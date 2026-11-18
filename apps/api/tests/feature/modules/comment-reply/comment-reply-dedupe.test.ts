/**
 * 同一位留言者在同一規則只私訊一次（change add-comment-keyword-private-reply tasks 5.4；design D10；
 * spec comment-private-reply「同一位留言者在同一規則只私訊一次」）。
 *
 * 留言經真的 webhook 收件，job 以 index.ts 同一個工廠處理；斷言 Meta 的呼叫次數，不只紀錄筆數。
 */
import {
  cleanupCommentReplyData,
  clearRateBuckets,
  createRule,
  disconnectAll,
  drainJobs,
  enableAllCapabilities,
  jobsForLog,
  owner,
  postToPlatform,
  redis,
  resetHarness,
  resetPlatformSettings,
  runJobOnce,
} from '#tests/support/comment-reply-harness.js';
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';
import { fbCommentPayload } from '#tests/support/meta-webhook.js';
import { bumpCommentReplyRulesVersion } from '#src/modules/comment-reply/comment-reply-rule-cache.js';

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

async function setup(rule: Parameters<typeof createRule>[2] = {}) {
  const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
  const fb = await fx.fbChannel(tenant.id);
  const r = await createRule(tenant.id, fb.id, { keywords: ['+1'], ...rule });
  await clearRateBuckets([fb.id]);
  return { tenant, fb, rule: r };
}

async function comment(fb: { id: string; externalAccountId: string }, fromId: string, message = '+1', createdTime = Math.floor(Date.now() / 1000)) {
  const commentId = uid('c');
  await postToPlatform(fbCommentPayload([{ pageId: fb.externalAccountId, commentId, from: { id: fromId, name: '同一人' }, message, createdTime }]));
  return owner.commentReplyLog.findFirstOrThrow({ where: { channelId: fb.id, commentId } });
}

function okFb(delayMs = 0) {
  graph.on('POST', 'graph.facebook.com', FB_SEND, () => ({ delayMs, body: { recipient_id: 'PSID-d', message_id: uid('m_') } }));
}

async function statuses(channelId: string) {
  const logs = await owner.commentReplyLog.findMany({ where: { channelId }, orderBy: { createdAt: 'asc' } });
  return logs.map((l) => l.status);
}

describe('同一位留言者在同一規則只私訊一次', () => {
  test('同一人留五則', async () => {
    const { fb } = await setup();
    okFb();
    const u = uid('U');
    for (let i = 0; i < 5; i++) await comment(fb, u);
    await drainJobs();
    const s = await statuses(fb.id);
    assert.equal(s.filter((x) => x === 'SENT').length, 1);
    assert.equal(s.filter((x) => x === 'SKIPPED_DUPLICATE').length, 4);
    assert.equal(graph.calls('POST', FB_SEND).length, 1);
  });

  test('關閉每人一次', async () => {
    const { fb } = await setup({ dedupePerCommenter: false });
    okFb();
    const u = uid('U');
    for (let i = 0; i < 5; i++) await comment(fb, u);
    await drainJobs();
    assert.deepEqual(await statuses(fb.id), ['SENT', 'SENT', 'SENT', 'SENT', 'SENT']);
    assert.equal(graph.calls('POST', FB_SEND).length, 5);
  });

  test('第一則失敗後的留言仍會嘗試', async () => {
    const { fb } = await setup();
    graph.on('POST', 'graph.facebook.com', FB_SEND, { status: 400, body: { error: { message: 'cannot', code: 551 } } }, { body: { recipient_id: 'PSID-d', message_id: 'm-2' } });
    const u = uid('U');
    // 兩則都在第一則失敗前收件：收件當下不知道第一則會不會成功，不能先佔名額
    await comment(fb, u);
    await comment(fb, u);
    await drainJobs();
    assert.equal(graph.calls('POST', FB_SEND).length, 2);
    assert.deepEqual(await statuses(fb.id), ['FAILED', 'SENT']);
  });

  test('同一人兩則留言並行', async () => {
    const { fb } = await setup();
    okFb(300);
    const u = uid('U');
    const a = await comment(fb, u);
    const b = await comment(fb, u);
    await Promise.all([runJobOnce(jobsForLog(a.id)[0]!), runJobOnce(jobsForLog(b.id)[0]!)]);
    await drainJobs({ includeDelayed: true });
    assert.equal(graph.calls('POST', FB_SEND).length, 1);
    const s = (await statuses(fb.id)).sort();
    assert.deepEqual(s, ['SENT', 'SKIPPED_DUPLICATE']);
  });

  test('不同規則各送一次', async () => {
    const { tenant, fb } = await setup();
    await createRule(tenant.id, fb.id, { keywords: ['我要'], priority: 1 });
    okFb();
    const u = uid('U');
    await comment(fb, u, '+1');
    await comment(fb, u, '我要');
    await drainJobs();
    assert.deepEqual(await statuses(fb.id), ['SENT', 'SENT']);
  });

  test('已私訊過的詳情指出先前的紀錄', async () => {
    const { fb } = await setup();
    okFb();
    const u = uid('U');
    const first = await comment(fb, u);
    const second = await comment(fb, u);
    await drainJobs();
    const dup = await owner.commentReplyLog.findUniqueOrThrow({ where: { id: second.id } });
    assert.equal(dup.status, 'SKIPPED_DUPLICATE');
    assert.equal(dup.holderLogId, first.id);
  });

  test('規則刪除重建後會再私訊', async () => {
    const { tenant, fb, rule } = await setup();
    okFb();
    const u = uid('U');
    await comment(fb, u);
    await drainJobs();
    await owner.commentReplyRule.update({ where: { id: rule.id }, data: { deletedAt: new Date() } });
    await createRule(tenant.id, fb.id, { keywords: ['+1'] });
    await bumpCommentReplyRulesVersion(redis, fb.id);
    await comment(fb, u);
    await drainJobs();
    assert.deepEqual(await statuses(fb.id), ['SENT', 'SENT']);
    assert.equal(graph.calls('POST', FB_SEND).length, 2);
  });

  test('第一則 EXPIRED 後會再嘗試', async () => {
    const { fb } = await setup();
    okFb();
    const u = uid('U');
    await comment(fb, u, '+1', Math.floor(Date.now() / 1000) - 8 * 86400);
    await comment(fb, u);
    await drainJobs();
    assert.deepEqual(await statuses(fb.id), ['EXPIRED', 'SENT']);
  });
});
