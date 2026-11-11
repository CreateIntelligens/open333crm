// @vitest-environment jsdom
/**
 * 收件匣「傳送手機登記連結」按鈕（change add-phone-identity-merge，spec phone-identity-merge「客服傳送連結」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: () => true }));

import { SendPhoneRegistrationLinkButton } from '#src/components/inbox/RegistrationLinkButtons.js';
import { resetIdentityBindingStatusCache } from '#src/components/inbox/identity-binding-status.js';

function status(s: { emailEnabled: boolean; phoneEnabled: boolean }) {
  api.get.mockResolvedValue({ data: { data: { enabled: false, ...s } } });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  resetIdentityBindingStatusCache();
});

test('客服傳送連結', async () => {
  status({ emailEnabled: false, phoneEnabled: true });
  api.post.mockResolvedValue({ data: { data: { status: 'sent' } } });
  render(<SendPhoneRegistrationLinkButton contactId="c1" conversationId="v1" />);
  fireEvent.click(await screen.findByRole('button', { name: '傳送手機登記連結' }));
  await screen.findByText('已在對話中送出手機登記連結');
  assert.deepEqual(api.post.mock.calls[0], ['/contacts/c1/phone-registration-link', { conversationId: 'v1' }]);
});

test('只啟用 email 登記時不顯示手機按鈕', async () => {
  status({ emailEnabled: true, phoneEnabled: false });
  const { container } = render(<SendPhoneRegistrationLinkButton contactId="c1" conversationId="v1" />);
  await waitFor(() => assert.equal(api.get.mock.calls.length, 1));
  assert.equal(container.innerHTML, '');
});
