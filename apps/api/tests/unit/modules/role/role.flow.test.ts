/**
 * role 的 flow（change migrate-role-agent-tenant-ctx，design 決策 1、7）：
 * - 角色權限快取在 commit 之後才清除。commit 之前清掉的快取，可能被另一個請求以舊資料寫回。
 * - 設定權限的稽核與權限在同一個交易寫入。
 *
 * prisma.$transaction 以 mock 模擬：callback resolve 之後才算 commit。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import type { RequestActor } from '#src/lib/request-actor.js';

const log: string[] = [];
vi.mock('#src/services/permission.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/services/permission.service.js')>()),
  invalidateRolePermissions: async (roleId: string) => {
    log.push(`invalidate:${roleId}`);
  },
}));

const { setRolePermissionsFlow, deleteRoleFlow } = await import('#src/modules/role/role.flow.js');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const ROLE_ID = 'r0000000-0000-0000-0000-000000000001';
const ADMIN_ROLE_ID = 'r0000000-0000-0000-0000-000000000002';
const actor: RequestActor = { tenantId: TENANT_ID, agentId: 'agent-1', roleId: ADMIN_ROLE_ID, ip: '127.0.0.1' };

beforeEach(() => {
  log.length = 0;
});

function mockPrisma() {
  const tx = {
    $executeRaw: async () => 1,
    role: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
        assert.equal(where.tenantId, TENANT_ID);
        if (where.id === ADMIN_ROLE_ID) return { id: ADMIN_ROLE_ID, slug: 'admin', isSystem: true };
        return { id: ROLE_ID, slug: 'custom-x', name: 'X', isSystem: false };
      },
      delete: async () => ({}),
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

test('deleteRoleFlow：commit 之後才清除快取', async () => {
  await deleteRoleFlow({ prisma: mockPrisma() }, actor, ROLE_ID);
  assert.deepEqual(log, ['commit', `invalidate:${ROLE_ID}`]);
});
