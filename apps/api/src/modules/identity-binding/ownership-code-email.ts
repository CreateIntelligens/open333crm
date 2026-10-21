/**
 * Email 登記驗證信（add-coupon-system design D15）。寄給租戶的顧客，以租戶名稱署名，不放平台品牌。
 * 純 HTML inline-style，與其他交易信相同的作法；不放 emoji。
 */
import { sendEmail } from '../email/email.service.js';
import { OWNERSHIP_CODE_TTL_MS } from './ownership-code.js';

const INK = '#1a2230';
const MUTED = '#66707f';
const BG = '#eef1f5';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang TC','Microsoft JhengHei',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function buildVerificationEmail(senderName: string, code: string): { subject: string; html: string; text: string } {
  const minutes = Math.round(OWNERSHIP_CODE_TTL_MS / 60000);
  const name = escapeHtml(senderName);
  const subject = `${senderName} email 驗證碼：${code}`;
  const text = `您的 email 驗證碼是 ${code}，${minutes} 分鐘內有效。請回到登記頁輸入。若不是您本人操作，請忽略此信。`;
  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:100%;max-width:480px;background:#ffffff;border-radius:16px;">
        <tr><td style="padding:32px 32px 8px;">
          <p style="font-size:14px;color:${MUTED};margin:0 0 8px;">${name}</p>
          <h1 style="font-size:20px;line-height:1.4;margin:0 0 16px;color:${INK};">email 驗證碼</h1>
          <p style="font-size:15px;line-height:1.7;color:${INK};margin:0 0 16px;">請回到登記頁輸入以下驗證碼，完成 email 登記。</p>
          <div style="margin:0 0 16px;padding:16px;background:#f7f9fc;border:1px solid #e8edf3;border-radius:10px;text-align:center;font-family:'SF Mono',Consolas,Menlo,monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:${INK};">${code}</div>
          <p style="font-size:13px;line-height:1.6;color:${MUTED};margin:0 0 24px;">驗證碼 ${minutes} 分鐘內有效。若不是您本人操作，請忽略此信，您的資料不會有任何變更。</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { subject, html, text };
}

/** 正式環境的寄送函式；senderName 為租戶名稱 */
export function verificationEmailSender(senderName: string) {
  return async (to: string, code: string) => {
    const mail = buildVerificationEmail(senderName, code);
    await sendEmail({ to, ...mail, metadata: { kind: 'email_verification' } });
  };
}
