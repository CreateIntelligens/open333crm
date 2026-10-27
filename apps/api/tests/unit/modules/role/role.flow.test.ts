/**
 * role 的 flow（change migrate-role-agent-tenant-ctx，design 決策 1、7）：
 * - 角色權限快取在 commit 之後才清除。commit 之前清掉的快取，可能被另一個請求以舊資料寫回。
 * - 設定權限、建立、改名、刪除的稽核與資料在同一個交易寫入。
 *
 * prisma.$transaction 以 mock 模擬：callback resolve 之後才算 commit。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import type { RequestActor } from '#src/lib/request-actor.js';

const log: string[] = [];
/** 寫入的稽核內容，測試檢查 targetType、targetId 與 payload */
const audits: Array<Record<string, unknown>> = [];
vi.mock('#src/services/permission.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/services/permission.service.js')>()),
  invalidateRolePermissions: async (roleId: string) => {
    log.push(`invalidate:${roleId}`);
  },
}));

const { setRolePermissionsFlow, deleteRoleFlow, createRoleFlow, renameRoleFlow } = await import('#src/modules/role/role.flow.js');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const ROLE_ID = 'r0000000-0000-0000-0000-000000000001';
const ADMIN_ROLE_ID = 'r0000000-0000-0000-0000-000000000002';
const actor: RequestActor = { tenantId: TENANT_ID, agentId: 'agent-1', roleId: ADMIN_ROLE_ID, ip: '127.0.0.1' };

beforeEach(() => {
  log.length = 0;
  audits.length = 0;
});

function mockPrisma() {
  const tx = {
    $executeRaw: async () => 1,
    role: {
      findFirst: async ({ where }: { where: { id?: string; tenantId: string; name?: string } }) => {
        assert.equal(where.tenantId, TENANT_ID);
        // 同名檢查：沒有重複
        if (where.name !== undefined) return null;
        if (where.id === ADMIN_ROLE_ID) return { id: ADMIN_ROLE_ID, slug: 'admin', isSystem: true };
        return { id: ROLE_ID, slug: 'custom-x', name: 'X', isSystem: false };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        log.push(`delete:role:${where.id}`);
        return {};
      },
      create: async ({ data }: { data: { name: string; slug: string } }) => {
        log.push(`write:role:${data.name}`);
        return { id: 'new-role', slug: data.slug, name: data.name, isSystem: false };
      },
      update: async ({ data }: { data: { name: string } }) => {
        log.push(`write:role:${data.name}`);
        return { id: ROLE_ID, slug: 'custom-x', name: data.name, isSystem: false };
      },
    },
    rolePermission: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => {
        log.push('write:permissions');
        return { count: 1 };
      },
    },
    agent: { findMany: async () => [] },
    tenantAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        log.push(`audit:${data.action}:${data.tenantId}:${data.actorId}`);
        audits.push(data);
        return data;
      },
    },
  };
  return {
    async $transaction(cb: (t: typeof tx) => Promise<unknown>) {
      const result = await cb(tx);
      log.push('commit');
      return result;
    },
  } as never;
}

test('setRolePermissionsFlow：權限與稽核一起 commit，commit 之後才清除快取', async () => {
  await setRolePermissionsFlow({ prisma: mockPrisma() }, actor, ROLE_ID, ['tag.view']);
  assert.deepEqual(log, [
    'write:permissions',
    `audit:role.permission.update:${TENANT_ID}:agent-1`,
    'commit',
    `invalidate:${ROLE_ID}`,
  ]);
});

test('deleteRoleFlow：刪除與稽核 role.delete 一起 commit，commit 之後才清除快取', async () => {
  const result = await deleteRoleFlow({ prisma: mockPrisma() }, actor, ROLE_ID);
  assert.deepEqual(result, { deleted: true });
  assert.deepEqual(log, [
    `delete:role:${ROLE_ID}`,
    `audit:role.delete:${TENANT_ID}:agent-1`,
    'commit',
    `invalidate:${ROLE_ID}`,
  ]);
  assert.deepEqual(
    { targetType: audits[0].targetType, targetId: audits[0].targetId, payload: audits[0].payload },
    { targetType: 'role', targetId: ROLE_ID, payload: { name: 'X' } },
    '稽核記被刪角色的名稱',
  );
});

test('createRoleFlow：建立角色與稽核 role.create 一起 commit', async () => {
  await createRoleFlow({ prisma: mockPrisma() }, actor, '客服組長');
  assert.deepEqual(log, ['write:role:客服組長', `audit:role.create:${TENANT_ID}:agent-1`, 'commit']);
});

test('renameRoleFlow：改名與稽核 role.rename 一起 commit', async () => {
  await renameRoleFlow({ prisma: mockPrisma() }, actor, ROLE_ID, '資深客服');
  assert.deepEqual(log, ['write:role:資深客服', `audit:role.rename:${TENANT_ID}:agent-1`, 'commit']);
});
