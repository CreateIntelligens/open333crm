// @vitest-environment jsdom
/**
 * 收件匣「其他渠道的對話」（change add-email-identity-merge，spec cross-channel-conversation-view）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { OtherChannelConversations } from '#src/components/inbox/OtherChannelConversations.js';

const conv = (id: string, channelType: string, channelName: string, text: string) => ({
  id,
  channelType,
  channel: { id: `ch-${id}`, displayName: channelName, channelType },
  lastMessageAt: '2026-10-05T03:00:00.000Z',
  lastMessage: { content: { text }, contentType: 'text', direction: 'INBOUND' },
});

function mockApi(conversations: unknown[], hiddenCount = 0) {
  api.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/contacts/c1/conversations')) return { data: { data: conversations, meta: { hiddenCount } } };
    if (url.startsWith('/conversations/fb1/messages')) {
      return {
        data: {
          data: [
            { id: 'm2', direction: 'OUTBOUND', contentType: 'text', content: { text: '請先關閉電源' }, createdAt: '2026-10-05T03:01:00.000Z' },
            { id: 'm1', direction: 'INBOUND', contentType: 'text', content: { text: '冷氣漏水怎麼處理' }, createdAt: '2026-10-05T03:00:00.000Z' },
          ],
        },
      };
    }
    throw new Error(`unexpected ${url}`);
  });
}

beforeEach(() => {
  api.get.mockReset();
});

test('歸戶後查看 FB 對話', async () => {
  mockApi([conv('line1', 'LINE', '總店 LINE', '目前這段'), conv('fb1', 'FB', '官方粉專', '冷氣漏水怎麼處理')]);
  render(<OtherChannelConversations contactId="c1" currentConversationId="line1" />);
  await screen.findByText('其他渠道的對話');
  assert.ok(screen.getByText('官方粉專'));
  assert.ok(screen.queryByText('目前這段') === null, '不列出目前這段對話');
  fireEvent.click(screen.getByRole('button', { name: /官方粉專/ }));
  await screen.findByText('請先關閉電源');
  const texts = screen.getAllByTestId('other-channel-message').map((el) => el.textContent ?? '');
  assert.ok(texts[0].includes('冷氣漏水怎麼處理') && texts[1].includes('請先關閉電源'), '由舊到新');
});

test('沒有其他渠道', async () => {
  mockApi([conv('line1', 'LINE', '總店 LINE', '目前這段')]);
  const { container } = render(<OtherChannelConversations contactId="c1" currentConversationId="line1" />);
  await waitFor(() => assert.equal(api.get.mock.calls.length, 1));
  assert.ok(screen.queryByText('其他渠道的對話') === null);
  assert.equal(container.innerHTML, '');
});

test('分店帳號只看到看不到的數量', async () => {
  mockApi([conv('line1', 'LINE', '總店 LINE', '目前這段')], 1);
  render(<OtherChannelConversations contactId="c1" currentConversationId="line1" />);
  await screen.findByText('另有 1 段其他渠道的對話，你沒有權限查看');
});

test('載入失敗時顯示原因', async () => {
  api.get.mockRejectedValue(new Error('network'));
  render(<OtherChannelConversations contactId="c1" currentConversationId="line1" />);
  await screen.findByText(/其他渠道的對話載入失敗/);
});
