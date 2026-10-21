/**
 * 非文字訊息不做 AI 自動回覆（主規格 automation-engine「非文字訊息不做 AI 自動回覆」，
 * change restore-instagram-channel-spec）。Instagram 的愛心是帶「❤️」文字的貼圖，不能拿去做 KB 檢索。
 * AI 回覆、摘要、情緒分析與送出換成假的；資料庫換成一段機器人處理中的對話。
 */
import assert from 'node:assert/strict';
import { beforeAll, beforeEach, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({ kb: [] as string[], agent: [] as string[], enqueued: 0 }));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    // eventBus 也把衍生事件送進訂閱者佇列；這裡只計算規則評估的 job
    async add(name: string) {
      if (name === 'automation:evaluate') calls.enqueued += 1;
    }
  },
}));
vi.mock('#src/modules/ai/kb-autoreply.service.js', () => ({
  attemptKbAutoReply: async (_p: unknown, _io: unknown, _t: string, _c: string, text: string) => {
    calls.kb.push(text);
  },
}));
vi.mock('#src/modules/ai/agent/agent.service.js', () => ({
  isAgentEnabled: () => true,
  runAgentReply: async (_p: unknown, input: { userMessage: string }) => {
    calls.agent.push(input.userMessage);
    return { handled: true };
  },
}));
vi.mock('#src/modules/ai/sentiment.service.js', () => ({
  analyzeSentiment: async () => {
    throw new Error('not in this test');
  },
}));
vi.mock('#src/modules/ai/classify.service.js', () => ({ autoClassifyNewCase: async () => {} }));
vi.mock('#src/modules/ai/ai.service.js', () => ({ summarizeConversation: async () => ({ summary: '' }) }));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({ deliverToChannel: async () => true }));

const { setupAutomationWorker } = await import('#src/modules/automation/automation.worker.js');

const conversation = { id: 'conv-1', status: 'BOT_HANDLED', botRepliesCount: 0, handoffReason: null as string | null };

const prisma = {
  conversation: {
    findFirst: async ({ where }: { where: { status?: string } }) =>
      where.status && where.status !== conversation.status
        ? null
        : { ...conversation, channel: { settings: { botConfig: { botMode: 'llm', handoffKeywords: [] } } } },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(conversation, data);
      return { ...conversation, assignedToId: null, unreadCount: 0, lastMessageAt: new Date(), updatedAt: new Date() };
    },
  },
  message: { create: async ({ data }: { data: { content: unknown } }) => ({ id: 'sys-1', content: data.content }) },
  automationRule: { findMany: async () => [] },
};

let handle: Awaited<ReturnType<typeof setupAutomationWorker>>;

beforeAll(() => {
  handle = setupAutomationWorker(prisma as never, { to: () => ({ emit: () => {} }) } as never);
});

beforeEach(() => {
  Object.assign(conversation, { status: 'BOT_HANDLED', handoffReason: null });
  calls.kb.length = 0;
  calls.agent.length = 0;
  calls.enqueued = 0;
});

/** 發布 message.received，等處理流程走到最後一步（排入自動化規則的佇列） */
async function receive(contentType: string | undefined, content: Record<string, unknown>) {
  void handle({
    id: crypto.randomUUID(),
    name: 'message.received',
    tenantId: 'tenant-1',
    timestamp: new Date(),
    payload: {
      conversationId: 'conv-1', messageId: 'msg-1', contactId: 'contact-1', channelId: 'ch-1', channelType: 'THREADS',
      contentType, content, messageContent: (content.text as string) ?? '',
    },
  });
  for (let i = 0; i < 100 && calls.enqueued === 0; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls.enqueued, 1, '處理流程沒有走完');
}

test('客人傳帶文字的貼圖：不執行 AI 自動回覆', async () => {
  await receive('sticker', { text: '❤️' });
  assert.deepEqual(calls.agent, []);
  assert.deepEqual(calls.kb, []);
});

test('客人傳圖片：把對話轉給真人，不執行 AI 自動回覆', async () => {
  await receive('image', { mediaUrl: 'https://cdn.example.com/a.jpg' });
  assert.equal(conversation.status, 'AGENT_HANDLED');
  assert.match(conversation.handoffReason ?? '', /圖片/);
  assert.deepEqual(calls.agent, []);
  assert.deepEqual(calls.kb, []);
});

test('客人傳文字：執行 AI 自動回覆', async () => {
  await receive('text', { text: '請問營業時間' });
  assert.deepEqual(calls.agent, ['請問營業時間']);
  assert.equal(conversation.status, 'BOT_HANDLED');
});

test('事件沒有 contentType：視為文字訊息，執行 AI 自動回覆', async () => {
  await receive(undefined, { text: '請問營業時間' });
  assert.deepEqual(calls.agent, ['請問營業時間']);
});
