// @vitest-environment jsdom
/**
 * 收件匣顯示 Instagram 對話（change restore-instagram-channel-spec）：
 * - threads-channel「收件匣以 Instagram 顯示 IG 對話」
 * - core-inbox「無法解析的訊息顯示佔位文字」
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(async (_url: string, _body?: unknown, _config?: unknown) => ({ data: { data: {} } })) } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: () => false }));
const channels = [{ id: 'ch-ig', channelType: 'THREADS' }];
vi.mock('#src/hooks/useChannels.js', () => ({ useChannels: () => ({ channels, isLoading: false }) }));
vi.mock('#src/hooks/useQuickReplyPresets.js', () => ({ useQuickReplyPresets: () => ({ presets: [], isLoading: false }) }));

import { FilterDrawer } from '#src/components/inbox/FilterDrawer.js';
import { ChannelBadge } from '#src/components/shared/ChannelBadge.js';
import { MessageInput } from '#src/components/inbox/MessageInput.js';
import { MessageBubble } from '#src/components/inbox/MessageBubble.js';

afterEach(cleanup);

test('以 Instagram 篩選收件匣：客服看得到 Instagram 渠道時，渠道選項有「Instagram」', () => {
  render(<FilterDrawer open onClose={() => {}} values={{ statuses: [], channels: [], assignee: '' }} onChange={() => {}} />);
  assert.ok(screen.getByText('Instagram'));
  assert.ok(screen.queryByText('THREADS') === null, '不顯示原始值 THREADS');
});

test('渠道標示顯示 Instagram：THREADS 的標示文字是「Instagram」', () => {
  render(<ChannelBadge channel="THREADS" />);
  assert.ok(screen.getByText('Instagram'));
  assert.ok(screen.queryByText('THREADS') === null);
});

test('Instagram 對話傳送圖片：選擇圖片後送到該對話的 /send-image', async () => {
  const { container } = render(<MessageInput onSend={async () => {}} conversationId="conv-ig" channelType="THREADS" />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['png'], 'a.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.equal(api.post.mock.calls[0]![0], '/conversations/conv-ig/send-image');
});

test('無法解析的訊息：content 是沒有 text 的物件時顯示「[不支援的訊息類型]」', () => {
  render(
    <MessageBubble
      message={{ id: 'm1', direction: 'INBOUND', contentType: 'unknown', content: {}, senderType: 'CONTACT', createdAt: '2026-10-15T04:30:00Z' }}
    />,
  );
  assert.ok(screen.getByText('[不支援的訊息類型]'));
  assert.ok(screen.queryByText('[object Object]') === null);
});
