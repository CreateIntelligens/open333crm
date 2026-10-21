/**
 * outbox 與 side_effect_claims 受 RLS 約束（change outbox-event-delivery：
 * event-delivery「outbox 受租戶隔離」、side-effect-claims「認領紀錄受租戶隔離並保存 30 天」）。
 *
 * 測試寫入的資料都以 MARK 標記，afterAll 用 admin 連線刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { inTenant } from '#src/lib/tenant-ctx.js';

const TENANT_URL = process.env.DATABASE_URL_TENANT;
const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const TENANT_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const TENANT_B = process.env.RLS_TEST_TENANT_B ?? 'd207783b-58a6-48a1-838c-526874ce1606';

if (!TENANT_URL || !ADMIN_URL) {
  throw new Error('outbox-rls 需要 DATABASE_URL_TENANT / DATABASE_URL_ADMIN，由 tests/setup/feature.env.ts 提供');
}

const tenantDb = new PrismaClient({ datasources: { db: { url: TENANT_URL } } });
const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
const MARK = `outbox-rls-${randomUUID()}`;
const deps = { prisma: tenantDb, events: { publish() {} } };

afterAll(async () => {
  await adminDb.outbox.deleteMany({ where: { name: MARK } });
  await adminDb.sideEffectClaim.deleteMany({ where: { kind: MARK } });
  await tenantDb.$disconnect();
  await adminDb.$disconnect();
});

test('寫入別的租戶的事件', async () => {
  await assert.rejects(
    inTenant(deps, TENANT_A, (ctx) =>
      ctx.tx.outbox.create({ data: { tenantId: TENANT_B, kind: 'event', name: MARK, payload: {} } }),
    ),
    /row-level security/,
  );
  assert.equal(await adminDb.outbox.count({ where: { name: MARK } }), 0);
});

test('outbox：綁定租戶 A 的交易看不到租戶 B 的事件', async () => {
  await adminDb.outbox.createMany({
    data: [
      { tenantId: TENANT_A, kind: 'event', name: MARK, payload: {} },
      { tenantId: TENANT_B, kind: 'event', name: MARK, payload: {} },
    ],
  });
  const rows = await inTenant(deps, TENANT_A, (ctx) =>
    ctx.tx.outbox.findMany({ where: { name: MARK }, select: { tenantId: true } }),
  );
  assert.deepEqual(rows.map((r) => r.tenantId), [TENANT_A]);
});

test('認領紀錄：不能寫入別的租戶', async () => {
  await assert.rejects(
    inTenant(deps, TENANT_A, (ctx) =>
      ctx.tx.sideEffectClaim.create({ data: { tenantId: TENANT_B, kind: MARK, sourceId: randomUUID() } }),
    ),
    /row-level security/,
  );
  assert.equal(await adminDb.sideEffectClaim.count({ where: { kind: MARK } }), 0);
});

test('認領紀錄：綁定租戶 A 的交易看不到租戶 B 的紀錄', async () => {
  await adminDb.sideEffectClaim.createMany({
    data: [
      { tenantId: TENANT_A, kind: MARK, sourceId: randomUUID() },
      { tenantId: TENANT_B, kind: MARK, sourceId: randomUUID() },
    ],
  });
  const rows = await inTenant(deps, TENANT_A, (ctx) =>
    ctx.tx.sideEffectClaim.findMany({ where: { kind: MARK }, select: { tenantId: true } }),
  );
  assert.deepEqual(rows.map((r) => r.tenantId), [TENANT_A]);
});
