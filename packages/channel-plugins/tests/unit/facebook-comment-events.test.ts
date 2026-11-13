/**
 * FB 外掛解析粉專貼文留言（change add-comment-keyword-private-reply，tasks 1.2）。
 * spec channel-plugins「Facebook plugin parses page feed comments」。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { fbPlugin } from '#src/facebook/index.js';
import {
  FB_PAGE_ID,
  fbCommentValue,
  fbFeedCommentAdd,
  fbFeedCommentEdited,
  fbFeedCommentFromPage,
  fbFeedCommentNoFrom,
  fbFeedCommentRemove,
  fbFeedCommentReply,
  fbFeedLike,
  fbFeedPayload,
  fbFeedPost,
  fbFeedReaction,
  fbFeedShare,
  fbFeedStatus,
  fbMixedMessagingAndFeed,
} from '../fixtures/meta-comments/fb-feed.js';

/** 擴充不存在時以斷言失敗（不是 TypeError） */
const fbC = () => {
  assert.ok(fbPlugin.extensions?.comments, 'FB 外掛要有 extensions.comments');
  return fbPlugin.extensions.comments;
};


const parse = (payload: unknown) => {
  const ext = fbPlugin.extensions?.comments;
  assert.ok(ext, 'FB 外掛要有 extensions.comments');
  return ext.parseCommentEvents(Buffer.from(JSON.stringify(payload)));
};

test('New comment on a post', () => {
  const payload = fbFeedPayload([
    fbCommentValue({ comment_id: 'C1', post_id: 'P_1', parent_id: 'P_1', from: { id: 'U1', name: '王小明' }, message: '我要+1', created_time: 1731470000 }),
  ]);
  const events = parse(payload);
  assert.equal(events.length, 1);
  const e = events[0]!;
  assert.equal(e.kind, 'add');
  assert.equal(e.accountId, FB_PAGE_ID);
  assert.equal(e.commentId, 'C1');
  assert.equal(e.postId, 'P_1');
  assert.equal(e.commenterId, 'U1');
  assert.equal(e.commenterName, '王小明');
  assert.equal(e.text, '我要+1');
  assert.equal(e.createdAt.toISOString(), '2024-11-13T03:53:20.000Z');
  assert.equal(e.createdAtSource, 'comment');
  assert.equal(e.parentId, undefined, 'parent_id 等於 post_id 時不填');
});

test('New comment on a post：fixture 的第一層留言', () => {
  const events = parse(fbFeedCommentAdd);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, 'add');
});

test('Comment by the page itself', () => {
  assert.deepEqual(parse(fbFeedCommentFromPage), []);
});

test('Comment without from', () => {
  assert.deepEqual(parse(fbFeedCommentNoFrom), []);
});

test('Other feed changes', () => {
  for (const [name, payload] of Object.entries({ fbFeedReaction, fbFeedLike, fbFeedPost, fbFeedStatus, fbFeedShare, fbFeedCommentEdited })) {
    assert.deepEqual(parse(payload), [], name);
  }
});

test('Reply to another comment', () => {
  const events = parse(fbFeedCommentReply);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.parentId, String(fbCommentValue().comment_id));
});

test('verb=remove 回傳 kind: remove', () => {
  const events = parse(fbFeedCommentRemove);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, 'remove');
  assert.equal(events[0]!.commentId, String(fbCommentValue().comment_id));
  assert.equal(events[0]!.text, '', '刪除事件沒有留言內容');
});

test('同一個 entry 有私訊與留言時，留言解析只回留言、私訊解析只回私訊', async () => {
  const raw = Buffer.from(JSON.stringify(fbMixedMessagingAndFeed));
  assert.equal(fbC().parseCommentEvents(raw).length, 1);
  const messages = await fbPlugin.parseWebhook(raw, {});
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.contactUid, 'PSID-MIXED');
});

test('非 page 物件、壞掉的 JSON 不丟錯，回空陣列', () => {
  assert.deepEqual(parse({ object: 'instagram', entry: [] }), []);
  assert.deepEqual(fbC().parseCommentEvents(Buffer.from('not json')), []);
});
