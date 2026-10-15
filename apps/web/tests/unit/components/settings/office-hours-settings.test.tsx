// @vitest-environment jsdom
/**
 * 營業時間讀取失敗時不可儲存（change fix-admin-settings-safeguards，office-hours-settings）。
 * G07：讀取失敗時原本顯示預設值，按儲存會蓋掉正式設定。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { OfficeHoursSettings } from '#src/components/settings/OfficeHoursSettings.js';

const SAVED = {
  timezone: 'Asia/Taipei',
  officeHours: {
    enabled: true,
    schedule: { mon: { start: '10:00', end: '19:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
    holidays: [],
    outsideHoursMessage: '已儲存的訊息',
  },
};

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
});

test('讀取失敗時停用儲存', async () => {
  api.get.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
  render(<OfficeHoursSettings />);
  await waitFor(() => assert.ok(screen.queryByText('載入中...') === null));

  assert.ok(screen.queryByText(/無法讀取營業時間設定/) !== null, '顯示讀取失敗的訊息');
  assert.ok(screen.queryByRole('button', { name: '重新載入' }) !== null);
  const save = screen.queryByRole('button', { name: '儲存設定' });
  assert.ok(save === null || (save as HTMLButtonElement).disabled, '沒有可按的儲存');
  if (save) fireEvent.click(save);
  assert.equal(api.put.mock.calls.length, 0);
});

test('重新載入成功後可以儲存', async () => {
  api.get.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ data: { data: SAVED } });
  render(<OfficeHoursSettings />);
  const reload = await screen.findByRole('button', { name: '重新載入' });
  fireEvent.click(reload);

  const save = await screen.findByRole('button', { name: '儲存設定' });
  assert.equal((save as HTMLButtonElement).disabled, false);
  assert.ok(screen.queryByDisplayValue('已儲存的訊息') !== null, '顯示讀到的設定');
});
