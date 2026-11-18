/**
 * 留言自動私訊的留言者對應跟著聯絡人合併與解除合併（change add-comment-keyword-private-reply，design D27、tasks 8.3）：
 * contact-management「Comment private reply joins the contact created from a comment」「Comment author moved back on reversal」、
 * comment-reply-contact-linking「合併後顯示存活者」「解除合併後顯示原本的人」。
 *
 * 合併引擎與解除合併走 app_tenant 連線（RLS）；資料準備用 owner 連線。觸發紀錄沒有自己的 contactId，
 * 「紀錄顯示哪位聯絡人」以紀錄 → 留言者對應 → contactId 讀出，與紀錄詳情的查法相同。
 * 每次執行自建一個租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { inTenant } from '#src/lib/tenant-ctx.js';
import { mergeContacts, revertMerge } from '#src/modules/contact/contact-merge.service.js';
import { createCommentReplyFixtures } from '../../../support/comment-reply-fixtures.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const fx = createCommentReplyFixtures(owner);

const tenant = await fx.tenant();
const T = tenant.id;
const fb = await fx.fbChannel(T);
const rule = await fx.rule(T, fb.id);
let seq = 0;

afterAll(async () => {
  await fx.cleanup(async (ids) => {
    await owner.contactMergeLog.deleteMany({ where: { tenantId: { in: ids } } });
    await owner.contact.deleteMany({ where: { tenantId: { in: ids } } });
  });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

/** 由留言建立、沒有渠道身分的聯絡人 A，帶留言者對應與 n 筆觸發紀錄 */
async function commentContact(logs = 1) {
  seq += 1;
  const contact = await owner.contact.create({ data: { tenantId: T, displayName: `留言者${seq}` } });
  const author = await fx.author(T, fb.id, contact.id, { createdContact: true });
  const rows = [];
  for (let i = 0; i < logs; i++) rows.push(await fx.log(rule, author));
  return { contact, author, logs: rows };
}

/** 在同一個 FB 渠道已有私訊身分的聯絡人 B */
async function messengerContact() {
  seq += 1;
  const contact = await owner.contact.create({ data: { tenantId: T, displayName: `私訊客人${seq}` } });
  const psid = `PSID_B_${seq}_${Date.now()}`;
  await owner.channelIdentity.create({ data: { contactId: contact.id, channelId: fb.id, channelType: 'FB', uid: psid } });
  return { contact, psid };
}

const merge = (survivorId: string, mergedId: string, source: 'COMMENT_REPLY' | 'MANUAL') =>
  inTenant(tenantDb, T, (scope) => mergeContacts(scope, { survivorId, mergedId, source }));
const revert = (mergeLogId: string) => inTenant(tenantDb, T, (scope) => revertMerge(scope, { mergeLogId, revertedBy: 'test' }));

/** 紀錄詳情顯示的聯絡人：紀錄 → 留言者對應 → contactId */
async function shownContacts(logIds: string[]) {
  const rows = await owner.commentReplyLog.findMany({
    where: { id: { in: logIds } },
    select: { commentAuthor: { select: { contactId: true } } },
  });
  return [...new Set(rows.map((r) => r.commentAuthor.contactId))];
}

test('Comment private reply joins the contact created from a comment', async () => {
  const a = await commentContact();
  const b = await messengerContact();

  const result = await merge(b.contact.id, a.contact.id, 'COMMENT_REPLY');

  const author = await owner.commentAuthor.findUniqueOrThrow({ where: { id: a.author.id } });
  assert.equal(author.contactId, b.contact.id, "A 的留言者對應改指 B");
  const archived = await owner.contact.findUniqueOrThrow({ where: { id: a.contact.id } });
  assert.equal(archived.isArchived, true);
  assert.equal(archived.mergedIntoId, b.contact.id);
  const log = await owner.contactMergeLog.findUniqueOrThrow({ where: { id: result.mergeLogId } });
  assert.equal(log.source, 'COMMENT_REPLY');
  assert.deepEqual((log.movedRecords as { commentAuthor?: string[] }).commentAuthor, [a.author.id], '合併紀錄記下搬過去的留言者對應');
});

test('Comment author moved back on reversal', async () => {
  const a = await commentContact(2);
  const b = await messengerContact();
  const { mergeLogId } = await merge(b.contact.id, a.contact.id, 'COMMENT_REPLY');
  assert.deepEqual(await shownContacts(a.logs.map((l) => l.id)), [b.contact.id], '合併後先指向 B');

  await revert(mergeLogId);

  const author = await owner.commentAuthor.findUniqueOrThrow({ where: { id: a.author.id } });
  assert.equal(author.contactId, a.contact.id, '留言者對應改回 A');
  assert.deepEqual(await shownContacts(a.logs.map((l) => l.id)), [a.contact.id], '那位留言者的紀錄顯示 A');
});

test('合併後顯示存活者', async () => {
  const a = await commentContact(2);
  const b = await messengerContact();

  await merge(b.contact.id, a.contact.id, 'MANUAL');

  assert.deepEqual(await shownContacts(a.logs.map((l) => l.id)), [b.contact.id]);
});

test('解除合併後顯示原本的人', async () => {
  const a = await commentContact(2);
  const b = await messengerContact();
  const { mergeLogId } = await merge(b.contact.id, a.contact.id, 'MANUAL');
  assert.deepEqual(await shownContacts(a.logs.map((l) => l.id)), [b.contact.id]);

  await revert(mergeLogId);

  assert.deepEqual(await shownContacts(a.logs.map((l) => l.id)), [a.contact.id]);
});
