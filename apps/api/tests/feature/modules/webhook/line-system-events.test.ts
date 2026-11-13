/**
 * LINE 系統事件（follow／unfollow）的分流（change fix-line-follow-unfollow-events，issue #362）：
 * - line-webhook-events「Parse all LINE Webhook event types」「Unfollow from an unknown user creates nothing」
 * - first-contact-greeting「首次進站時送出招呼語」（加好友用 replyToken）
 * - inbound-message-processing「系統事件不觸發非營業時間的自動回覆」
 * - interaction-canvas「Webhook 觸發依進站事件類型比對」
 *
 * 走真正的入口 processWebhookEvent()：自己算簽章、真的 LINE 外掛解析與送出、真的 deliverToChannel()。
 * 只攔截對 LINE API 的 fetch（取個人資料、reply、push），記錄呼叫並依測試設定回應。
 * client 用 app_admin（與正式環境 webhook 的 prismaAdmin 相同）；資料建在本檔專用的租戶，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterAll, beforeEach, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { linePlugin, registerChannelPlugin } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { getContact } from '#src/modules/contact/contact.service.js';
import { ALL_CHANNELS } from '#src/services/channel-visibility.js';
import { processWebhookEvent } from '#src/modules/webhook/webhook.service.js';

loadEnvConfig();
registerChannelPlugin(linePlugin);

/** 對 LINE API 的呼叫紀錄；replyFails 為 true 時 reply 回 400 */
const lineCalls: Array<{ method: string; path: string; body: Record<string, any> | null }> = [];
let replyFails = false;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, any>) : null;
  lineCalls.push({ method, path: url.pathname, body });
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const profile = /^\/v2\/bot\/profile\/(.+)$/.exec(url.pathname);
  if (profile) return json(200, { userId: profile[1], displayName: '測試好友' });
  if (url.pathname === '/v2/bot/message/reply' && replyFails) return json(400, { message: 'Invalid reply token' });
  return json(200, {});
}) as typeof fetch;

const owner = new PrismaClient();
const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_ADMIN } } });
const io = { to: () => ({ emit: () => {} }), emit: () => {} } as never;
const stamp = Date.now().toString(36);
const GREETING = '歡迎加入，{{contact.name}}！';
const SECRET = `line-secret-${stamp}`;

const tenant = await owner.tenant.create({ data: { name: `CI LINE 系統事件 ${stamp}` } });
const mkChannel = (name: string) =>
  owner.channel.create({
    data: {
      tenantId: tenant.id,
      channelType: 'LINE',
      displayName: `CI LINE ${name} ${stamp}`,
      credentialsEncrypted: encryptCredentials({ channelSecret: SECRET, channelAccessToken: `token-${name}` }),
      settings: { firstContactGreeting: GREETING },
      isActive: true,
    },
  });
const chA = await mkChannel('A');
const chB = await mkChannel('B');

afterAll(async () => {
  const flows = await owner.interactionFlow.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
  const executions = await owner.flowExecution.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
  await owner.flowLog.deleteMany({ where: { executionId: { in: executions.map((e) => e.id) } } });
  await owner.flowExecution.deleteMany({ where: { tenantId: tenant.id } });
  await owner.interactionNode.deleteMany({ where: { flowId: { in: flows.map((f) => f.id) } } });
  await owner.interactionFlow.deleteMany({ where: { tenantId: tenant.id } });
  const convs = await owner.conversation.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
  await owner.message.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } });
  await owner.conversation.deleteMany({ where: { tenantId: tenant.id } });
  await owner.channelIdentity.deleteMany({ where: { channelId: { in: [chA.id, chB.id] } } });
  await owner.contact.deleteMany({ where: { tenantId: tenant.id } });
  await owner.channel.deleteMany({ where: { tenantId: tenant.id } });
  await owner.tenantSettings.deleteMany({ where: { tenantId: tenant.id } });
  await owner.tenant.delete({ where: { id: tenant.id } });
  await Promise.all([owner.$disconnect(), admin.$disconnect()]);
});

beforeEach(async () => {
  lineCalls.length = 0;
  replyFails = false;
  await setOfficeHours(false);
});

/** 營業時間：enabled 時每天都不營業（schedule 全為 null），現在一定是非營業時間 */
async function setOfficeHours(enabled: boolean) {
  const officeHours = {
    enabled,
    schedule: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
    holidays: [],
    outsideHoursMessage: '現在是非營業時間',
  };
  await owner.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    create: { tenantId: tenant.id, timezone: 'Asia/Taipei', officeHours },
    update: { officeHours },
  });
}

let seq = 0;
type LineEvent =
  | { type: 'follow' | 'unfollow'; uid: string; replyToken?: string }
  | { type: 'text'; uid: string; text: string; replyToken?: string };

/** 組一包簽好章的 LINE webhook，交給 processWebhookEvent() */
async function deliver(channelId: string, ev: LineEvent) {
  const base = { timestamp: Date.now(), source: { type: 'user', userId: ev.uid }, mode: 'active', webhookEventId: `wh-${stamp}-${seq++}` };
  const event =
    ev.type === 'text'
      ? { ...base, type: 'message', replyToken: ev.replyToken ?? `rt-${stamp}-${seq++}`, message: { id: `msg-${stamp}-${seq++}`, type: 'text', text: ev.text } }
      : { ...base, type: ev.type, ...(ev.type === 'follow' ? { replyToken: ev.replyToken ?? `rt-${stamp}-${seq++}` } : {}) };
  const raw = Buffer.from(JSON.stringify({ destination: 'U-dest', events: [event] }));
  const signature = crypto.createHmac('sha256', SECRET).update(raw).digest('base64');
  await processWebhookEvent(admin, io, channelId, 'LINE', raw, { 'x-line-signature': signature });
}

const uid = (name: string) => `U${name}-${stamp}`;
const identityOf = (channelId: string, u: string) =>
  owner.channelIdentity.findUnique({ where: { channelId_uid: { channelId, uid: u } }, include: { contact: true } });
const sends = () => lineCalls.filter((c) => c.method === 'POST' && c.path.startsWith('/v2/bot/message/'));
async function messagesOf(channelId: string, u: string) {
  const identity = await identityOf(channelId, u);
  if (!identity) return [];
  return owner.message.findMany({
    where: { conversation: { channelId, contactId: identity.contactId } },
    orderBy: { createdAt: 'asc' },
  });
}
const sourceOf = (m: { metadata: unknown }) => (m.metadata as { source?: string } | null)?.source;

// ── line-webhook-events ─────────────────────────────────────────

test('Unknown user blocks the official account：不建聯絡人、不存訊息、不送任何東西', async () => {
  const before = await owner.contact.count({ where: { tenantId: tenant.id } });
  await deliver(chA.id, { type: 'unfollow', uid: uid('stranger') });

  assert.equal(await identityOf(chA.id, uid('stranger')), null, '不建立渠道身分');
  assert.equal(await owner.contact.count({ where: { tenantId: tenant.id } }), before, '不建立聯絡人');
  assert.deepEqual(sends(), [], '不呼叫 LINE 送訊息');
});

test('Unfollow event records the block：記下封鎖時間、照舊存訊息、不動 Contact.isBlocked', async () => {
  const u = uid('blocker');
  await deliver(chA.id, { type: 'follow', uid: u });
  lineCalls.length = 0;
  const startedAt = new Date();

  await deliver(chA.id, { type: 'unfollow', uid: u });

  const identity = await identityOf(chA.id, u);
  assert.ok(identity?.blockedAt instanceof Date, 'blockedAt 有值');
  assert.ok(identity.blockedAt.getTime() >= startedAt.getTime() - 1000, 'blockedAt 是處理時間');
  assert.equal(identity.contact.isBlocked, false, 'Contact.isBlocked 不變');
  const messages = await messagesOf(chA.id, u);
  assert.ok(messages.some((m) => m.direction === 'INBOUND' && m.contentType === 'unfollow'), 'unfollow 存成進站訊息');
  assert.deepEqual(sends(), [], '封鎖不送任何訊息');

  // 聯絡人詳情 API（GET /contacts/:id 的 service）帶出 blockedAt，前端據此顯示「已封鎖官方帳號」
  const detail = await getContact({ tx: owner as never, tenantId: tenant.id }, identity.contactId, ALL_CHANNELS);
  const shown = (detail as { channelIdentities: Array<{ channelId: string; blockedAt: Date | null }> }).channelIdentities
    .find((ci) => ci.channelId === chA.id);
  assert.deepEqual(shown?.blockedAt, identity.blockedAt);
});

test('Follow event updates contact：重新加入好友時清空封鎖時間', async () => {
  const u = uid('comeback');
  await deliver(chA.id, { type: 'follow', uid: u });
  await deliver(chA.id, { type: 'unfollow', uid: u });
  assert.ok((await identityOf(chA.id, u))?.blockedAt instanceof Date, '前提：封鎖後 blockedAt 有值');

  await deliver(chA.id, { type: 'follow', uid: u });

  const identity = await identityOf(chA.id, u);
  assert.equal(identity?.blockedAt, null);
  assert.equal(identity?.contact.isBlocked, false);
});

test('Unfollow of another channel does not change this channel：只記在收到事件的渠道', async () => {
  const u = uid('two-oa');
  await deliver(chA.id, { type: 'follow', uid: u });
  await deliver(chB.id, { type: 'follow', uid: u });

  await deliver(chA.id, { type: 'unfollow', uid: u });

  assert.ok((await identityOf(chA.id, u))?.blockedAt instanceof Date, '渠道 A 記下封鎖');
  assert.equal((await identityOf(chB.id, u))?.blockedAt, null, '渠道 B 不受影響');
});

// ── first-contact-greeting ──────────────────────────────────────

test('LINE 加好友當下即招呼：以 follow 的 replyToken 回覆，不用 push', async () => {
  const u = uid('greet-reply');
  await deliver(chA.id, { type: 'follow', uid: u, replyToken: `rt-greet-${stamp}` });

  const calls = sends();
  assert.deepEqual(calls.map((c) => c.path), ['/v2/bot/message/reply']);
  assert.equal(calls[0]!.body?.replyToken, `rt-greet-${stamp}`);
  assert.equal(calls[0]!.body?.messages?.[0]?.text, '歡迎加入，測試好友！');
});

test('加好友的 reply 失敗時改用 push：同一則招呼語 push 一次', async () => {
  replyFails = true;
  const u = uid('greet-fallback');
  await deliver(chA.id, { type: 'follow', uid: u });

  const calls = sends();
  assert.deepEqual(calls.map((c) => c.path), ['/v2/bot/message/reply', '/v2/bot/message/push']);
  assert.equal(calls[1]!.body?.to, u);
  assert.equal(calls[1]!.body?.messages?.[0]?.text, '歡迎加入，測試好友！');
});

test('一般訊息的招呼語不用該訊息的 replyToken：以 push 送出', async () => {
  const u = uid('greet-text');
  await deliver(chA.id, { type: 'text', uid: u, text: '你好', replyToken: `rt-text-${stamp}` });

  const calls = sends();
  assert.deepEqual(calls.map((c) => c.path), ['/v2/bot/message/push']);
  assert.equal(calls[0]!.body?.messages?.[0]?.text, '歡迎加入，測試好友！');
});

// ── inbound-message-processing：非營業時間 ─────────────────────

test('非營業時間有人加好友：不寫也不送非營業時間訊息', async () => {
  await setOfficeHours(true);
  const u = uid('ooh-follow');
  await deliver(chA.id, { type: 'follow', uid: u });

  const messages = await messagesOf(chA.id, u);
  assert.equal(messages.filter((m) => sourceOf(m) === 'office_hours_auto_reply').length, 0);
  assert.ok(!sends().some((c) => c.body?.messages?.[0]?.text === '現在是非營業時間'), '沒有送出非營業時間訊息');
});

test('非營業時間有人封鎖：不寫非營業時間訊息', async () => {
  const u = uid('ooh-unfollow');
  await deliver(chA.id, { type: 'follow', uid: u });
  await setOfficeHours(true);

  await deliver(chA.id, { type: 'unfollow', uid: u });

  const messages = await messagesOf(chA.id, u);
  assert.equal(messages.filter((m) => sourceOf(m) === 'office_hours_auto_reply').length, 0);
  assert.ok(!sends().some((c) => c.body?.messages?.[0]?.text === '現在是非營業時間'), '沒有送出非營業時間訊息');
});

test('非營業時間的一般訊息照舊自動回覆', async () => {
  const u = uid('ooh-text');
  await deliver(chA.id, { type: 'follow', uid: u });
  await setOfficeHours(true);
  lineCalls.length = 0;

  await deliver(chA.id, { type: 'text', uid: u, text: '請問有營業嗎' });

  const messages = await messagesOf(chA.id, u);
  assert.equal(messages.filter((m) => sourceOf(m) === 'office_hours_auto_reply').length, 1);
  assert.ok(sends().some((c) => c.body?.messages?.[0]?.text === '現在是非營業時間'), '送出非營業時間訊息');
});

// ── interaction-canvas ──────────────────────────────────────────

async function withFlow(triggerConfig: Record<string, unknown>, run: (flowId: string) => Promise<void>) {
  const flow = await owner.interactionFlow.create({
    data: { tenantId: tenant.id, name: `CI ${stamp} ${seq++}`, status: 'ACTIVE', triggerType: 'webhook', triggerConfig: triggerConfig as never },
  });
  try {
    await run(flow.id);
  } finally {
    await owner.interactionFlow.update({ where: { id: flow.id }, data: { status: 'ARCHIVED' } });
  }
}
const executionsOf = (flowId: string, contactId: string) => owner.flowExecution.count({ where: { flowId, contactId } });

test('加好友觸發「加好友」流程', async () => {
  await withFlow({ eventType: 'follow' }, async (flowId) => {
    const u = uid('canvas-follow');
    await deliver(chA.id, { type: 'follow', uid: u });
    const identity = await identityOf(chA.id, u);
    assert.equal(await executionsOf(flowId, identity!.contactId), 1);
  });
});

test('加好友不觸發「收到訊息」流程', async () => {
  await withFlow({ eventType: 'message' }, async (flowId) => {
    const u = uid('canvas-follow-msg');
    await deliver(chA.id, { type: 'follow', uid: u });
    const identity = await identityOf(chA.id, u);
    assert.equal(await executionsOf(flowId, identity!.contactId), 0);
  });
});

test('封鎖不觸發流程：沒有設定事件類型的流程也不觸發', async () => {
  const u = uid('canvas-unfollow');
  await deliver(chA.id, { type: 'follow', uid: u });
  const identity = await identityOf(chA.id, u);
  await withFlow({}, async (flowId) => {
    await deliver(chA.id, { type: 'unfollow', uid: u });
    assert.equal(await executionsOf(flowId, identity!.contactId), 0);
  });
});

test('文字訊息觸發「收到訊息」流程', async () => {
  await withFlow({ eventType: 'message' }, async (flowId) => {
    const u = uid('canvas-text');
    await deliver(chA.id, { type: 'text', uid: u, text: '哈囉' });
    const identity = await identityOf(chA.id, u);
    assert.equal(await executionsOf(flowId, identity!.contactId), 1);
  });
});
