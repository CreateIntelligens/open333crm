/** 帳號不存在時也驗一次密碼，回應時間不透露 email 是否存在（change add-login-brute-force-protection） */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { memBindingStore } from '#tests/support/mem-binding-store.js';

const verifyCalls: string[] = [];
vi.mock('#src/shared/utils/password.js', () => ({
  hashPassword: async (plain: string) => `hash-of-${plain}`,
  verifyPassword: async (_plain: string, hash: string) => {
    verifyCalls.push(hash);
    return false;
  },
}));

test('不存在的 email：仍對一組雜湊驗證密碼，與存在的帳號花一樣的時間', async () => {
  const { login } = await import('#src/modules/auth/auth.service.js');
  const db = { agent: { findUnique: async () => null } } as never;
  await assert.rejects(login(db, 'nobody@x.dev', 'pw', memBindingStore()), (e: { code?: string }) => e.code === 'INVALID_CREDENTIALS');
  assert.equal(verifyCalls.length, 1);
  assert.match(verifyCalls[0]!, /^hash-of-/);
});
