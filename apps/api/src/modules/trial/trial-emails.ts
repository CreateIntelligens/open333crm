/**
 * 平台級試用信件（驗證/開通完成/到期提醒/到期通知）。
 * 平台級、不需租戶自訂、內容簡單 → 直接純 HTML 模板 + {{變數}} 替換。
 * 刻意不走 MJML：mjml 是可選 runtime 依賴，未安裝時 compileMjml 會 fallback
 * 成「strip 標籤」把按鈕 href 丟掉 → 信裡連結消失。純 HTML 無此風險。
 * 寄信一律 fire-and-forget，失敗只 log（呼叫端負責）。
 */
import { renderTemplateBody } from '../marketing/template-renderer.js';
import { sendEmail } from '../email/email.service.js';
import { logger } from '@open333crm/core';

// ── 品牌與樣式常數 ──
const BRAND = '#0d9488';
const INK = '#1a2230';
const MUTED = '#66707f';
const FAINT = '#97a0ae';
const BG = '#eef1f5';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang TC','Microsoft JhengHei',Roboto,Helvetica,Arial,sans-serif";

/**
 * email-safe 外殼：品牌色 header + 白卡片 + 頁尾。
 * 全部 inline style + table 佈局（Outlook/Gmail/Apple Mail 相容）。
 * accent 依信件類型帶不同強調色（emoji + header 底色）。
 */
function wrap(opts: { emoji: string; heading: string; accent?: string; bodyHtml: string }): string {
  const accent = opts.accent ?? BRAND;
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.heading}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(20,30,50,.06),0 8px 24px rgba(20,30,50,.08);">
        <!-- 品牌 header -->
        <tr><td style="background:${accent};padding:28px 36px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:15px;font-weight:700;color:#ffffff;letter-spacing:.3px;">open333 <span style="opacity:.75;font-weight:500;">CRM</span></td>
            <td align="right" style="font-size:26px;line-height:1;">${opts.emoji}</td>
          </tr></table>
        </td></tr>
        <!-- 內容 -->
        <tr><td style="padding:32px 36px 8px;">
          <h1 style="font-size:21px;line-height:1.35;margin:0 0 16px;color:${INK};font-weight:700;">${opts.heading}</h1>
          ${opts.bodyHtml}
        </td></tr>
        <!-- 頁尾 -->
        <tr><td style="padding:20px 36px 28px;border-top:1px solid #eef1f5;">
          <p style="font-size:12px;color:${FAINT};margin:0;line-height:1.6;">此信由 open333 CRM 系統自動發送，請勿直接回覆。</p>
        </td></tr>
      </table>
      <p style="font-size:11px;color:${FAINT};margin:16px 0 0;">© open333 CRM</p>
    </td></tr>
  </table>
</body></html>`;
}

// bulletproof 按鈕（VML 讓 Outlook 也有圓角底色）
function button(href: string, label: string, color = BRAND): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;"><tr><td align="center" style="border-radius:10px;background:${color};box-shadow:0 2px 6px rgba(13,148,136,.35);">
    <a href="${href}" target="_blank" style="display:inline-block;padding:13px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:10px;">${label}</a>
  </td></tr></table>`;
}

const p = (t: string) => `<p style="font-size:15px;line-height:1.7;color:${INK};margin:0 0 14px;">${t}</p>`;
const small = (t: string) => `<p style="font-size:13px;line-height:1.6;color:${MUTED};margin:14px 0 0;">${t}</p>`;
// 淡色資訊卡（放連結備援 / 憑證提示）
const infobox = (t: string) =>
  `<div style="margin:16px 0 4px;padding:12px 14px;background:#f7f9fc;border:1px solid #e8edf3;border-radius:10px;font-size:12.5px;line-height:1.6;color:${MUTED};word-break:break-all;">${t}</div>`;
// 到期日高亮列
const highlight = (label: string, value: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr>
    <td style="font-size:13px;color:${MUTED};padding-right:10px;">${label}</td>
    <td style="font-size:15px;font-weight:700;color:${INK};">${value}</td>
  </tr></table>`;

const VERIFY_HTML = wrap({
  emoji: '👋',
  heading: '歡迎試用 open333 CRM',
  bodyHtml:
    p('您好，感謝申請「<strong>{{siteName}}</strong>」的免費試用站台。') +
    p('請點擊下方按鈕完成 email 驗證，系統將立即為您開通站台：') +
    button('{{verifyUrl}}', '完成驗證並開通') +
    small('此連結 <strong>{{ttlHours}}</strong> 小時內有效。若非您本人申請，請忽略此信。') +
    infobox('按鈕無法點擊？請複製以下連結至瀏覽器開啟：<br><a href="{{verifyUrl}}" style="color:' + BRAND + ';">{{verifyUrl}}</a>'),
});

const PROVISIONED_HTML = wrap({
  emoji: '🎉',
  heading: '站台已開通完成',
  bodyHtml:
    p('「<strong>{{siteName}}</strong>」試用站台已成功開通。') +
    highlight('試用至', '{{expireDate}}') +
    p('使用您申請時設定的 email 與密碼即可登入：') +
    button('{{loginUrl}}', '前往登入'),
});

// 平台手動開通用：密碼由開通人員設定，信裡不能帶密碼，註明請洽開通人員
const MANUAL_PROVISIONED_HTML = wrap({
  emoji: '🎉',
  heading: '站台已開通完成',
  bodyHtml:
    p('「<strong>{{siteName}}</strong>」站台已為您開通完成。') +
    p('請使用本信箱（<strong>{{adminEmail}}</strong>）登入：') +
    button('{{loginUrl}}', '前往登入') +
    small('登入密碼由開通人員為您設定，請向開通人員索取；登入後建議立即修改密碼。') +
    infobox('按鈕無法點擊？請複製以下連結至瀏覽器開啟：<br><a href="{{loginUrl}}" style="color:' + BRAND + ';">{{loginUrl}}</a>'),
});

const REMINDER_HTML = wrap({
  emoji: '⏰',
  heading: '試用即將到期',
  accent: '#b7791f',
  bodyHtml:
    p('您的試用站台「<strong>{{siteName}}</strong>」將於 <strong>{{daysLeft}}</strong> 天後（{{expireDate}}）到期。') +
    p('到期後站台將暫停使用，資料會保留一段時間。如需繼續使用，歡迎聯絡我們升級為正式方案。'),
});

const EXPIRED_HTML = wrap({
  emoji: '🔔',
  heading: '試用已到期',
  accent: '#d1443e',
  bodyHtml:
    p('您的試用站台「<strong>{{siteName}}</strong>」已到期並暫停使用，您的資料仍為您完整保留。') +
    p('如需恢復並繼續使用，歡迎聯絡我們升級為正式方案。'),
});

/** HTML 轉義：變數值可能含使用者輸入（如 siteName 為申請時自填），
 *  塞進 email HTML 前必須轉義，避免 HTML/XSS 注入。URL（& 轉 &amp;）不受影響。 */
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
    logger.error(`[TrialEmail] send failed to=${to} subject="${subject}":`, err);
  }
}

export async function sendVerifyEmail(
  to: string,
  vars: { siteName: string; verifyUrl: string; ttlHours: number },
): Promise<void> {
  const html = render(VERIFY_HTML, {
    siteName: vars.siteName,
    verifyUrl: vars.verifyUrl,
    ttlHours: String(vars.ttlHours),
  });
  // verifyUrl 放 metadata → log 模式可從日誌取連結驗證
  await safeSend(to, `【open333】請驗證您的試用申請：${vars.siteName}`, html, { verifyUrl: vars.verifyUrl });
}

export async function sendProvisionedEmail(
  to: string,
  vars: { siteName: string; loginUrl: string; expireDate: string },
): Promise<void> {
  const html = render(PROVISIONED_HTML, vars);
  await safeSend(to, `【open333】試用站台已開通：${vars.siteName}`, html, { loginUrl: vars.loginUrl });
}

/** 平台手動開通信：不帶密碼（密碼由開通人員線下轉交），只帶登入網址。 */
export async function sendManualProvisionedEmail(
  to: string,
  vars: { siteName: string; loginUrl: string; adminEmail: string },
): Promise<void> {
  const html = render(MANUAL_PROVISIONED_HTML, vars);
  await safeSend(to, `【open333】站台已開通：${vars.siteName}`, html, { loginUrl: vars.loginUrl });
}

export async function sendReminderEmail(
  to: string,
  vars: { siteName: string; daysLeft: number; expireDate: string },
): Promise<void> {
  const html = render(REMINDER_HTML, {
    siteName: vars.siteName,
    daysLeft: String(vars.daysLeft),
    expireDate: vars.expireDate,
  });
  await safeSend(to, `【open333】試用即將到期（剩 ${vars.daysLeft} 天）：${vars.siteName}`, html, {});
}

export async function sendExpiredEmail(to: string, vars: { siteName: string }): Promise<void> {
  const html = render(EXPIRED_HTML, vars);
  await safeSend(to, `【open333】試用已到期：${vars.siteName}`, html, {});
}

