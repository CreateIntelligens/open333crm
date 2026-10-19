/**
 * 試用生命週期排程：每小時 + 啟動即跑一次，依序執行三步。
 * - 到期：trialEndsAt < now 且仍 active → isActive=false + 到期信 + 稽核
 * - 提醒：剩餘天數到達 reminderDaysBefore 檔位且未寄過 → 標記 → 寄該租戶 ADMIN
 * - 軟刪：已停用試用租戶，trialEndsAt 距今 > dataRetentionDays 天且 purgedAt=null →
 *   設 purgedAt=now（標記，不真刪 DB，可復原）+ 稽核
 *
 * 每一步都是「讀取 → 逐筆認領 → 認領成功才寄信與寫稽核」。認領是以讀取時的條件加上 id
 * 做條件更新：讀取之後租戶被延長、轉正式、停用，或被另一次排程先處理，條件就不成立，
 * 這一筆略過，不會用讀到的舊狀態蓋掉別人的結果。
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

async function writeSystemAudit(prisma: PrismaClient, action: string, tenantId: string): Promise<void> {
  await prisma.platformAuditLog
    .create({
      // platformUserId 省略 = 系統排程動作
      data: { action, targetType: 'tenant', targetId: tenantId },
    })
    .catch(() => {
      /* 稽核失敗不阻斷排程動作 */
    });
}

interface Claim {
  where: Prisma.TenantWhereInput;
  data: Prisma.TenantUpdateManyMutationInput;
}

/**
 * 逐筆認領：以 claim 的 where 加上 id 做條件更新，更新到這一筆才執行 after。
 * 寄信失敗只記 log（trial-emails 的 safeSend），所以先認領再寄信不會漏掉原本會重寄的信。
 */
async function claimEach<T extends { id: string }>(
  prisma: PrismaClient,
  step: string,
  rows: T[],
  claim: (t: T) => Claim,
  after: (t: T) => Promise<void>,
): Promise<void> {
  for (const t of rows) {
    try {
      const { where, data } = claim(t);
      const { count } = await prisma.tenant.updateMany({ where: { ...where, id: t.id }, data });
      if (count === 0) continue;
      await after(t);
    } catch (err) {
      logger.error(`[TrialScheduler] ${step} failed for tenant ${t.id}:`, err);
    }
  }
}

async function expireTrials(prisma: PrismaClient, now: number): Promise<void> {
  const expired: Prisma.TenantWhereInput = { isActive: true, trialEndsAt: { lt: new Date(now) } };
  const rows = await prisma.tenant.findMany({ where: expired, select: { id: true, name: true } });

  await claimEach(prisma, 'expire', rows, () => ({ where: expired, data: { isActive: false } }), async (t) => {
    for (const e of await adminEmails(prisma, t.id)) await sendExpiredEmail(e, { siteName: t.name });
    await writeSystemAudit(prisma, 'tenant.trial.expire', t.id);
    logger.info(`[TrialScheduler] tenant ${t.id} trial expired → disabled`);
  });
}

async function remindTrials(prisma: PrismaClient, now: number, milestones: number[]): Promise<void> {
  const rows = await prisma.tenant.findMany({
    where: { isActive: true, trialEndsAt: { gte: new Date(now) } },
    select: { id: true, name: true, trialEndsAt: true, trialRemindersSent: true },
  });
  const due = rows.flatMap((t) => {
    const endsAt = t.trialEndsAt!;
    const left = daysLeft(endsAt, now);
    const sent = (t.trialRemindersSent as number[]) ?? [];
    // 找最大的「≤ left 尚未寄」檔位（跳檔位補寄：停機跨天不漏）
    const milestone = [...milestones].sort((a, b) => b - a).find((m) => left <= m && !sent.includes(m));
    return milestone === undefined ? [] : [{ id: t.id, name: t.name, endsAt, left, sent, milestone }];
  });

  await claimEach(
    prisma,
    'reminder',
    due,
    (t) => ({
      // trialRemindersSent 也要是讀到的值：兩次排程同時讀到同一筆時，只有一次寄信
      where: { isActive: true, trialEndsAt: t.endsAt, trialRemindersSent: { equals: t.sent } },
      data: { trialRemindersSent: [...t.sent, t.milestone] as Prisma.InputJsonValue },
    }),
    async (t) => {
      const expireDate = t.endsAt.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
      for (const e of await adminEmails(prisma, t.id)) {
        await sendReminderEmail(e, { siteName: t.name, daysLeft: t.left, expireDate });
      }
      logger.info(`[TrialScheduler] tenant ${t.id} reminder sent (milestone=${t.milestone}, left=${t.left})`);
    },
  );
}

async function purgeTrials(prisma: PrismaClient, now: number, retentionDays: number): Promise<void> {
  // 保留期基準用 trialEndsAt（非停用時間）：到期後滿 dataRetentionDays 天才軟刪
  const purgeable: Prisma.TenantWhereInput = {
    isActive: false,
    purgedAt: null,
    trialEndsAt: { lte: new Date(now - retentionDays * DAY_MS) },
  };
  const rows = await prisma.tenant.findMany({ where: purgeable, select: { id: true } });

  await claimEach(prisma, 'purge', rows, () => ({ where: purgeable, data: { purgedAt: new Date(now) } }), async (t) => {
    await writeSystemAudit(prisma, 'tenant.trial.purge', t.id);
    logger.info(`[TrialScheduler] tenant ${t.id} data-retention expired → purged (soft)`);
  });
}

export async function runTrialLifecycle(prisma: PrismaClient): Promise<void> {
  const policy = await getTrialPolicy(prisma);
  const now = Date.now();

  // 到期先於軟刪：早已過保留期的租戶，同一次執行中先停用，再標記
  await expireTrials(prisma, now);
  await remindTrials(prisma, now, policy.reminderDaysBefore);
  await purgeTrials(prisma, now, policy.dataRetentionDays);
}

export function setupTrialScheduler(prisma: PrismaClient): void {
  runTrialLifecycle(prisma).catch((err) => logger.error('[TrialScheduler] startup run failed:', err));
  setInterval(() => {
    runTrialLifecycle(prisma).catch((err) => logger.error('[TrialScheduler] periodic run failed:', err));
  }, HOUR_MS);
  logger.info('[TrialScheduler] Started — hourly trial reminder/expiry sweep');
}
