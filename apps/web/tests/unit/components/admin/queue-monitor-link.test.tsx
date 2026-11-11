// @vitest-environment jsdom
/**
 * 平台後台的「佇列監控」連結（change queue-monitoring，任務 8）。
 *
 * 點擊時先以平台 JWT 換發監控 cookie，成功後在新分頁開啟 bull-board。分頁在點擊當下開啟，
 * 換發完成後才導向監控畫面：在 await 之後才呼叫 window.open 會被瀏覽器當成彈出視窗擋下。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { post: vi.fn() } }));
vi.mock('#src/app/admin/lib/platform-api.js', () => ({ platformApi: api }));
import { QueueMonitorLink } from '#src/app/admin/lib/QueueMonitorLink.js';

let tab: { location: { href: string }; opener: unknown; close: ReturnType<typeof vi.fn> };
let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  api.post.mockReset();
  tab = { location: { href: '' }, opener: {}, close: vi.fn() };
  open = vi.fn(() => tab);
  vi.stubGlobal('open', open);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('點擊時先換發 cookie，成功後在新分頁開啟監控畫面', async () => {
  api.post.mockResolvedValue({ data: { data: { expiresIn: 3600 } } });
  render(<QueueMonitorLink />);

  fireEvent.click(screen.getByRole('button', { name: '佇列監控' }));

  await waitFor(() => assert.match(tab.location.href, /\/api\/v1\/platform\/queues$/));
  assert.equal(open.mock.calls.length, 1);
  assert.equal(api.post.mock.calls[0][0], '/queues/session');
  assert.equal(api.post.mock.calls[0][2]?.withCredentials, true, '跨來源時要帶 credentials，瀏覽器才會存下 cookie');
  assert.equal(tab.opener, null);
});

test('換發失敗時關閉分頁並顯示訊息', async () => {
  api.post.mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403, data: { error: { message: '此來源 IP 不能使用佇列監控' } } } }));
  render(<QueueMonitorLink />);

  fireEvent.click(screen.getByRole('button', { name: '佇列監控' }));

  await waitFor(() => assert.equal(tab.close.mock.calls.length, 1));
  assert.equal(tab.location.href, '');
  assert.ok(await screen.findByText('此來源 IP 不能使用佇列監控'));
});

test('瀏覽器擋下新分頁時顯示訊息，不換發 cookie', async () => {
  open.mockReturnValue(null);
  render(<QueueMonitorLink />);

  fireEvent.click(screen.getByRole('button', { name: '佇列監控' }));

  assert.ok(await screen.findByText('瀏覽器擋下了新分頁，請允許此網站開啟新分頁後再試一次'));
  assert.equal(api.post.mock.calls.length, 0);
});
