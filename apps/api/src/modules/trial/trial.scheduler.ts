/**
 * 試用生命週期排程：每小時 + 啟動即跑一次。
 * - 提醒：剩餘天數到達 reminderDaysBefore 檔位且未寄過 → 寄該租戶 ADMIN → 標記（DB 冪等）
 * - 到期：trialEndsAt < now 且仍 active → isActive=false + 到期信 + 稽核
 * - 軟刪：已停用試用租戶，trialEndsAt 距今 > dataRetentionDays 天且 purgedAt=null →
 *   設 purgedAt=now（標記，不真刪 DB，可復原）+ 稽核
 * 逐租戶 try/catch，單一失敗不影響其他。DB 掃描每輪讀最新 trialEndsAt 與 policy。
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '@open333crm/core';
import { getTrialPolicy } from './trial-policy.service.js';
import { sendReminderEmail, sendExpiredEmail } from './trial-emails.js';

const HOUR_MS = 3600_000;
const DAY_MS = 86400_000;

function daysLeft(trialEndsAt: Date, now: number): number {
  return Math.ceil((trialEndsAt.getTime() - now) / DAY_MS);
}

async function adminEmails(prisma: PrismaClient, tenantId: string): Promise<string[]> {
  const admins = await prisma.agent.findMany({
    where: { tenantId, role: 'ADMIN', isActive: true },
    select: { email: true },
  });
  return admins.map((a) => a.email);
}

export async function runTrialLifecycle(prisma: PrismaClient): Promise<void> {
  const policy = await getTrialPolicy(prisma);
  const now = Date.now();

  const trialTenants = await prisma.tenant.findMany({
    where: { trialEndsAt: { not: null }, isActive: true },
    select: { id: true, name: true, trialEndsAt: true, trialRemindersSent: true },
  });

  for (const t of trialTenants) {
    try {
      const endsAt = t.trialEndsAt!;
      // ── 到期 ──
      if (endsAt.getTime() < now) {
        await prisma.tenant.update({ where: { id: t.id }, data: { isActive: false } });
        const emails = await adminEmails(prisma, t.id);
        for (const e of emails) await sendExpiredEmail(e, { siteName: t.name });
        await prisma.platformAuditLog.create({
          // platformUserId 省略 = 系統排程動作
          data: { action: 'tenant.trial.expire', targetType: 'tenant', targetId: t.id },
        }).catch(() => {
          /* 稽核失敗不阻斷停用 */
        });
        logger.info(`[TrialScheduler] tenant ${t.id} trial expired → disabled`);
        continue;
      }

      // ── 提醒 ──
      const left = daysLeft(endsAt, now);
      const sent = (t.trialRemindersSent as number[]) ?? [];
      // 找最大的「≤ left 尚未寄」檔位（跳檔位補寄：停機跨天不漏）
      const dueMilestone = [...policy.reminderDaysBefore]
        .sort((a, b) => b - a)
        .find((m) => left <= m && !sent.includes(m));
      if (dueMilestone !== undefined) {
        const emails = await adminEmails(prisma, t.id);
        const expireDate = endsAt.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
        for (const e of emails) await sendReminderEmail(e, { siteName: t.name, daysLeft: left, expireDate });
        await prisma.tenant.update({
          where: { id: t.id },
          data: { trialRemindersSent: [...sent, dueMilestone] as Prisma.InputJsonValue },
        });
        logger.info(`[TrialScheduler] tenant ${t.id} reminder sent (milestone=${dueMilestone}, left=${left})`);
      }
    } catch (err) {
      logger.error(`[TrialScheduler] failed for tenant ${t.id}:`, err);
    }
  }

  // ── 軟刪：已停用試用租戶超過保留期 → 標記 purgedAt（不真刪 DB）──
  const retentionMs = policy.dataRetentionDays * DAY_MS;
  const purgeCandidates = await prisma.tenant.findMany({
    where: { isActive: false, trialEndsAt: { not: null }, purgedAt: null },
    select: { id: true, name: true, trialEndsAt: true },
  });
  for (const t of purgeCandidates) {
    try {
      // 保留期基準用 trialEndsAt（非停用時間）：到期後滿 dataRetentionDays 天才軟刪
      if (t.trialEndsAt!.getTime() + retentionMs > now) continue;
      await prisma.tenant.update({ where: { id: t.id }, data: { purgedAt: new Date(now) } });
      await prisma.platformAuditLog
        .create({
          // platformUserId 省略 = 系統排程動作
          data: { action: 'tenant.trial.purge', targetType: 'tenant', targetId: t.id },
        })
        .catch(() => {
          /* 稽核失敗不阻斷軟刪 */
        });
      logger.info(`[TrialScheduler] tenant ${t.id} data-retention expired → purged (soft)`);
    } catch (err) {
      logger.error(`[TrialScheduler] purge failed for tenant ${t.id}:`, err);
    }
  }
}

export function setupTrialScheduler(prisma: PrismaClient): void {
  runTrialLifecycle(prisma).catch((err) => logger.error('[TrialScheduler] startup run failed:', err));
  setInterval(() => {
    runTrialLifecycle(prisma).catch((err) => logger.error('[TrialScheduler] periodic run failed:', err));
  }, HOUR_MS);
  logger.info('[TrialScheduler] Started — hourly trial reminder/expiry sweep');
}
