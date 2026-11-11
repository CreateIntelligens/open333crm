/**
 * 不合契約的規則不可啟用（change fix-automation-rule-gaps，spec automation-engine「不合契約的規則不可啟用」，問題清單 A02）。
 * 背景：UAT 示範租戶的舊規則含 auto_assign 或觸發事件 sentiment.negative，workers 整條略過，
 * 列表的開關卻能把它們重新打開，看起來在運作、實際不會執行。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { updateRule } from '#src/modules/automation/automation.service.js';
import { createMockTenantCtx } from '#tests/support/mock-tenant-ctx.js';

const TENANT = 't1';

function db(rule: Record<string, unknown>) {
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    automationRule: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        where.id === rule.id && where.tenantId === TENANT ? rule : null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { ...rule, ...data };
      },
    },
    material: { findMany: async () => [] },
  };
  return { prisma: prisma as never, updates };
}

const legacyAutoAssign = {
  id: 'r1',
  tenantId: TENANT,
  enabled: true,
  isActive: false,
  eventType: 'message.received',
  trigger: { type: 'message.received' },
  conditions: { all: [{ fact: 'case.open.count', operator: 'equal', value: 0 }] },
  actions: [
    { type: 'create_case', params: { title: '客戶諮詢' } },
    { type: 'auto_assign', params: {} },
  ],
};

const legacySentiment = {
  id: 'r2',
  tenantId: TENANT,
  enabled: true,
  isActive: true,
  eventType: 'sentiment.negative',
  trigger: { type: 'sentiment.negative' },
  conditions: { all: [] },
  actions: [{ type: 'notify_supervisor', params: { message: '偵測到客戶負面情緒' } }],
};

test('開啟含未知動作的規則', async () => {
  const { prisma, updates } = db(legacyAutoAssign);
  await assert.rejects(updateRule(createMockTenantCtx(prisma, TENANT).ctx, 'r1', { isActive: true }), (err: Error & { statusCode?: number }) => {
    assert.equal(err.statusCode, 400);
    assert.match(err.message, /第 2 個動作「auto_assign」不是系統提供的動作/);
    return true;
  });
  assert.equal(updates.length, 0, '規則維持停用');
});

test('停用不合契約的規則', async () => {
  const { prisma, updates } = db(legacySentiment);
  await updateRule(createMockTenantCtx(prisma, TENANT).ctx, 'r2', { isActive: false });
  assert.deepEqual(updates, [{ isActive: false }]);
});

test('開啟合法的規則', async () => {
  const { prisma, updates } = db({
    ...legacyAutoAssign,
    actions: [{ type: 'create_case', params: { title: '客戶諮詢' } }],
  });
  await updateRule(createMockTenantCtx(prisma, TENANT).ctx, 'r1', { isActive: true });
  assert.deepEqual(updates, [{ isActive: true }]);
});
