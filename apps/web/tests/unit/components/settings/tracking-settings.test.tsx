// @vitest-environment jsdom
/**
 * 追蹤設定頁的格式驗證（SEC：追蹤碼儲存型 XSS）。
 * GA4 ID 須為 G- 開頭的大寫英數，Meta Pixel ID 須為純數字。
 * 畸形輸入（含可脫出 <script> 的字元）要擋在前端、不呼叫 api.put。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { TrackingSettings } from '#src/components/settings/TrackingSettings.js';

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.get.mockResolvedValue({ data: { data: { gaId: null, metaPixelId: null } } });
  api.put.mockImplementation(async (_url: string, body: object) => ({ data: { data: body } }));
});

async function fill(gaId: string, metaPixelId: string) {
  render(<TrackingSettings />);
  fireEvent.change(await screen.findByLabelText('Google Analytics 4 ID'), { target: { value: gaId } });
  fireEvent.change(screen.getByLabelText('Meta Pixel ID'), { target: { value: metaPixelId } });
  fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));
}

test('GA4 ID 含 </script>：不呼叫 api.put，顯示格式錯誤', async () => {
  await fill('</script><script>alert(1)</script>', '');
  await waitFor(() => assert.ok(screen.getByText(/格式不正確/)));
  assert.equal(api.put.mock.calls.length, 0);
});

test('Meta Pixel ID 含引號：不呼叫 api.put', async () => {
  await fill('', "');alert(1);//");
  await waitFor(() => assert.ok(screen.getByText(/格式不正確/)));
  assert.equal(api.put.mock.calls.length, 0);
});

test('合法 ID：呼叫 api.put 送出 trim 後的值', async () => {
  await fill('G-ABC1234567', '1234567890123456');
  await waitFor(() => assert.equal(api.put.mock.calls.length, 1));
  const body = api.put.mock.calls[0][1] as Record<string, unknown>;
  assert.equal(body.gaId, 'G-ABC1234567');
  assert.equal(body.metaPixelId, '1234567890123456');
});

test('兩欄皆空：允許清除，送出 null', async () => {
  await fill('', '');
  await waitFor(() => assert.equal(api.put.mock.calls.length, 1));
  const body = api.put.mock.calls[0][1] as Record<string, unknown>;
  assert.equal(body.gaId, null);
  assert.equal(body.metaPixelId, null);
});
