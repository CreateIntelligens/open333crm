/**
 * Demo 帳號種子（issue #394）。
 * API 容器每次啟動都跑 seed。Demo 帳號的密碼寫在公開的原始碼裡，所以：
 * - 正式環境不建 Demo 帳號
 * - 帳號已經存在時，不覆寫密碼與啟用狀態
 * seed 不在 src/ 裡，所以這裡用相對路徑匯入。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

// 真的 bcrypt（純 JS、cost 10）四次雜湊在 CPU 吃緊時會超過測試時限；這裡只檢查寫入的欄位
vi.mock('bcryptjs', () => ({ default: { hash: async (password: string) => `hashed:${password}` } }));
vi.mock('../../../prisma/seed-data/rbac-roles.js', () => ({
  seedDemoRoles: async () => ({ admin: 'role-admin', supervisor: 'role-supervisor', agent: 'role-agent' }),
}));

import { seedDemoAccounts, shouldSeedDemoAccounts } from '../../../prisma/seed-data/demo-accounts.js';

type UpsertArgs = { where: Record<string, unknown>; update: Record<string, unknown>; create: Record<string, unknown> };
const upserts: Record<'tenant' | 'agent' | 'platformUser', UpsertArgs[]> = { tenant: [], agent: [], platformUser: [] };

const prisma = {
  tenant: { upsert: async (args: UpsertArgs) => { upserts.tenant.push(args); } },
  agent: { upsert: async (args: UpsertArgs) => { upserts.agent.push(args); } },
  platformUser: { upsert: async (args: UpsertArgs) => { upserts.platformUser.push(args); } },
};

beforeEach(() => {
  upserts.tenant.length = 0;
  upserts.agent.length = 0;
  upserts.platformUser.length = 0;
});

test('Production does not seed demo accounts', () => {
  assert.equal(shouldSeedDemoAccounts({ NODE_ENV: 'production' }), false);
});

test('Production seeds demo accounts when SEED_DEMO_ACCOUNTS is true', () => {
  assert.equal(shouldSeedDemoAccounts({ NODE_ENV: 'production', SEED_DEMO_ACCOUNTS: 'true' }), true);
});

test('Development seeds demo accounts', () => {
  assert.equal(shouldSeedDemoAccounts({ NODE_ENV: 'development' }), true);
  assert.equal(shouldSeedDemoAccounts({}), true);
});

test('New demo accounts are created with a password and active', async () => {
  await seedDemoAccounts(prisma as never);
  assert.equal(upserts.agent.length, 3);
  for (const { create } of upserts.agent) {
    assert.equal(typeof create.passwordHash, 'string');
    assert.equal(create.isActive, true);
  }
  assert.equal(typeof upserts.platformUser[0].create.passwordHash, 'string');
  assert.equal(upserts.tenant[0].create.isActive, true);
});

test('Existing demo accounts keep their password and active state', async () => {
  await seedDemoAccounts(prisma as never);
  for (const { update } of [...upserts.agent, ...upserts.platformUser]) {
    assert.ok(!('passwordHash' in update), `update 不可覆寫密碼：${JSON.stringify(Object.keys(update))}`);
    assert.ok(!('isActive' in update), `update 不可覆寫啟用狀態：${JSON.stringify(Object.keys(update))}`);
  }
  assert.ok(!('isActive' in upserts.tenant[0].update), '已停用的 Demo 租戶不可被重新啟用');
});
