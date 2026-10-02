/** token 用途判斷（change fix-agent-token-purpose，AUDIT AUTH-05） */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { isAgentAccessToken, isAgentRefreshToken } from '#src/lib/agent-token.js';

const base = { agentId: 'a1', tenantId: 't1', role: 'ADMIN', roleId: null };

test('access token：typ access 且帶 agentId、tenantId 才算', () => {
  assert.equal(isAgentAccessToken({ ...base, typ: 'access' }), true);
  assert.equal(isAgentAccessToken({ ...base, typ: 'refresh', rememberMe: true }), false);
  assert.equal(isAgentAccessToken({ ...base }), false, '舊格式（沒有 typ）不收，讓前端換發');
  assert.equal(isAgentAccessToken({ sub: 'fan', contactId: 'c1', tenantId: 't1' }), false);
  assert.equal(isAgentAccessToken({ op: 'line.send', tenantId: 't1', agentId: 'a1', v: 1 }), false);
  assert.equal(isAgentAccessToken({ typ: 'access', tenantId: 't1' }), false, '缺 agentId');
  assert.equal(isAgentAccessToken({ typ: 'access', agentId: 'a1' }), false, '缺 tenantId');
});

test('refresh token：typ refresh，或過渡期的舊格式（沒有 typ、帶 rememberMe）', () => {
  assert.equal(isAgentRefreshToken({ ...base, typ: 'refresh', rememberMe: false }), true);
  assert.equal(isAgentRefreshToken({ ...base, rememberMe: true }), true);
  assert.equal(isAgentRefreshToken({ ...base, typ: 'access' }), false);
  assert.equal(isAgentRefreshToken({ ...base }), false, '舊格式 access token 不能拿來換發');
  assert.equal(isAgentRefreshToken({ sub: 'fan', contactId: 'c1', tenantId: 't1', rememberMe: true }), false);
});
