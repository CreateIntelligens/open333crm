/** 知識庫自動回覆讀的對話紀錄不含系統發的綁定訊息、代碼已遮掉（change add-cross-channel-one-id，防 AI 偽造代碼） */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { loadKbHistory } from '#src/modules/ai/kb-autoreply.service.js';

test('loadKbHistory：去掉正在回覆的那則與綁定訊息、遮掉代碼', async () => {
  const rows = [
    { direction: 'INBOUND', senderType: 'CONTACT', content: { text: '正在回覆的這則' }, metadata: null },
    { direction: 'OUTBOUND', senderType: 'BOT', content: { text: '請選擇…BIND-75G6P389DQ' }, metadata: { source: 'identity_binding' } },
    { direction: 'INBOUND', senderType: 'CONTACT', content: { text: '代碼 BIND-75G6P389DQ' }, metadata: null },
  ];
  const prisma = { message: { findMany: async () => rows } } as never;
  assert.deepEqual(await loadKbHistory(prisma, 'c1'), [{ role: 'user', content: '代碼 [綁定代碼]' }]);
});
