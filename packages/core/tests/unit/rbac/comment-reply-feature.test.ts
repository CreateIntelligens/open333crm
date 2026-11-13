/**
 * 留言自動私訊的方案 feature 與權限點（change add-comment-keyword-private-reply，design D20、D23）。
 * - feature `comment_reply` 由平台在方案勾選，不是核心功能（不恆開）
 * - `comment_reply.view`、`comment_reply.manage` 歸屬這個 feature；manage 依賴 view、隱含 channel.view，
 *   不隱含 marketing.view（素材下拉改走本模組的 material-options）
 * - 預設角色（Open Questions 2）：admin、supervisor 有 view＋manage，agent 只有 view
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  FEATURES,
  PERMISSION_BY_CODE,
  permsForFeatures,
  resolveImplied,
  DEFAULT_ROLE_PERMISSIONS,
} from '#src/rbac/index.js';

test('feature comment_reply 存在且不是核心功能', () => {
  const f = FEATURES.find((x) => x.slug === 'comment_reply');
  assert.ok(f, 'FEATURES 要有 comment_reply');
  assert.equal(f.label, '留言自動私訊');
  assert.equal(!!f.core, false);
});

test('方案只勾 comment_reply 時天花板恰好是兩個權限點', () => {
  assert.deepEqual([...permsForFeatures(['comment_reply'])].sort(), ['comment_reply.manage', 'comment_reply.view']);
});

test('comment_reply.manage 依賴 view、隱含 channel.view，不隱含 marketing.view', () => {
  const manage = PERMISSION_BY_CODE.get('comment_reply.manage');
  assert.ok(manage);
  assert.deepEqual(manage.dependsOn, ['comment_reply.view']);
  assert.deepEqual(manage.implies, ['channel.view']);
  const implied = resolveImplied(['comment_reply.manage']);
  assert.equal(implied.has('channel.view'), true);
  assert.equal(implied.has('marketing.view'), false);
  assert.equal(PERMISSION_BY_CODE.get('comment_reply.view')?.dependsOn, undefined);
});

test('預設角色：admin、supervisor 有 view＋manage，agent 只有 view', () => {
  for (const slug of ['admin', 'supervisor'] as const) {
    assert.ok(DEFAULT_ROLE_PERMISSIONS[slug].includes('comment_reply.view'), `${slug} 要有 view`);
    assert.ok(DEFAULT_ROLE_PERMISSIONS[slug].includes('comment_reply.manage'), `${slug} 要有 manage`);
  }
  assert.ok(DEFAULT_ROLE_PERMISSIONS.agent.includes('comment_reply.view'));
  assert.equal(DEFAULT_ROLE_PERMISSIONS.agent.includes('comment_reply.manage'), false);
});
