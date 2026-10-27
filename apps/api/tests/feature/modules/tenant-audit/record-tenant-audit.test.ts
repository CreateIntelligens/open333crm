/**
 * recordTenantAudit() 與主操作在同一個交易：一起 commit 或一起 rollback
 * （change migrate-role-agent-tenant-ctx，tenant-audit-log「交易內的稽核與主操作一起 commit」）。
 *
 * 以 app_tenant 連線（受 RLS 約束）執行。測試建立的角色與稽核都以 MARK 標記，afterAll 用 admin 連線刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { inTenant } from '#src/lib/tenant-ctx.js';
import { createOutboxPublisher } from '#src/events/outbox-publisher.js';
import { recordTenantAudit } from '#src/modules/tenant-audit/tenant-audit.service.js';

const TENANT_URL = process.env.DATABASE_URL_TENANT;
const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const TENANT_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';

if (!TENANT_URL || !ADMIN_URL) {
  throw new Error('record-tenant-audit 需要 DATABASE_URL_TENANT / DATABASE_URL_ADMIN，由 tests/setup/feature.env.ts 提供');
}

const tenantDb = new PrismaClient({ datasources: { db: { url: TENANT_URL } } });
const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
const MARK = `record-audit-${randomUUID()}`;
const deps = { prisma: tenantDb, events: createOutboxPublisher(tenantDb) };

afterAll(async () => {
  await adminDb.tenantAuditLog.deleteMany({ where: { action: { startsWith: MARK } } });
  await adminDb.role.deleteMany({ where: { name: { startsWith: MARK } } });
  await tenantDb.$disconnect();
  await adminDb.$disconnect();
});

function createRole(tx: Parameters<Parameters<typeof inTenant>[2]>[0]['tx'], tenantId: string, name: string) {
  return tx.role.create({ data: { tenantId, slug: `custom-${randomUUID().slice(0, 8)}`, name, isSystem: false } });
}

test('稽核與主操作一起寫入', async () => {
  const name = `${MARK}-ok`;
  await inTenant(deps, TENANT_A, async (ctx) => {
    const role = await createRole(ctx.tx, ctx.tenantId, name);
    await recordTenantAudit(ctx, { action: `${MARK}.role.create`, targetType: 'role', targetId: role.id });
  });
  const role = await adminDb.role.findFirst({ where: { name } });
  assert.ok(role);
  const audits = await adminDb.tenantAuditLog.findMany({ where: { action: `${MARK}.role.create` } });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].tenantId, TENANT_A);
  assert.equal(audits[0].targetId, role.id);
});

test('稽核寫入失敗時主操作 rollback', async () => {
  const name = `${MARK}-rollback`;
  await assert.rejects(
    inTenant(deps, TENANT_A, async (ctx) => {
      await createRole(ctx.tx, ctx.tenantId, name);
      // 不存在的成員：違反 tenant_audit_logs.actor_id 的外鍵
      await recordTenantAudit(ctx, { actorId: randomUUID(), action: `${MARK}.role.fail` });
    }),
  );
  assert.equal(await adminDb.role.count({ where: { name } }), 0);
  assert.equal(await adminDb.tenantAuditLog.count({ where: { action: `${MARK}.role.fail` } }), 0);
});
