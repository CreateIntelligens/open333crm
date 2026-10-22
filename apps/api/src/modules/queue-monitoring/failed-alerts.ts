/**
 * job 移到 failed set 時發出告警（change queue-monitoring，design 決策 8）。
 *
 * 每個監控的佇列（ops-alert 除外）一個 QueueEvents，監聽 failed 事件。BullMQ 只在 job 移到 failed set 時
 * 寫入 failed 事件：重試時寫入的是 delayed 或 waiting，所以不用自己比對 attemptsMade。
 * 不用 retries-exhausted 事件：job 丟出 UnrecoverableError 而提早失敗時，不會觸發這個事件。
 *
 * 告警不帶失敗原因與 job 資料：兩者都可能含客人的個資（ops-alert「告警內容不含 job 資料」）。
 */
import { logger } from '@open333crm/core';
import type { OpsAlert } from '../ops-alert/ops-alert.service.js';

/** BullMQ QueueEvents 用到的部分 */
export interface QueueEventsLike {
  on(event: 'failed', listener: (args: { jobId: string; failedReason: string }) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  close(): Promise<void>;
}

export interface FailedAlertsDeps {
  queueNames: readonly string[];
  createQueueEvents(name: string): QueueEventsLike;
  getJob(queueName: string, jobId: string): Promise<{ name: string; data: unknown; attemptsMade: number } | null | undefined>;
  sendAlert(alert: OpsAlert): Promise<unknown>;
  /** 佇列監控畫面的網址，例如 https://<網域>/api/v1/platform/queues */
  dashboardUrl: string;
}

function topLevelTenantId(data: unknown): string | undefined {
  if (data === null || typeof data !== 'object') return undefined;
  const tenantId = (data as Record<string, unknown>).tenantId;
  return typeof tenantId === 'string' ? tenantId : undefined;
}

export function startFailedAlerts(deps: FailedAlertsDeps): { close(): Promise<void> } {
  async function alertFailedJob(queueName: string, jobId: string) {
    const job = await deps.getJob(queueName, jobId).catch((err: unknown) => {
      logger.warn(`[queue-monitoring] 讀取 ${queueName} 的 failed job ${jobId} 失敗，告警只帶 job id`, err);
      return undefined;
    });
    const fields: Record<string, string | number> = { 佇列: queueName, 'job id': jobId };
    if (job) {
      fields['job 名稱'] = job.name;
      const tenantId = topLevelTenantId(job.data);
      if (tenantId) fields['租戶 id'] = tenantId;
      fields['重試次數'] = job.attemptsMade;
    }
    await deps.sendAlert({
      key: `queue-failed:${queueName}`,
      title: '佇列 job 失敗',
      fields,
      link: `${deps.dashboardUrl}/queue/${encodeURIComponent(queueName)}/${encodeURIComponent(jobId)}`,
    });
  }

  const events = deps.queueNames.map((queueName) => {
    const queueEvents = deps.createQueueEvents(queueName);
    queueEvents.on('failed', ({ jobId }) => {
      alertFailedJob(queueName, jobId).catch((err: unknown) =>
        logger.error(`[queue-monitoring] ${queueName} 的 job ${jobId} 告警送出失敗`, err),
      );
    });
    // 必須註冊：沒有 error listener 時，Redis 斷線會變成 uncaught error
    queueEvents.on('error', (err) => logger.error(`[queue-monitoring] ${queueName} 的 QueueEvents 錯誤`, err));
    return queueEvents;
  });

  return { close: async () => void (await Promise.all(events.map((e) => e.close()))) };
}
