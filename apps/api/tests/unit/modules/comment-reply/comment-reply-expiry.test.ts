/**
 * 7 天期限含 10 分鐘安全邊際（change add-comment-keyword-private-reply design D14；
 * comment-private-reply「超過 7 天的留言不送出」；QA EX-01～04、06）。
 *
 * now 由呼叫端注入；邊際值以常數斷言（EX-02），改邊際時這個測試會提醒。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  COMMENT_REPLY_WINDOW_MS,
  COMMENT_REPLY_WINDOW_SAFETY_MARGIN_MS,
  isCommentReplyWindowExpired,
} from '#src/modules/comment-reply/comment-reply-expiry.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = new Date('2026-11-13T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

test('期限與安全邊際的常數：7 天、10 分鐘', () => {
  assert.equal(COMMENT_REPLY_WINDOW_MS, 7 * DAY);
  assert.equal(COMMENT_REPLY_WINDOW_SAFETY_MARGIN_MS, 10 * MIN);
});

test('7 天前的留言：7 天又 1 分鐘前已過期', () => {
  assert.equal(isCommentReplyWindowExpired(ago(7 * DAY + MIN), now), true);
});

test('安全邊際內：6 天 23 小時 55 分前已過期', () => {
  assert.equal(isCommentReplyWindowExpired(ago(6 * DAY + 23 * HOUR + 55 * MIN), now), true);
});

test('邊界：剛好 7 天減 10 分鐘過期，少 1 毫秒未過期', () => {
  const edge = COMMENT_REPLY_WINDOW_MS - COMMENT_REPLY_WINDOW_SAFETY_MARGIN_MS;
  assert.equal(isCommentReplyWindowExpired(ago(edge), now), true);
  assert.equal(isCommentReplyWindowExpired(ago(edge - 1), now), false);
});

test('6 天前的留言：未過期，送出私訊', () => {
  assert.equal(isCommentReplyWindowExpired(ago(6 * DAY), now), false);
});

test('IG 以通知時間判斷：時間來源不影響判斷，只看傳入的時間', () => {
  // IG 事件沒有留言時間，外掛以 entry.time 填 createdAt（createdAtSource='notification'）
  const notifiedAt = ago(2 * DAY);
  assert.equal(isCommentReplyWindowExpired(notifiedAt, now), false);
});

test('排隊到過期：收件時未過期，限流排隊到執行時已滿 7 天減 10 分鐘', () => {
  const commentAt = ago(6 * DAY + 23 * HOUR);
  assert.equal(isCommentReplyWindowExpired(commentAt, now), false);
  const executedAt = new Date(now.getTime() + 51 * MIN);
  assert.equal(isCommentReplyWindowExpired(commentAt, executedAt), true);
});
