/**
 * ops-alert 佇列的 processor（change queue-monitoring，design 決策 9）。
 *
 * 設定 Slack Webhook 時送到 Slack，失敗時丟錯，由佇列重試 3 次。保證是至少一次：
 * Slack 收下訊息之後、job 完成之前中斷時，同一則告警會再送一次。
 * 重試用完時，bullWorkerFactory() 的 failed 監聽寫入 log；告警監聽不監聽這個佇列，所以不發出新的告警。
 */
import type { Job } from 'bullmq';
import type { OpsAlertJob } from './ops-alert.service.js';
import { sendSlackAlert } from './slack-sender.js';
import { logOpsAlert } from './log-sender.js';

export function createOpsAlertProcessor(slackWebhookUrl?: string) {
  return async (job: Job<OpsAlertJob>): Promise<void> => {
    if (!slackWebhookUrl) {
      logOpsAlert(job.data);
      return;
    }
    await sendSlackAlert(slackWebhookUrl, job.data);
  };
}
