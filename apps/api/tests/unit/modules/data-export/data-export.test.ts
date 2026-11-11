/**
 * GDPR 資料匯出的 service 與 flow（#337 階段 3，AGENTS.md 結構規則 2）。
 * 涵蓋：
 *  - createExportRequest 建 pending 請求
 *  - getExportRequest 一律 tenantId scoped，找不到 → 404
 *  - 下載：跨租戶（找不到）→ 404、未完成 → 400、已過期 → 410，未通過都不增計數
 *  - requestExportFlow 在同一個交易寫請求、稽核與匯出工作（含保留期限）；稽核寫不進去時 rollback，匯出工作不送出
 *
 * prisma.$transaction 以 mock 模擬，見 tests/support/flow-harness.ts。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { createMockTenantCtx, MOCK_TENANT_ID } from '#tests/support/mock-tenant-ctx.js';
import { createFlowLog, mockTransactionPrisma, recordingPublisher } from '#tests/support/flow-harness.js';
import type { OutboxInput } from '@open333crm/core';

vi.mock('#src/modules/storage/storage.service.js', () => ({
  getFileUrl: async (key: string) => `https://storage.example.test/${key}?signed=1`,
}));

const { createExportRequest, getExportRequest } = await import('#src/modules/data-export/data-export.service.js');
const { getExportDownloadFlow, requestExportFlow } = await import('#src/modules/data-export/data-export.flow.js');

type MockFn = ((...args: unknown[]) => unknown) & { calls: unknown[][] };

function mockFn(impl?: (...args: unknown[]) => unknown): MockFn {
  const fn = ((...args: unknown[]) => {
    fn.calls.push(args);
    return impl?.(...args);
  }) as MockFn;
  fn.calls = [];
  return fn;
}

const actor = { tenantId: MOCK_TENANT_ID, agentId: 'agent-1', roleId: 'role-1', ip: '203.0.113.7' };

test('creates pending request', async () => {
  const created = { id: 'export-1', status: 'pending', scope: null, createdAt: new Date() };
  const tx = { dataExportRequest: { create: mockFn(() => created) } };
  const { ctx } = createMockTenantCtx(tx);

  const result = await createExportRequest(ctx, { requestedBy: 'agent-1', scope: ['contacts'] });

  assert.deepEqual(result, created);
  const createArg = tx.dataExportRequest.create.calls[0][0] as { data: Record<string, unknown> };
  assert.equal(createArg.data.tenantId, MOCK_TENANT_ID);
  assert.equal(createArg.data.requestedBy, 'agent-1');
  assert.equal(createArg.data.status, 'pending');
  assert.deepEqual(createArg.data.scope, ['contacts']);
});

test('get export request is tenant scoped', async () => {
  const row = { id: 'export-1', status: 'completed' };
  const tx = { dataExportRequest: { findFirst: mockFn(() => row) } };
  const { ctx } = createMockTenantCtx(tx);

  const result = await getExportRequest(ctx, 'export-1');
  assert.deepEqual(result, row);
  const arg = tx.dataExportRequest.findFirst.calls[0][0] as { where: Record<string, unknown> };
  assert.deepEqual(arg.where, { id: 'export-1', tenantId: MOCK_TENANT_ID });
});

test('get export request not found', async () => {
  const { ctx } = createMockTenantCtx({ dataExportRequest: { findFirst: mockFn(() => null) } });
  await assert.rejects(
    () => getExportRequest(ctx, 'missing'),
    (err: unknown) => {
      const e = err as { code?: string; statusCode?: number };
      assert.equal(e.code, 'NOT_FOUND');
      assert.equal(e.statusCode, 404);
      return true;
    },
  );
});

/** 呼叫下載 flow，回傳結果與 tx 的 mock */
async function download(row: Record<string, unknown> | null) {
  const log = createFlowLog();
  const tx = { dataExportRequest: { findFirst: mockFn(() => row), updateMany: mockFn(() => ({ count: 1 })) } };
  const result = getExportDownloadFlow({ prisma: mockTransactionPrisma(log, tx) }, MOCK_TENANT_ID, 'export-1');
  return { result, tx };
}

test('保留期內下載', async () => {
  const { result, tx } = await download({
    id: 'export-1',
    status: 'completed',
    fileKey: 'export/t/export-1.zip',
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.deepEqual(await result, { url: 'https://storage.example.test/export/t/export-1.zip?signed=1', expiresInSeconds: 900 });
  assert.deepEqual(tx.dataExportRequest.updateMany.calls[0][0], {
    where: { id: 'export-1', tenantId: MOCK_TENANT_ID },
    data: { downloadCount: { increment: 1 } },
  });
});

test('其他租戶的匯出不能下載', async () => {
  // 跨租戶：findFirst 帶 tenantId 找不到 → 404，不提供任何檔案
  const { result, tx } = await download(null);
  await assert.rejects(result, (err: unknown) => {
    assert.equal((err as { statusCode?: number }).statusCode, 404);
    return true;
  });
  const arg = tx.dataExportRequest.findFirst.calls[0][0] as { where: Record<string, unknown> };
  assert.equal(arg.where.tenantId, MOCK_TENANT_ID);
  assert.equal(tx.dataExportRequest.updateMany.calls.length, 0, '未通過不得增計數');
});

test('download not ready', async () => {
  const { result, tx } = await download({ id: 'export-1', status: 'processing', fileKey: null, expiresAt: null });
  await assert.rejects(result, (err: unknown) => {
    const e = err as { code?: string; statusCode?: number };
    assert.equal(e.code, 'EXPORT_NOT_READY');
    assert.equal(e.statusCode, 400);
    return true;
  });
  assert.equal(tx.dataExportRequest.updateMany.calls.length, 0);
});

test('過期的匯出不能下載', async () => {
  const { result, tx } = await download({
    id: 'export-1',
    status: 'completed',
    fileKey: 'export/tenant-1/export-1.zip',
    expiresAt: new Date(Date.now() - 60_000),
  });
  await assert.rejects(result, (err: unknown) => {
    const e = err as { code?: string; statusCode?: number };
    assert.equal(e.code, 'EXPORT_EXPIRED');
    assert.equal(e.statusCode, 410);
    return true;
  });
  assert.equal(tx.dataExportRequest.updateMany.calls.length, 0, '過期不得增計數');
});

/** 記錄寫進 outbox 的 job 內容的 publisher */
function jobRecorder(log: ReturnType<typeof createFlowLog>) {
  const jobs: Array<Extract<OutboxInput, { kind: 'job' }>> = [];
  const base = recordingPublisher(log);
  return {
    jobs,
    events: {
      ...base,
      write: (tx: Parameters<typeof base.write>[0], input: OutboxInput) => {
        if (input.kind === 'job') jobs.push(input);
        return base.write(tx, input);
      },
    },
  };
}

function flowTx(log: ReturnType<typeof createFlowLog>, auditFails = false) {
  return {
    dataExportRequest: {
      create: async () => {
        log.entries.push('write:request');
        return { id: 'export-1', status: 'pending', scope: null };
      },
    },
    tenantAuditLog: {
      create: mockFn(async () => {
        if (auditFails) throw new Error('audit failed');
        log.entries.push('write:audit');
        return {};
      }),
    },
  };
}

test('請求、稽核與匯出工作在同一個交易寫入，commit 之後才送出', async () => {
  const log = createFlowLog();
  const tx = flowTx(log);
  const { jobs, events } = jobRecorder(log);

  const result = await requestExportFlow({ prisma: mockTransactionPrisma(log, tx), events }, actor, {
    scope: ['contacts'],
  });

  assert.deepEqual(result, { id: 'export-1', status: 'pending', scope: null });
  assert.deepEqual(log.entries.slice(0, 4), ['write:request', 'write:audit', 'event:data-export:generate', 'commit']);
  assert.deepEqual(log.entries.slice(4), ['dispatch:data-export:generate'], '匯出工作在 commit 之後才送出');

  const auditArg = tx.tenantAuditLog.create.calls[0][0] as { data: Record<string, unknown> };
  assert.equal(auditArg.data.action, 'data.export.request');
  assert.equal(auditArg.data.targetId, 'export-1');
  assert.equal(auditArg.data.actorId, 'agent-1');
  assert.equal(auditArg.data.ip, '203.0.113.7');
  assert.deepEqual(auditArg.data.payload, { scope: ['contacts'] });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].queueName, 'data-export');
  assert.deepEqual(jobs[0].payload, { requestId: 'export-1', tenantId: MOCK_TENANT_ID, requestedBy: 'agent-1' });
  // queue-monitoring「各佇列 job 的保留期限」：completed 保留 24 小時，failed 保留 7 天
  assert.deepEqual(jobs[0].jobOptions, { removeOnComplete: { age: 86_400 }, removeOnFail: { age: 604_800 } });
});

test('稽核寫不進去時不送出匯出工作', async () => {
  const log = createFlowLog();
  const { jobs, events } = jobRecorder(log);

  await assert.rejects(
    () => requestExportFlow({ prisma: mockTransactionPrisma(log, flowTx(log, true)), events }, actor, {}),
    /audit failed/,
  );

  assert.equal(jobs.length, 0);
  assert.ok(log.entries.includes('rollback'));
  assert.ok(!log.entries.some((e) => e.startsWith('dispatch:')));
});
