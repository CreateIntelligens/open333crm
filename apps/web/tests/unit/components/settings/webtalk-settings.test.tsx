// @vitest-environment jsdom
/**
 * WebTalk 協作設定頁（change webtalk-multi-tenant，spec webtalk-collaboration「Tenant WebTalk Settings」「WebTalk Room Rotation」）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { WebTalkSettings } from '#src/components/settings/WebTalkSettings.js';

const isChecked = (el: HTMLElement) => el.getAttribute('aria-checked') ?? String((el as HTMLInputElement).checked);

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.post.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('載入既有設定', async () => {
  api.get.mockResolvedValue({ data: { data: { enabled: true, aiEnabled: false } } });
  render(<WebTalkSettings />);
  assert.equal(isChecked(await screen.findByRole('checkbox', { name: /^啟用 WebTalk/ })), 'true');
  assert.equal(isChecked(screen.getByRole('checkbox', { name: /^啟用 AI 摘要/ })), 'false');
  assert.equal(api.get.mock.calls[0]![0], '/webtalk/settings');
});

test('開啟 AI 摘要後儲存', async () => {
  api.get.mockResolvedValue({ data: { data: { enabled: true, aiEnabled: false } } });
  api.put.mockImplementation(async (_url: string, body: object) => ({ data: { data: { enabled: true, aiEnabled: false, ...body } } }));
  render(<WebTalkSettings />);
  fireEvent.click(await screen.findByRole('checkbox', { name: /^啟用 AI 摘要/ }));
  fireEvent.click(screen.getByRole('button', { name: '儲存設定' }));
  await waitFor(() => assert.equal(api.put.mock.calls.length, 1));
  assert.equal(api.put.mock.calls[0]![0], '/webtalk/settings');
  assert.deepEqual(api.put.mock.calls[0]![1], { enabled: true, aiEnabled: true });
  await screen.findByText('已儲存');
});

test('儲存失敗時顯示錯誤訊息', async () => {
  api.get.mockResolvedValue({ data: { data: { enabled: true, aiEnabled: false } } });
  api.put.mockRejectedValue({ response: { status: 403, data: { error: { code: 'FORBIDDEN', message: '權限不足' } } } });
  render(<WebTalkSettings />);
  fireEvent.click(await screen.findByRole('button', { name: '儲存設定' }));
  await screen.findByText('權限不足');
});

test('重新產生房間代號需要確認', async () => {
  api.get.mockResolvedValue({ data: { data: { enabled: true, aiEnabled: false } } });
  api.post.mockResolvedValue({ data: { data: { rotated: true } } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  render(<WebTalkSettings />);
  const button = await screen.findByRole('button', { name: '重新產生房間代號' });
  fireEvent.click(button);
  assert.equal(api.post.mock.calls.length, 0, '取消時不送出');
  fireEvent.click(button);
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.equal(api.post.mock.calls[0]![0], '/webtalk/settings/rotate-room');
  assert.equal(confirm.mock.calls.length, 2);
  await screen.findByText(/已重新產生房間代號/);
});
