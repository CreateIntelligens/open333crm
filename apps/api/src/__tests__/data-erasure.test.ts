/**
 * GDPR 資料刪除服務層測試（tsx 自跑）。
 * 涵蓋：
 *  - requestErasure 驗聯絡人同租戶（不存在→丟 CONTACT_NOT_FOUND / 404）
 *  - requestErasure 成功時建 pending 請求 + 寫稽核（payload 不含 PII）
 *  - getErasureRequest 一律 tenantId scoped
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

const { requestErasure, getErasureRequest, setEnqueueErasureJob } = await import(
  '../modules/data-erasure/data-erasure.service.js'
);

// 注入入列替身，避免單元測試連 Redis。
const enqueued: unknown[] = [];
setEnqueueErasureJob(async (data) => {
  enqueued.push(data);
});

async function testRejectsForeignContact() {
  const prisma = {
    contact: { findFirst: mockFn(() => null) },
    dataErasureRequest: { create: mockFn() },
    tenantAuditLog: { create: mockFn() },
  };

  await assert.rejects(
    () =>
      requestErasure(prisma as never, {
        tenantId: 'tenant-1',
        requestedBy: 'agent-1',
        contactId: 'contact-x',
        mode: 'anonymize',
      }),
    (err: unknown) => {
      const e = err as { code?: string; statusCode?: number };
      assert.equal(e.code, 'CONTACT_NOT_FOUND');
      assert.equal(e.statusCode, 404);
      return true;
    },
  );

  // 驗證有帶 tenantId 查聯絡人
  assert.deepEqual(prisma.contact.findFirst.calls[0][0], {
    where: { id: 'contact-x', tenantId: 'tenant-1' },
    select: { id: true },
  });
  // 未通過驗證不應建請求
  assert.equal(prisma.dataErasureRequest.create.calls.length, 0);
}

async function testCreatesPendingRequestAndAudit() {
  const created = { id: 'erasure-1', status: 'pending' };
  const prisma = {
    contact: { findFirst: mockFn(() => ({ id: 'contact-1' })) },
    dataErasureRequest: { create: mockFn(() => created) },
    tenantAuditLog: { create: mockFn(() => ({})) },
  };

  const result = await requestErasure(prisma as never, {
    tenantId: 'tenant-1',
    requestedBy: 'agent-1',
    contactId: 'contact-1',
    mode: 'hard_delete',
    reason: '客戶要求刪除',
  });

  assert.deepEqual(result, created);

  // 建 pending 請求，帶正確欄位
  const createArg = prisma.dataErasureRequest.create.calls[0][0] as { data: Record<string, unknown> };
  assert.equal(createArg.data.tenantId, 'tenant-1');
  assert.equal(createArg.data.contactId, 'contact-1');
  assert.equal(createArg.data.mode, 'hard_delete');
  assert.equal(createArg.data.status, 'pending');
  assert.equal(createArg.data.reason, '客戶要求刪除');

  // 稽核 payload 只含 contactId/mode，絕不含 PII（displayName/phone/email）
  const auditArg = prisma.tenantAuditLog.create.calls[0][0] as { data: { action: string; payload: Record<string, unknown> } };
  assert.equal(auditArg.data.action, 'data.erasure.request');
  assert.deepEqual(auditArg.data.payload, { contactId: 'contact-1', mode: 'hard_delete' });
  const payloadKeys = Object.keys(auditArg.data.payload);
  assert.ok(!payloadKeys.includes('displayName'));
  assert.ok(!payloadKeys.includes('phone'));
  assert.ok(!payloadKeys.includes('email'));

  // 入列 job payload 帶最小識別欄位
  assert.deepEqual(enqueued.at(-1), {
    requestId: 'erasure-1',
    tenantId: 'tenant-1',
    contactId: 'contact-1',
    mode: 'hard_delete',
    requestedBy: 'agent-1',
  });
}

async function testGetErasureRequestIsTenantScoped() {
  const row = { id: 'erasure-1', tenantId: 'tenant-1', status: 'completed' };
  const prisma = {
    dataErasureRequest: { findFirst: mockFn(() => row) },
  };

  const result = await getErasureRequest(prisma as never, 'tenant-1', 'erasure-1');
  assert.deepEqual(result, row);
  assert.deepEqual(prisma.dataErasureRequest.findFirst.calls[0][0], {
    where: { id: 'erasure-1', tenantId: 'tenant-1' },
  });
}

await testRejectsForeignContact();
await testCreatesPendingRequestAndAudit();
await testGetErasureRequestIsTenantScoped();

console.log('data-erasure tests passed');
process.exit(0);
