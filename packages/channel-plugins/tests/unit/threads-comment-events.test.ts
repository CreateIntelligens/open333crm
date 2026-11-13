/**
 * IG 外掛（Instagram Login，threadsPlugin）解析貼文留言（change add-comment-keyword-private-reply，tasks 1.3）。
 * spec threads-channel「Instagram Comment Parsing」。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { threadsPlugin } from '#src/threads.js';
import {
  IG_ACCOUNT_ID,
  igComments,
  igCommentsAd,
  igCommentsReply,
  igCommentsSelf,
  igCommentsSelfScoped,
  igLiveComments,
  IG_COMMENT_ID,
  IG_MEDIA_ID,
} from '../fixtures/meta-comments/ig-comments.js';

/** 擴充不存在時以斷言失敗（不是 TypeError） */
const igC = () => {
  assert.ok(threadsPlugin.extensions?.comments, 'IG 外掛要有 extensions.comments');
  return threadsPlugin.extensions.comments;
};


const parse = (payload: unknown) => {
  const ext = threadsPlugin.extensions?.comments;
  assert.ok(ext, 'IG 外掛要有 extensions.comments');
  return ext.parseCommentEvents(Buffer.from(JSON.stringify(payload)));
};

test('一般貼文留言', () => {
  const events = parse(igComments);
  assert.equal(events.length, 1);
  const e = events[0]!;
  assert.equal(e.kind, 'add');
  assert.equal(e.accountId, IG_ACCOUNT_ID);
  assert.equal(e.commentId, IG_COMMENT_ID);
  assert.equal(e.postId, IG_MEDIA_ID);
  assert.equal(e.commenterId, 'IGSID-1');
  assert.equal(e.commenterUsername, 'amy');
  assert.equal(e.text, '+1');
  assert.equal(e.createdAtSource, 'notification');
  assert.equal(e.createdAt.getTime(), 1731470000000, '以 entry.time 當留言時間');
  assert.equal(e.adId, undefined);
});

test('一般貼文留言：spec 範例的 ID', () => {
  const events = parse({
    object: 'instagram',
    entry: [{
      id: IG_ACCOUNT_ID,
      time: 1731470000000,
      changes: [{ field: 'comments', value: { id: 'IC1', text: '+1', from: { id: 'IGSID-1', username: 'amy' }, media: { id: 'M1' } } }],
    }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.commentId, 'IC1');
  assert.equal(events[0]!.postId, 'M1');
  assert.equal(events[0]!.commenterId, 'IGSID-1');
  assert.equal(events[0]!.commenterUsername, 'amy');
  assert.equal(events[0]!.createdAtSource, 'notification');
});

test('自己帳號的留言', () => {
  assert.deepEqual(parse(igCommentsSelf), [], 'from.id 等於 entry.id');
  assert.deepEqual(parse(igCommentsSelfScoped), [], 'from 帶 self_ig_scoped_id');
});

test('廣告貼文留言', () => {
  const events = parse(igCommentsAd);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.adId, 'AD1');
});

test('直播留言', () => {
  assert.deepEqual(parse(igLiveComments), []);
});

test('對另一則留言的回覆帶 parentId（M6 待實測能否私訊）', () => {
  const events = parse(igCommentsReply);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.parentId, IG_COMMENT_ID);
});

test('非 instagram 物件、壞掉的 JSON 不丟錯，回空陣列', () => {
  assert.deepEqual(parse({ object: 'page', entry: [] }), []);
  assert.deepEqual(igC().parseCommentEvents(Buffer.from('{')), []);
});

test('留言事件不會被當成私訊：parseWebhook 不回留言', async () => {
  const messages = await threadsPlugin.parseWebhook(Buffer.from(JSON.stringify(igComments)), {});
  assert.deepEqual(messages, []);
});
