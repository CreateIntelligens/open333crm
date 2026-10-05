/**
 * 清理既有規則中已從契約拿掉的動作（change fix-automation-remaining-actions）。
 * assign_bot、kb_auto_reply、llm_reply 拿掉後，含這些動作的既有規則會被 workers 整條略過；
 * 清理腳本把這 3 種動作移除，讓規則其他動作恢復執行。預設 dry-run，--apply 才寫入。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { removeRetiredActions, stripRetiredActions } from '#src/modules/automation/retired-actions.js';

test('只移除 3 種拿掉的動作，其他動作保留順序', () => {
  assert.deepEqual(
    stripRetiredActions([
      { type: 'send_message', params: { text: 'hi' } },
      { type: 'llm_reply', params: {} },
      { type: 'add_tag', payload: { tagName: 'VIP' } },
      { type: 'assign_bot', params: {} },
      { type: 'kb_auto_reply' },
    ]),
    {
      actions: [
        { type: 'send_message', params: { text: 'hi' } },
        { type: 'add_tag', payload: { tagName: 'VIP' } },
      ],
      removed: ['llm_reply', 'assign_bot', 'kb_auto_reply'],
    },
  );
  assert.deepEqual(stripRetiredActions('bad'), { actions: [], removed: [] });
});

function fakePrisma(rules: Array<{ id: string; tenantId: string; name: string; actions: unknown }>) {
  const updates: Array<{ id: string; tenantId: string; actions: unknown }> = [];
  return {
    updates,
    prisma: {
      tenant: {
        findMany: async () => [...new Set(rules.map((r) => r.tenantId))].map((id) => ({ id })),
      },
      automationRule: {
        // 逐租戶查詢：where 一定帶 tenantId（租戶隔離檢查）
        findMany: async ({ where }: { where: { tenantId: string } }) => {
          assert.ok(where.tenantId, '查詢要帶 tenantId');
          return rules.filter((r) => r.tenantId === where.tenantId);
        },
        updateMany: async ({ where, data }: { where: { id: string; tenantId: string }; data: { actions: unknown } }) => {
          assert.ok(where.tenantId, '更新要帶 tenantId');
          updates.push({ id: where.id, tenantId: where.tenantId, actions: data.actions });
          return { count: 1 };
        },
      },
    },
  };
}

const RULES = [
  { id: 'r1', tenantId: 't1', name: 'AI 回覆', actions: [{ type: 'send_message', params: { text: 'hi' } }, { type: 'llm_reply', params: {} }] },
  { id: 'r2', tenantId: 't1', name: '一般規則', actions: [{ type: 'add_tag', params: { tagName: 'VIP' } }] },
  { id: 'r3', tenantId: 't2', name: '只有機器人', actions: [{ type: 'assign_bot', params: {} }] },
];

test('dry-run：列出受影響的規則，不寫入', async () => {
  const { prisma, updates } = fakePrisma(RULES);
  const report = await removeRetiredActions(prisma as never, { apply: false });
  assert.deepEqual(
    report.map((r) => [r.id, r.removed, r.remaining]),
    [
      ['r1', ['llm_reply'], 1],
      ['r3', ['assign_bot'], 0],
    ],
  );
  assert.equal(updates.length, 0);
});

test('--apply：只更新受影響的規則；移除後沒有動作的規則不寫入空陣列，留給管理員處理', async () => {
  const { prisma, updates } = fakePrisma(RULES);
  const report = await removeRetiredActions(prisma as never, { apply: true });
  assert.deepEqual(updates, [{ id: 'r1', tenantId: 't1', actions: [{ type: 'send_message', params: { text: 'hi' } }] }]);
  assert.equal(report.find((r) => r.id === 'r3')!.updated, false, '動作全被移除的規則不寫入（建立規則要求至少一個動作）');
});
