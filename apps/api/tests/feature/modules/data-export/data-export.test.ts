/**
 * GDPR 資料匯出服務層測試（tsx 自跑）。
 * 涵蓋：
 *  - requestExport 建 pending 請求 + 寫稽核 data.export.request + 入列 job
 *  - getExportRequest 一律 tenantId scoped
 *  - getExportDownload：跨租戶（找不到）→ 404、未完成 → 400、已過期 → 410
 *  - 匯出只含本租戶資料：所有查詢 where 帶 tenantId（於 request/get 層驗證）
 */
import assert from 'node:assert/strict';

type MockFn = ((...args: unknown[]) => unknown) & { calls: unknown[][] };

function mockFn(impl?: (...args: unknown[]) => unknown): MockFn {
  const fn = ((...args: unknown[]) => {
    fn.calls.push(args);
    return impl?.(...args);
  }) as MockFn;
  fn.calls = [];
  return fn;
}

// 入列 lazy-init queue：用本機 Redis（可達）讓 add 快速完成，結束 close 即可。
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';

const { requestExport, getExportRequest, getExportDownload, closeExportQueue } = await import(
  '../modules/data-export/data-export.service.js'
);

async function testCreatesPendingRequestAndAudit() {
  const created = { id: 'export-1', status: 'pending', scope: null, createdAt: new Date() };
  const prisma = {
    dataExportRequest: { create: mockFn(() => created) },
    tenantAuditLog: { create: mockFn(() => ({})) },
  };

  const result = await requestExport(prisma as never, {
    tenantId: 'tenant-1',
    requestedBy: 'agent-1',
    ip: '1.2.3.4',
  });

  assert.deepEqual(result, created);

  // 建 pending 請求，帶 tenantId / requestedBy / status
  const createArg = prisma.dataExportRequest.create.calls[0][0] as { data: Record<string, unknown> };
  assert.equal(createArg.data.tenantId, 'tenant-1');
  assert.equal(createArg.data.requestedBy, 'agent-1');
  assert.equal(createArg.data.status, 'pending');

  // 稽核 action = data.export.request，targetId = 請求 id
  const auditArg = prisma.tenantAuditLog.create.calls[0][0] as {
    data: { action: string; targetId: string; tenantId: string };
  };
  assert.equal(auditArg.data.action, 'data.export.request');
  assert.equal(auditArg.data.targetId, 'export-1');
  assert.equal(auditArg.data.tenantId, 'tenant-1');
}

async function testGetExportRequestIsTenantScoped() {
  const row = { id: 'export-1', status: 'completed' };
  const prisma = {
    dataExportRequest: { findFirst: mockFn(() => row) },
  };

  const result = await getExportRequest(prisma as never, 'tenant-1', 'export-1');
  assert.deepEqual(result, row);
  // 查詢 where 必帶 tenantId（隔離）
  const arg = prisma.dataExportRequest.findFirst.calls[0][0] as { where: Record<string, unknown> };
  assert.equal(arg.where.id, 'export-1');
  assert.equal(arg.where.tenantId, 'tenant-1');
}

async function testGetExportRequestNotFound() {
  const prisma = { dataExportRequest: { findFirst: mockFn(() => null) } };
  await assert.rejects(
    () => getExportRequest(prisma as never, 'tenant-1', 'missing'),
    (err: unknown) => {
      const e = err as { code?: string; statusCode?: number };
      assert.equal(e.code, 'NOT_FOUND');
      assert.equal(e.statusCode, 404);
      return true;
    },
  );
}

async function testDownloadCrossTenantRejected() {
  // 跨租戶：findFirst 帶 tenantId 找不到 → 404，不提供任何檔案
  const prisma = {
    dataExportRequest: { findFirst: mockFn(() => null), updateMany: mockFn() },
  };
  await assert.rejects(
    () => getExportDownload(prisma as never, 'tenant-B', 'export-of-A'),
    (err: unknown) => {
      const e = err as { statusCode?: number };
      assert.equal(e.statusCode, 404);
      return true;
    },
  );
  // 一律以 tenantId 限定
  const arg = prisma.dataExportRequest.findFirst.calls[0][0] as { where: Record<string, unknown> };
  assert.equal(arg.where.tenantId, 'tenant-B');
  // 未通過不得增計數
  assert.equal(prisma.dataExportRequest.updateMany.calls.length, 0);
}

async function testDownloadNotReady() {
  const prisma = {
    dataExportRequest: {
      findFirst: mockFn(() => ({ id: 'export-1', status: 'processing', fileKey: null, expiresAt: null })),
      updateMany: mockFn(),
    },
  };
  await assert.rejects(
    () => getExportDownload(prisma as never, 'tenant-1', 'export-1'),
    (err: unknown) => {
      const e = err as { code?: string; statusCode?: number };
      assert.equal(e.code, 'EXPORT_NOT_READY');
      assert.equal(e.statusCode, 400);
      return true;
    },
  );
  assert.equal(prisma.dataExportRequest.updateMany.calls.length, 0);
}

async function testDownloadExpired() {
  const past = new Date(Date.now() - 60_000);
  const prisma = {
    dataExportRequest: {
      findFirst: mockFn(() => ({
        id: 'export-1',
        status: 'completed',
        fileKey: 'export/tenant-1/export-1.zip',
        expiresAt: past,
      })),
      updateMany: mockFn(),
    },
  };
  await assert.rejects(
    () => getExportDownload(prisma as never, 'tenant-1', 'export-1'),
    (err: unknown) => {
      const e = err as { code?: string; statusCode?: number };
      assert.equal(e.code, 'EXPORT_EXPIRED');
      assert.equal(e.statusCode, 410);
      return true;
    },
  );
  // 過期不得下載、不得增計數
  assert.equal(prisma.dataExportRequest.updateMany.calls.length, 0);
}

await testCreatesPendingRequestAndAudit();
await testGetExportRequestIsTenantScoped();
await testGetExportRequestNotFound();
await testDownloadCrossTenantRejected();
await testDownloadNotReady();
await testDownloadExpired();
await closeExportQueue();

console.log('data-export tests passed');
process.exit(0);
