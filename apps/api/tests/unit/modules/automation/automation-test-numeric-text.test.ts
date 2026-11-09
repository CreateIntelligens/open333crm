/**
 * 試試看與實際觸發一致（issue #418、AUDIT AUTO-06；change fix-automation-numeric-text-conditions）。
 * 舊版編輯器把「8888」存成數字，試跑 `POST /automation/rules/:id/test` 對「單號 8888」回 matched:false，
 * 管理員只會以為規則壞了。試跑與 workers 用同一個 evaluateRules，這裡測試跑的服務函式。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { testRule } from '#src/modules/automation/automation.service.js';
import { createMockTenantCtx } from '#tests/support/mock-tenant-ctx.js';

function txWithRule(value: unknown) {
  return {
    automationRule: {
      findFirst: async () => ({
        id: 'rule-1',
        name: '查單號',
        priority: 0,
        stopOnMatch: false,
        eventType: 'message.received',
        conditions: { all: [{ fact: 'message.text', operator: 'contains', value }] },
        actions: [{ type: 'add_tag', params: { tagName: '查單號' } }],
      }),
    },
  };
}

test('試試看與實際觸發一致：條件存成數字 8888，填入「單號 8888」時 matched 為 true', async () => {
  const { ctx } = createMockTenantCtx(txWithRule(8888));
  const result = await testRule(ctx, 'rule-1', { 'message.text': '單號 8888' });
  assert.equal(result.matched, true);
});

test('試試看：條件存成字串「8888」時一樣成立，不含 8888 的訊息不成立', async () => {
  assert.equal((await testRule(createMockTenantCtx(txWithRule('8888')).ctx, 'rule-1', { 'message.text': '單號 8888' })).matched, true);
  assert.equal((await testRule(createMockTenantCtx(txWithRule(8888)).ctx, 'rule-1', { 'message.text': '單號 7777' })).matched, false);
});
