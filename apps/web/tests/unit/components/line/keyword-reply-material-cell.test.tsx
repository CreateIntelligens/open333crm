// @vitest-environment jsdom
/**
 * LINE 關鍵字回覆列表的「回覆素材」欄（PR #364 第二輪審查）：傳送的素材不是 LINE 素材、已刪除或已停用時，
 * 列表直接看得出原因並引導到自動化規則編輯，不能等存檔才發現。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { KeywordReplyMaterialCell } from '#src/components/line/keyword-reply/KeywordReplyMaterialCell.js';

afterEach(cleanup);

const base = { id: 'r-1', materialId: 'm-1' };

test('LINE 素材：顯示素材名稱與類型', () => {
  render(<KeywordReplyMaterialCell reply={{ ...base, materialIssue: null }} material={{ name: '歡迎訊息', contentType: 'text' }} />);
  assert.ok(screen.getByText('歡迎訊息'));
  assert.ok(screen.queryByRole('link') === null);
});

test('傳送 Facebook 素材：標示原因並連到自動化規則編輯', () => {
  render(<KeywordReplyMaterialCell reply={{ ...base, materialIssue: { kind: 'other_channel', channelLabel: 'Facebook' } }} />);
  assert.ok(screen.getByText('Facebook 素材，這頁不能編輯'));
  assert.equal(screen.getByRole('link', { name: '到自動化規則編輯' }).getAttribute('href'), '/dashboard/automation/r-1');
});

test('素材已刪除：標示原因', () => {
  render(<KeywordReplyMaterialCell reply={{ ...base, materialIssue: { kind: 'missing' } }} />);
  assert.ok(screen.getByText(/素材已刪除/));
});

test('素材已停用：標示原因', () => {
  render(<KeywordReplyMaterialCell reply={{ ...base, materialIssue: { kind: 'inactive' } }} />);
  assert.ok(screen.getByText(/素材已停用/));
});

test('無法確認素材：標示原因', () => {
  render(<KeywordReplyMaterialCell reply={{ ...base, materialIssue: { kind: 'unknown' } }} />);
  assert.ok(screen.getByText(/無法確認素材/));
});
