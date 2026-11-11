import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { readConversationTranscript, readSuggestReplyQuery } from '#src/modules/ai/ai.service.js';

// 第一層租戶隔離：AI 輔助以 conversationId 讀對話時，查詢條件要帶 tenantId，不能只靠 RLS。

const TENANT = 'tenant-1';
const CONV = '11111111-1111-4111-8111-111111111111';
const where: { message: unknown[]; conversation: unknown[] } = { message: [], conversation: [] };

/** 對話屬於 tenant-2：只有不帶 tenantId 的查詢會找到它 */
function prismaMock() {
  const conv = { id: CONV, tenantId: 'tenant-2', contact: { displayName: 'X' }, messages: [{ senderType: 'CONTACT', content: { text: '機密內容' }, createdAt: new Date() }] };
  const matches = (w: any) => w.id === CONV && (w.tenantId === undefined || w.tenantId === conv.tenantId);
  return {
    message: {
      findMany: async ({ where: w }: any) => {
        where.message.push(w);
        const ok = w.conversationId === CONV && (w.conversation?.tenantId ?? w.tenantId) === undefined
          ? true
          : (w.conversation?.tenantId ?? w.tenantId) === conv.tenantId;
        return ok ? conv.messages : [];
      },
    },
    conversation: {
      findUnique: async ({ where: w }: any) => { where.conversation.push(w); return matches(w) ? conv : null; },
      findFirst: async ({ where: w }: any) => { where.conversation.push(w); return matches(w) ? conv : null; },
    },
  } as any;
}

beforeEach(() => { where.message.length = 0; where.conversation.length = 0; });

// 讀資料的查詢在 ai.service；flow 在交易內呼叫（change migrate-ai-llm-tenant-ctx，design D7）

test('summarizeConversation：其他租戶的對話視為不存在', async () => {
  const res = await readConversationTranscript({ tx: prismaMock(), tenantId: TENANT }, CONV);
  assert.equal(res, null);
  assert.ok(where.conversation.length > 0);
  assert.ok(where.conversation.every((w: any) => w.tenantId === TENANT));
});

test('suggestReply：訊息與對話查詢都帶 tenantId', async () => {
  const res = await readSuggestReplyQuery({ tx: prismaMock(), tenantId: TENANT }, CONV);
  assert.equal(res, null);
  assert.ok(where.message.length > 0);
  assert.ok(where.message.every((w: any) => (w.conversation?.tenantId ?? w.tenantId) === TENANT));
});
