/**
 * 入站管線 × 跨渠道綁定（change add-cross-channel-one-id，tasks 6.9；spec inbound-message-processing）。
 *
 * 用真實 Postgres 跑完整的 processInboundMessage，每個案例在交易內執行並 rollback。
 * 驗證：命中綁定時不送招呼語、不發 message.received（AI／關鍵字／自動化不處理）；
 * 未啟用時行為與改版前相同；非綁定代碼的 referral 事件不落地。
 *
 * 執行：DATABASE_URL=... tsx src/__tests__/inbound-identity-binding.test.ts
 */
import assert from 'node:assert/strict';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { ParsedWebhookMessage } from '@open333crm/channel-plugins';
import { eventBus, type AppEvent } from '../events/event-bus.js';
import { processInboundMessage } from '../modules/webhook/webhook.service.js';
import { setBindingStoreForTest } from '../modules/webhook/inbound-identity-binding.js';
import { issueBindingCode, invalidateIdentityBindingSettings } from '../modules/identity-binding/identity-binding.service.js';
import { extractBindingCode } from '../modules/identity-binding/binding-code.js';
import { linePrefillText } from '../modules/identity-binding/binding-links.js';
import { memBindingStore } from './helpers/mem-binding-store.js';

if (!process.env.DATABASE_URL) {
  console.log('SKIP inbound-identity-binding: 需 DATABASE_URL');
  process.exit(0);
}

const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const io = { to: () => ({ emit: () => {} }) } as never;
class Rollback extends Error {}

const received: AppEvent[] = [];
eventBus.subscribe('message.received', (e) => {
  received.push(e);
});

interface Env {
  tx: Prisma.TransactionClient;
  line: { id: string; channelType: string };
  fb: { id: string; channelType: string };
  store: ReturnType<typeof memBindingStore>;
  /** 既有的 FB 顧客 A */
  fbA: { contactId: string; uid: string; identityId: string; conversationId: string };
}

let seq = 0;

async function setup(tx: Prisma.TransactionClient, enabled: boolean): Promise<Env> {
  const tag = `ib-inbound-${Date.now()}-${seq++}`;
  await tx.tenantSettings.upsert({
    where: { tenantId: T },
    create: { tenantId: T, identityBinding: { enabled } },
    update: { identityBinding: { enabled } },
  });
  await tx.channel.updateMany({ where: { tenantId: T }, data: { isActive: false } });
  const line = await tx.channel.create({
    data: {
      tenantId: T,
      channelType: 'LINE',
      displayName: '測試 LINE',
      credentialsEncrypted: 'x',
      isActive: true,
      settings: { bindingHandleAuto: '@line1234', firstContactGreeting: '歡迎加入！' },
    },
  });
  const fb = await tx.channel.create({
    data: {
      tenantId: T,
      channelType: 'FB',
      displayName: '測試粉專',
      credentialsEncrypted: 'x',
      isActive: true,
      settings: { bindingHandle: 'test.page' },
    },
  });
  const a = await tx.contact.create({ data: { tenantId: T, displayName: 'A' } });
  const uid = `${tag}-fb-A`;
  const identity = await tx.channelIdentity.create({
    data: { contactId: a.id, channelId: fb.id, channelType: 'FB', uid },
  });
  const conv = await tx.conversation.create({
    data: { tenantId: T, contactId: a.id, channelId: fb.id, channelType: 'FB' },
  });
  invalidateIdentityBindingSettings();
  const store = memBindingStore();
  setBindingStoreForTest(store);
  received.length = 0;
  return {
    tx,
    line,
    fb,
    store,
    fbA: { contactId: a.id, uid, identityId: identity.id, conversationId: conv.id },
  };
}

function inbound(uid: string, text: string, extra: Partial<ParsedWebhookMessage> = {}): ParsedWebhookMessage {
  return {
    contactUid: uid,
    channelMsgId: `mid-${Date.now()}-${seq++}`,
    timestamp: new Date(),
    contentType: 'text',
    content: { text },
    ...extra,
  };
}

async function run(env: Env, channel: { id: string; channelType: string }, parsed: ParsedWebhookMessage) {
  return processInboundMessage(env.tx as never, io, {}, channel, T, parsed);
}

/** 從 A 的 FB 對話發出代碼（直接呼叫服務，不經網路） */
async function codeFromA(env: Env): Promise<string> {
  const r = await issueBindingCode(env.tx, { store: env.store, deliver: async () => true }, {
    tenantId: T,
    channelId: env.fb.id,
    channelType: 'FB',
    channelIdentityId: env.fbA.identityId,
    uid: env.fbA.uid,
    contactId: env.fbA.contactId,
    conversationId: env.fbA.conversationId,
  });
  assert.equal(r.status, 'sent');
  return r.status === 'sent' ? r.code : '';
}

const scenarios: Array<[string, boolean, (env: Env) => Promise<void>]> = [
  [
    '啟用：既有 FB 顧客傳「綁定帳號」→ 回覆導流連結，不發 message.received',
    true,
    async (env) => {
      await run(env, env.fb, inbound(env.fbA.uid, '綁定帳號'));
      const msgs = await env.tx.message.findMany({
        where: { conversationId: env.fbA.conversationId },
        orderBy: { createdAt: 'asc' },
      });
      assert.ok(msgs.some((m) => m.direction === 'INBOUND'), '顧客訊息仍落地');
      const invite = msgs.find((m) => m.senderType === 'BOT' && m.contentType === 'text');
      assert.ok(extractBindingCode((invite?.content as { text?: string }).text), '回覆含代碼的邀請');
      assert.equal(received.length, 0, 'AI／關鍵字／自動化不處理');
    },
  ],
  [
    '啟用：新 LINE 好友送出預填代碼 → 併入 A、不送招呼語、不發 message.received',
    true,
    async (env) => {
      const code = await codeFromA(env);
      const lineUid = `new-line-${seq++}`;
      await run(env, env.line, inbound(lineUid, linePrefillText(code)));

      const identity = await env.tx.channelIdentity.findFirst({ where: { channelId: env.line.id, uid: lineUid } });
      assert.equal(identity?.contactId, env.fbA.contactId, 'LINE 身分併到 A');
      const lineConv = await env.tx.conversation.findFirst({ where: { tenantId: T, channelId: env.line.id } });
      const msgs = await env.tx.message.findMany({ where: { conversationId: lineConv!.id } });
      assert.ok(
        !msgs.some((m) => (m.metadata as { source?: string }).source === 'first_contact_greeting'),
        '不送首次招呼語',
      );
      assert.ok(msgs.some((m) => ((m.content as { text?: string }).text ?? '').startsWith('已完成帳號綁定')));
      assert.equal(received.length, 0);
    },
  ],
  [
    '未啟用：新 LINE 好友送出含代碼的文字 → 照常送招呼語、發 message.received',
    false,
    async (env) => {
      const lineUid = `new-line-${seq++}`;
      await run(env, env.line, inbound(lineUid, linePrefillText('BIND-7K2M9QH4TX')));
      const lineConv = await env.tx.conversation.findFirst({ where: { tenantId: T, channelId: env.line.id } });
      const msgs = await env.tx.message.findMany({ where: { conversationId: lineConv!.id } });
      assert.ok(
        msgs.some((m) => (m.metadata as { source?: string }).source === 'first_contact_greeting'),
        '照常送招呼語',
      );
      assert.equal(received.length, 1, '照常進 AI／關鍵字／自動化');
    },
  ],
  [
    'FB referral 帶非綁定代碼的 ref → 只記錄，不建立聯絡人或訊息',
    true,
    async (env) => {
      const uid = `ad-visitor-${seq++}`;
      await run(env, env.fb, { contactUid: uid, timestamp: new Date(), contentType: 'referral', content: {}, referralRef: 'spring_sale' });
      assert.equal(await env.tx.channelIdentity.count({ where: { channelId: env.fb.id, uid } }), 0);
      assert.equal(received.length, 0);
    },
  ],
  [
    'FB referral 帶綁定代碼 → 合併、不落地空白訊息，平台重送不重複處理',
    true,
    async (env) => {
      // 由 LINE 顧客 B 發碼，FB 新身分以 referral 兌換
      const b = await env.tx.contact.create({ data: { tenantId: T, displayName: 'B' } });
      const bUid = `line-B-${seq++}`;
      const bIdentity = await env.tx.channelIdentity.create({
        data: { contactId: b.id, channelId: env.line.id, channelType: 'LINE', uid: bUid },
      });
      const bConv = await env.tx.conversation.create({
        data: { tenantId: T, contactId: b.id, channelId: env.line.id, channelType: 'LINE' },
      });
      const r = await issueBindingCode(env.tx, { store: env.store, deliver: async () => true }, {
        tenantId: T,
        channelId: env.line.id,
        channelType: 'LINE',
        channelIdentityId: bIdentity.id,
        uid: bUid,
        contactId: b.id,
        conversationId: bConv.id,
      });
      assert.equal(r.status, 'sent');
      const code = r.status === 'sent' ? r.code : '';

      const fbUid = `fb-new-${seq++}`;
      const referral = { contactUid: fbUid, timestamp: new Date(), contentType: 'referral', content: {}, referralRef: code };
      await run(env, env.fb, referral);
      // 平台重送同一 referral 事件：應被去重，不再回覆「代碼無效」
      await run(env, env.fb, { ...referral, timestamp: new Date() });
      const identity = await env.tx.channelIdentity.findFirst({ where: { channelId: env.fb.id, uid: fbUid } });
      assert.equal(identity?.contactId, b.id, 'FB 身分併到發碼的 B');
      const fbConv = await env.tx.conversation.findFirst({ where: { tenantId: T, channelId: env.fb.id, contactId: b.id } });
      const inboundMsgs = await env.tx.message.count({ where: { conversationId: fbConv!.id, direction: 'INBOUND' } });
      assert.equal(inboundMsgs, 0, 'referral 事件不落地成顧客訊息');
      const replies = await env.tx.message.findMany({ where: { conversationId: fbConv!.id, senderType: 'BOT' } });
      const texts = replies.map((m) => (m.content as { text?: string }).text ?? '');
      assert.equal(texts.filter((t) => t.startsWith('已完成帳號綁定')).length, 1, '只綁定一次');
      assert.ok(!texts.some((t) => t.includes('無效或已過期')), '重送事件不回覆代碼無效');
    },
  ],
  [
    'FB 新顧客按「開始使用」帶綁定代碼 → 合併；平台重送同一 postback 不回覆代碼無效',
    true,
    async (env) => {
      const code = await codeFromA(env);
      // 以 LINE 身分接收（LINE 不會有 postback referral，此處只驗證 ref 去重邏輯與管線行為）
      const uid = `fb-getstarted-${seq++}`;
      const b = await env.tx.contact.create({ data: { tenantId: T, displayName: 'LINE-B' } });
      await env.tx.channelIdentity.create({ data: { contactId: b.id, channelId: env.line.id, channelType: 'LINE', uid } });
      // FB postback 帶平台 mid（postback.mid），重送時 mid 相同
      const postback = {
        contactUid: uid,
        channelMsgId: `pb-mid-${seq++}`,
        timestamp: new Date(),
        contentType: 'postback',
        content: { text: '開始使用' },
        referralRef: code,
      } as ParsedWebhookMessage;
      await run(env, env.line, postback);
      await run(env, env.line, { ...postback, timestamp: new Date() });

      const identity = await env.tx.channelIdentity.findFirst({ where: { channelId: env.line.id, uid } });
      assert.equal(identity?.contactId, env.fbA.contactId, '併入發碼的 A');
      const conv = await env.tx.conversation.findFirst({ where: { tenantId: T, channelId: env.line.id, contactId: env.fbA.contactId } });
      const texts = (await env.tx.message.findMany({ where: { conversationId: conv!.id, senderType: 'BOT' } })).map(
        (m) => (m.content as { text?: string }).text ?? '',
      );
      assert.equal(texts.filter((t) => t.startsWith('已完成帳號綁定')).length, 1);
      assert.ok(!texts.some((t) => t.includes('無效或已過期')), '重送不回覆代碼無效');
    },
  ],
  [
    '啟用：新 LINE 好友第一則就送出無效代碼 → 回覆代碼無效，且仍收到首次招呼語',
    true,
    async (env) => {
      const lineUid = `new-line-${seq++}`;
      await run(env, env.line, inbound(lineUid, linePrefillText('BIND-0000000000')));
      const lineConv = await env.tx.conversation.findFirst({ where: { tenantId: T, channelId: env.line.id } });
      const msgs = await env.tx.message.findMany({ where: { conversationId: lineConv!.id } });
      assert.ok(msgs.some((m) => ((m.content as { text?: string }).text ?? '').includes('無效或已過期')));
      assert.ok(
        msgs.some((m) => (m.metadata as { source?: string }).source === 'first_contact_greeting'),
        '沒有合併的新顧客仍要收到招呼語',
      );
      assert.equal(received.length, 0, '仍不交給 AI');
    },
  ],
];

let failed = 0;
for (const [i, [name, enabled, fn]] of scenarios.entries()) {
  try {
    await prisma
      .$transaction(
        async (tx) => {
          await fn(await setup(tx, enabled));
          throw new Rollback();
        },
        { timeout: 30_000 },
      )
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
    console.log(`ok ${i + 1} - ${name}`);
  } catch (err) {
    failed++;
    console.log(`not ok ${i + 1} - ${name}`);
    console.error(err);
  }
}
setBindingStoreForTest(null);
console.log(`# pass ${scenarios.length - failed}`);
console.log(`# fail ${failed}`);
await prisma.$disconnect();
process.exit(failed === 0 ? 0 : 1);
