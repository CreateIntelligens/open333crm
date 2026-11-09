/**
 * 永久刪除成員時保留操作者快照（change preserve-audit-actor-on-agent-purge，issue #414；
 * 主規格 agent-lifecycle「永久刪除成員」）。
 *
 * 稽核、資料匯出請求、資料刪除請求的操作者外鍵都是 ON DELETE SET NULL，所以 purgeAgent 要在
 * 刪除成員之前、同一個交易內把名稱與 email 寫進快照欄位。驗證失敗時不可寫任何快照。
 *
 * tx 以 mock 取代，只實作 purgeAgent 會呼叫的方法；tenant-audit、data-export、data-erasure 的
 * service 用真的，所以測得到實際送出的 where 與 data。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { purgeAgent } from '#src/modules/agent/agent.service.js';
import { createMockTenantCtx } from '#tests/support/mock-tenant-ctx.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const TARGET = { id: 'agent-x', isActive: false, role: 'AGENT', roleId: 'role-plain', name: '成員 X', email: 'x@example.test' };

interface Opts {
  target?: typeof TARGET | null;
  /** 目標是啟用中的唯一管理員 */
  lastAdmin?: boolean;
  /** 目標的權限比操作者多 */
  outranks?: boolean;
}

function mockTx(opts: Opts = {}) {
  const log: string[] = [];
  const calls: Record<string, unknown[]> = {};
  const record = (name: string) => async (args: unknown) => {
    log.push(name);
    (calls[name] ??= []).push(args);
    return { count: 1 };
  };
  const target = opts.target === undefined ? TARGET : opts.target;
  const tx = {
    agent: {
      findFirst: async ({ where }: { where: { tenantId: string } }) => {
        assert.equal(where.tenantId, TENANT, '查成員要帶 tenantId');
        if (!target) return null;
        return opts.lastAdmin ? { ...target, isActive: true, roleId: 'role-admin' } : target;
      },
      count: async () => 1,
      delete: record('agent.delete'),
    },
    role: {
      // listAdminRoleIds：role-admin 有 role.manage（selfLock）
      findMany: async () => [{ id: 'role-admin', permissions: [{ permissionCode: 'role.manage' }] }],
      // 操作者不是內建 admin，要比較權限
      findFirst: async () => ({ slug: 'manager', isSystem: false }),
    },
    rolePermission: {
      findMany: async ({ where }: { where: { roleId: string } }) => {
        if (where.roleId === 'role-actor') return [{ permissionCode: 'agent.view' }];
        return opts.outranks ? [{ permissionCode: 'agent.view' }, { permissionCode: 'data.export' }] : [{ permissionCode: 'agent.view' }];
      },
    },
    notification: { deleteMany: record('notification.deleteMany') },
    cliSession: { deleteMany: record('cliSession.deleteMany') },
    passkeyCredential: { deleteMany: record('passkeyCredential.deleteMany') },
    tenantAuditLog: { updateMany: record('tenantAuditLog.updateMany') },
    dataExportRequest: { updateMany: record('dataExportRequest.updateMany') },
    dataErasureRequest: { updateMany: record('dataErasureRequest.updateMany') },
  };
  return { tx, log, calls };
}

const SNAPSHOT_WRITES = ['tenantAuditLog.updateMany', 'dataExportRequest.updateMany', 'dataErasureRequest.updateMany'];

test('刪除保留操作者快照：刪除成員之前，以 tenantId 與成員 ID 寫入稽核、匯出請求、刪除請求的快照', async () => {
  const { tx, log, calls } = mockTx();
  const result = await purgeAgent(createMockTenantCtx(tx, TENANT).ctx, TARGET.id, 'role-actor');

  const deleteAt = log.indexOf('agent.delete');
  assert.ok(deleteAt >= 0, '要刪除成員');
  for (const name of SNAPSHOT_WRITES) {
    const at = log.indexOf(name);
    assert.ok(at >= 0 && at < deleteAt, `${name} 要在 agent.delete 之前`);
  }

  assert.deepEqual(calls['tenantAuditLog.updateMany'], [
    { where: { tenantId: TENANT, actorId: TARGET.id }, data: { actorName: TARGET.name, actorEmail: TARGET.email } },
  ]);
  const requesterSnapshot = {
    where: { tenantId: TENANT, requestedBy: TARGET.id },
    data: { requestedByName: TARGET.name, requestedByEmail: TARGET.email },
  };
  assert.deepEqual(calls['dataExportRequest.updateMany'], [requesterSnapshot]);
  assert.deepEqual(calls['dataErasureRequest.updateMany'], [requesterSnapshot]);

  // flow 用回傳的名稱寫 agent.purge 稽核的 payload
  assert.deepEqual(result, { name: TARGET.name });
});

test('刪除被拒時不寫快照：成員不存在（404）', async () => {
  const { tx, log } = mockTx({ target: null });
  await assert.rejects(purgeAgent(createMockTenantCtx(tx, TENANT).ctx, 'missing', 'role-actor'), (err: { statusCode?: number }) => err.statusCode === 404);
  assert.deepEqual(log.filter((l) => SNAPSHOT_WRITES.includes(l)), []);
  assert.equal(log.includes('agent.delete'), false);
});

test('刪除被拒時不寫快照：目標是最後一位管理員（422 LAST_ADMIN_PROTECTED）', async () => {
  const { tx, log } = mockTx({ lastAdmin: true });
  await assert.rejects(purgeAgent(createMockTenantCtx(tx, TENANT).ctx, TARGET.id, 'role-actor'), (err: { code?: string }) => err.code === 'LAST_ADMIN_PROTECTED');
  assert.deepEqual(log.filter((l) => SNAPSHOT_WRITES.includes(l)), []);
});

test('刪除被拒時不寫快照：目標權限比操作者高（403 TARGET_OUTRANKS_ACTOR）', async () => {
  const { tx, log } = mockTx({ outranks: true });
  await assert.rejects(purgeAgent(createMockTenantCtx(tx, TENANT).ctx, TARGET.id, 'role-actor'), (err: { code?: string }) => err.code === 'TARGET_OUTRANKS_ACTOR');
  assert.deepEqual(log.filter((l) => SNAPSHOT_WRITES.includes(l)), []);
});

/**
 * 順序是並行時的保證，行為測試碰不到（change keep-completion-audit-for-purged-requester）：
 * 資料刪除 worker 的交易先鎖住刪除請求列，再寫完成稽核。永久刪除先更新請求快照，會等那個交易 commit，
 * 之後才寫稽核快照，這時看得到剛寫入的完成稽核；反過來的話，那筆稽核在成員刪除後沒有操作者也沒有快照。
 */
test('請求的快照在稽核的快照之前寫入', async () => {
  const { tx, log } = mockTx();
  await purgeAgent(createMockTenantCtx(tx, TENANT).ctx, TARGET.id, 'role-actor');

  const auditAt = log.indexOf('tenantAuditLog.updateMany');
  assert.ok(log.indexOf('dataErasureRequest.updateMany') < auditAt, '刪除請求的快照在稽核快照之前');
  assert.ok(log.indexOf('dataExportRequest.updateMany') < auditAt, '匯出請求的快照在稽核快照之前');
});
