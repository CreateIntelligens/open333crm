// @vitest-environment jsdom
/**
 * 收件匣「傳送 email 登記連結」按鈕（change add-email-identity-merge，spec email-identity-merge「客服傳送連結」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api, auth } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() }, auth: { canReply: true } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: () => auth.canReply }));

import { SendEmailRegistrationLinkButton } from '#src/components/inbox/SendEmailRegistrationLinkButton.js';
import { resetIdentityBindingStatusCache } from '#src/components/inbox/identity-binding-status.js';

function status(emailEnabled: boolean) {
  api.get.mockResolvedValue({ data: { data: { enabled: false, emailEnabled } } });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  auth.canReply = true;
  resetIdentityBindingStatusCache();
});

test('啟用時送出連結並顯示結果', async () => {
  status(true);
  api.post.mockResolvedValue({ data: { data: { status: 'sent' } } });
  render(<SendEmailRegistrationLinkButton contactId="c1" conversationId="v1" />);
  fireEvent.click(await screen.findByRole('button', { name: '傳送 email 登記連結' }));
  await screen.findByText('已在對話中送出 email 登記連結');
  assert.deepEqual(api.post.mock.calls[0], ['/contacts/c1/email-registration-link', { conversationId: 'v1' }]);
});

test('沒送到顧客時顯示失敗原因', async () => {
  status(true);
  api.post.mockResolvedValue({ data: { data: { status: 'delivery_failed' } } });
  render(<SendEmailRegistrationLinkButton contactId="c1" conversationId="v1" />);
  fireEvent.click(await screen.findByRole('button', { name: '傳送 email 登記連結' }));
  await screen.findByText(/沒有送到顧客/);
});

test('租戶沒啟用或沒有回覆權限時不顯示', async () => {
  status(false);
  const { container, unmount } = render(<SendEmailRegistrationLinkButton contactId="c1" conversationId="v1" />);
  await waitFor(() => assert.equal(api.get.mock.calls.length, 1));
  assert.equal(container.innerHTML, '');
  unmount();

  auth.canReply = false;
  resetIdentityBindingStatusCache();
  status(true);
  const second = render(<SendEmailRegistrationLinkButton contactId="c1" conversationId="v1" />);
  assert.equal(second.container.innerHTML, '');
  assert.equal(api.get.mock.calls.length, 1, '沒有權限時不查詢');
});
