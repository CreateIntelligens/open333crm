/**
 * 模型讀取的對話紀錄略過未遮罩的訊息（issue #466，change fix-deid-inbound-fallback-466：
 * bot-handoff-config「模型讀取的對話紀錄略過未遮罩的訊息」）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readModelMessageContent } from '#src/modules/ai/deidentification.service.js';
import { toAiHistory } from '#src/modules/identity-binding/ai-guard.js';
import { autoClassifyNewCase } from '#src/modules/ai/classify.service.js';

const PHONE = '0912345678';
const unmasked = {
  direction: 'INBOUND',
  content: { text: `我的電話 ${PHONE}` },
  metadata: { privacy: { version: 1, mode: 'inbound_unmasked', reason: 'upstream_5xx' } },
};
const masked = {
  direction: 'INBOUND',
  content: { text: '我住台北 0922000000' },
  metadata: { privacy: { version: 1, mode: 'inbound', maskedContent: { text: '我住[地址] [手機]' } } },
};

test('對話紀錄有未遮罩的訊息', () => {
  const history = toAiHistory([unmasked, masked]);
  assert.deepEqual(history, [{ role: 'user', content: '我住[地址] [手機]' }]);
  assert.equal(readModelMessageContent(unmasked.content, unmasked.metadata), '');
  assert.equal(readModelMessageContent(masked.content, masked.metadata), '我住[地址] [手機]');
  assert.ok(!JSON.stringify(history).includes(PHONE));
});

test('新工單最新的進站訊息未遮罩', async () => {
  let classified = 0;
  let updated = 0;
  const prisma = {
    case: {
      findFirst: async () => ({ category: null }),
      updateMany: async () => {
        updated += 1;
        return { count: 1 };
      },
    },
    message: { findFirst: async () => ({ content: unmasked.content, metadata: unmasked.metadata }) },
  };
  const result = await autoClassifyNewCase(prisma as never, 'tenant-1', 'case-1', 'conv-1', async () => {
    classified += 1;
    return { category: 'billing', confidence: 0.9 } as never;
  });
  assert.equal(result, null);
  assert.equal(classified, 0, '沒有呼叫模型分類');
  assert.equal(updated, 0, '工單的分類仍是空的');
});
