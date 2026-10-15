// @vitest-environment jsdom
/**
 * 收件匣的交回 Bot 按鈕（change add-return-conversation-to-bot，spec core-inbox「客服把對話交回 Bot」）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { ReturnToBotButton } from '#src/components/inbox/ReturnToBotButton.js';

afterEach(cleanup);
// 用區塊主體：beforeEach 回傳的函式會被當成 teardown，mockReset() 回傳 mock 本身，測試結束會被呼叫一次
beforeEach(() => {
  api.post.mockReset();
});

test('收件匣的交回 Bot 按鈕', async () => {
  for (const status of ['AGENT_HANDLED', 'ACTIVE']) {
    api.post.mockResolvedValue({ data: { success: true } });
    const onDone = vi.fn();
    render(<ReturnToBotButton conversationId="c1" status={status} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /交回 Bot/ }));
    await waitFor(() => assert.equal(onDone.mock.calls.length, 1));
    assert.equal(api.post.mock.calls.at(-1)![0], '/conversations/c1/return-to-bot');
    cleanup();
  }
  for (const status of ['BOT_HANDLED', 'CLOSED']) {
    render(<ReturnToBotButton conversationId="c1" status={status} onDone={() => {}} />);
    assert.ok(screen.queryByRole('button', { name: /交回 Bot/ }) === null, `${status} 不顯示`);
    cleanup();
  }
});

test('交回失敗時顯示原因', async () => {
  const rejection = Object.assign(new Error('400'), {
    response: { status: 400, data: { success: false, error: { code: 'BAD_REQUEST', message: '這個渠道的機器人已關閉，無法交回 Bot' } } },
  });
  api.post.mockImplementation(async () => {
    throw rejection;
  });
  render(<ReturnToBotButton conversationId="c1" status="AGENT_HANDLED" onDone={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /交回 Bot/ }));
  await screen.findByText('這個渠道的機器人已關閉，無法交回 Bot');
});

test('切換對話時不殘留上一筆的錯誤', async () => {
  // ChatWindow 切換對話時元件不會重建，錯誤訊息要跟著對話走
  api.post.mockImplementation(async () => {
    throw Object.assign(new Error('400'), { response: { status: 400, data: { error: { message: '對話狀態已變更，請重新整理後再試' } } } });
  });
  const { rerender } = render(<ReturnToBotButton conversationId="c1" status="AGENT_HANDLED" onDone={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /交回 Bot/ }));
  await screen.findByText('對話狀態已變更，請重新整理後再試');
  rerender(<ReturnToBotButton conversationId="c2" status="AGENT_HANDLED" onDone={() => {}} />);
  assert.ok(screen.queryByText('對話狀態已變更，請重新整理後再試') === null);
  rerender(<ReturnToBotButton conversationId="c1" status="AGENT_HANDLED" onDone={() => {}} />);
  assert.ok(screen.queryByText('對話狀態已變更，請重新整理後再試') === null, '切回原對話也不顯示舊錯誤');
});
