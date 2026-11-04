/**
 * 自動轉接每次只發生一次（change outbox-event-delivery：bot-handoff-config「自動轉接每次只發生一次」）。
 *
 * 摘要、送出與佇列換成假的；資料庫是 automation-harness 的假交易（丟錯時還原）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({ delivered: [] as string[], evaluate: 0, kb: 0, deliveryFails: false }));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add(name: string) {
      if (name === 'automation:evaluate') calls.evaluate += 1;
    }
  },
}));
vi.mock('#src/modules/ai/kb-autoreply.service.js', () => ({
  attemptKbAutoReply: async () => {
    calls.kb += 1;
    return false;
  },
}));
vi.mock('#src/modules/ai/agent/agent.service.js', () => ({ isAgentEnabled: () => false, runAgentReply: async () => ({ handled: false }) }));
vi.mock('#src/modules/ai/sentiment.service.js', () => ({
  analyzeSentiment: async () => ({ sentiment: 'neutral', score: 0, confidence: 0.9 }),
}));
vi.mock('#src/modules/ai/classify.service.js', () => ({ autoClassifyNewCase: async () => {} }));
vi.mock('#src/modules/ai/ai.service.js', () => ({
  // 讓出執行權：兩次處理同時進行時，都先讀到 BOT_HANDLED 才進交易
  summarizeConversation: async () => {
    await new Promise((r) => setTimeout(r, 5));
    return { summary: '摘要' };
  },
}));
vi.mock('#src/modules/ai/deidentification.service.js', () => ({
  prepareStoredMessageContent: async (_p: unknown, _t: string, content: unknown) => ({ content, metadata: {} }),
}));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async (_p: unknown, _c: string, payload: unknown) => {
    if (calls.deliveryFails) throw new Error('LINE 500');
    calls.delivered.push(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return true;
  },
}));

const { setupAutomationWorker } = await import('#src/modules/automation/automation.worker.js');
const { createHarness, messageReceived, TENANT, CHANNEL } = await import('./automation-harness.js');

const HANDOFF_MESSAGE = '稍等，正在為您轉接客服人員';

beforeEach(() => {
  calls.delivered.length = 0;
  calls.evaluate = 0;
  calls.kb = 0;
  calls.deliveryFails = false;
});

function setup() {
  // 機器人已回覆 5 次，達到上限：下一則訊息觸發自動轉接
  const h = createHarness({ botRepliesCount: 5 });
  const handle = setupAutomationWorker(h.adminPrisma as never, h.io as never, h.tenantPrisma as never);
  return { h, handle };
}

test('同一則訊息處理兩次：客人只收到一則轉接訊息，只發出一個 conversation.handoff', async () => {
  const { h, handle } = setup();
  const event = messageReceived();
  await handle(event);
  await handle(event);

  assert.deepEqual(calls.delivered, [HANDOFF_MESSAGE]);
  assert.deepEqual(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 1);
  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
});

test('兩次處理同時進行：只有一個處理送出轉接訊息並發出 conversation.handoff', async () => {
  const { h, handle } = setup();
  const event = messageReceived();
  await Promise.all([handle(event), handle({ ...event, id: crypto.randomUUID() })]);

  assert.deepEqual(calls.delivered, [HANDOFF_MESSAGE]);
  assert.equal(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 1);
  assert.equal(h.state.messages.filter((m) => m.senderType === 'SYSTEM').length, 1);
});

test('寫入系統訊息失敗：對話仍是 BOT_HANDLED，不送出轉接訊息，處理失敗由佇列重試', async () => {
  const { h, handle } = setup();
  h.state.failSystemMessage = true;
  await assert.rejects(handle(messageReceived()), /system message write failed/);

  assert.equal(h.state.conversation.status, 'BOT_HANDLED');
  assert.deepEqual(calls.delivered, []);
  assert.equal(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 0);
  // 轉接失敗時不做 AI 回覆（重試時轉接要能認領 bot_reply），規則評估照常送出
  assert.equal(calls.kb, 0);
  assert.equal(calls.evaluate, 1);
});

test('Delivery fails after handoff commit：轉接已 commit，送出轉接訊息失敗時不重試', async () => {
  const { h, handle } = setup();
  calls.deliveryFails = true;
  await handle(messageReceived());

  assert.equal(h.state.conversation.status, 'AGENT_HANDLED');
  assert.equal(h.state.outbox.filter((o) => o.name === 'conversation.handoff').length, 1);
});

test('轉接的 message.new 送到渠道房間（與其他 message.new 相同），不只送到對話房間（PR #438 審查）', async () => {
  const { h } = setup();
  const emitted: Array<{ rooms: string[]; event: string }> = [];
  h.io.to = ((rooms: string | string[]) => ({
    emit: (event: string) => { emitted.push({ rooms: ([] as string[]).concat(rooms), event }); },
  })) as never;
  const handle = setupAutomationWorker(h.adminPrisma as never, h.io as never, h.tenantPrisma as never);
  await handle(messageReceived());

  const messageNew = emitted.find((e) => e.event === 'message.new');
  assert.ok(messageNew, '送出 message.new');
  assert.ok(messageNew.rooms.includes(`tenant:${TENANT}:channel:${CHANNEL}`), `送到渠道房間：${messageNew.rooms.join(',')}`);
  assert.ok(messageNew.rooms.includes(`tenant:${TENANT}:channels:all`), '送到總店房間');
});

test('自動轉接：worker 推播 conversation.updated 到渠道房間，帶對話的 updatedAt 與轉接原因', async () => {
  const h = createHarness({ botRepliesCount: 5 });
  const emitted: Array<{ rooms: string[]; name: string; data: Record<string, unknown> }> = [];
  const io = {
    to: (rooms: string | string[]) => ({
      emit: (name: string, data: Record<string, unknown>) => {
        emitted.push({ rooms: Array.isArray(rooms) ? rooms : [rooms], name, data });
      },
    }),
  };
  await setupAutomationWorker(h.adminPrisma as never, io as never, h.tenantPrisma as never)(messageReceived());

  const updated = emitted.filter((e) => e.name === 'conversation.updated');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].data.status, 'AGENT_HANDLED');
  assert.equal(typeof updated[0].data.updatedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(String(updated[0].data.updatedAt))));
  assert.ok(updated[0].data.handoffReason);
  assert.ok(updated[0].rooms.includes(`tenant:${TENANT}:channel:${CHANNEL}`), JSON.stringify(updated[0].rooms));
});
