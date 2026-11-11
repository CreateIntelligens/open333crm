/**
 * 知識庫自動回覆不在交易內等待外部呼叫（change migrate-ai-kb-autoreply-tenant-ctx：
 * bot-handoff-config「知識庫自動回覆不在交易內等待外部呼叫」）。
 *
 * 交易換成會記錄「目前有幾個交易還沒結束」的 mock；embedding、LLM 與去識別化服務被呼叫時，
 * 記下當時還沒結束的交易數。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const TENANT = 'a1a1a1a1-0000-4000-8000-000000000020';

const state = vi.hoisted(() => ({
  open: 0,
  /** 呼叫外部服務當下還沒結束的交易數 */
  calls: [] as Array<{ kind: 'embedding' | 'llm' | 'deidentify'; openTransactions: number }>,
  delivered: 0,
  kbEnabled: true,
  /** 開過的交易數 */
  transactions: 0,
}));

vi.mock('#src/config/env.js', async (orig) => ({
  ...(await orig<object>()),
  getConfig: () => ({ KB_AUTO_REPLY_ENABLED: state.kbEnabled }),
}));
vi.mock('#src/modules/embedding/embedding-client.js', () => ({
  embedText: async () => {
    state.calls.push({ kind: 'embedding', openTransactions: state.open });
    return [0.1];
  },
}));
vi.mock('#src/modules/ai/llm.flow.js', () => ({
  generateReply: async () => {
    state.calls.push({ kind: 'llm', openTransactions: state.open });
    return '請問您想詢問哪一項服務呢？';
  },
}));
vi.mock('#src/modules/ai/deidentification.service.js', () => ({
  prepareStoredMessageContent: async (_policy: unknown, content: unknown) => {
    state.calls.push({ kind: 'deidentify', openTransactions: state.open });
    return { content, metadata: {} };
  },
}));
vi.mock('#src/modules/embedding/embedding.service.js', () => ({
  readEmbeddingInputs: async () => ({ settings: { baseUrl: 'http://embed.test', model: 'bge-m3', topK: 3, threshold: 0.5 }, policy: { enabled: true } }),
  searchSimilarArticles: async () => [],
}));
vi.mock('#src/modules/settings/chat-settings.service.js', () => ({
  getChatSettings: async () => ({ clarifyThreshold: 0.5, clarifyMaxAttempts: 2 }),
}));
vi.mock('#src/modules/ai/other-channel-context.js', () => ({ loadOtherChannelContext: async () => '' }));
vi.mock('#src/modules/automation/keyword-yield.js', () => ({ hasMatchingKeywordRule: async () => false }));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async () => {
    state.delivered += 1;
  },
}));

const { attemptKbAutoReplyFlow } = await import('#src/modules/ai/kb-autoreply.flow.js');
const { createBotReplyGuard } = await import('#src/modules/automation/bot-reply-guard.js');

/** 記錄交易數的 Prisma mock：$transaction 進入時 +1，結束時 -1 */
function countingPrisma() {
  const conversation = { contactId: 'ct1', metadata: {}, channel: { id: 'ch1', channelType: 'LINE', settings: { botConfig: { botMode: 'llm' } } } };
  const tx = {
    $executeRaw: async () => 1,
    conversation: {
      findFirst: async () => conversation,
      updateMany: async () => ({ count: 1 }),
    },
    message: {
      findMany: async () => [],
      create: async () => ({ id: 'm1', metadata: {} }),
    },
  };
  return {
    async $transaction(cb: (t: unknown) => Promise<unknown>) {
      state.open += 1;
      state.transactions += 1;
      try {
        return await cb(tx);
      } finally {
        state.open -= 1;
      }
    },
  } as never;
}

beforeEach(() => {
  state.open = 0;
  state.calls.length = 0;
  state.delivered = 0;
  state.kbEnabled = true;
  state.transactions = 0;
});

function deps(prisma: never) {
  return {
    prisma,
    llm: {} as never,
    io: { to: () => ({ emit: () => {} }) } as never,
    replyGuard: createBotReplyGuard(prisma, {} as never, TENANT, undefined),
    events: {} as never,
    deliverDb: {} as never,
  };
}

// 搬遷前 attemptKbAutoReply() 一開始就檢查開關、不碰資料庫：開關關閉時開交易失敗不能變成「AI 失敗」而轉接真人（KB-06）
test('知識庫自動回覆停用：不開交易，結果是略過（kb_disabled）', async () => {
  state.kbEnabled = false;
  const result = await attemptKbAutoReplyFlow(deps(countingPrisma()), { tenantId: TENANT, conversationId: 'c1', messageText: '請問一下', delivery: {} });

  assert.deepEqual(result, { status: 'skipped', reason: 'kb_disabled' });
  assert.equal(state.transactions, 0);
  assert.deepEqual(state.calls, []);
});

test('呼叫外部服務之前交易已經結束：向量化、呼叫 LLM、遮罩回覆時，沒有還沒結束的交易', async () => {
  const prisma = countingPrisma();
  const result = await attemptKbAutoReplyFlow(
    {
      prisma,
      llm: {} as never,
      io: { to: () => ({ emit: () => {} }) } as never,
      replyGuard: createBotReplyGuard(prisma, {} as never, TENANT, undefined),
      events: {} as never,
      deliverDb: {} as never,
    },
    { tenantId: TENANT, conversationId: 'c1', messageText: '請問一下', delivery: {} },
  );

  assert.deepEqual(result, { status: 'replied' });
  assert.deepEqual(state.calls, [
    { kind: 'embedding', openTransactions: 0 },
    { kind: 'llm', openTransactions: 0 },
    { kind: 'deidentify', openTransactions: 0 },
  ]);
  assert.equal(state.delivered, 1);
});
