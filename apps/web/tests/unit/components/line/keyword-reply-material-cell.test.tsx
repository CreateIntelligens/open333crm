// @vitest-environment jsdom
/**
 * 關鍵字回覆列表的「回覆素材」欄（PR #364 第二輪審查；change add-fb-ig-keyword-coupon）：素材與規則渠道不符、已刪除或已停用時，
 * 列表直接看得出原因並引導到自動化規則編輯，不能等存檔才發現。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { KeywordReplyMaterialCell } from '#src/components/line/keyword-reply/KeywordReplyMaterialCell.js';

afterEach(cleanup);

const base = { id: 'r-1', materialId: 'm-1' };

test('素材與規則渠道相符：顯示素材名稱與類型', () => {
  render(<KeywordReplyMaterialCell reply={{ ...base, materialIssue: null }} material={{ name: '歡迎訊息', contentType: 'text' }} />);
  assert.ok(screen.getByText('歡迎訊息'));
  assert.ok(screen.queryByRole('link') === null);
});

test('傳送 Facebook 素材的規則不能在這頁存檔：列表標示素材與規則渠道不符，並連到自動化規則編輯', () => {
  render(<KeywordReplyMaterialCell reply={{ ...base, materialIssue: { kind: 'other_channel', channelLabel: 'Facebook', ruleChannelLabel: 'LINE' } }} />);
  assert.ok(screen.getByText('Facebook 素材，與規則渠道不符'));
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

test('素材清單沒有列到：只顯示 id，不寫死 LINE', () => {
  render(<KeywordReplyMaterialCell reply={{ ...base, materialIssue: null }} />);
  assert.ok(screen.getByText(/^素材（id: m-1/));
});
