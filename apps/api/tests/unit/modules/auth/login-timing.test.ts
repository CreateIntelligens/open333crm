/** 帳號不存在時也驗一次密碼，回應時間不透露 email 是否存在（change add-login-brute-force-protection） */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { memBindingStore } from '#tests/support/mem-binding-store.js';

const verifyCalls: string[] = [];
let failNextHash = false;
vi.mock('#src/shared/utils/password.js', () => ({
  hashPassword: async (plain: string) => {
    if (failNextHash) {
      failNextHash = false;
      throw new Error('hash failed');
    }
    return `hash-of-${plain}`;
  },
  verifyPassword: async (_plain: string, hash: string) => {
    verifyCalls.push(hash);
    return false;
  },
}));

test('假雜湊第一次產生失敗：該次 500，之後重新產生、不會一直失敗', async () => {
  vi.resetModules();
  failNextHash = true;
  const { login } = await import('#src/modules/auth/auth.service.js');
  const db = { agent: { findUnique: async () => null } } as never;
  await assert.rejects(login(db, 'nobody2@x.dev', 'pw', memBindingStore()), /hash failed/);
  await assert.rejects(login(db, 'nobody2@x.dev', 'pw', memBindingStore()), (e: { code?: string }) => e.code === 'INVALID_CREDENTIALS');
});

test('不存在的 email：仍對一組雜湊驗證密碼，與存在的帳號花一樣的時間', async () => {
  const { login } = await import('#src/modules/auth/auth.service.js');
  const db = { agent: { findUnique: async () => null } } as never;
  await assert.rejects(login(db, 'nobody@x.dev', 'pw', memBindingStore()), (e: { code?: string }) => e.code === 'INVALID_CREDENTIALS');
  assert.ok(verifyCalls.length >= 1);
  assert.match(verifyCalls.at(-1)!, /^hash-of-/);
});
