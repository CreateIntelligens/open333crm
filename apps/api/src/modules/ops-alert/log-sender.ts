/**
 * 沒有設定 Slack Webhook 時的送出端：只寫 log，不對外送出請求
 * （change queue-monitoring：ops-alert「沒有設定管道時只記錄 log」）。
 */
import { logger } from '@open333crm/core';
import type { OpsAlertJob } from './ops-alert.service.js';
import { formatOpsAlertText } from './slack-sender.js';

export function logOpsAlert(alert: OpsAlertJob): void {
  logger.warn(`[ops-alert] ${formatOpsAlertText(alert)}`);
}
