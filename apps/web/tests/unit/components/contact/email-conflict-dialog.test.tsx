// @vitest-environment jsdom
/**
 * 聯絡人頁修改 email 與他人重複時的確認（change add-email-identity-merge，spec email-identity-merge
 * 「客服修改 email 與他人重複時須確認」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api, perms } = vi.hoisted(() => ({
  api: { patch: vi.fn() },
  perms: new Set<string>(['contact.update', 'contact.merge']),
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: (code: string) => perms.has(code) }));

import { ContactEmailField } from '#src/components/contact/ContactEmailField.js';

const conflict = Object.assign(new Error('409'), {
  isAxiosError: true,
  response: {
    status: 409,
    data: { success: false, error: { code: 'EMAIL_IN_USE', message: '此 email 已由其他聯絡人使用', details: { contactId: 'b', displayName: '王小美' } } },
  },
});

let onUpdate = vi.fn();
let onRequestMerge = vi.fn();

beforeEach(() => {
  api.patch.mockReset();
  onUpdate = vi.fn();
  onRequestMerge = vi.fn();
  perms.clear();
  perms.add('contact.update');
  perms.add('contact.merge');
});

async function editTo(value: string) {
  render(<ContactEmailField contactId="a" email={null} onUpdate={onUpdate} onRequestMerge={onRequestMerge} />);
  fireEvent.click(screen.getByRole('button', { name: '編輯 email' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '儲存' }));
}

test('改成他人的 email', async () => {
  api.patch.mockRejectedValueOnce(conflict);
  await editTo('amy@example.com');
  await screen.findByText(/已由聯絡人「王小美」使用/);
  assert.deepEqual(api.patch.mock.calls[0], ['/contacts/a', { email: 'amy@example.com' }]);
  assert.equal(onUpdate.mock.calls.length, 0);
});

test('確認後仍要儲存', async () => {
  api.patch.mockRejectedValueOnce(conflict).mockResolvedValueOnce({ data: { data: {} } });
  await editTo('amy@example.com');
  fireEvent.click(await screen.findByRole('button', { name: '仍要儲存' }));
  await waitFor(() => assert.equal(onUpdate.mock.calls.length, 1));
  assert.deepEqual(api.patch.mock.calls[1], ['/contacts/a', { email: 'amy@example.com', allowDuplicateEmail: true }]);
});

test('選擇合併', async () => {
  api.patch.mockRejectedValueOnce(conflict);
  await editTo('amy@example.com');
  fireEvent.click(await screen.findByRole('button', { name: '與「王小美」合併' }));
  assert.deepEqual(onRequestMerge.mock.calls[0], [{ id: 'b', displayName: '王小美' }, 'amy@example.com']);
});

test('沒有合併權限', async () => {
  perms.delete('contact.merge');
  api.patch.mockRejectedValueOnce(conflict);
  await editTo('amy@example.com');
  await screen.findByRole('button', { name: '仍要儲存' });
  assert.ok(screen.queryByRole('button', { name: /合併/ }) === null);
  assert.ok(screen.getByRole('button', { name: '取消' }));
});

test('沒有編輯權限時不顯示編輯按鈕', () => {
  perms.delete('contact.update');
  render(<ContactEmailField contactId="a" email="x@example.com" onUpdate={onUpdate} onRequestMerge={onRequestMerge} />);
  assert.ok(screen.getByText('x@example.com'));
  assert.ok(screen.queryByRole('button', { name: '編輯 email' }) === null);
});
