/**
 * usage-alert-email 佇列的 processor：寄出一封用量告警信（change outbox-event-delivery，design 決策 10）。
 *
 * 通知訂閱者為每個告警事件、每位管理員建立一個 job，job id 是 <事件 id>__<管理員 id>。
 * 所以事件重送時不會重寄；寄送失敗時丟錯，由 BullMQ 重試。
 */
import type { Job } from 'bullmq';
import { sendQuotaCriticalEmail, sendQuotaWarningEmail, type QuotaEmailVars } from '../trial/usage-alert-emails.js';

export interface UsageAlertEmailJob {
  level: 'warning' | 'critical';
  to: string;
  vars: QuotaEmailVars;
}

export async function processUsageAlertEmail(job: Job<UsageAlertEmailJob>): Promise<void> {
  const { level, to, vars } = job.data;
  await (level === 'critical' ? sendQuotaCriticalEmail : sendQuotaWarningEmail)(to, vars);
}
