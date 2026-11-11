// @vitest-environment jsdom
/**
 * 設定頁讀取失敗時要顯示錯誤，不可顯示成「尚未建立」或空白表單（G13）。
 * 假的空狀態會讓人重複建立金鑰，或以空白值蓋掉追蹤設定。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { ApiKeyManagement } from '#src/components/settings/ApiKeyManagement.js';
import { CliSessionManagement } from '#src/components/settings/CliSessionManagement.js';
import { TrackingSettings } from '#src/components/settings/TrackingSettings.js';

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.get.mockRejectedValue({ response: { status: 403, data: { error: { message: '權限不足，無法執行此操作' } } } });
});
afterEach(cleanup);

test('API 金鑰讀取失敗時不顯示尚未建立', async () => {
  render(<ApiKeyManagement />);
  assert.ok(await screen.findByText(/無法讀取 API 金鑰/));
  assert.equal(screen.queryAllByText('尚未建立任何金鑰').length, 0);
  assert.ok(screen.getByRole('button', { name: '重新載入' }));
});

test('CLI 連線讀取失敗時不顯示尚未產生', async () => {
  render(<CliSessionManagement />);
  assert.ok(await screen.findByText(/無法讀取 CLI 連線/));
  assert.equal(screen.queryAllByText('尚未產生任何 CLI Token').length, 0);
});

test('追蹤設定讀取失敗時不可儲存', async () => {
  render(<TrackingSettings />);
  assert.ok(await screen.findByText(/無法讀取追蹤設定/));
  const save = screen.queryByRole('button', { name: '儲存設定' });
  assert.ok(save === null || (save as HTMLButtonElement).disabled);
  if (save) fireEvent.click(save);
  assert.equal(api.put.mock.calls.length, 0);
});
