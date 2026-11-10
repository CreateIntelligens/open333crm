/**
 * 合約到期前提醒排程（change add-contract-expiry-reminder）：每小時一次（Job Scheduler 觸發，
 * withoutOverlapping 防兩期重疊），對啟用中、合約迄日未過的租戶，到達提醒檔位時寄信給所有啟用中的平台帳號。
 *
 * - 剩餘天數以台灣日曆日計算：迄日的日期 − 台灣今天的日期（design D1）。迄日當天為 0，隔天起為負（已過期，不寄）。
 * - 檔位選「≥ 剩餘天數」中最小的一個；未寄過才寄，並把它與更大的檔位一起標記，晚設定的合約不會一小時內連收多封（D2）。
 * - 讀取 → 以讀到的 contractEndDate 與 contractRemindersSent 做條件更新認領 → 認領成功才寄信（D3）。
 *   平台人員在讀取後改了迄日或停用租戶，條件不成立，這一筆略過。
 * - 只寄提醒，MUST NOT 停用租戶：到期是否停用需要產品決定（issue #494）。
 * 逐租戶 try/catch，單一失敗不影響其他。
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import type { JobScheduler } from '../../lib/job-scheduler.js';
import { getContractReminderDays } from './contract-policy.service.js';
import { sendContractExpiryReminderEmail } from './platform-user-emails.js';

const HOUR_MS = 3600_000;
// 鎖的存活時間：要長於最久的執行時間，也要短於週期（同 trial.scheduler）
const MAX_RUN_MS = 30 * 60_000;
const DAY_MS = 86400_000;
// 台灣沒有日光節約時間，固定 UTC+8
const TAIPEI_OFFSET_MS = 8 * HOUR_MS;

/** 台灣時區「今天」的日期，以該日 UTC 00:00 表示（與 date input 存入的迄日同一基準）。 */
function taipeiToday(now: number): Date {
  return new Date(new Date(now + TAIPEI_OFFSET_MS).toISOString().slice(0, 10) + 'T00:00:00.000Z');
}

/** 迄日的日期 − 今天的日期（天）。迄日取 UTC 日期部分，與平台後台 date input 的存法一致。 */
function calendarDaysLeft(endDate: Date, today: Date): number {
  const endDay = Date.parse(endDate.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  return Math.round((endDay - today.getTime()) / DAY_MS);
}

/**
 * @description 依剩餘天數挑出要寄的檔位
 * @param left 剩餘天數（≥ 0）
 * @param milestones 提醒檔位
 * @param sent 目前迄日已寄過的檔位
 * @returns 要寄的檔位與寄出後的已寄清單；不需寄信時回 null
 */
function pickMilestone(left: number, milestones: number[], sent: number[]): { milestone: number; nextSent: number[] } | null {
  const reached = milestones.filter((m) => left <= m);
  if (reached.length === 0) return null;
  const milestone = Math.min(...reached);
  if (sent.includes(milestone)) return null;
  const nextSent = [...sent, ...reached.filter((m) => !sent.includes(m)).sort((a, b) => b - a)];
  return { milestone, nextSent };
}

export interface ContractReminderOptions {
  now?: number;
  /** 前端網址，信中租戶詳細頁連結用 */
  webBaseUrl: string;
}

export async function runContractReminders(prisma: PrismaClient, opts: ContractReminderOptions): Promise<void> {
  const now = opts.now ?? Date.now();
  const today = taipeiToday(now);
  const milestones = await getContractReminderDays(prisma);

  const rows = await prisma.tenant.findMany({
    where: { isActive: true, contractEndDate: { gte: today } },
    select: { id: true, name: true, contractEndDate: true, contractRemindersSent: true },
  });

  let recipients: { email: string }[] | null = null;

  for (const t of rows) {
    try {
      const endDate = t.contractEndDate;
      if (!endDate) continue;
      // 查詢已排除迄日早於今天的租戶，left ≥ 0
      const left = calendarDaysLeft(endDate, today);
      const sent = Array.isArray(t.contractRemindersSent) ? (t.contractRemindersSent as number[]) : [];
      const pick = pickMilestone(left, milestones, sent);
      if (!pick) continue;

      // 認領：條件帶讀到的迄日與已寄清單，讀取後被修改或兩期重疊時只有一方寄信
      const { count } = await prisma.tenant.updateMany({
        where: {
          id: t.id,
          isActive: true,
          contractEndDate: endDate,
          contractRemindersSent: { equals: sent as Prisma.InputJsonValue },
        },
        data: { contractRemindersSent: pick.nextSent as Prisma.InputJsonValue },
      });
      if (count === 0) continue;

      recipients ??= await prisma.platformUser.findMany({ where: { isActive: true }, select: { email: true } });
      if (recipients.length === 0) {
        logger.warn(`[ContractReminder] tenant ${t.id} milestone=${pick.milestone}: no active platform user to notify`);
        continue;
      }
      const vars = {
        tenantName: t.name,
        endDate: endDate.toISOString().slice(0, 10).replace(/-/g, '/'),
        daysLeft: left,
        tenantUrl: `${opts.webBaseUrl}/admin/tenants/${t.id}`,
      };
      for (const r of recipients) await sendContractExpiryReminderEmail(r.email, vars);
      logger.info(`[ContractReminder] tenant ${t.id} reminder sent (milestone=${pick.milestone}, left=${left})`);
    } catch (err) {
      logger.error(`[ContractReminder] reminder failed for tenant ${t.id}:`, err);
    }
  }
}

export function setupContractReminderScheduler(scheduler: JobScheduler, prisma: PrismaClient): void {
  scheduler.registerSchedule({
    id: 'contract-reminder',
    every: HOUR_MS,
    withoutOverlapping: { expiresInMs: MAX_RUN_MS },
    run: () => runContractReminders(prisma, { webBaseUrl: getConfig().WEB_BASE_URL }),
  });
}
