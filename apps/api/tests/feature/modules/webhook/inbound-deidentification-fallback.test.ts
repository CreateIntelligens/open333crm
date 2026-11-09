/**
 * 去識別化服務無法使用時，進站訊息照常保存、標記未遮罩、不交給 AI 並轉接真人（issue #466，
 * change fix-deid-inbound-fallback-466：inbound-message-processing「去識別化服務短暫故障時重試一次」
 * 「去識別化服務無法使用時進站訊息存原文並標記未遮罩」「進站訊息未遮罩時發出維運告警」，
 * bot-handoff-config「未遮罩的進站訊息不交給 AI，轉接真人」「程式固定的系統文字不呼叫去識別化服務」）。
 *
 * 走真實的 processInboundMessage、測試資料庫與 setupAutomationWorker（admin 連線 + app_tenant 的 inTenant）。
 * 只換掉最底層的邊界：HTTP（fetch：2md 與 embedding）、模型供應商、送出渠道、BullMQ 佇列、
 * 維運告警的 sendOpsAlert 與 Redis 連線。租戶與渠道帶 stamp，afterAll 依租戶刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, test, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const calls = vi.hoisted(() => ({
  delivered: [] as Array<{ conversationId: string; payload: unknown }>,
  /** 2md 每次請求依序取用的行為；用完之後回正常結果 */
  deidPlan: [] as Array<'ok' | '503' | '400' | 'timeout' | 'dns'>,
  /** 2md 一直失敗時的行為（deidPlan 用完之後） */
  deidDefault: 'ok' as 'ok' | '503' | '400' | 'timeout' | 'dns',
  deidRequests: [] as string[],
  embedRequests: 0,
  modelCalls: 0,
  alerts: [] as Array<{ key: string; title: string; fields: Record<string, string | number> }>,
  alertFails: false,
}));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {}
    async close() {}
  },
}));
vi.mock('#src/config/env.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('#src/config/env.js')>();
  return {
    ...real,
    getConfig: () => ({ ...real.getConfig(), AGENTIC_LLM_ENABLED: true, KB_AUTO_REPLY_ENABLED: true }),
  };
});
vi.mock('#src/modules/conversation/conversation.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/conversation/conversation.service.js')>()),
  deliverToChannel: async (_prisma: unknown, conversationId: string, payload: unknown) => {
    calls.delivered.push({ conversationId, payload });
    return true;
  },
}));
// 模型供應商（LLM 邊界）
vi.mock('#src/modules/ai/providers/index.js', () => ({
  getChatProvider: () => ({
    id: 'test',
    label: 'test',
    async generate() {
      calls.modelCalls += 1;
      return { text: '{"sentiment":"neutral","score":0,"confidence":0.9}' };
    },
    async generateToolTurn() {
      calls.modelCalls += 1;
      return { text: 'AI 的回覆', toolCalls: [] };
    },
  }),
}));
// 月額度計數在 Redis
vi.mock('#src/modules/trial/token-quota.service.js', () => ({ isMonthlyTokenExceeded: async () => false }));
vi.mock('#src/modules/ops-alert/ops-alert.service.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendOpsAlert: async (alert: { key: string; title: string; fields: Record<string, string | number> }) => {
    if (calls.alertFails) throw new Error('redis down');
    calls.alerts.push(alert);
    return true;
  },
}));
vi.mock('#src/lib/redis-client.js', () => ({ getSharedRedis: () => ({}), closeSharedRedis: () => {} }));

import { loadEnvConfig } from '#src/config/env.js';
import { eventBus, type AppEvent } from '#src/events/event-bus.js';
import { processInboundMessage } from '#src/modules/webhook/webhook.service.js';
import { setupAutomationWorker } from '#src/modules/automation/automation.worker.js';
import { setBindingStoreForTest } from '#src/modules/webhook/inbound-identity-binding.js';
import { invalidateIdentityBindingSettings } from '#src/modules/identity-binding/identity-binding.service.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';

loadEnvConfig();

const prisma = new PrismaClient();
const adminDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_ADMIN } } });
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const stamp = randomUUID().slice(0, 8);
const PHONE_TEXT = '我的電話 0912345678';
const HANDOFF_MESSAGE = '稍等，正在為您轉接客服人員';
const UNMASKED_REASON = '去識別化服務無法使用，這則訊息未遮罩、未交給 AI';

const tenant = await prisma.tenant.create({ data: { name: `CI 去識別化降級 ${stamp}` } });
await prisma.platformSetting.create({ data: { key: `ai.privacy.${tenant.id}`, value: { enabled: true } } });
const channel = await prisma.channel.create({
  data: { tenantId: tenant.id, channelType: 'WEBCHAT', displayName: `CI 去識別化降級 ${stamp}`, credentialsEncrypted: 'x' },
});

afterAll(async () => {
  const where = { tenantId: tenant.id };
  const convs = await prisma.conversation.findMany({ where, select: { id: true } });
  await prisma.message.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } });
  await prisma.outbox.deleteMany({ where });
  await prisma.sideEffectClaim.deleteMany({ where });
  await prisma.aiUsage.deleteMany({ where });
  await prisma.agentRun.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.channelIdentity.deleteMany({ where: { channelId: channel.id } });
  await prisma.contact.deleteMany({ where });
  await prisma.channel.deleteMany({ where });
  await prisma.tenantSettings.deleteMany({ where });
  await prisma.platformSetting.deleteMany({ where: { key: `ai.privacy.${tenant.id}` } });
  await prisma.tenant.delete({ where: { id: tenant.id } });
  await Promise.all([prisma.$disconnect(), adminDb.$disconnect(), tenantDb.$disconnect()]);
});

/** HTTP 邊界：2md 去識別化服務與 embedding 服務 */
async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('2md.aiurl.tw')) {
    const { text } = JSON.parse(String(init?.body)) as { text: string };
    calls.deidRequests.push(text);
    const behavior = calls.deidPlan.shift() ?? calls.deidDefault;
    if (behavior === '503') return new Response('upstream unavailable', { status: 503 });
    if (behavior === '400') return new Response('bad request', { status: 400 });
    if (behavior === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    if (behavior === 'dns') {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND 2md.aiurl.tw'), { code: 'ENOTFOUND' }),
      });
    }
    return Response.json({ code: 200, data: { status: 'ok', text: text.replace('0912345678', '[手機]') } });
  }
  calls.embedRequests += 1;
  return Response.json({ embeddings: [[0.1, 0.2, 0.3]] });
}

beforeEach(() => {
  calls.delivered.length = 0;
  calls.deidPlan.length = 0;
  calls.deidDefault = 'ok';
  calls.deidRequests.length = 0;
  calls.embedRequests = 0;
  calls.modelCalls = 0;
  calls.alerts.length = 0;
  calls.alertFails = false;
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const io = { to: () => ({ emit: () => {} }) } as never;
let seq = 0;

async function receive(text: string, uid = `visitor-${stamp}-${seq}`) {
  const events: AppEvent[] = [];
  const handler = (event: AppEvent) => events.push(event);
  eventBus.subscribe('*', handler);
  try {
    const result = await processInboundMessage(prisma, io, {}, channel, tenant.id, {
      contactUid: uid,
      channelMsgId: `ci-deid-${stamp}-${seq++}`,
      timestamp: new Date(),
      contentType: 'text',
      content: { text },
    }).catch((err: { code?: string }) => assert.fail(`進站處理丟出例外，訊息沒有保存：${err.code}`));
    assert.ok(result && 'message' in result, '訊息有處理完成');
    const message = await prisma.message.findUniqueOrThrow({ where: { id: result.message.id } });
    return { result, message, received: events.filter((e) => e.name === 'message.received') };
  } finally {
    eventBus.unsubscribe('*', handler);
  }
}

type Privacy = { mode?: string; reason?: string; maskedContent?: { text?: string } };
const privacyOf = (metadata: unknown) => ((metadata as { privacy?: Privacy } | null)?.privacy ?? {}) as Privacy;

test('去識別化服務回 503', async () => {
  calls.deidDefault = '503';
  const { message, received } = await receive(PHONE_TEXT);

  assert.equal(calls.deidRequests.length, 2, '重試一次');
  assert.equal(message.direction, 'INBOUND');
  assert.equal((message.content as { text: string }).text, PHONE_TEXT);
  const privacy = privacyOf(message.metadata);
  assert.equal(privacy.mode, 'inbound_unmasked');
  assert.equal(privacy.reason, 'upstream_5xx');
  assert.equal(privacy.maskedContent, undefined, '沒有遮罩副本');
  assert.equal(received.length, 1);
  assert.equal((received[0]!.payload as { privacyUnmasked?: boolean }).privacyUnmasked, true);
});

test('去識別化服務逾時', async () => {
  calls.deidDefault = 'timeout';
  const { message } = await receive(PHONE_TEXT);
  assert.equal(calls.deidRequests.length, 2);
  assert.equal(privacyOf(message.metadata).mode, 'inbound_unmasked');
  assert.equal(privacyOf(message.metadata).reason, 'timeout');
});

test('去識別化服務的網址解析失敗', async () => {
  calls.deidDefault = 'dns';
  const { message } = await receive(PHONE_TEXT);
  assert.equal(calls.deidRequests.length, 2);
  assert.equal(privacyOf(message.metadata).mode, 'inbound_unmasked');
  assert.equal(privacyOf(message.metadata).reason, 'network');
});

test('重試一次成功', async () => {
  calls.deidPlan.push('503');
  const { message, received } = await receive(PHONE_TEXT);
  assert.equal(calls.deidRequests.length, 2);
  const privacy = privacyOf(message.metadata);
  assert.equal(privacy.mode, 'inbound');
  assert.equal(privacy.maskedContent?.text, '我的電話 [手機]');
  assert.equal((received[0]!.payload as { privacyUnmasked?: boolean }).privacyUnmasked, undefined);
  assert.equal(calls.alerts.length, 0);
});

test('去識別化服務正常', async () => {
  const { message, received } = await receive(PHONE_TEXT);
  assert.equal(calls.deidRequests.length, 1);
  const privacy = privacyOf(message.metadata);
  assert.equal(privacy.mode, 'inbound');
  assert.equal(privacy.maskedContent?.text, '我的電話 [手機]');
  assert.equal((message.content as { text: string }).text, PHONE_TEXT, '進站訊息保留原文');
  assert.equal(received.length, 1);
  assert.equal((received[0]!.payload as { privacyUnmasked?: boolean }).privacyUnmasked, undefined);
  assert.equal(calls.alerts.length, 0);
});

test('未遮罩的進站訊息發出告警', async () => {
  calls.deidDefault = '503';
  await receive(PHONE_TEXT);
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.alerts[0]!.key, 'deidentification-unavailable');
  assert.equal(calls.alerts[0]!.fields['租戶'], tenant.id);
  assert.equal(calls.alerts[0]!.fields['原因'], 'upstream_5xx');
  assert.ok(!JSON.stringify(calls.alerts[0]).includes('0912345678'), '告警不含訊息內容');
});

test('發出告警失敗', async () => {
  calls.deidDefault = '503';
  calls.alertFails = true;
  const { message, received } = await receive(PHONE_TEXT);
  assert.equal(privacyOf(message.metadata).mode, 'inbound_unmasked');
  assert.equal(received.length, 1);
});

test('未遮罩的訊息轉接真人', async () => {
  calls.deidDefault = '503';
  const { result, received } = await receive(PHONE_TEXT);
  const conversationId = result.conversation.id;
  assert.equal(result.conversation.status, 'BOT_HANDLED');

  // 去識別化服務在 AI 處理之前恢復：仍不可把這則沒有遮罩副本的訊息交給模型
  calls.deidDefault = 'ok';
  calls.deidRequests.length = 0;
  const handle = setupAutomationWorker(adminDb, io, tenantDb);
  await handle({ ...received[0]!, id: randomUUID() });

  assert.equal(calls.modelCalls, 0, '模型供應商沒有被呼叫');
  assert.equal(calls.embedRequests, 0, 'embedding 服務沒有被呼叫');
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  assert.equal(conversation.status, 'AGENT_HANDLED');
  assert.equal(conversation.handoffReason, UNMASKED_REASON);
  const system = await prisma.message.findMany({ where: { conversationId, senderType: 'SYSTEM' } });
  assert.equal(system.length, 1);
  assert.equal((system[0]!.metadata as { source?: string }).source, 'inbound_unmasked');
  assert.deepEqual(system[0]!.content, { text: `自動轉接人工客服：${UNMASKED_REASON}` });
  assert.equal(await prisma.message.count({ where: { conversationId, senderType: 'BOT' } }), 0, '沒有機器人回覆');
  assert.equal(
    await prisma.outbox.count({ where: { tenantId: tenant.id, name: 'conversation.handoff', payload: { path: ['conversationId'], equals: conversationId } } }),
    1,
  );
  assert.deepEqual(calls.delivered.filter((d) => d.conversationId === conversationId).map((d) => d.payload), [HANDOFF_MESSAGE]);
});

test('去識別化服務無法使用時客人點按轉接人工', async () => {
  const uid = `visitor-button-${stamp}`;
  const first = await receive('你好', uid);
  const conversationId = first.result.conversation.id;

  calls.deidDefault = '503';
  calls.deidRequests.length = 0;
  await processInboundMessage(prisma, io, {}, channel, tenant.id, {
    contactUid: uid,
    channelMsgId: `ci-deid-${stamp}-${seq++}`,
    timestamp: new Date(),
    contentType: 'postback',
    content: { text: '轉接真人' },
    rawPayload: { postback: { data: 'handoff_request' } },
  }).catch((err: { code?: string }) => assert.fail(`進站處理丟出例外：${err.code}`));

  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  assert.equal(conversation.status, 'AGENT_HANDLED');
  const system = await prisma.message.findMany({ where: { conversationId, senderType: 'SYSTEM' } });
  assert.equal(system.length, 1);
  assert.deepEqual(system[0]!.content, { text: '使用者主動點按按鈕轉接人工客服' });
  const privacy = privacyOf(system[0]!.metadata);
  assert.equal(privacy.mode, 'system_fixed');
  assert.deepEqual(privacy.maskedContent, system[0]!.content);
});

test('去識別化服務無法使用時跨渠道綁定失敗', async () => {
  // 綁定訊息帶顧客名稱，仍要遮罩：2md 失敗時綁定失敗，客服看得到的內部提示是固定文字，照常寫入
  await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    create: { tenantId: tenant.id, identityBinding: { enabled: true } },
    update: { identityBinding: { enabled: true } },
  });
  invalidateIdentityBindingSettings();
  setBindingStoreForTest(memBindingStore());
  try {
    calls.deidDefault = '503';
    const { result } = await receive('綁定帳號', `visitor-binding-${stamp}`);
    const notes = await prisma.message.findMany({
      where: { conversationId: result.conversation.id, senderType: 'SYSTEM' },
    });
    assert.equal(notes.length, 1, '有一則客服看得到的綁定失敗提示');
    assert.deepEqual(notes[0]!.content, { text: '跨渠道綁定處理失敗，顧客的綁定請求沒有完成，請協助確認。' });
    assert.equal((notes[0]!.metadata as { type?: string }).type, 'identity_binding_error');
    assert.equal(privacyOf(notes[0]!.metadata).mode, 'system_fixed');
  } finally {
    setBindingStoreForTest(null);
    await prisma.tenantSettings.updateMany({ where: { tenantId: tenant.id }, data: { identityBinding: { enabled: false } } });
    invalidateIdentityBindingSettings();
  }
});
