/**
 * 券號撞號時換一組重試（coupon.service insertWithDisplayCode）。
 * 建券在入口開的單一交易內：撞號的 SQL 錯誤會讓整個交易失效，重試必須在 savepoint 內才會成功。
 * 以固定 randomInt 讓第二張券第一次產生的券號與第一張相同。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TENANT_A } from '#tests/setup/feature-config.js';

const mocks = vi.hoisted(() => ({ next: [] as number[] }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomInt: ((max: number) => (mocks.next.length ? mocks.next.shift()! : actual.randomInt(max))) as typeof actual.randomInt,
  };
});

const { createCoupon } = await import('#src/modules/coupon/coupon.service.js');
const { runInTenant } = await import('#tests/support/tenant-run.js');

const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const createdById = randomUUID();
// 字元表第 0 個是 2、第 1 個是 3
const FIRST = 'CP-222222';
const SECOND = 'CP-333333';

beforeAll(async () => {
  await owner.coupon.deleteMany({ where: { tenantId: T, displayCode: { in: [FIRST, SECOND] } } });
});

afterAll(async () => {
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

it('券號撞號時換一組重試，建券成功', async () => {
  mocks.next = Array(6).fill(0);
  const first = await runInTenant(prisma, T, (ctx) => createCoupon(ctx, createdById, { name: '撞號第一張' }));
  assert.equal(first.displayCode, FIRST);

  // 第一次產生的券號與第一張相同，第二次換成 CP-333333
  mocks.next = [...Array(6).fill(0), ...Array(6).fill(1)];
  const second = await runInTenant(prisma, T, (ctx) => createCoupon(ctx, createdById, { name: '撞號第二張' }));
  assert.equal(second.displayCode, SECOND);
});
