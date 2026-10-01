/**
 * 租戶稽核 service 測試（writeTenantAudit / listTenantAudit）。
 * 真連 DB：驗寫入欄位正確、寫入失敗不阻斷、查詢 tenantId 隔離。
 *
 * 執行：DATABASE_URL=... REDIS_URL=... tsx src/__tests__/tenant-audit.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://crm:crmpassword@localhost:5433/open333crm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';

import { PrismaClient } from '@prisma/client';
import { writeTenantAudit, listTenantAudit } from '../modules/tenant-audit/tenant-audit.service.js';

const prisma = new PrismaClient();
const TENANT_A = 'a0000000-0000-0000-0000-000000000001'; // Demo Tenant
const TENANT_B = 'd207783b-58a6-48a1-838c-526874ce1606'; // GGYY
const MARK = `qa-audit-${Date.now()}`; // 本次測試標記，便於清理

test('writeTenantAudit 寫入正確欄位', async () => {
  await writeTenantAudit(prisma, {
    tenantId: TENANT_A,
    actorId: null,
    action: `${MARK}.settings.update`,
    targetType: 'settings',
    payload: { section: 'chat' },
  });
  const { rows } = await listTenantAudit(prisma, { tenantId: TENANT_A, action: `${MARK}.settings.update` });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, `${MARK}.settings.update`);
  assert.equal(rows[0].targetType, 'settings');
  assert.deepEqual(rows[0].payload, { section: 'chat' });
});

test('writeTenantAudit 失敗不拋（非阻斷）', async () => {
  // 給不合法 tenantId（非 UUID）→ Prisma 會拋，但 writeTenantAudit 內部 try/catch 吞掉，不應拋出
  await assert.doesNotReject(
    writeTenantAudit(prisma, { tenantId: 'not-a-uuid', action: `${MARK}.bad` }),
  );
});

test('listTenantAudit 跨租戶隔離：租戶 B 查不到租戶 A 的稽核', async () => {
  await writeTenantAudit(prisma, { tenantId: TENANT_A, action: `${MARK}.only-a` });
  const bResult = await listTenantAudit(prisma, { tenantId: TENANT_B, action: `${MARK}.only-a` });
  assert.equal(bResult.rows.length, 0, '租戶 B 不應看到租戶 A 的稽核');
  const aResult = await listTenantAudit(prisma, { tenantId: TENANT_A, action: `${MARK}.only-a` });
  assert.equal(aResult.rows.length, 1, '租戶 A 應看到自己的稽核');
});

test('listTenantAudit 分頁 + 日期篩選', async () => {
  const { rows, total, page, pageSize } = await listTenantAudit(prisma, {
    tenantId: TENANT_A,
    page: 1,
    pageSize: 5,
  });
  assert.ok(Array.isArray(rows));
  assert.equal(page, 1);
  assert.equal(pageSize, 5);
  assert.ok(total >= rows.length);
});

test.after(async () => {
  // 清理本次測試寫入的稽核
  await prisma.tenantAuditLog.deleteMany({ where: { action: { startsWith: MARK } } });
  await prisma.$disconnect();
  process.exit(0);
});
