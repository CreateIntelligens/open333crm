/** 請求 log 用：遮掉網址參數中的機密值（OAuth 授權碼、state、access_token、token） */
export function redactSensitiveQuery(url: string | undefined): string | undefined {
  if (!url || !url.includes('?')) return url;
  return url.replace(/([?&](?:code|state|access_token|token)=)[^&]*/gi, '$1<redacted>');
}
