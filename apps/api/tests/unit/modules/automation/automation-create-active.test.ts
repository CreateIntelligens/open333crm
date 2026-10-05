/**
 * 建立規則時的啟用狀態（change improve-automation-page-readability）。
 * createRuleSchema 沒有 isActive、createRule 一律寫 true：新增規則頁「啟用」預設不勾，
 * 管理員以為建立的是停用的規則，存檔後卻立刻啟用、開始執行。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRule } from '#src/modules/automation/automation.service.js';

function mockPrisma() {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    prisma: {
      automationRule: {
        create: async (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return { id: 'r1', ...args.data };
        },
      },
    } as never,
  };
}

const base = {
  name: '新規則',
  trigger: { type: 'message.received' },
  conditions: { all: [] },
  actions: [{ type: 'add_tag', params: { tagName: 'VIP' } }],
};

test('Create an inactive rule：送 isActive false 就建立停用的規則', async () => {
  const { prisma, created } = mockPrisma();
  await createRule(prisma, 'tenant-1', { ...base, isActive: false });
  assert.equal(created[0]!.isActive, false);
});

test('Client that does not send the active state：沒送 isActive 時維持啟用', async () => {
  const { prisma, created } = mockPrisma();
  await createRule(prisma, 'tenant-1', base);
  assert.equal(created[0]!.isActive, true);
});
