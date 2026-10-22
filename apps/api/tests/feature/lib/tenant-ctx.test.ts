/**
 * inTenant() 對真實 Postgres 與 app_tenant（受 RLS 約束）的行為
 * （主規格 tenant-transaction-context「入口開一個綁定租戶的交易」）。
 *
 * 測試建立的 contact 都以 MARK 開頭的 displayName 標記，afterAll 用 admin 連線刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { inTenant } from '#src/lib/tenant-ctx.js';
import { createOutboxPublisher } from '#src/events/outbox-publisher.js';

const TENANT_URL = process.env.DATABASE_URL_TENANT;
const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const TENANT_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const TENANT_B = process.env.RLS_TEST_TENANT_B ?? 'd207783b-58a6-48a1-838c-526874ce1606';

if (!TENANT_URL || !ADMIN_URL) {
  throw new Error('tenant-ctx 需要 DATABASE_URL_TENANT / DATABASE_URL_ADMIN，由 tests/setup/feature.env.ts 提供');
}

const tenantDb = new PrismaClient({ datasources: { db: { url: TENANT_URL } } });
const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
const MARK = `tenant-ctx-${randomUUID()}`;

beforeAll(async () => {
  await adminDb.contact.createMany({
    data: [
      { tenantId: TENANT_A, displayName: `${MARK}-a` },
      { tenantId: TENANT_B, displayName: `${MARK}-b` },
    ],
  });
});

afterAll(async () => {
  await adminDb.contact.deleteMany({ where: { displayName: { startsWith: MARK } } });
  await tenantDb.$disconnect();
  await adminDb.$disconnect();
});

test('第二筆寫入失敗時第一筆也不留下', async () => {
  const name = `${MARK}-rollback`;
  await assert.rejects(
    inTenant({ prisma: tenantDb, events: createOutboxPublisher(tenantDb) }, TENANT_A, async (ctx) => {
      await ctx.tx.contact.create({ data: { tenantId: ctx.tenantId, displayName: name } });
      throw new Error('second step failed');
    }),
    /second step failed/,
  );
  const left = await adminDb.contact.count({ where: { displayName: name } });
  assert.equal(left, 0);
});

test('交易內只看得到綁定租戶的資料', async () => {
  // 查詢條件刻意不帶 tenantId，隔離只靠 RLS
  const rows = await inTenant({ prisma: tenantDb, events: createOutboxPublisher(tenantDb) }, TENANT_A, (ctx) =>
    ctx.tx.contact.findMany({ where: { displayName: { startsWith: MARK } }, select: { tenantId: true } }),
  );
  // 要同時確認 A 的資料有查到：沒設租戶時 RLS fail-closed 回空，只檢查「沒有 B」也會通過
  assert.deepEqual(rows.map((r) => r.tenantId), [TENANT_A]);
});
