// @vitest-environment jsdom
/**
 * 跨渠道綁定設定頁的 email 登記開關（change add-email-identity-merge，spec email-identity-merge「Email 登記須由租戶啟用」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { IdentityBindingSettings } from '#src/components/settings/IdentityBindingSettings.js';

const settings = (over: object = {}) => ({
  enabled: false,
  bindKeywords: ['綁定帳號'],
  unbindKeywords: ['解除綁定'],
  emailEnabled: false,
  emailKeywords: ['登記email'],
  ...over,
});

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
});

test('開啟 email 登記並修改關鍵字後儲存', async () => {
  api.get.mockResolvedValue({ data: { data: settings() } });
  api.put.mockImplementation(async (_url: string, body: object) => ({ data: { data: body } }));
  render(<IdentityBindingSettings />);
  fireEvent.click(await screen.findByRole('checkbox', { name: /^啟用 email 登記/ }));
  fireEvent.change(screen.getByLabelText('Email 登記關鍵字'), { target: { value: '登記信箱、留email' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));
  await waitFor(() => assert.equal(api.put.mock.calls.length, 1));
  const body = api.put.mock.calls[0][1] as Record<string, unknown>;
  assert.equal(body.emailEnabled, true);
  assert.deepEqual(body.emailKeywords, ['登記信箱', '留email']);
  assert.equal(body.enabled, false, '不影響綁定代碼的開關');
});

test('載入既有設定', async () => {
  api.get.mockResolvedValue({ data: { data: settings({ emailEnabled: true, emailKeywords: ['登記信箱'] }) } });
  render(<IdentityBindingSettings />);
  const box = await screen.findByRole('checkbox', { name: /^啟用 email 登記/ });
  assert.equal(box.getAttribute('aria-checked') ?? String((box as HTMLInputElement).checked), 'true');
  assert.equal((screen.getByLabelText('Email 登記關鍵字') as HTMLInputElement).value, '登記信箱');
});
