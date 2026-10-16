/**
 * 租戶合約日期（主規格 tenant-contract-dates）。
 *
 * 走真實的 platform.routes、updateTenantContract 與測試資料庫。平台認證換成固定的平台帳號；
 * 租戶 JWT 被拒絕由 tests/unit/modules/platform/platform-auth-guard.test.ts 對每一條平台路由檢查。
 * 租戶、平台帳號與稽核都帶 stamp，afterAll 刪除。試用排程的情境在交易內執行，結束時 rollback。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import platformRoutes from '#src/modules/platform/platform.routes.js';
import { runTrialLifecycle } from '#src/modules/trial/trial.scheduler.js';

loadEnvConfig();

const prisma = new PrismaClient();
const stamp = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const platformUser = await prisma.platformUser.create({
  data: { email: `ci-contract-${stamp}@example.test`, name: 'CI 合約日期測試', passwordHash: 'x' },
});
const tenantIds: string[] = [];
async function mkTenant(data: { contractStartDate?: Date; contractEndDate?: Date } = {}) {
  const t = await prisma.tenant.create({ data: { name: `CI 合約日期測試 ${stamp}-${tenantIds.length}`, ...data } });
  tenantIds.push(t.id);
  return t;
}

const app = Fastify();
app.decorate('prismaAdmin', prisma as never);
app.decorateRequest('platformUser', null);
app.decorate('authenticatePlatformSuperuser', async (req: { platformUser: unknown }) => {
  req.platformUser = { id: platformUser.id, role: 'PLATFORM_SUPERUSER', mustChangePassword: false };
});
await app.register(errorHandlerPlugin);
await app.register(platformRoutes, { prefix: '/api/v1/platform' });
await app.ready();

afterAll(async () => {
  await app.close();
  await prisma.platformAuditLog.deleteMany({ where: { platformUserId: platformUser.id } });
  await prisma.platformUser.delete({ where: { id: platformUser.id } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

const patchContract = (tenantId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/api/v1/platform/tenants/${tenantId}/contract`, payload });
const contractOf = (tenantId: string) =>
  prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { contractStartDate: true, contractEndDate: true },
  });
const iso = (d: Date | null) => d?.toISOString() ?? null;

test('平台設定合約起訖日', async () => {
  const t = await mkTenant();
  const res = await patchContract(t.id, { contractStartDate: '2026-09-01', contractEndDate: '2027-08-31' });
  assert.equal(res.statusCode, 200, res.body);

  const saved = await contractOf(t.id);
  assert.equal(iso(saved.contractStartDate), '2026-09-01T00:00:00.000Z');
  assert.equal(iso(saved.contractEndDate), '2027-08-31T00:00:00.000Z');

  const audits = await prisma.platformAuditLog.findMany({ where: { targetId: t.id, action: 'tenant.contract.update' } });
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.platformUserId, platformUser.id);
});

test('合約日期出現在租戶列表與租戶詳細資料', async () => {
  const t = await mkTenant({ contractStartDate: new Date('2026-09-01'), contractEndDate: new Date('2027-08-31') });
  const empty = await mkTenant();

  const list = await app.inject({ method: 'GET', url: '/api/v1/platform/tenants' });
  assert.equal(list.statusCode, 200, list.body);
  const rows = list.json().data as Array<{ id: string; contractStartDate: string | null; contractEndDate: string | null }>;
  const row = rows.find((r) => r.id === t.id);
  assert.equal(row?.contractStartDate, '2026-09-01T00:00:00.000Z');
  assert.equal(row?.contractEndDate, '2027-08-31T00:00:00.000Z');
  const emptyRow = rows.find((r) => r.id === empty.id);
  assert.equal(emptyRow?.contractStartDate, null);
  assert.equal(emptyRow?.contractEndDate, null);

  const detail = await app.inject({ method: 'GET', url: `/api/v1/platform/tenants/${t.id}` });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().data.contractEndDate, '2027-08-31T00:00:00.000Z');
});

test('迄日早於起日被拒絕', async () => {
  const t = await mkTenant();
  const res = await patchContract(t.id, { contractStartDate: '2027-01-01', contractEndDate: '2026-01-01' });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error.code, 'CONTRACT_DATE_INVALID');

  const saved = await contractOf(t.id);
  assert.equal(saved.contractStartDate, null);
  assert.equal(saved.contractEndDate, null);
  assert.equal(await prisma.platformAuditLog.count({ where: { targetId: t.id } }), 0, '被拒絕時不寫稽核');
});

test('只設定其中一個日期', async () => {
  const t = await mkTenant();
  const res = await patchContract(t.id, { contractStartDate: '2026-09-01' });
  assert.equal(res.statusCode, 200, res.body);

  const saved = await contractOf(t.id);
  assert.equal(iso(saved.contractStartDate), '2026-09-01T00:00:00.000Z');
  assert.equal(saved.contractEndDate, null);
});

test('只送一個日期時，與另一個日期的現值比較', async () => {
  const t = await mkTenant({ contractStartDate: new Date('2026-09-01'), contractEndDate: new Date('2027-08-31') });
  const res = await patchContract(t.id, { contractEndDate: '2026-01-01' });
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(res.json().error.code, 'CONTRACT_DATE_INVALID');
  assert.equal(iso((await contractOf(t.id)).contractEndDate), '2027-08-31T00:00:00.000Z');
});

test('送 null 清除日期，沒送的日期不變', async () => {
  const t = await mkTenant({ contractStartDate: new Date('2026-09-01'), contractEndDate: new Date('2027-08-31') });
  const res = await patchContract(t.id, { contractEndDate: null });
  assert.equal(res.statusCode, 200, res.body);

  const saved = await contractOf(t.id);
  assert.equal(iso(saved.contractStartDate), '2026-09-01T00:00:00.000Z');
  assert.equal(saved.contractEndDate, null);
});

class Rollback extends Error {}

test('合約到期不觸發任何自動行為', async () => {
  await assert.rejects(
    prisma.$transaction(async (raw) => {
      const tx = raw as unknown as PrismaClient;
      const past = new Date(Date.now() - 30 * DAY);
      // 付費租戶與試用中的租戶，合約迄日都已過
      const paid = await tx.tenant.create({
        data: { name: `CI 合約到期 付費 ${stamp}`, contractStartDate: new Date(Date.now() - 400 * DAY), contractEndDate: past },
      });
      const trial = await tx.tenant.create({
        data: { name: `CI 合約到期 試用 ${stamp}`, trialEndsAt: new Date(Date.now() + 10 * DAY), contractEndDate: past },
      });

      await runTrialLifecycle(tx);

      for (const id of [paid.id, trial.id]) {
        const after = await tx.tenant.findUniqueOrThrow({ where: { id }, select: { isActive: true, purgedAt: true } });
        assert.equal(after.isActive, true);
        assert.equal(after.purgedAt, null);
      }
      assert.equal(
        await tx.platformAuditLog.count({ where: { targetId: { in: [paid.id, trial.id] } } }),
        0,
        '排程不為這兩個租戶寫任何稽核',
      );
      throw new Rollback();
    }),
    Rollback,
  );
});
