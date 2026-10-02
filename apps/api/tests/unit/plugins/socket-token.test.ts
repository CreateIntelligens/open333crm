/** socket 連線只收客服 access token（change fix-agent-token-purpose，AUDIT AUTH-05） */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { decodeSocketAgentToken } from '#src/plugins/socket.plugin.js';

const claims = { agentId: 'a1', tenantId: 't1', role: 'ADMIN', roleId: null };
const verifyAs = (payload: unknown) => () => payload;

test('access token：取出客服身分', () => {
  assert.equal(decodeSocketAgentToken(verifyAs({ ...claims, typ: 'access' }), 'x').agentId, 'a1');
});

test('refresh、粉絲、舊格式 token：拒絕連線', () => {
  for (const p of [{ ...claims, typ: 'refresh', rememberMe: true }, { sub: 'fan', contactId: 'c1', tenantId: 't1' }, claims]) {
    assert.throws(() => decodeSocketAgentToken(verifyAs(p), 'x'));
  }
});

test('簽章錯誤：照樣丟錯', () => {
  assert.throws(() => decodeSocketAgentToken(() => { throw new Error('bad signature'); }, 'x'), /bad signature/);
});
