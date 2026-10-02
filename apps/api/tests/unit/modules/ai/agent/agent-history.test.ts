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

test('loadAgentHistory：最近的訊息大多是綁定訊息時，仍保留 10 則一般對話', async () => {
  // 資料庫依 createdAt desc 回傳：最新的 8 則是綁定訊息，之後才是一般對話
  const binding = Array.from({ length: 8 }, () => ({ direction: 'OUTBOUND', content: { text: '請選擇…' }, metadata: { source: 'identity_binding' } }));
  const normal = Array.from({ length: 20 }, (_, i) => ({ direction: 'INBOUND', content: { text: `訊息${20 - i}` }, metadata: null }));
  let take = 0;
  const prisma = {
    message: {
      findMany: async (args: { take: number }) => {
        take = args.take;
        return [...binding, ...normal].slice(0, args.take);
      },
    },
  } as never;
  const history = await loadAgentHistory(prisma, 't1', 'c1');
  assert.equal(history.length, 10, `取 ${take} 則、過濾後應保留 10 則一般對話`);
  assert.equal(history.at(-1)?.content, '訊息20', '最新的一般對話在最後');
});
