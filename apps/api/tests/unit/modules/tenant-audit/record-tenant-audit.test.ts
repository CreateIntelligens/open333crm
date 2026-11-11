/**
 * recordTenantAudit()：在交易內寫稽核，失敗時丟出錯誤讓交易 rollback
 * （change migrate-role-agent-tenant-ctx，tenant-audit-log「交易內的稽核與主操作一起 commit」）。
 * 與資料庫一起 rollback 的行為見 tests/feature/modules/tenant-audit/record-tenant-audit.test.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { recordTenantAudit } from '#src/modules/tenant-audit/tenant-audit.service.js';
import { createMockTenantCtx, MOCK_TENANT_ID } from '#tests/support/mock-tenant-ctx.js';

test('稽核的 tenantId 是交易綁定的租戶', async () => {
  const created: unknown[] = [];
  const { ctx } = createMockTenantCtx({
    tenantAuditLog: {
      create: async (args: unknown) => {
        created.push(args);
        return {};
      },
    },
  });
  await recordTenantAudit(ctx, { actorId: 'agent-1', action: 'role.create', targetType: 'role', targetId: 'r1' });
  assert.deepEqual(created, [
    {
      data: {
        tenantId: MOCK_TENANT_ID,
        actorId: 'agent-1',
        action: 'role.create',
        targetType: 'role',
        targetId: 'r1',
        payload: undefined,
        ip: undefined,
      },
    },
  ]);
});

test('寫入失敗時丟出錯誤，不吞掉', async () => {
  const boom = new Error('fk violation');
  const { ctx } = createMockTenantCtx({
    tenantAuditLog: {
      create: async () => {
        throw boom;
      },
    },
  });
  await assert.rejects(recordTenantAudit(ctx, { action: 'role.create' }), (err) => err === boom);
});
