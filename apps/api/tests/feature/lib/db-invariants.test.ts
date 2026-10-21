/**
 * createOrFindExisting() 在真實 PostgreSQL 與 app_tenant（受 RLS 約束）的交易內的行為
 * （主規格 tenant-transaction-context「寫入撞到唯一鍵時改用既有資料」）。
 *
 * 用 tags 表的唯一鍵 (tenantId, name, scope)。測試建立的 tag 名稱都以 MARK 開頭，afterAll 用 admin 連線刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { inTenant, type TenantCtx } from '#src/lib/tenant-ctx.js';
import { createOutboxPublisher } from '#src/events/outbox-publisher.js';
import { createOrFindExisting } from '@open333crm/core';

const TENANT_URL = process.env.DATABASE_URL_TENANT;
const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const TENANT_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';

if (!TENANT_URL || !ADMIN_URL) {
  throw new Error('db-invariants 需要 DATABASE_URL_TENANT / DATABASE_URL_ADMIN，由 tests/setup/feature.env.ts 提供');
}

const tenantDb = new PrismaClient({ datasources: { db: { url: TENANT_URL } } });
const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
const MARK = `db-invariants-${randomUUID()}`;
const deps = { prisma: tenantDb, events: createOutboxPublisher(tenantDb) };

afterAll(async () => {
  await adminDb.tag.deleteMany({ where: { name: { startsWith: MARK } } });
  await tenantDb.$disconnect();
  await adminDb.$disconnect();
});

function createTag(ctx: TenantCtx, name: string) {
  return createOrFindExisting(
    () => ctx.tx.tag.createManyAndReturn({ data: [{ tenantId: ctx.tenantId, name }], skipDuplicates: true }),
    () => ctx.tx.tag.findFirst({ where: { tenantId: ctx.tenantId, name, scope: 'CONTACT' } }),
  );
}

test('沒有衝突：回傳新寫入的資料', async () => {
  const name = `${MARK}-new`;
  const result = await inTenant(deps, TENANT_A, (ctx) => createTag(ctx, name));
  assert.equal(result.created, true);
  assert.equal(result.row.name, name);
  const saved = await adminDb.tag.findUnique({ where: { id: result.row.id } });
  assert.equal(saved?.name, name);
});

test('與已存在的資料衝突：回傳既有的資料，之後同一個交易的查詢成功', async () => {
  const name = `${MARK}-existing`;
  const existing = await adminDb.tag.create({ data: { tenantId: TENANT_A, name } });

  const { result, countAfter } = await inTenant(deps, TENANT_A, async (ctx) => {
    const result = await createTag(ctx, name);
    // 交易若因衝突進入 aborted 狀態，這個查詢會失敗
    const countAfter = await ctx.tx.tag.count({ where: { name } });
    return { result, countAfter };
  });

  assert.equal(result.created, false);
  assert.equal(result.row.id, existing.id);
  assert.equal(countAfter, 1);
});

test('兩個交易同時寫入同一個唯一鍵：第二個交易取得第一個交易的資料，不丟錯', async () => {
  const name = `${MARK}-concurrent`;
  let releaseFirst!: () => void;
  const firstMayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
  let firstWrote!: () => void;
  const firstHasWritten = new Promise<void>((resolve) => (firstWrote = resolve));

  // 第一個交易寫入之後先不 commit
  const first = inTenant(deps, TENANT_A, async (ctx) => {
    const result = await createTag(ctx, name);
    firstWrote();
    await firstMayCommit;
    return result;
  });
  await firstHasWritten;

  let secondDone = false;
  const second = inTenant(deps, TENANT_A, async (ctx) => {
    const result = await createTag(ctx, name);
    const countAfter = await ctx.tx.tag.count({ where: { name } });
    return { result, countAfter };
  }).finally(() => {
    secondDone = true;
  });

  // 第二個交易要被唯一索引擋住，等第一個交易 commit；否則測到的只是先後執行
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(secondDone, false);

  releaseFirst();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(a.created, true);
  assert.equal(b.result.created, false);
  assert.equal(b.result.row.id, a.row.id);
  assert.equal(b.countAfter, 1);
});
