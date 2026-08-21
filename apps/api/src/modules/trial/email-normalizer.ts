/**
 * Email 正規化。
 * - email：trim + lowercase，用來建 Agent（既有 login/createAgent 大小寫敏感，統一小寫避免登入打不進）。
 * - normalized：再對 gmail/googlemail 去 +tag 與帳號中的點，作為唯一鍵擋別名重複申請。
 */

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function normalizeEmail(raw: string): { email: string; normalized: string } {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 0) return { email, normalized: email };

  let local = email.slice(0, at);
  const domain = email.slice(at + 1);

  // 去 +tag（所有網域通用；+ 後全部丟棄）
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);

  // gmail 系：帳號中的點無意義，去除
  const canonicalDomain = domain === 'googlemail.com' ? 'gmail.com' : domain;
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
  }

  return { email, normalized: `${local}@${canonicalDomain}` };
}
