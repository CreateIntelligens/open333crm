/**
 * 客服 token 的用途判斷（change fix-agent-token-purpose，AUDIT AUTH-05）。
 *
 * JWT_SECRET 同時簽發客服 access token、refresh token、粉絲 token 與 MCP 確認 token。
 * 原本驗證端只看簽章，refresh token（30 天）能直接當 access token 用，日後接回的粉絲 token 也能通過客服認證。
 * 簽發時帶 `typ`，驗證時依用途判斷：
 *   - 客服 API 與 socket 只收 access token
 *   - /auth/refresh 只收 refresh token
 */
export const ACCESS_TOKEN_TYPE = 'access';
export const REFRESH_TOKEN_TYPE = 'refresh';

type Claims = Record<string, unknown> | null | undefined;

function hasAgentIdentity(p: Record<string, unknown>): boolean {
  return typeof p.agentId === 'string' && p.agentId !== '' && typeof p.tenantId === 'string' && p.tenantId !== '';
}

/** 客服 access token：typ access，且帶 agentId 與 tenantId。舊格式（沒有 typ）不收，前端會用 refresh token 換發 */
export function isAgentAccessToken(payload: Claims): boolean {
  return !!payload && payload.typ === ACCESS_TOKEN_TYPE && hasAgentIdentity(payload);
}

/**
 * 客服 refresh token：typ refresh。
 * 過渡期另收舊格式（沒有 typ、帶 rememberMe 欄位；只有 refresh token 有這個欄位），
 * 上線前登入的使用者才不會被登出。舊格式最長 REFRESH_TOKEN_EXPIRES_IN（30 天）後自然消失，屆時可移除。
 */
export function isAgentRefreshToken(payload: Claims): boolean {
  if (!payload || !hasAgentIdentity(payload)) return false;
  if (payload.typ === REFRESH_TOKEN_TYPE) return true;
  return payload.typ === undefined && 'rememberMe' in payload && payload.sub === undefined;
}
