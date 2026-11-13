/**
 * 顧客回覆留言私訊時串到收件匣（change add-comment-keyword-private-reply tasks 6.2、6.3；design D16、D17、D18；
 * spec comment-reply-contact-linking「顧客第一次回覆時對話標記來源並補入私訊」「收件匣標示來自留言的對話」
 * 「私訊成功後以 recipient_id 接上渠道身分」Scenario「顧客回覆比寫結果先到」；
 * first-contact-greeting「首次進站時送出招呼語」「聯絡人建立時發布 contact.created 事件」的留言情境；
 * inbound-contact-resolution「新 UID 首次進站必須建立聯絡人並落地訊息」Scenario「留言者自己傳第一則私訊」）。
 *
 * 留言與顧客私訊都經真的 webhook（processPlatformMetaWebhook／processWebhookEvent），job 以 index.ts 同一個工廠處理。
 * tasks 6.3 指定擴充 inbound-message-processing.test.ts；那個檔案以 WEBCHAT 渠道與替換的 deliverToChannel 測一般管線，
 * 留言情境需要 FB／IG 外掛、fake-meta-graph 與留言收件，所以放在這裡（同一個真入口 processInboundMessage）。
 */
import {
  adminDb,
  cleanupCommentReplyData,
  clearRateBuckets,
  createRule,
  disconnectAll,
  drainJobs,
  enableAllCapabilities,
  owner,
  PLATFORM_APP_SECRET,
  postToChannel,
  postToPlatform,
  resetHarness,
  resetPlatformSettings,
  silentIo,
  tenantDb,
} from '#tests/support/comment-reply-harness.js';
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { eventBus } from '#src/events/event-bus.js';
import { withTenant } from '#src/lib/tenant-db.js';
import { inTenant } from '#src/lib/tenant-ctx.js';
import { attachCommentOrigin } from '#src/modules/comment-reply/comment-reply-inbox.service.js';
import { ALL_CHANNELS } from '#src/services/channel-visibility.js';
import { listConversations } from '#src/modules/conversation/conversation.service.js';
import { processPlatformMetaWebhook } from '#src/modules/webhook/webhook.service.js';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';
import { fbCommentPayload, fbMessagePayload, igCommentPayload, igMessagePayload, signed } from '#tests/support/meta-webhook.js';
import { urls } from '#tests/setup/feature-config.js';

const fx = createCommentReplyFixtures(owner);
const graph = useFakeMetaGraph();
let seq = 0;
const uid = (p: string) => `${p}${Date.now()}${++seq}`;
const FB_SEND = '/v21.0/me/messages';
const GREETING = '歡迎光臨，有問題直接留言';

beforeEach(async () => {
  resetHarness();
  await enableAllCapabilities();
  // 進站時讀顧客個人資料（getProfile）：讀不到就用預設名稱
  graph.on('GET', 'graph.facebook.com', /.*/, { status: 400, body: { error: { message: 'offline', code: 100 } } });
  graph.on('GET', 'graph.instagram.com', /.*/, { status: 400, body: { error: { message: 'offline', code: 100 } } });
});

afterAll(async () => {
  await resetPlatformSettings();
  await fx.cleanup(cleanupCommentReplyData);
  await disconnectAll();
});

async function setupFb(rule: Parameters<typeof createRule>[2] = {}) {
  const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
  const fb = await fx.fbChannel(tenant.id, { settings: { firstContactGreeting: GREETING } });
  await createRule(tenant.id, fb.id, { keywords: ['+1'], messageText: '活動連結在這', ...rule });
  await clearRateBuckets([fb.id]);
  return { tenant, fb };
}

/** 留言 → 私訊成功（recipient_id = psid），回傳紀錄 */
async function commentAndSend(fb: { id: string; externalAccountId: string }, psid: string, from = { id: uid('U'), name: '王小明' }) {
  const mid = uid('m_');
  graph.on('POST', 'graph.facebook.com', FB_SEND, (call) =>
    call.body?.recipient?.comment_id
      ? { body: { recipient_id: psid, message_id: mid } }
      : { body: { recipient_id: call.body?.recipient?.id, message_id: uid('g_') } },
  );
  const commentId = uid('c');
  await postToPlatform(fbCommentPayload([{ pageId: fb.externalAccountId, commentId, from, createdTime: Math.floor(Date.now() / 1000) }]));
  await drainJobs();
  const log = await owner.commentReplyLog.findFirstOrThrow({ where: { channelId: fb.id, commentId } });
  assert.equal(log.status, 'SENT');
  return log;
}

const reply = (fb: { externalAccountId: string }, psid: string, text = '我要') =>
  postToPlatform(fbMessagePayload([{ pageId: fb.externalAccountId, psid, text }]));

async function conversationMessages(channelId: string, uid_: string) {
  const identity = await owner.channelIdentity.findFirstOrThrow({ where: { channelId, uid: uid_ } });
  const conv = await owner.conversation.findFirstOrThrow({ where: { channelId, contactId: identity.contactId } });
  const messages = await owner.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' } });
  return { conv, messages };
}

const originMessages = (messages: Array<{ metadata: unknown }>) =>
  messages.filter((m) => (m.metadata as { source?: string })?.source === 'comment_private_reply');
const greetingSends = () => graph.calls('POST', FB_SEND).filter((c) => c.body?.recipient?.id);

describe('顧客第一次回覆時對話標記來源並補入私訊', () => {
  test('顧客第一次回覆', async () => {
    const { fb, tenant } = await setupFb();
    const psid = uid('PSID');
    const log = await commentAndSend(fb, psid);
    const contactsBefore = await owner.contact.count({ where: { tenantId: tenant.id } });
    await reply(fb, psid, '我要');
    const { conv, messages } = await conversationMessages(fb.id, psid);
    assert.equal(messages.length, 3);
    assert.equal((messages[0]!.metadata as any).kind, 'origin_note');
    assert.equal((messages[0]!.metadata as any).logId, log.id);
    assert.equal((messages[1]!.metadata as any).source, 'comment_private_reply');
    assert.equal((messages[1]!.content as any).text, '活動連結在這');
    assert.equal(messages[1]!.channelMsgId, log.sentMessageId);
    assert.equal((messages[2]!.content as any).text, '我要');
    const after = await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } });
    assert.equal(after.conversationId, conv.id);
    assert.ok(after.customerRepliedAt);
    assert.equal(await owner.contact.count({ where: { tenantId: tenant.id } }), contactsBefore);
    // 補入的訊息不改 lastMessageAt 與未讀數
    assert.equal(conv.lastMessageAt?.getTime(), messages[2]!.createdAt.getTime());
    assert.equal(conv.unreadCount, 1);
  });

  test('顧客再傳第二則', async () => {
    const { fb } = await setupFb();
    const psid = uid('PSID');
    await commentAndSend(fb, psid);
    await reply(fb, psid, '第一則');
    await reply(fb, psid, '第二則');
    const { messages } = await conversationMessages(fb.id, psid);
    assert.equal(originMessages(messages).length, 2);
    assert.equal(messages.length, 4);
  });

  test('兩則回覆並行', async () => {
    const { fb } = await setupFb();
    const psid = uid('PSID');
    await commentAndSend(fb, psid);
    await Promise.all([reply(fb, psid, 'A'), reply(fb, psid, 'B')]);
    // 並行的兩則回覆可能各自解析對話（既有入站行為），所以看這位顧客在這個渠道的全部訊息
    const identity = await owner.channelIdentity.findFirstOrThrow({ where: { channelId: fb.id, uid: psid } });
    const messages = await owner.message.findMany({ where: { conversation: { channelId: fb.id, contactId: identity.contactId } } });
    assert.equal(originMessages(messages).filter((m) => (m.metadata as any).kind === 'origin_note').length, 1);
    assert.equal(originMessages(messages).length, 2);
  });

  test('兩個關聯同時進行時只關聯一次', async () => {
    // 入站與 T2 之後的補救兩條路可能同時關聯同一筆紀錄。讓第一個交易在條件更新之後、提交之前停 300ms，
    // 第二個交易在這段時間讀到 conversationId 仍是空的；只有條件更新（conversationId IS NULL）能擋下第二次
    const { fb, tenant } = await setupFb();
    const psid = uid('PSID');
    const log = await commentAndSend(fb, psid);
    graph.on('POST', 'graph.facebook.com', FB_SEND, { body: { recipient_id: psid, message_id: uid('g_') } });
    // 先建好對話（不經關聯）：直接建一個沒有留言來源的對話
    const identity = await owner.channelIdentity.findFirstOrThrow({ where: { channelId: fb.id, uid: psid } });
    const conv = await owner.conversation.create({ data: { tenantId: tenant.id, channelId: fb.id, channelType: 'FB', contactId: identity.contactId } });
    const slowTx = (scope: { tx: unknown; tenantId: string }) => ({
      tenantId: scope.tenantId,
      tx: new Proxy(scope.tx as object, {
        get(target, prop, receiver) {
          const v = Reflect.get(target, prop, receiver);
          if (prop !== 'message') return v;
          return { ...(v as object), createMany: async (args: unknown) => {
            await new Promise((r) => setTimeout(r, 300));
            return (v as { createMany: (a: unknown) => unknown }).createMany(args);
          } };
        },
      }),
    });
    const attachOnce = () =>
      inTenant(tenantDb, tenant.id, (scope) =>
        attachCommentOrigin(slowTx(scope) as never, { channelId: fb.id, uid: psid, conversationId: conv.id, repliedAt: new Date() }),
      );
    const first = attachOnce();
    await new Promise((r) => setTimeout(r, 100));
    const results = await Promise.all([first, attachOnce()]);
    assert.equal(results.filter((r) => r.attached).length, 1);
    const messages = await owner.message.findMany({ where: { conversationId: conv.id } });
    assert.equal(originMessages(messages).filter((m) => (m.metadata as any).kind === 'origin_note').length, 1);
    assert.equal((await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } })).conversationId, conv.id);
  });

  test('echo 不重複', async () => {
    const { fb } = await setupFb();
    const psid = uid('PSID');
    const log = await commentAndSend(fb, psid);
    await reply(fb, psid);
    await postToPlatform(fbMessagePayload([{ pageId: fb.externalAccountId, psid, isEcho: true, mid: log.sentMessageId!, text: '活動連結在這' }]));
    const { messages } = await conversationMessages(fb.id, psid);
    assert.equal(messages.filter((m) => m.channelMsgId === log.sentMessageId).length, 1);
  });

  test('一般私訊不受影響', async () => {
    const { fb } = await setupFb();
    const psid = uid('PSID');
    graph.on('POST', 'graph.facebook.com', FB_SEND, { body: { recipient_id: psid, message_id: uid('g_') } });
    await reply(fb, psid, '你好');
    const { messages } = await conversationMessages(fb.id, psid);
    assert.equal(originMessages(messages).length, 0);
  });

  test('關聯步驟丟錯', async () => {
    const { fb } = await setupFb();
    const psid = uid('PSID');
    const log = await commentAndSend(fb, psid);
    const broken = new PrismaClient({ datasources: { db: { url: urls.tenant.replace(/:[^:@/]+@/, ':wrong-password@') } } });
    const pushed: string[] = [];
    const io = { to: () => ({ emit: (event: string) => void pushed.push(event) }), emit: () => true } as never;
    const { raw, headers } = signed(fbMessagePayload([{ pageId: fb.externalAccountId, psid, text: '我要' }]), PLATFORM_APP_SECRET);
    try {
      await processPlatformMetaWebhook(adminDb, io, raw, headers, { tenantPrisma: broken });
    } finally {
      await broken.$disconnect();
    }
    const { messages } = await conversationMessages(fb.id, psid);
    assert.ok(messages.some((m) => (m.content as any).text === '我要'), '顧客訊息仍落地');
    assert.ok(pushed.includes('message.new'), '仍推播');
    assert.equal((await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } })).conversationId, null);
  });

  test('30 天前的私訊不關聯', async () => {
    const { fb } = await setupFb();
    const psid = uid('PSID');
    const log = await commentAndSend(fb, psid);
    await owner.commentReplyLog.update({ where: { id: log.id }, data: { sentAt: new Date(Date.now() - 31 * 86_400_000) } });
    await reply(fb, psid);
    const { messages } = await conversationMessages(fb.id, psid);
    assert.equal(originMessages(messages).length, 0);
  });
});

describe('收件匣標示來自留言的對話', () => {
  test('對話列表帶來源', async () => {
    const { fb, tenant } = await setupFb();
    const psid = uid('PSID');
    const log = await commentAndSend(fb, psid);
    await reply(fb, psid);
    const { conversations } = await withTenant(tenantDb, tenant.id, (tx) =>
      listConversations(tx as never, tenant.id, {}, { page: 1, limit: 20 }, ALL_CHANNELS),
    );
    const conv = conversations.find((c) => c.channelId === fb.id)!;
    assert.equal(conv.origin?.type, 'comment_private_reply');
    assert.equal(conv.origin?.logId, log.id);
    assert.ok(conv.origin?.at);
  });

  test('已有對話的顧客再次留言', async () => {
    const { fb } = await setupFb({ dedupePerCommenter: false });
    const psid = uid('PSID');
    const from = { id: uid('U'), name: '回頭客' };
    const first = await commentAndSend(fb, psid, from);
    await reply(fb, psid, '第一次');
    const second = await commentAndSend(fb, psid, from);
    await reply(fb, psid, '第二次');
    const { conv, messages } = await conversationMessages(fb.id, psid);
    assert.equal(originMessages(messages).filter((m) => (m.metadata as any).kind === 'origin_note').length, 2);
    assert.equal(conv.originCommentReplyLogId, first.id);
    assert.equal((await owner.commentReplyLog.findUniqueOrThrow({ where: { id: second.id } })).conversationId, conv.id);
  });
});

describe('招呼語與 contact.created（first-contact-greeting）', () => {
  test('留言私訊後顧客第一次回覆', async () => {
    const { fb } = await setupFb();
    const psid = uid('PSID');
    await commentAndSend(fb, psid);
    await reply(fb, psid);
    const { messages } = await conversationMessages(fb.id, psid);
    assert.equal(messages.filter((m) => (m.metadata as any)?.source === 'first_contact_greeting').length, 0);
    assert.equal(greetingSends().length, 0);
  });

  test('留言建立的聯絡人自己傳私訊', async () => {
    const { fb, tenant } = await setupFb();
    const u1 = uid('U');
    graph.on('POST', 'graph.facebook.com', FB_SEND, (call) =>
      call.body?.recipient?.comment_id ? { status: 400, body: { error: { message: 'x', code: 551 } } } : { body: { recipient_id: u1, message_id: uid('g_') } },
    );
    await postToPlatform(fbCommentPayload([{ pageId: fb.externalAccountId, commentId: uid('c'), from: { id: u1, name: '失敗的人' }, createdTime: Math.floor(Date.now() / 1000) }]));
    await drainJobs();
    const contactsBefore = await owner.contact.count({ where: { tenantId: tenant.id } });
    // 私訊失敗：聯絡人只有留言者對應；顧客自己傳私訊（FB 實測 from.id 等於 PSID 時才接得上）
    await reply(fb, u1, '請問');
    assert.equal(await owner.contact.count({ where: { tenantId: tenant.id } }), contactsBefore);
    const { messages } = await conversationMessages(fb.id, u1);
    assert.equal(messages.filter((m) => (m.metadata as any)?.source === 'first_contact_greeting').length, 0);
    assert.equal(greetingSends().length, 0);
  });

  test('一般 FB 新顧客第一次私訊仍送招呼語', async () => {
    const { fb } = await setupFb();
    const psid = uid('PSID');
    graph.on('POST', 'graph.facebook.com', FB_SEND, { body: { recipient_id: psid, message_id: uid('g_') } });
    await reply(fb, psid, '你好');
    const { messages } = await conversationMessages(fb.id, psid);
    assert.equal(messages.filter((m) => (m.metadata as any)?.source === 'first_contact_greeting').length, 1);
    assert.equal(greetingSends().length, 1);
  });

  test('留言建立的聯絡人第一次進站時發布一次', async () => {
    const { fb } = await setupFb();
    const psid = uid('PSID');
    await commentAndSend(fb, psid);
    const spy = vi.spyOn(eventBus, 'publish');
    try {
      await reply(fb, psid, '第一則');
      const firstCount = spy.mock.calls.filter(([e]) => (e as { name: string }).name === 'contact.created').length;
      await reply(fb, psid, '第二則');
      const total = spy.mock.calls.filter(([e]) => (e as { name: string }).name === 'contact.created').length;
      assert.equal(firstCount, 1);
      assert.equal(total, 1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('入站解析先查留言者對應（inbound-contact-resolution）', () => {
  test('留言者自己傳第一則私訊', async () => {
    const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
    const secret = uid('ig-');
    const ig = await fx.igChannel(tenant.id, { mode: 'own_app', appSecret: secret });
    await createRule(tenant.id, ig.id, { keywords: ['+1'] });
    await clearRateBuckets([ig.id]);
    const igsid = uid('IGSID');
    graph.on('POST', 'graph.instagram.com', FB_SEND, { status: 400, body: { error: { message: 'x', code: 551 } } });
    await postToChannel(ig, igCommentPayload([{ accountId: ig.externalAccountId, commentId: uid('igc'), from: { id: igsid, username: 'amy' }, text: '+1', time: Date.now() }]), secret);
    await drainJobs();
    const author = await owner.commentAuthor.findFirstOrThrow({ where: { channelId: ig.id, externalUserId: igsid } });
    assert.equal(await owner.channelIdentity.count({ where: { contactId: author.contactId } }), 0);
    const contactsBefore = await owner.contact.count({ where: { tenantId: tenant.id } });
    await postToChannel(ig, igMessagePayload([{ accountId: ig.externalAccountId, igsid, text: '請問' }]), secret);
    const identity = await owner.channelIdentity.findFirstOrThrow({ where: { channelId: ig.id, uid: igsid } });
    assert.equal(identity.contactId, author.contactId);
    assert.equal(await owner.conversation.count({ where: { channelId: ig.id, contactId: author.contactId } }), 1);
    assert.equal(await owner.contact.count({ where: { tenantId: tenant.id } }), contactsBefore);
  });
});

describe('顧客回覆比寫結果先到', () => {
  test('顧客回覆比寫結果先到', async () => {
    const { fb, tenant } = await setupFb();
    const psid = uid('PSID');
    graph.on('POST', 'graph.facebook.com', FB_SEND, async (call) => {
      if (call.body?.recipient?.comment_id) {
        // Meta 送出私訊後顧客馬上回覆：回覆的 webhook 在系統寫入 SENT 之前處理完
        await reply(fb, psid, '馬上回');
        return { body: { recipient_id: psid, message_id: uid('m_') } };
      }
      return { body: { recipient_id: psid, message_id: uid('g_') } };
    });
    await postToPlatform(fbCommentPayload([{ pageId: fb.externalAccountId, commentId: uid('c'), from: { id: uid('U'), name: '急性子' }, createdTime: Math.floor(Date.now() / 1000) }]));
    await drainJobs();
    const identity = await owner.channelIdentity.findFirstOrThrow({ where: { channelId: fb.id, uid: psid } });
    const active = await owner.contact.findMany({ where: { tenantId: tenant.id, isArchived: false } });
    assert.equal(active.length, 1);
    assert.equal(active[0]!.id, identity.contactId);
    const author = await owner.commentAuthor.findFirstOrThrow({ where: { channelId: fb.id } });
    assert.equal(author.contactId, identity.contactId);
    void silentIo;
  });
});
