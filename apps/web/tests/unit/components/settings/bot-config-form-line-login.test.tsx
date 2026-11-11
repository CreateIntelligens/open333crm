// @vitest-environment jsdom
/**
 * LINE 渠道設定的 Login Channel ID（add-coupon-system design D20）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { patch: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { BotConfigForm } from '#src/components/settings/BotConfigForm.js';

const channel = {
  id: 'ch-1',
  channelType: 'LINE',
  displayName: '官方帳號',
  settings: { liffConfig: { liffId: '1234567890-AbcdEfgh', loginChannelId: '1660000001' } },
};

beforeEach(() => {
  api.patch.mockReset().mockResolvedValue({ data: { success: true } });
});

test('帶出已設定的 Login Channel ID，並說明 Endpoint URL 與 Scope', () => {
  render(<BotConfigForm open onOpenChange={() => {}} channel={channel} onSaved={() => {}} />);
  const input = screen.getByLabelText('LINE Login Channel ID（優惠券身分驗證）') as HTMLInputElement;
  assert.equal(input.value, '1660000001');
  assert.ok(screen.getByText(`${window.location.origin}/liff/redirect`));
  assert.ok(screen.getByText(/openid/));
});

test('儲存時一併送出 LIFF ID 與 Login Channel ID', async () => {
  render(<BotConfigForm open onOpenChange={() => {}} channel={channel} onSaved={() => {}} />);
  fireEvent.change(screen.getByLabelText('LINE Login Channel ID（優惠券身分驗證）'), { target: { value: ' 1660000002 ' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  await waitFor(() => assert.equal(api.patch.mock.calls.length, 1));
  const body = api.patch.mock.calls[0][1] as { settings: { liffConfig: unknown } };
  assert.deepEqual(body.settings.liffConfig, { liffId: '1234567890-AbcdEfgh', loginChannelId: '1660000002' });
});
