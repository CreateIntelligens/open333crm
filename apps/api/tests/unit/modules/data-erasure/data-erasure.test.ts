/**
 * GDPR 資料刪除的 service 與 flow（#337 階段 3，AGENTS.md 結構規則 2）。
 * 涵蓋：
 *  - createErasureRequest 驗聯絡人同租戶（不存在→丟 CONTACT_NOT_FOUND / 404）
 *  - createErasureRequest 建 pending 請求
 *  - getErasureRequest 一律 tenantId scoped
 *  - requestErasureFlow 在同一個交易寫請求、稽核與刪除工作（payload 不含 PII 與 reason）；
 *    稽核寫不進去時 rollback，刪除工作不送出
 *
 * prisma.$transaction 以 mock 模擬，見 tests/support/flow-harness.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createMockTenantCtx, MOCK_TENANT_ID } from '#tests/support/mock-tenant-ctx.js';
import { createFlowLog, mockTransactionPrisma, recordingPublisher } from '#tests/support/flow-harness.js';
import type { OutboxInput } from '@open333crm/core';
import { createErasureRequest, getErasureRequest } from '#src/modules/data-erasure/data-erasure.service.js';
import { requestErasureFlow } from '#src/modules/data-erasure/data-erasure.flow.js';

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

test('rejects foreign contact', async () => {
  const tx = {
    contact: { findFirst: mockFn(() => null) },
    dataErasureRequest: { create: mockFn() },
  };
  const { ctx } = createMockTenantCtx(tx);

  await assert.rejects(
    () => createErasureRequest(ctx, { requestedBy: 'agent-1', contactId: 'contact-x', mode: 'anonymize' }),
    (err: unknown) => {
      const e = err as { code?: string; statusCode?: number };
      assert.equal(e.code, 'CONTACT_NOT_FOUND');
      assert.equal(e.statusCode, 404);
      return true;
    },
  );

  // 驗證有帶 tenantId 查聯絡人
  assert.deepEqual(tx.contact.findFirst.calls[0][0], {
    where: { id: 'contact-x', tenantId: MOCK_TENANT_ID },
    select: { id: true },
  });
  // 未通過驗證不應建請求
  assert.equal(tx.dataErasureRequest.create.calls.length, 0);
});

test('creates pending request', async () => {
  const created = { id: 'erasure-1', status: 'pending' };
  const tx = {
    contact: { findFirst: mockFn(() => ({ id: 'contact-1' })) },
    dataErasureRequest: { create: mockFn(() => created) },
  };
  const { ctx } = createMockTenantCtx(tx);

  const result = await createErasureRequest(ctx, {
    requestedBy: 'agent-1',
    contactId: 'contact-1',
    mode: 'hard_delete',
    reason: '客戶要求刪除',
  });

  assert.deepEqual(result, created);
  const createArg = tx.dataErasureRequest.create.calls[0][0] as { data: Record<string, unknown> };
  assert.equal(createArg.data.tenantId, MOCK_TENANT_ID);
  assert.equal(createArg.data.requestedBy, 'agent-1');
  assert.equal(createArg.data.contactId, 'contact-1');
  assert.equal(createArg.data.mode, 'hard_delete');
  assert.equal(createArg.data.status, 'pending');
  assert.equal(createArg.data.reason, '客戶要求刪除');
});

test('get erasure request is tenant scoped', async () => {
  const row = { id: 'erasure-1', tenantId: MOCK_TENANT_ID, status: 'completed' };
  const tx = { dataErasureRequest: { findFirst: mockFn(() => row) } };
  const { ctx } = createMockTenantCtx(tx);

  const result = await getErasureRequest(ctx, 'erasure-1');
  assert.deepEqual(result, row);
  assert.deepEqual(tx.dataErasureRequest.findFirst.calls[0][0], {
    where: { id: 'erasure-1', tenantId: MOCK_TENANT_ID },
  });
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
    contact: { findFirst: async () => ({ id: 'contact-1' }) },
    dataErasureRequest: {
      create: async () => {
        log.entries.push('write:request');
        return { id: 'erasure-1', status: 'pending' };
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

test('請求、稽核與刪除工作在同一個交易寫入，commit 之後才送出', async () => {
  const log = createFlowLog();
  const tx = flowTx(log);
  const { jobs, events } = jobRecorder(log);

  const result = await requestErasureFlow({ prisma: mockTransactionPrisma(log, tx) as never, events }, actor, {
    contactId: 'contact-1',
    mode: 'hard_delete',
    reason: '客戶要求刪除',
  });

  assert.deepEqual(result, { id: 'erasure-1', status: 'pending' });
  assert.deepEqual(log.entries.slice(0, 4), ['write:request', 'write:audit', 'event:data-erasure:process', 'commit']);
  assert.deepEqual(log.entries.slice(4), ['dispatch:data-erasure:process'], '刪除工作在 commit 之後才送出');

  // 稽核 payload 只含 contactId/mode，絕不含 PII 與 reason
  const auditArg = tx.tenantAuditLog.create.calls[0][0] as { data: Record<string, unknown> };
  assert.equal(auditArg.data.action, 'data.erasure.request');
  assert.equal(auditArg.data.actorId, 'agent-1');
  assert.equal(auditArg.data.ip, '203.0.113.7');
  assert.deepEqual(auditArg.data.payload, { contactId: 'contact-1', mode: 'hard_delete' });

  // 刪除工作只帶最小識別欄位
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].queueName, 'data-erasure');
  assert.deepEqual(jobs[0].payload, {
    requestId: 'erasure-1',
    tenantId: MOCK_TENANT_ID,
    contactId: 'contact-1',
    mode: 'hard_delete',
    requestedBy: 'agent-1',
  });
  assert.deepEqual(jobs[0].jobOptions, { removeOnComplete: { age: 86_400 }, removeOnFail: { age: 604_800 } });
});

test('稽核寫不進去時不送出刪除工作', async () => {
  const log = createFlowLog();
  const { jobs, events } = jobRecorder(log);

  await assert.rejects(
    () =>
      requestErasureFlow({ prisma: mockTransactionPrisma(log, flowTx(log, true)) as never, events }, actor, {
        contactId: 'contact-1',
        mode: 'anonymize',
      }),
    /audit failed/,
  );

  assert.equal(jobs.length, 0);
  assert.ok(log.entries.includes('rollback'));
  assert.ok(!log.entries.some((e) => e.startsWith('dispatch:')));
});
