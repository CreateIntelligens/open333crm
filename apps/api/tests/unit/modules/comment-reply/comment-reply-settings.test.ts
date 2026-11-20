/**
 * 渠道 settings.commentReply 的解析與寫入（#547 第 1 項：寫入只有一份，各入口對 subscribedAt 的意思一致）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { commentReplySettingsOf, nextCommentReplySettings } from '#src/modules/comment-reply/comment-reply-settings.js';

const NOW = new Date('2026-11-19T08:00:00.000Z');
const FIELDS = ['messages', 'feed'];

test('第一次開啟：寫入 subscribedAt 與 subscription', () => {
  assert.deepEqual(nextCommentReplySettings(null, true, FIELDS, NOW), {
    receiving: true,
    subscribedAt: NOW.toISOString(),
    subscription: { status: 'ok', fields: FIELDS, checkedAt: NOW.toISOString() },
  });
});

test('已有 subscribedAt 時再開啟：保留第一次的時間，只更新 subscription', () => {
  const first = '2026-10-01T00:00:00.000Z';
  const next = nextCommentReplySettings({ commentReply: { receiving: false, subscribedAt: first } }, true, FIELDS, NOW);
  assert.equal(next.subscribedAt, first);
  assert.deepEqual(next.subscription, { status: 'ok', fields: FIELDS, checkedAt: NOW.toISOString() });
});

test('關閉：receiving 為 false、subscription 為 disabled，從未開啟過時不寫 subscribedAt', () => {
  const next = nextCommentReplySettings({}, false, ['messages'], NOW);
  assert.equal(next.receiving, false);
  assert.equal('subscribedAt' in next, false);
  assert.deepEqual(next.subscription, { status: 'disabled', fields: ['messages'], checkedAt: NOW.toISOString() });
});

test('保留本檔不認得的子鍵（例如 lastCommentEventAt）', () => {
  const next = nextCommentReplySettings({ commentReply: { lastCommentEventAt: '2026-11-01T00:00:00.000Z', extra: 1 } }, true, FIELDS, NOW);
  assert.equal(next.lastCommentEventAt, '2026-11-01T00:00:00.000Z');
  assert.equal(next.extra, 1);
});

test('解析：形狀不對的子鍵回預設值', () => {
  const cr = commentReplySettingsOf({ commentReply: { receiving: 'yes', subscribedAt: 5, subscription: { status: 1, fields: 'x' }, lastCommentEventAt: null } });
  assert.equal(cr.receiving, false);
  assert.equal(cr.subscribedAt, null);
  assert.deepEqual(cr.subscription, { status: null, fields: [], checkedAt: null });
  assert.equal(cr.lastCommentEventAt, null);
  assert.deepEqual(commentReplySettingsOf(null).raw, {});
});
