/**
 * 把告警送到 Slack Incoming Webhook（change queue-monitoring：ops-alert「設定 Slack Webhook 時送到 Slack」）。
 * 失敗時丟錯，由 ops-alert 佇列重試。
 */
import type { OpsAlertJob } from './ops-alert.service.js';

const SLACK_TIMEOUT_MS = 10_000;

/** 組成 Slack 的 mrkdwn 文字：標題、每個欄位一行、上一段期間沒有送出的次數、連結 */
export function formatOpsAlertText(alert: OpsAlertJob): string {
  const lines = [`*${alert.title}*`];
  for (const [name, value] of Object.entries(alert.fields)) {
    lines.push(`• ${name}：${value}`);
  }
  if (alert.suppressedCount > 0) {
    lines.push(`前一段期間另有 ${alert.suppressedCount} 次相同的告警沒有送出`);
  }
  if (alert.link) lines.push(`<${alert.link}|佇列監控>`);
  return lines.join('\n');
}

export async function sendSlackAlert(webhookUrl: string, alert: OpsAlertJob): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: formatOpsAlertText(alert) }),
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook 回應 HTTP ${res.status}`);
  }
}
