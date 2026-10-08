// @vitest-environment jsdom
/**
 * 聯絡人頁「對話紀錄」分頁（change add-email-identity-merge，spec cross-channel-conversation-view）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { ContactConversationHistory } from '#src/components/contact/ContactConversationHistory.js';

const m = (id: string, channelType: string, direction: string, text: string, minute: number) => ({
  id,
  channelType,
  channelName: `${channelType} 渠道`,
  direction,
  senderType: direction === 'INBOUND' ? 'CONTACT' : 'AGENT',
  contentType: 'text',
  content: { text },
  createdAt: `2026-10-05T03:${String(minute).padStart(2, '0')}:00.000Z`,
});

beforeEach(() => {
  api.get.mockReset();
});

test('合併後的時間軸', async () => {
  api.get.mockResolvedValue({
    data: {
      data: {
        messages: [m('1', 'LINE', 'INBOUND', 'LINE 第一則', 1), m('2', 'FB', 'INBOUND', 'FB 第一則', 2), m('3', 'LINE', 'OUTBOUND', 'LINE 客服回覆', 3)],
        hiddenConversationCount: 0,
        nextCursor: null,
      },
    },
  });
  render(<ContactConversationHistory contactId="c1" />);
  await screen.findByText('LINE 客服回覆');
  const rows = screen.getAllByTestId('history-message');
  assert.equal(rows.length, 3);
  assert.ok(rows[0].textContent?.includes('LINE 第一則') && rows[0].textContent?.includes('LINE'));
  assert.ok(rows[1].textContent?.includes('FB 第一則') && rows[1].textContent?.includes('FB'));
  assert.ok(rows[2].textContent?.includes('客服'), '標示方向');
  assert.ok(screen.queryByRole('button', { name: '載入更早的訊息' }) === null, '沒有更早的訊息時不顯示按鈕');
});

test('載入更早的訊息', async () => {
  api.get
    .mockResolvedValueOnce({ data: { data: { messages: [m('2', 'FB', 'INBOUND', '較新的', 2)], hiddenConversationCount: 0, nextCursor: 'cur1' } } })
    .mockResolvedValueOnce({ data: { data: { messages: [m('1', 'LINE', 'INBOUND', '較舊的', 1)], hiddenConversationCount: 0, nextCursor: null } } });
  render(<ContactConversationHistory contactId="c1" />);
  fireEvent.click(await screen.findByRole('button', { name: '載入更早的訊息' }));
  await screen.findByText('較舊的');
  assert.equal(api.get.mock.calls[1][0], '/contacts/c1/messages?limit=50&before=cur1');
  const rows = screen.getAllByTestId('history-message').map((r) => r.textContent ?? '');
  assert.equal(rows.length, 2, '不重複已顯示的訊息');
  assert.ok(rows[0].includes('較舊的') && rows[1].includes('較新的'));
});

test('分店帳號看到看不到的數量', async () => {
  api.get.mockResolvedValue({ data: { data: { messages: [m('1', 'LINE', 'INBOUND', '只有 LINE', 1)], hiddenConversationCount: 1, nextCursor: null } } });
  render(<ContactConversationHistory contactId="c1" />);
  await screen.findByText('另有 1 段其他渠道的對話，你沒有權限查看');
});

test('載入失敗時顯示原因', async () => {
  api.get.mockRejectedValue(new Error('network'));
  render(<ContactConversationHistory contactId="c1" />);
  await screen.findByText(/對話紀錄載入失敗/);
});
