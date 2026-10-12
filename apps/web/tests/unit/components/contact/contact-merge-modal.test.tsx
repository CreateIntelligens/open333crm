// @vitest-environment jsdom
/**
 * 合併視窗顯示被拒絕的原因（change enforce-merge-same-channel-guard，spec contact-management
 * 「Merge Rejects Same-Channel Identities」的「Merge window shows the reason」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { ContactMergeModal } from '#src/components/contact/ContactMergeModal.js';

const side = (id: string, displayName: string) => ({
  id,
  displayName,
  channelIdentities: [{ channelType: 'LINE' }],
  tags: [],
  attributes: [],
  conversationsCount: 1,
  casesCount: 0,
});
const preview = {
  primary: side('b', '王小美'),
  secondary: side('a', '小美 LINE'),
  diff: { newChannelIdentities: [], newTags: [], newAttributes: [], totalConversations: 2, totalCases: 0 },
};

const conflictMessage = '兩位聯絡人在同一個渠道（總店 LINE）都有帳號，合併後回覆會送錯人，無法合併';
const conflict = Object.assign(new Error('409'), {
  isAxiosError: true,
  response: {
    status: 409,
    data: {
      success: false,
      error: { code: 'SAME_CHANNEL_CONFLICT', message: conflictMessage, details: { channels: [{ id: 'ch', displayName: '總店 LINE' }] } },
    },
  },
});

let onOpenChange = vi.fn();
let onMergeComplete = vi.fn();

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  onOpenChange = vi.fn();
  onMergeComplete = vi.fn();
});

test('Merge window shows the reason：合併回 409 時顯示 API 的訊息並維持開啟', async () => {
  api.get.mockResolvedValue({ data: { data: preview } });
  api.post.mockRejectedValueOnce(conflict);
  render(
    <ContactMergeModal
      open
      onOpenChange={onOpenChange}
      primaryContact={{ id: 'b', displayName: '王小美' }}
      initialSecondary={{ id: 'a', displayName: '小美 LINE' }}
      onMergeComplete={onMergeComplete}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
  await screen.findByText(/共 2 件/);
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '確認合併' }));

  await screen.findByText(conflictMessage);
  assert.deepEqual(api.post.mock.calls[0], ['/contacts/merge', { primaryContactId: 'b', secondaryContactId: 'a' }]);
  assert.equal(onOpenChange.mock.calls.some(([open]) => open === false), false, '視窗維持開啟');
  assert.equal(onMergeComplete.mock.calls.length, 0);
});
