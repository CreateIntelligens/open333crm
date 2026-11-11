/**
 * 進站訊息因去識別化服務無法使用而存成未遮罩時的維運告警（issue #466，
 * change fix-deid-inbound-fallback-466：inbound-message-processing「進站訊息未遮罩時發出維運告警」）。
 *
 * 沿用 sendOpsAlert()：同一個合併鍵 10 分鐘內只送一則，下一則帶上期間內沒有送出的次數，
 * 所以每則降級的訊息都呼叫一次即可，不另外計數。sendOpsAlert() 會寫 Redis，不可在租戶交易內呼叫。
 * 告警只帶租戶、渠道類型與原因代碼，不帶訊息內容。發出失敗只記 log，不影響訊息的保存與後續處理。
 */
import { logger } from '@open333crm/core';
import { getSharedRedis } from '../../lib/redis-client.js';
import { sendOpsAlert, type OpsAlert } from '../ops-alert/ops-alert.service.js';
import type { DeidentificationFailureReason } from './deidentification.service.js';

export const DEIDENTIFICATION_ALERT_KEY = 'deidentification-unavailable';

export interface InboundUnmaskedAlertInput {
  tenantId: string;
  channelType: string;
  reason: DeidentificationFailureReason;
}

/**
 * send 預設以共用的 Redis 連線呼叫 sendOpsAlert()。進站管線拿不到 `fastify.redis`
 * （lib/redis-client.ts 列出 webhook 收訊流程是暫時的使用者，#443），注入之後改由呼叫端傳入。
 */
export async function alertInboundUnmasked(
  input: InboundUnmaskedAlertInput,
  send: (alert: OpsAlert) => Promise<boolean> = (alert) => sendOpsAlert(alert, { redis: getSharedRedis() }),
): Promise<void> {
  try {
    await send({
      key: DEIDENTIFICATION_ALERT_KEY,
      title: '去識別化服務無法使用：進站訊息未遮罩保存、未交給 AI',
      fields: { 租戶: input.tenantId, 渠道: input.channelType, 原因: input.reason },
    });
  } catch (err) {
    logger.error('[Deidentification] 發出維運告警失敗:', err);
  }
}
