/** AI 讀的對話紀錄不含系統發的綁定訊息、代碼已遮掉（change add-cross-channel-one-id，防 AI 偽造代碼） */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { loadAgentHistory } from '#src/modules/ai/agent/agent.service.js';

test('loadAgentHistory：去掉綁定訊息、遮掉代碼、依時間由舊到新', async () => {
  let selected: Record<string, unknown> | undefined;
  const rows = [
    { direction: 'INBOUND', content: { text: '綁定帳號綁定帳號' }, metadata: null },
    { direction: 'OUTBOUND', content: { text: '請選擇…BIND-75G6P389DQ' }, metadata: { source: 'identity_binding' } },
    { direction: 'INBOUND', content: { text: '綁定帳號' }, metadata: null },
  ];
  const prisma = {
    message: {
      findMany: async (args: { select: Record<string, unknown> }) => {
        selected = args.select;
        return rows;
      },
    },
  } as never;
  const history = await loadAgentHistory(prisma, 't1', 'c1');
  assert.ok(selected?.metadata, '要讀 metadata 才能辨識綁定訊息');
  assert.deepEqual(history, [
    { role: 'user', content: '綁定帳號' },
    { role: 'user', content: '綁定帳號綁定帳號' },
  ]);
});
