/**
 * 留言自動私訊的狀態、原因、警示代碼單一來源（change add-comment-keyword-private-reply design D8）。
 * 前端顯示文字與後端列舉同源：每個代碼都要有中文標籤，未知代碼顯示通用文字。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  COMMENT_REPLY_STATUSES,
  COMMENT_REPLY_STATUS_LABELS,
  COMMENT_REPLY_REASON_CODES,
  COMMENT_REPLY_REASON_LABELS,
  COMMENT_REPLY_REASONS_BY_STATUS,
  COMMENT_PUBLIC_REPLY_STATUSES,
  COMMENT_PUBLIC_REPLY_STATUS_LABELS,
  COMMENT_PUBLIC_REPLY_REASON_CODES,
  COMMENT_PUBLIC_REPLY_REASON_LABELS,
  COMMENT_REPLY_WARNING_CODES,
  COMMENT_REPLY_WARNING_LABELS,
  COMMENT_REPLY_UNKNOWN_REASON_LABEL,
  commentReplyReasonLabel,
  isCommentReplyRetryable,
} from '#src/comment-reply.js';

const HAN = /\p{Script=Han}/u;

function assertAllLabelled(codes: readonly string[], labels: Record<string, string>, kind: string) {
  assert.ok(codes.length > 0, `${kind} 不可為空`);
  for (const code of codes) {
    const label = labels[code];
    assert.equal(typeof label, 'string', `${kind} ${code} 沒有標籤`);
    assert.ok(HAN.test(label), `${kind} ${code} 的標籤不是中文：${label}`);
  }
  // 標籤表沒有多出列舉以外的代碼
  assert.deepEqual(Object.keys(labels).sort(), [...codes].sort(), `${kind} 標籤表與列舉不一致`);
}

test('每個狀態、原因、警示代碼都有中文標籤', () => {
  assertAllLabelled(COMMENT_REPLY_STATUSES, COMMENT_REPLY_STATUS_LABELS, '狀態');
  assertAllLabelled(COMMENT_REPLY_REASON_CODES, COMMENT_REPLY_REASON_LABELS, '原因');
  assertAllLabelled(COMMENT_PUBLIC_REPLY_STATUSES, COMMENT_PUBLIC_REPLY_STATUS_LABELS, '公開回覆狀態');
  assertAllLabelled(COMMENT_PUBLIC_REPLY_REASON_CODES, COMMENT_PUBLIC_REPLY_REASON_LABELS, '公開回覆原因');
  assertAllLabelled(COMMENT_REPLY_WARNING_CODES, COMMENT_REPLY_WARNING_LABELS, '警示');
});

test('狀態與原因代碼依 design D8 的對照表', () => {
  assert.deepEqual([...COMMENT_REPLY_STATUSES], ['PENDING', 'SENDING', 'SENT', 'FAILED', 'EXPIRED', 'SKIPPED', 'SKIPPED_DUPLICATE']);
  assert.deepEqual([...COMMENT_REPLY_REASONS_BY_STATUS.PENDING], ['RATE_LIMIT_QUEUED']);
  assert.deepEqual([...COMMENT_REPLY_REASONS_BY_STATUS.SENT], ['SENT_UNCONFIRMED']);
  assert.deepEqual([...COMMENT_REPLY_REASONS_BY_STATUS.EXPIRED], ['WINDOW_EXPIRED', 'EXPIRED_BY_META']);
  assert.deepEqual([...COMMENT_REPLY_REASONS_BY_STATUS.SKIPPED_DUPLICATE], []);
  assert.ok(COMMENT_REPLY_REASONS_BY_STATUS.SKIPPED.includes('PLAN_QUOTA_EXCEEDED'));
  assert.ok(COMMENT_REPLY_REASONS_BY_STATUS.FAILED.includes('APP_NOT_APPROVED'));
  // 每個原因只屬於一個狀態，且都在原因列舉內
  const all = Object.values(COMMENT_REPLY_REASONS_BY_STATUS).flat();
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual([...all].sort(), [...COMMENT_REPLY_REASON_CODES].sort());
  assert.ok(COMMENT_REPLY_WARNING_CODES.includes('OVER_PLAN_LIMIT'));
});

test('未知原因代碼顯示通用失敗文字；null 沒有文字', () => {
  assert.equal(commentReplyReasonLabel('SOMETHING_NEW'), COMMENT_REPLY_UNKNOWN_REASON_LABEL);
  assert.equal(commentReplyReasonLabel(null), null);
  assert.equal(commentReplyReasonLabel('USER_UNAVAILABLE'), COMMENT_REPLY_REASON_LABELS.USER_UNAVAILABLE);
});

test('可否重試：可重試的 FAILED 與 PLAN_QUOTA_EXCEEDED 的 SKIPPED', () => {
  assert.equal(isCommentReplyRetryable('FAILED', 'TOKEN_EXPIRED'), true);
  assert.equal(isCommentReplyRetryable('FAILED', 'NETWORK'), true);
  assert.equal(isCommentReplyRetryable('FAILED', 'RATE_LIMITED'), true);
  assert.equal(isCommentReplyRetryable('FAILED', 'UNKNOWN'), true);
  assert.equal(isCommentReplyRetryable('SKIPPED', 'PLAN_QUOTA_EXCEEDED'), true);
  assert.equal(isCommentReplyRetryable('FAILED', 'USER_UNAVAILABLE'), false);
  assert.equal(isCommentReplyRetryable('FAILED', 'APP_NOT_APPROVED'), false);
  assert.equal(isCommentReplyRetryable('FAILED', 'ALREADY_REPLIED'), false);
  assert.equal(isCommentReplyRetryable('SKIPPED', 'RULE_INACTIVE'), false);
  assert.equal(isCommentReplyRetryable('SENT', null), false);
  assert.equal(isCommentReplyRetryable('EXPIRED', 'WINDOW_EXPIRED'), false);
});
