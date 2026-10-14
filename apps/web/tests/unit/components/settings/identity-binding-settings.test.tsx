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

// ── 手機登記（change add-phone-identity-merge，spec phone-identity-merge「手機登記須由租戶啟用」） ──

test('開啟手機登記並修改關鍵字後儲存', async () => {
  api.get.mockResolvedValue({ data: { data: settings({ phoneEnabled: false, phoneKeywords: ['登記手機'] }) } });
  api.put.mockImplementation(async (_url: string, body: object) => ({ data: { data: body } }));
  render(<IdentityBindingSettings />);
  fireEvent.click(await screen.findByRole('checkbox', { name: /^啟用手機登記/ }));
  fireEvent.change(screen.getByLabelText('手機登記關鍵字'), { target: { value: '登記電話、留手機' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));
  await waitFor(() => assert.equal(api.put.mock.calls.length, 1));
  const body = api.put.mock.calls[0][1] as Record<string, unknown>;
  assert.equal(body.phoneEnabled, true);
  assert.deepEqual(body.phoneKeywords, ['登記電話', '留手機']);
  assert.equal(body.emailEnabled, false, '不影響 email 登記的開關');
});

test('手機關鍵字衝突時在欄位下顯示原因', async () => {
  api.get.mockResolvedValue({ data: { data: settings({ phoneEnabled: true, phoneKeywords: ['登記'] }) } });
  api.put.mockRejectedValue(
    Object.assign(new Error('400'), {
      response: {
        status: 400,
        data: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: '輸入內容有誤',
            details: { issues: [{ path: 'phoneKeywords', message: '手機登記關鍵字不可與綁定、解除、email 登記關鍵字或「確認綁定」相同' }] },
          },
        },
      },
    }),
  );
  render(<IdentityBindingSettings />);
  fireEvent.click(await screen.findByRole('button', { name: '儲存設定' }));
  await screen.findByText('手機登記關鍵字不可與綁定、解除、email 登記關鍵字或「確認綁定」相同');
});
