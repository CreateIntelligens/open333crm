/**
 * 留言規則比對（change add-comment-keyword-private-reply：comment-reply-rules「關鍵字比對方式」
 * 「規則的優先順序」「刪除規則為軟刪除」；QA MT-06、07、10、12～14）。
 *
 * matchCommentRule() 是純函式：收件與試算（POST /rules/test）呼叫同一支，依 priority 套用第一條命中的啟用規則。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { matchCommentRule, type MatchableCommentRule } from '#src/modules/comment-reply/comment-reply-match.js';

const CH_A = 'channel-a';
const CH_B = 'channel-b';

function rule(id: string, overrides: Partial<MatchableCommentRule> = {}): MatchableCommentRule {
  return {
    id,
    channelId: CH_A,
    keywords: ['+1'],
    matchMode: 'any',
    postScope: 'all',
    postIds: [],
    priority: 0,
    isActive: true,
    deletedAt: null,
    ...overrides,
  };
}

test('非指定貼文的留言：規則只指定 P1，P2 的留言不命中、P1 的留言命中', () => {
  const rules = [rule('r1', { postScope: 'selected', postIds: ['page_P1'] })];
  assert.equal(matchCommentRule(rules, { channelId: CH_A, postId: 'page_P2', text: '+1' }), null);
  const hit = matchCommentRule(rules, { channelId: CH_A, postId: 'page_P1', text: '+1' });
  assert.equal(hit?.rule.id, 'r1');
  assert.deepEqual(hit?.matchedKeywords, ['+1']);
});

test('兩條規則都命中：只套用排第一（priority 小）的規則', () => {
  const rules = [rule('r2', { priority: 1 }), rule('r1', { priority: 0 })];
  const hit = matchCommentRule(rules, { channelId: CH_A, postId: 'page_P1', text: '我要 +1' });
  assert.equal(hit?.rule.id, 'r1');
});

test('排第一的規則停用時，套用第二條命中的規則', () => {
  const rules = [rule('r1', { priority: 0, isActive: false }), rule('r2', { priority: 1 })];
  assert.equal(matchCommentRule(rules, { channelId: CH_A, postId: 'p', text: '+1' })?.rule.id, 'r2');
});

test('停用與已刪除的規則不命中', () => {
  assert.equal(matchCommentRule([rule('r1', { isActive: false })], { channelId: CH_A, postId: 'p', text: '+1' }), null);
  assert.equal(
    matchCommentRule([rule('r1', { deletedAt: new Date('2026-11-01T00:00:00Z') })], { channelId: CH_A, postId: 'p', text: '+1' }),
    null,
  );
});

test('別的渠道的規則不命中', () => {
  assert.equal(matchCommentRule([rule('r1', { channelId: CH_A })], { channelId: CH_B, postId: 'p', text: '+1' }), null);
});

test('規則建立後才發布的貼文命中：全部貼文的規則不看貼文是誰、何時發布', () => {
  const hit = matchCommentRule([rule('r1', { postScope: 'all', postIds: [] })], {
    channelId: CH_A,
    postId: 'page_P9_published_after_rule',
    text: '+1',
  });
  assert.equal(hit?.rule.id, 'r1');
});

test('留言比對用 NFKC：全形「＋１」命中規則關鍵字 +1；沒有文字不命中', () => {
  assert.equal(matchCommentRule([rule('r1')], { channelId: CH_A, postId: 'p', text: '＋１' })?.rule.id, 'r1');
  assert.equal(matchCommentRule([rule('r1')], { channelId: CH_A, postId: 'p', text: '' }), null);
  assert.equal(matchCommentRule([rule('r1')], { channelId: CH_A, postId: 'p', text: null }), null);
});

test('沒命中的規則不擋後面的規則；同 priority 依輸入順序', () => {
  const rules = [rule('r1', { keywords: ['領券'] }), rule('r2', { keywords: ['+1'] }), rule('r3', { keywords: ['+1'] })];
  assert.equal(matchCommentRule(rules, { channelId: CH_A, postId: 'p', text: '+1' })?.rule.id, 'r2');
});
