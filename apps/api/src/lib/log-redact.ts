/**
 * 請求 log 用：遮掉網址中的機密值。網址參數：OAuth 授權碼、state、access_token、token、Meta webhook 驗證權杖；
 * 路徑：email 登記連結的 token（連結即憑證，change add-email-identity-merge）。
 */
export function redactSensitiveQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  url = url.replace(/(\/email-registration\/)[^/?#]+/g, '$1<redacted>');
  if (!url.includes('?')) return url;
  return url.replace(/([?&](?:code|state|access_token|token|hub\.verify_token)=)[^&]*/gi, '$1<redacted>');
}
