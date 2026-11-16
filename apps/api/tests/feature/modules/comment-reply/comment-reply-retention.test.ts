/**
 * 觸發紀錄與每月用量的保存期限（change add-comment-keyword-private-reply tasks 10.4，design D26）。
 * 保存期限排程的 run 函式以 prismaAdmin 找出租戶、逐租戶 inTenant() 刪除。
 */
import {
  adminDb,
  cleanupCommentReplyData,
  clearRateBuckets,
  createRule,
  disconnectAll,
  enableAllCapabilities,
  owner,
  postToPlatform,
  resetHarness,
  resetPlatformSettings,
  setPlatformSetting,
  tenantDb,
} from '#tests/support/comment-reply-harness.js';
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test } from 'vitest';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';
import { fbCommentPayload } from '#tests/support/meta-webhook.js';
import { monthsBefore, runCommentReplyRetention } from '#src/modules/comment-reply/comment-reply-maintenance.flow.js';

const fx = createCommentReplyFixtures(owner);
useFakeMetaGraph();
let seq = 0;
const uid = (p: string) => `${p}${Date.now()}${++seq}`;

beforeEach(async () => {
  resetHarness();
  await enableAllCapabilities();
});

afterAll(async () => {
  await resetPlatformSettings();
  await fx.cleanup(cleanupCommentReplyData);
  await disconnectAll();
});

async function comment(fb: { id: string; externalAccountId: string }) {
  const commentId = uid('c');
  await postToPlatform(fbCommentPayload([{ pageId: fb.externalAccountId, commentId, from: { id: uid('U'), name: 'A' }, createdTime: Math.floor(Date.now() / 1000) }]));
  return owner.commentReplyLog.findFirstOrThrow({ where: { channelId: fb.id, commentId } });
}

test('超過保存天數的紀錄', async () => {
  await setPlatformSetting('logRetentionDays', 30);
  const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
  const fb = await fx.fbChannel(tenant.id);
  await createRule(tenant.id, fb.id, { keywords: ['+1'] });
  await clearRateBuckets([fb.id]);
  const old = await comment(fb);
  const recent = await comment(fb);
  const contact = await owner.contact.create({ data: { tenantId: tenant.id, displayName: 'c' } });
  const conv = await owner.conversation.create({
    data: { tenantId: tenant.id, channelId: fb.id, channelType: 'FB', contactId: contact.id, originCommentReplyLogId: old.id },
  });
  await owner.$executeRaw`UPDATE comment_reply_logs SET "createdAt" = now() - interval '31 days' WHERE id = ${old.id}::uuid`;

  const res = await runCommentReplyRetention({ admin: adminDb, prisma: tenantDb, batchSize: 1 });
  assert.ok(res.deletedLogs >= 1);
  assert.equal(await owner.commentReplyLog.count({ where: { id: old.id } }), 0);
  assert.equal(await owner.commentReplyLog.count({ where: { id: recent.id } }), 1);
  assert.equal((await owner.conversation.findUniqueOrThrow({ where: { id: conv.id } })).originCommentReplyLogId, null);
});

test('每月用量保留 25 個月', async () => {
  const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
  const now = new Date();
  const keep = monthsBefore(now, 24);
  const drop = monthsBefore(now, 25);
  await owner.commentReplyUsage.createMany({
    data: [
      { tenantId: tenant.id, month: keep, sentCount: 1 },
      { tenantId: tenant.id, month: drop, sentCount: 1 },
    ],
  });
  await runCommentReplyRetention({ admin: adminDb, prisma: tenantDb });
  const months = (await owner.commentReplyUsage.findMany({ where: { tenantId: tenant.id } })).map((u) => u.month);
  assert.deepEqual(months, [keep]);
});
