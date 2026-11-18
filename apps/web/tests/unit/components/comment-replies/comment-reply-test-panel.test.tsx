// @vitest-environment jsdom
/**
 * 規則試算「試試看」（tasks 11.3；spec comment-reply-rules「規則試算不送出」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FB_ID, ok } from './fixtures';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { CommentReplyTestPanel } from '#src/components/comment-replies/CommentReplyTestPanel.js';

const channels = [{ channelId: FB_ID, channelType: 'FB', displayName: '品牌粉專' }];

beforeEach(() => vi.clearAllMocks());

async function runTest(text: string, postId = '') {
  fireEvent.click(screen.getByRole('button', { name: '試試看' }));
  fireEvent.change(screen.getByLabelText('留言文字'), { target: { value: text } });
  if (postId) fireEvent.change(screen.getByLabelText('貼文 ID（選填）'), { target: { value: postId } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '試算' }));
  });
}

test('命中時顯示會套用的規則與命中的關鍵字，只呼叫 /rules/test', async () => {
  api.post.mockImplementation(() => ok({ matched: true, ruleId: 'r1', ruleName: '雙 11 留 +1', matchedKeywords: ['+1'] }));
  render(<CommentReplyTestPanel channels={channels} />);
  await runTest('我要 +1', '999_1');

  await screen.findByText('會套用：規則「雙 11 留 +1」');
  screen.getByText('命中的關鍵字：+1');
  assert.equal(api.post.mock.calls.length, 1);
  assert.equal(api.post.mock.calls[0][0], '/comment-replies/rules/test');
  assert.deepEqual(api.post.mock.calls[0][1], { channelId: FB_ID, postId: '999_1', text: '我要 +1' });
  assert.equal(api.get.mock.calls.length + api.patch.mock.calls.length + api.put.mock.calls.length, 0);
});

test('未命中時說明不會觸發', async () => {
  api.post.mockImplementation(() => ok({ matched: false }));
  render(<CommentReplyTestPanel channels={channels} />);
  await runTest('今天天氣很好');
  await screen.findByText('不會觸發任何啟用中的規則');
  assert.deepEqual(api.post.mock.calls[0][1], { channelId: FB_ID, text: '今天天氣很好' });
});

test('沒有輸入留言文字時不送出', async () => {
  render(<CommentReplyTestPanel channels={channels} />);
  await runTest('');
  screen.getByText('請輸入一段留言文字');
  assert.equal(api.post.mock.calls.length, 0);
});
