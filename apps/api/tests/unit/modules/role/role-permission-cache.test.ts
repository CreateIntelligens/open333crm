/**
 * 角色權限快取在 commit 之後才清除（change migrate-role-agent-tenant-ctx，design 決策 1）。
 * commit 之前清掉的快取，可能被另一個請求以舊資料寫回。
 * service 以 ctx.afterCommit 登記清除；inTenant() 在 commit 之後、回應之前執行它。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { createMockTenantCtx, MOCK_TENANT_ID } from '#tests/support/mock-tenant-ctx.js';

const invalidateRolePermissions = vi.fn(async (_roleId: string) => {});
vi.mock('#src/services/permission.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/services/permission.service.js')>()),
  invalidateRolePermissions: (roleId: string) => invalidateRolePermissions(roleId),
}));

const { setRolePermissions, deleteRole } = await import('#src/modules/role/role.service.js');

const ROLE_ID = 'r0000000-0000-0000-0000-000000000001';
const ADMIN_ROLE_ID = 'r0000000-0000-0000-0000-000000000002';

beforeEach(() => {
  invalidateRolePermissions.mockClear();
});

function mockTx() {
  return {
    role: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
        assert.equal(where.tenantId, MOCK_TENANT_ID);
        if (where.id === ADMIN_ROLE_ID) return { id: ADMIN_ROLE_ID, slug: 'admin', isSystem: true };
        return { id: ROLE_ID, slug: 'custom-x', name: 'X', isSystem: false };
      },
      delete: async () => ({}),
    },
    rolePermission: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 1 }),
    },
    agent: { findMany: async () => [] },
  };
}

async function runAfterCommit(afterCommitted: Array<{ fn: () => void | Promise<void> }>) {
  for (const { fn } of afterCommitted) await fn();
}

test('setRolePermissions：以 afterCommit 登記清除快取，交易內不清除', async () => {
  const { ctx, afterCommitted } = createMockTenantCtx(mockTx());
  await setRolePermissions(ctx, ROLE_ID, ['tag.view'], ADMIN_ROLE_ID);
  assert.equal(invalidateRolePermissions.mock.calls.length, 0, '交易內不能清除快取');
  assert.equal(afterCommitted.length, 1);
  await runAfterCommit(afterCommitted);
  assert.deepEqual(invalidateRolePermissions.mock.calls, [[ROLE_ID]]);
});

test('deleteRole：以 afterCommit 登記清除快取，交易內不清除', async () => {
  const { ctx, afterCommitted } = createMockTenantCtx(mockTx());
  await deleteRole(ctx, ROLE_ID);
  assert.equal(invalidateRolePermissions.mock.calls.length, 0, '交易內不能清除快取');
  assert.equal(afterCommitted.length, 1);
  await runAfterCommit(afterCommitted);
  assert.deepEqual(invalidateRolePermissions.mock.calls, [[ROLE_ID]]);
});
