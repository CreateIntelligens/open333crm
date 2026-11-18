/**
 * 留言者的聯絡人（change add-comment-keyword-private-reply tasks 6.1；design D16、D17；
 * spec comment-reply-contact-linking「留言命中規則時建立或沿用聯絡人」「私訊成功後以 recipient_id 接上渠道身分」）。
 *
 * 留言經真的 webhook 收件，job 以 index.ts 同一個工廠處理，真的外掛＋fake-meta-graph。
 */
import {
  cleanupCommentReplyData,
  clearRateBuckets,
  createRule,
  disconnectAll,
  drainJobs,
  enableAllCapabilities,
  owner,
  postToChannel,
  postToPlatform,
  resetHarness,
  resetPlatformSettings,
} from '#tests/support/comment-reply-harness.js';
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test, vi } from 'vitest';
import { eventBus } from '#src/events/event-bus.js';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';
import { fbCommentPayload, igCommentPayload } from '#tests/support/meta-webhook.js';

const fx = createCommentReplyFixtures(owner);
const graph = useFakeMetaGraph();
let seq = 0;
const uid = (p: string) => `${p}${Date.now()}${++seq}`;
const FB_SEND = '/v21.0/me/messages';

beforeEach(async () => {
  resetHarness();
  await enableAllCapabilities();
});

afterAll(async () => {
  await resetPlatformSettings();
  await fx.cleanup(cleanupCommentReplyData);
  await disconnectAll();
});

async function setupFb(settings: Record<string, unknown> = {}) {
  const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
  const fb = await fx.fbChannel(tenant.id, { settings });
  await createRule(tenant.id, fb.id, { keywords: ['+1'] });
  await clearRateBuckets([fb.id]);
  return { tenant, fb };
}

async function fbComment(fb: { id: string; externalAccountId: string }, from: { id: string; name?: string }) {
  const commentId = uid('c');
  await postToPlatform(fbCommentPayload([{ pageId: fb.externalAccountId, commentId, from, createdTime: Math.floor(Date.now() / 1000) }]));
  return owner.commentReplyLog.findFirstOrThrow({ where: { channelId: fb.id, commentId }, include: { commentAuthor: true } });
}

const okFb = (recipientId: string) => graph.on('POST', 'graph.facebook.com', FB_SEND, { body: { recipient_id: recipientId, message_id: uid('m_') } });

describe('留言命中規則時建立或沿用聯絡人', () => {
  test('新留言者', async () => {
    const { fb, tenant } = await setupFb();
    const u1 = uid('U');
    const log = await fbComment(fb, { id: u1, name: '王小明' });
    const contacts = await owner.contact.findMany({ where: { tenantId: tenant.id } });
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0]!.displayName, '王小明');
    assert.equal(log.commentAuthor.contactId, contacts[0]!.id);
    assert.equal(log.commentAuthor.createdContact, true);
    assert.equal(await owner.channelIdentity.count({ where: { contactId: contacts[0]!.id } }), 0);
  });

  test('私訊失敗仍保留聯絡人', async () => {
    const { fb } = await setupFb();
    graph.on('POST', 'graph.facebook.com', FB_SEND, { status: 400, body: { error: { message: 'x', code: 551 } } });
    const log = await fbComment(fb, { id: uid('U'), name: '李四' });
    await drainJobs();
    assert.equal((await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } })).status, 'FAILED');
    assert.ok(await owner.contact.findUnique({ where: { id: log.commentAuthor.contactId } }));
  });

  test('舊顧客留言', async () => {
    const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
    const secret = uid('ig-');
    const ig = await fx.igChannel(tenant.id, { mode: 'own_app', appSecret: secret });
    await createRule(tenant.id, ig.id, { keywords: ['+1'] });
    const igsid = uid('IGSID');
    const existing = await owner.contact.create({ data: { tenantId: tenant.id, displayName: '老顧客' } });
    await owner.channelIdentity.create({ data: { contactId: existing.id, channelId: ig.id, channelType: 'THREADS', uid: igsid } });
    const commentId = uid('igc');
    await postToChannel(ig, igCommentPayload([{ accountId: ig.externalAccountId, commentId, from: { id: igsid, username: 'old' }, text: '+1', time: Date.now() }]), secret);
    const log = await owner.commentReplyLog.findFirstOrThrow({ where: { channelId: ig.id, commentId }, include: { commentAuthor: true } });
    assert.equal(log.commentAuthor.contactId, existing.id);
    assert.equal(log.commentAuthor.createdContact, false);
    assert.equal(await owner.contact.count({ where: { tenantId: tenant.id } }), 1);
  });

  test('同一人兩則留言並行', async () => {
    const { fb, tenant } = await setupFb();
    const from = { id: uid('U'), name: '同時' };
    await Promise.all([
      postToPlatform(fbCommentPayload([{ pageId: fb.externalAccountId, commentId: uid('c'), from, createdTime: Math.floor(Date.now() / 1000) }])),
      postToPlatform(fbCommentPayload([{ pageId: fb.externalAccountId, commentId: uid('c'), from, createdTime: Math.floor(Date.now() / 1000) }])),
    ]);
    assert.equal(await owner.commentReplyLog.count({ where: { channelId: fb.id } }), 2);
    assert.equal(await owner.commentAuthor.count({ where: { channelId: fb.id } }), 1);
    assert.equal(await owner.contact.count({ where: { tenantId: tenant.id } }), 1);
  });

  test('不送招呼語也不發建立事件', async () => {
    const { fb, tenant } = await setupFb({ firstContactGreeting: '歡迎光臨' });
    const spy = vi.spyOn(eventBus, 'publish');
    try {
      await fbComment(fb, { id: uid('U'), name: '新人' });
    } finally {
      spy.mockRestore();
    }
    assert.equal(spy.mock.calls.filter(([e]) => (e as { name: string }).name === 'contact.created').length, 0);
    assert.equal(await owner.outbox.count({ where: { tenantId: tenant.id, name: 'contact.created' } }), 0);
    assert.equal(graph.calls('POST', FB_SEND).length, 0);
  });

  // first-contact-greeting「留言收件建立聯絡人時不發布」：確認聯絡人真的新建了，且沒有發布 contact.created
  test('留言收件建立聯絡人時不發布', async () => {
    const { fb, tenant } = await setupFb();
    const before = await owner.contact.count({ where: { tenantId: tenant.id } });
    const spy = vi.spyOn(eventBus, 'publish');
    try {
      const log = await fbComment(fb, { id: uid('U'), name: '新留言者' });
      assert.ok(log.commentAuthor?.contactId, '留言收件建立了聯絡人');
    } finally {
      spy.mockRestore();
    }
    assert.equal(await owner.contact.count({ where: { tenantId: tenant.id } }), before + 1);
    assert.equal(spy.mock.calls.filter(([e]) => (e as { name: string }).name === 'contact.created').length, 0);
    assert.equal(await owner.outbox.count({ where: { tenantId: tenant.id, name: 'contact.created' } }), 0);
  });

  test('IdentityMap 已拼接時建在拼接的聯絡人', async () => {
    const { fb, tenant } = await setupFb();
    const u1 = uid('U');
    const stitched = await owner.contact.create({ data: { tenantId: tenant.id, displayName: '拼接的人' } });
    await owner.identityMap.create({ data: { tenantId: tenant.id, contactId: stitched.id, channelType: 'FB', uid: u1, source: 'MANUAL' } });
    const log = await fbComment(fb, { id: u1, name: '拼接' });
    assert.equal(log.commentAuthor.contactId, stitched.id);
    await owner.identityMap.deleteMany({ where: { tenantId: tenant.id } });
  });
});

describe('私訊成功後以 recipient_id 接上渠道身分', () => {
  test('新留言者私訊成功', async () => {
    const { fb } = await setupFb();
    const psid = uid('PSID');
    okFb(psid);
    const log = await fbComment(fb, { id: uid('U'), name: '王小明' });
    await drainJobs();
    const identity = await owner.channelIdentity.findFirstOrThrow({ where: { channelId: fb.id, uid: psid } });
    assert.equal(identity.contactId, log.commentAuthor.contactId);
    assert.equal((await owner.commentAuthor.findUniqueOrThrow({ where: { id: log.commentAuthorId } })).psid, psid);
  });

  test('留言者 ID 與 PSID 不同', async () => {
    const { fb } = await setupFb();
    const u1 = uid('U');
    const psid = uid('PSID');
    okFb(psid);
    const log = await fbComment(fb, { id: u1, name: '王小明' });
    await drainJobs();
    assert.equal(await owner.channelIdentity.count({ where: { channelId: fb.id, uid: u1 } }), 0);
    const identity = await owner.channelIdentity.findFirstOrThrow({ where: { channelId: fb.id, uid: psid }, include: { contact: true } });
    assert.equal(identity.contact.displayName, '王小明');
    assert.equal(identity.contactId, log.commentAuthor.contactId);
  });

  test('PSID 已屬於舊顧客', async () => {
    const { fb, tenant } = await setupFb();
    const psid = uid('PSID');
    const b = await owner.contact.create({ data: { tenantId: tenant.id, displayName: '舊顧客 B' } });
    await owner.channelIdentity.create({ data: { contactId: b.id, channelId: fb.id, channelType: 'FB', uid: psid } });
    okFb(psid);
    const log = await fbComment(fb, { id: uid('U'), name: '留言者' });
    const a = log.commentAuthor.contactId;
    await drainJobs();
    const merged = await owner.contact.findUniqueOrThrow({ where: { id: a } });
    assert.equal(merged.isArchived, true);
    assert.equal(merged.mergedIntoId, b.id);
    const mergeLog = await owner.contactMergeLog.findFirstOrThrow({ where: { tenantId: tenant.id, mergedId: a } });
    assert.equal(mergeLog.source, 'COMMENT_REPLY');
    assert.equal(mergeLog.survivorId, b.id);
    assert.deepEqual(
      (await owner.contact.findMany({ where: { tenantId: tenant.id, isArchived: false }, select: { id: true } })).map((c) => c.id),
      [b.id],
    );
    assert.equal((await owner.commentAuthor.findUniqueOrThrow({ where: { id: log.commentAuthorId } })).contactId, b.id);
  });

  test('原本就存在的聯絡人不自動合併，只改指留言者對應', async () => {
    const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
    const fb = await fx.fbChannel(tenant.id);
    await createRule(tenant.id, fb.id, { keywords: ['+1'] });
    await clearRateBuckets([fb.id]);
    const u1 = uid('U');
    const psid = uid('PSID');
    const a = await owner.contact.create({ data: { tenantId: tenant.id, displayName: 'A（ID 相同的舊顧客）' } });
    await owner.channelIdentity.create({ data: { contactId: a.id, channelId: fb.id, channelType: 'FB', uid: u1 } });
    const b = await owner.contact.create({ data: { tenantId: tenant.id, displayName: 'B' } });
    await owner.channelIdentity.create({ data: { contactId: b.id, channelId: fb.id, channelType: 'FB', uid: psid } });
    okFb(psid);
    const log = await fbComment(fb, { id: u1, name: 'A' });
    await drainJobs();
    assert.equal((await owner.contact.findUniqueOrThrow({ where: { id: a.id } })).isArchived, false);
    assert.equal((await owner.commentAuthor.findUniqueOrThrow({ where: { id: log.commentAuthorId } })).contactId, b.id);
  });
});
