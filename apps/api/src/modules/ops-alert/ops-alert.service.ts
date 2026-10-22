/**
 * 維運告警（change queue-monitoring：ops-alert，design 決策 9）。
 *
 * sendOpsAlert() 以 Redis 合併同一個合併鍵的告警，通過時把告警放進 ops-alert 佇列，
 * 由 ops-alert.worker.ts 在發出告警的程式之外送出。告警是平台層的事，不讀寫租戶資料表，
 * 所以不收 TenantCtx；它會寫 Redis，不能在租戶的交易內呼叫。
 */
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { redis as coreRedis } from '@open333crm/core';

export const OPS_ALERT_QUEUE = 'ops-alert';

/** 同一個合併鍵在這段期間內只送一則 */
export const OPS_ALERT_WINDOW_MS = 600_000;

/**
 * 沒有送出的次數保留多久。要比合併的期間長：計數在期間結束之後，由下一則送出的告警取走。
 * 期間結束後一直沒有新的告警時，計數在這段時間後過期。
 */
const SUPPRESSED_COUNT_TTL_MS = 86_400_000;

export interface OpsAlert {
  /** 合併鍵，例如 `queue-failed:<佇列名稱>` */
  key: string;
  title: string;
  fields: Record<string, string | number>;
  link?: string;
}

/** ops-alert 佇列的 job 資料 */
export interface OpsAlertJob {
  title: string;
  fields: Record<string, string | number>;
  link?: string;
  /** 上一段期間同一個合併鍵沒有送出的次數 */
  suppressedCount: number;
}

export interface OpsAlertDeps {
  redis: Pick<Redis, 'set' | 'incr' | 'pexpire' | 'getdel'>;
  queue: Pick<Queue<OpsAlertJob>, 'add'>;
}

// Lazy init：避免在 dotenv 載入前讀到 undefined REDIS_URL
let _opsAlertQueue: Queue<OpsAlertJob> | null = null;
function opsAlertQueue(): Queue<OpsAlertJob> {
  if (!_opsAlertQueue) {
    _opsAlertQueue = new Queue<OpsAlertJob>(OPS_ALERT_QUEUE, {
      connection: { url: process.env.REDIS_URL! },
      // 送出告警至少一次：失敗時重試 3 次，重試用完只記 log（ops-alert「送出告警至少一次」）
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    });
  }
  return _opsAlertQueue;
}

export async function closeOpsAlertQueue(): Promise<void> {
  if (!_opsAlertQueue) return;
  await _opsAlertQueue.close();
  _opsAlertQueue = null;
}

/**
 * 發出一則告警。同一個合併鍵在 10 分鐘內只送出第一則，其他的只計數；
 * 下一則送出的告警帶上這個次數。計數放在 Redis，多個 API 實例也只送一則。
 * 回傳 true 代表這則告警已放進佇列。
 */
export async function sendOpsAlert(
  alert: OpsAlert,
  deps: OpsAlertDeps = { redis: coreRedis, queue: opsAlertQueue() },
): Promise<boolean> {
  const gateKey = `ops-alert:${alert.key}`;
  const suppressedKey = `${gateKey}:suppressed`;

  const opened = await deps.redis.set(gateKey, '1', 'PX', OPS_ALERT_WINDOW_MS, 'NX');
  if (!opened) {
    await deps.redis.incr(suppressedKey);
    await deps.redis.pexpire(suppressedKey, SUPPRESSED_COUNT_TTL_MS);
    return false;
  }

  const suppressedCount = Number((await deps.redis.getdel(suppressedKey)) ?? 0);
  await deps.queue.add('ops-alert:send', {
    title: alert.title,
    fields: alert.fields,
    ...(alert.link ? { link: alert.link } : {}),
    suppressedCount,
  });
  return true;
}
