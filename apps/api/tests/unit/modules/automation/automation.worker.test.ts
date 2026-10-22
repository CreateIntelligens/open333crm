/**
 * 自動化訂閱者送出規則評估（change outbox-event-delivery：automation-engine「Worker-Owned Automation Triggering」、
 * 「關鍵字規則在處理收到的訊息時比對」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const queued = vi.hoisted(() => [] as Array<{ name: string; data: Record<string, unknown>; opts?: Record<string, unknown> }>);
const redis = vi.hoisted(() => ({ down: false }));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add(name: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
      if (redis.down) throw new Error('redis down');
      queued.push({ name, data, opts });
    }
  },
}));
vi.mock('#src/modules/ai/kb-autoreply.service.js', () => ({ attemptKbAutoReply: async () => false }));
vi.mock('#src/modules/ai/agent/agent.service.js', () => ({ isAgentEnabled: () => false, runAgentReply: async () => ({ handled: false }) }));
vi.mock('#src/modules/ai/sentiment.service.js', () => ({
  analyzeSentiment: async () => ({ sentiment: 'neutral', score: 0, confidence: 0.9 }),
}));
vi.mock('#src/modules/ai/classify.service.js', () => ({ autoClassifyNewCase: async () => {} }));
vi.mock('#src/modules/ai/ai.service.js', () => ({ summarizeConversation: async () => ({ summary: '' }) }));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({ deliverToChannel: async () => true }));

const { EVENT_AUTOMATION_QUEUE, subscriberQueuesOf } = await import('@open333crm/core');
const { eventBus } = await import('#src/events/event-bus.js');
const { setupAutomationWorker } = await import('#src/modules/automation/automation.worker.js');
const { createHarness, messageReceived, MESSAGE, TENANT } = await import('./automation-harness.js');

beforeEach(() => {
  queued.length = 0;
  redis.down = false;
});

function setup() {
  const h = createHarness({ botConfig: { botMode: 'off' } });
  const handle = setupAutomationWorker(h.adminPrisma as never, h.io as never, h.tenantPrisma as never);
  return { h, handle };
}

const evaluations = () => queued.filter((q) => q.name === 'automation:evaluate');

test('Automation event enqueued by API：送出 id 等於事件 id 的 automation:evaluate', async () => {
  const { handle } = setup();
  const event = { id: crypto.randomUUID(), name: 'contact.created' as const, tenantId: TENANT, timestamp: new Date(), payload: { contactId: 'x' } };
  await handle(event);
  assert.equal(evaluations().length, 1);
  assert.equal(evaluations()[0].opts?.jobId, event.id);
  assert.equal(evaluations()[0].data.eventId, event.id);
  assert.equal(evaluations()[0].data.trigger, 'contact.created');
});

test('Same event delivered twice：兩次的 job id 相同，BullMQ 只保留一個 job', async () => {
  const { handle } = setup();
  const event = messageReceived();
  await handle(event);
  await handle(event);
  assert.deepEqual(evaluations().map((q) => q.opts?.jobId), [event.id, event.id]);
});

test('message.received 的 context 帶入站訊息 id，供 keyword_matched 認領', async () => {
  const { handle } = setup();
  await handle(messageReceived());
  assert.equal((evaluations()[0].data.context as Record<string, unknown>).messageId, MESSAGE);
});

test('API 不再發出 keyword.matched：命中關鍵字規則時，規則由 workers 處理 message.received 時比對', async () => {
  const { h, handle } = setup();
  h.adminPrisma.automationRule.findMany = async () => [
    { id: 'r1', name: 'R', trigger: { type: 'keyword.matched', keywords: ['請問'] }, isActive: true, conditions: {}, actions: [] },
  ];
  const published: string[] = [];
  const spy = vi.spyOn(eventBus, 'publish').mockImplementation((e) => void published.push(e.name));
  try {
    await handle(messageReceived());
  } finally {
    spy.mockRestore();
  }
  assert.deepEqual(published.filter((n) => n === 'keyword.matched'), []);
  assert.equal(subscriberQueuesOf('keyword.matched').includes(EVENT_AUTOMATION_QUEUE), false);
  assert.deepEqual(evaluations().map((q) => q.data.trigger), ['message.received']);
});

test('Subscriber cannot enqueue the next job：送不出 automation:evaluate 時處理失敗，由 BullMQ 重試', async () => {
  const { handle } = setup();
  redis.down = true;
  const contactCreated = { id: crypto.randomUUID(), name: 'contact.created' as const, tenantId: TENANT, timestamp: new Date(), payload: { contactId: 'x' } };
  await assert.rejects(handle(contactCreated), /redis down/);
  await assert.rejects(handle(messageReceived()), /redis down/);
  await assert.rejects(
    handle({ id: crypto.randomUUID(), name: 'case.created' as const, tenantId: TENANT, timestamp: new Date(), payload: { caseId: 'c' } }),
    /redis down/,
  );
});

// ── 加入好友事件（add-coupon-system A15 15.14；design D28；spec automation-engine「加入好友事件」）──

function followReceived(overrides: Record<string, unknown> = {}) {
  return messageReceived({
    contentType: 'follow',
    content: { systemEvent: 'follow' },
    messageContent: '',
    replyToken: 'reply-token-follow',
    receivedAt: '2026-10-23T01:00:00.000Z',
    isFirstFollow: true,
    ...overrides,
  });
}

test('加好友觸發規則：加入好友事件另外以 contact.followed 排入評估，帶回覆權杖、收到時間與「第一次加入」', async () => {
  const { handle } = setup();
  const event = followReceived();
  await handle(event);
  const followed = evaluations().filter((q) => q.data.trigger === 'contact.followed');
  assert.equal(followed.length, 1);
  assert.equal(followed[0].data.eventId, event.id);
  // job id 不能和 message.received 的相同（BullMQ 會當成同一個 job），也不能含「:」
  assert.equal(followed[0].opts?.jobId, `${event.id}-followed`);
  const context = followed[0].data.context as Record<string, unknown>;
  assert.equal(context.replyToken, 'reply-token-follow');
  assert.equal(context.receivedAt, '2026-10-23T01:00:00.000Z');
  assert.equal(context.isFirstFollow, true);
  assert.equal(context.conversationId, event.payload.conversationId);
  assert.equal(context.contactId, event.payload.contactId);
});

test('取消好友不觸發：unfollow 不排入 contact.followed', async () => {
  const { handle } = setup();
  await handle(followReceived({ contentType: 'unfollow', content: { systemEvent: 'unfollow' }, replyToken: undefined, isFirstFollow: undefined }));
  assert.deepEqual(evaluations().map((q) => q.data.trigger), ['message.received']);
});

test('加好友不觸發收到訊息的關鍵字規則：message.received 的評估不帶訊息文字，workers 不比對關鍵字', async () => {
  const { handle } = setup();
  await handle(followReceived({ content: { systemEvent: 'follow', text: '領券' }, messageContent: undefined }));
  const received = evaluations().find((q) => q.data.trigger === 'message.received');
  assert.ok(received);
  assert.equal((received.data.context as Record<string, unknown>).messageContent, undefined);
});
