/**
 * 登入失敗鎖定與停用帳號回應順序（change add-login-brute-force-protection，AUDIT SEC-05）。
 */
import assert from 'node:assert/strict';
import { beforeAll, test } from 'vitest';
import { login } from '#src/modules/auth/auth.service.js';
import { hashPassword } from '#src/shared/utils/password.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';

const PASSWORD = 'Correct-Pass-1';
let hash = '';
beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

function prismaWith(agents: Record<string, { isActive?: boolean }>) {
  return {
    agent: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        const a = agents[where.email];
        if (!a) return null;
        return {
          id: `id-${where.email}`,
          tenantId: 't1',
          email: where.email,
          name: 'n',
          role: 'ADMIN',
          roleId: null,
          avatarUrl: null,
          passwordHash: hash,
          isActive: a.isActive ?? true,
          tenant: { isActive: true },
        };
      },
    },
  } as never;
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return (e as { code?: string; statusCode?: number }).code;
  }
};
const MIN = 60_000;

test('連續失敗 5 次後鎖定：第 6 次就算密碼正確也回 ACCOUNT_LOCKED', async () => {
  const store = memBindingStore();
  const db = prismaWith({ 'a@x.dev': {} });
  for (let i = 0; i < 5; i++) assert.equal(await codeOf(login(db, 'a@x.dev', 'wrong', store)), 'INVALID_CREDENTIALS');
  try {
    await login(db, 'a@x.dev', PASSWORD, store);
    assert.fail('應被鎖定');
  } catch (e) {
    assert.equal((e as { code: string }).code, 'ACCOUNT_LOCKED');
    assert.equal((e as { statusCode: number }).statusCode, 429);
  }
});

test('鎖定期滿後可登入', async () => {
  const clock = { now: Date.now() };
  const store = memBindingStore(clock);
  const db = prismaWith({ 'b@x.dev': {} });
  for (let i = 0; i < 5; i++) await codeOf(login(db, 'b@x.dev', 'wrong', store));
  clock.now += 15 * MIN + 1;
  assert.equal(await codeOf(login(db, 'b@x.dev', PASSWORD, store)), 'OK');
});

test('成功登入清除失敗次數', async () => {
  const store = memBindingStore();
  const db = prismaWith({ 'c@x.dev': {} });
  for (let i = 0; i < 4; i++) await codeOf(login(db, 'c@x.dev', 'wrong', store));
  assert.equal(await codeOf(login(db, 'c@x.dev', PASSWORD, store)), 'OK');
  for (let i = 0; i < 4; i++) await codeOf(login(db, 'c@x.dev', 'wrong', store));
  assert.equal(await codeOf(login(db, 'c@x.dev', PASSWORD, store)), 'OK');
});

test('大小寫不同視為同一帳號', async () => {
  const store = memBindingStore();
  const db = prismaWith({ 'admin@x.dev': {} });
  for (let i = 0; i < 3; i++) await codeOf(login(db, 'Admin@x.dev', 'wrong', store));
  for (let i = 0; i < 2; i++) await codeOf(login(db, 'admin@x.dev', 'wrong', store));
  assert.equal(await codeOf(login(db, 'admin@x.dev', PASSWORD, store)), 'ACCOUNT_LOCKED');
});

test('不存在的 email 也會鎖定', async () => {
  const store = memBindingStore();
  const db = prismaWith({});
  for (let i = 0; i < 5; i++) assert.equal(await codeOf(login(db, 'ghost@x.dev', 'x', store)), 'INVALID_CREDENTIALS');
  assert.equal(await codeOf(login(db, 'ghost@x.dev', 'x', store)), 'ACCOUNT_LOCKED');
});

test('停用帳號：密碼錯誤回 401 INVALID_CREDENTIALS，密碼正確才回 403 ACCOUNT_DISABLED', async () => {
  const store = memBindingStore();
  const db = prismaWith({ 'off@x.dev': { isActive: false } });
  assert.equal(await codeOf(login(db, 'off@x.dev', 'wrong', store)), 'INVALID_CREDENTIALS');
  assert.equal(await codeOf(login(db, 'off@x.dev', PASSWORD, store)), 'ACCOUNT_DISABLED');
});
