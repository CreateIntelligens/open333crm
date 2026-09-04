/**
 * 平台帳號（PlatformUser）相關信件：開通完成、忘記密碼重設。
 * 樣式與 trial-emails.ts 一致（純 HTML inline-style + table 佈局，不走 MJML——
 * mjml 為可選依賴、未安裝時 fallback 會把按鈕 href 吃掉，純 HTML 無此風險）。
 * 寄信一律 fire-and-forget，失敗只 log（呼叫端負責）。
 */
import { renderTemplateBody } from '../marketing/template-renderer.js';
import { sendEmail } from '../email/email.service.js';
import { logger } from '@open333crm/core';

const BRAND = '#0d9488';
const INK = '#1a2230';
const MUTED = '#66707f';
const FAINT = '#97a0ae';
const BG = '#eef1f5';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang TC','Microsoft JhengHei',Roboto,Helvetica,Arial,sans-serif";

function wrap(opts: { heading: string; accent?: string; bodyHtml: string }): string {
  const accent = opts.accent ?? BRAND;
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.heading}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(20,30,50,.06),0 8px 24px rgba(20,30,50,.08);">
        <tr><td style="background:${accent};padding:24px 36px;">
          <span style="font-size:15px;font-weight:700;color:#ffffff;letter-spacing:.3px;">open333 <span style="opacity:.75;font-weight:500;">CRM</span> <span style="opacity:.6;font-weight:500;">平台後台</span></span>
        </td></tr>
        <tr><td style="padding:32px 36px 8px;">
          <h1 style="font-size:21px;line-height:1.35;margin:0 0 16px;color:${INK};font-weight:700;">${opts.heading}</h1>
          ${opts.bodyHtml}
        </td></tr>
        <tr><td style="padding:20px 36px 28px;border-top:1px solid #eef1f5;">
          <p style="font-size:12px;color:${FAINT};margin:0;line-height:1.6;">此信由 open333 CRM 平台系統自動發送，請勿直接回覆。</p>
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
const infobox = (t: string) =>
  `<div style="margin:16px 0 4px;padding:12px 14px;background:#f7f9fc;border:1px solid #e8edf3;border-radius:10px;font-size:12.5px;line-height:1.6;color:${MUTED};word-break:break-all;">${t}</div>`;
const passwordBox = (t: string) =>
  `<div style="margin:16px 0;padding:14px 18px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:10px;text-align:center;">
    <div style="font-size:11px;color:${MUTED};margin-bottom:6px;">臨時密碼</div>
    <div style="font-family:'SF Mono',Consolas,Menlo,monospace;font-size:20px;font-weight:700;letter-spacing:2px;color:${INK};">${t}</div>
  </div>`;

const PLATFORM_USER_PROVISIONED_HTML = wrap({
  heading: '平台帳號已開通',
  bodyHtml:
    p('您好 <strong>{{name}}</strong>，您的 open333 CRM 平台管理後台帳號已開通完成。') +
    passwordBox('{{tempPassword}}') +
    button('{{loginUrl}}', '前往平台後台登入') +
    small('請使用上方臨時密碼登入，系統將要求您<strong>立即設定新密碼</strong>後才能使用其他功能。此臨時密碼僅供首次登入使用，請勿轉發他人。') +
    infobox('按鈕無法點擊？請複製以下連結至瀏覽器開啟：<br><a href="{{loginUrl}}" style="color:' + BRAND + ';">{{loginUrl}}</a>'),
});

const PLATFORM_PASSWORD_RESET_HTML = wrap({
  heading: '重設平台帳號密碼',
  bodyHtml:
    p('我們收到您重設 open333 CRM 平台後台帳號密碼的申請。') +
    p('請點擊下方按鈕設定新密碼：') +
    button('{{resetUrl}}', '重設密碼') +
    small('此連結 <strong>{{ttlMinutes}}</strong> 分鐘內有效，且僅能使用一次。若非您本人申請，請忽略此信，密碼不會被變更。') +
    infobox('按鈕無法點擊？請複製以下連結至瀏覽器開啟：<br><a href="{{resetUrl}}" style="color:' + BRAND + ';">{{resetUrl}}</a>'),
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
    logger.error(`[PlatformUserEmail] send failed to=${to} subject="${subject}":`, err);
  }
}

/** 平台帳號開通信：帶系統產生的明文臨時密碼（首次登入後須強制改密碼）與登入網址。 */
export async function sendPlatformUserProvisionedEmail(
  to: string,
  vars: { name: string; loginUrl: string; tempPassword: string },
): Promise<void> {
  const html = render(PLATFORM_USER_PROVISIONED_HTML, vars);
  await safeSend(to, '【open333】平台帳號已開通', html, { loginUrl: vars.loginUrl });
}

/** 平台帳號忘記密碼重設信：帶明文 token 的重設連結，有效期提示。 */
export async function sendPlatformPasswordResetEmail(
  to: string,
  vars: { resetUrl: string; ttlMinutes: number },
): Promise<void> {
  const html = render(PLATFORM_PASSWORD_RESET_HTML, {
    resetUrl: vars.resetUrl,
    ttlMinutes: String(vars.ttlMinutes),
  });
  await safeSend(to, '【open333】重設您的平台帳號密碼', html, { resetUrl: vars.resetUrl });
}
