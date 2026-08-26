/**
 * 用量告警信件（AI token 月額度達 80% / 100%）。
 * 平台級、內容簡單 → 純 HTML 模板 + {{變數}} 替換，樣式對齊 trial-emails.ts。
 * 寄信一律 fire-and-forget，失敗只 log（呼叫端負責）。
 */
import { renderTemplateBody } from '../marketing/template-renderer.js';
import { sendEmail } from '../email/email.service.js';
import { logger } from '@open333crm/core';

// ── 品牌與樣式常數（對齊 trial-emails.ts）──
const BRAND = '#0d9488';
const INK = '#1a2230';
const MUTED = '#66707f';
const FAINT = '#97a0ae';
const BG = '#eef1f5';
const WARN = '#b7791f'; // warning 琥珀
const CRIT = '#d1443e'; // critical 紅
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang TC','Microsoft JhengHei',Roboto,Helvetica,Arial,sans-serif";

function wrap(opts: { emoji: string; heading: string; accent: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.heading}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(20,30,50,.06),0 8px 24px rgba(20,30,50,.08);">
        <tr><td style="background:${opts.accent};padding:28px 36px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:15px;font-weight:700;color:#ffffff;letter-spacing:.3px;">open333 <span style="opacity:.75;font-weight:500;">CRM</span></td>
            <td align="right" style="font-size:26px;line-height:1;">${opts.emoji}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px 36px 8px;">
          <h1 style="font-size:21px;line-height:1.35;margin:0 0 16px;color:${INK};font-weight:700;">${opts.heading}</h1>
          ${opts.bodyHtml}
        </td></tr>
        <tr><td style="padding:20px 36px 28px;border-top:1px solid #eef1f5;">
          <p style="font-size:12px;color:${FAINT};margin:0;line-height:1.6;">此信由 open333 CRM 系統自動發送，請勿直接回覆。</p>
        </td></tr>
      </table>
      <p style="font-size:11px;color:${FAINT};margin:16px 0 0;">© open333 CRM</p>
    </td></tr>
  </table>
</body></html>`;
}

function button(href: string, label: string, color = BRAND): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;"><tr><td align="center" style="border-radius:10px;background:${color};box-shadow:0 2px 6px rgba(13,148,136,.35);">
    <a href="${href}" target="_blank" style="display:inline-block;padding:13px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:10px;">${label}</a>
  </td></tr></table>`;
}

const p = (t: string) => `<p style="font-size:15px;line-height:1.7;color:${INK};margin:0 0 14px;">${t}</p>`;
const small = (t: string) => `<p style="font-size:13px;line-height:1.6;color:${MUTED};margin:14px 0 0;">${t}</p>`;
const usageRow = (label: string, value: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr>
    <td style="font-size:13px;color:${MUTED};padding-right:10px;">${label}</td>
    <td style="font-size:15px;font-weight:700;color:${INK};">${value}</td>
  </tr></table>`;

const WARNING_HTML = wrap({
  emoji: '📊',
  heading: 'AI 用量已達 80%',
  accent: WARN,
  bodyHtml:
    p('您的站台「<strong>{{siteName}}</strong>」本月（{{monthKey}}）AI 用量已達方案額度的 <strong>80%</strong>。') +
    usageRow('已用 / 上限', '{{usedTokens}} / {{limitTokens}} tokens') +
    p('額度用盡後 AI 自動回覆將暫停（真人回覆不受影響）。如需提高額度，歡迎升級方案或加購。') +
    button('{{usageUrl}}', '查看用量與方案', WARN),
});

const CRITICAL_HTML = wrap({
  emoji: '🚨',
  heading: 'AI 用量已達上限',
  accent: CRIT,
  bodyHtml:
    p('您的站台「<strong>{{siteName}}</strong>」本月（{{monthKey}}）AI 用量已達方案額度上限。') +
    usageRow('已用 / 上限', '{{usedTokens}} / {{limitTokens}} tokens') +
    p('<strong>AI 自動回覆已暫停</strong>，直到下月額度重置或升級方案為止。<strong>真人回覆不受影響</strong>，客服人員仍可正常收發訊息。') +
    button('{{usageUrl}}', '升級方案', CRIT),
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(template: string, vars: Record<string, string>): string {
  const escaped: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) escaped[k] = escapeHtml(String(v ?? ''));
  return renderTemplateBody(template, escaped);
}

async function safeSend(to: string, subject: string, html: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await sendEmail({ to, subject, html, metadata });
  } catch (err) {
    logger.error(`[UsageAlertEmail] send failed to=${to} subject="${subject}":`, err);
  }
}

interface QuotaEmailVars {
  siteName: string;
  usedTokens: string;
  limitTokens: string;
  monthKey: string;
  usageUrl: string;
}

/** 80% 告警信。 */
export async function sendQuotaWarningEmail(to: string, vars: QuotaEmailVars): Promise<void> {
  const html = render(WARNING_HTML, { ...vars });
  await safeSend(to, `【open333】AI 用量提醒（80%）：${vars.siteName}`, html, { monthKey: vars.monthKey });
}

/** 100% 已達上限信。 */
export async function sendQuotaCriticalEmail(to: string, vars: QuotaEmailVars): Promise<void> {
  const html = render(CRITICAL_HTML, { ...vars });
  await safeSend(to, `【open333】AI 用量已達上限：${vars.siteName}`, html, { monthKey: vars.monthKey });
}
