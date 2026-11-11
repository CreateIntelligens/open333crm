// @vitest-environment jsdom
/**
 * 收件匣狀態下拉選「已關閉」要走結案流程：原本直接 PATCH status，不會記錄結案原因、時間與結案人。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/SocketProvider.js', () => ({ useSocket: () => ({ socket: null }) }));

import { ChatWindow } from '#src/components/inbox/ChatWindow.js';

const conversation = {
  id: 'conv-1',
  channelType: 'WEBCHAT',
  status: 'ACTIVE',
  assignedToId: null,
  contact: { id: 'contact-1', name: '陳小姐' },
};

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: { data: [], meta: {} } });
  api.post.mockReset();
  api.patch.mockReset();
});

function statusSelect() {
  return screen.getAllByRole('combobox').find((el) =>
    Array.from((el as HTMLSelectElement).options).some((o) => o.value === 'AGENT_HANDLED'),
  ) as HTMLSelectElement;
}

test('狀態下拉選「已關閉」：開啟結案對話框，不直接改狀態', async () => {
  render(<ChatWindow conversation={conversation} />);
  fireEvent.change(statusSelect(), { target: { value: 'CLOSED' } });

  assert.ok(await screen.findByRole('dialog'), '應開啟結案對話框');
  assert.equal(api.patch.mock.calls.length, 0, '不應直接 PATCH 狀態');
});

test('從下拉進入結案並確認：走結案 API，帶上結案原因', async () => {
  api.post.mockResolvedValue({ data: { data: {} } });
  render(<ChatWindow conversation={conversation} />);
  fireEvent.change(statusSelect(), { target: { value: 'CLOSED' } });
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(dialog.querySelector('textarea') as HTMLTextAreaElement, { target: { value: '問題已解決' } });
  fireEvent.click(screen.getByRole('button', { name: /確認結案/ }));

  await vi.waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.deepEqual(api.post.mock.calls[0], ['/conversations/conv-1/close', { reason: '問題已解決' }]);
});

test('結案失敗：對話框內顯示原因，不跳瀏覽器 alert', async () => {
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  api.post.mockRejectedValue({ response: { status: 403, data: { error: { message: '權限不足：需要「管理對話」權限' } } } });
  render(<ChatWindow conversation={conversation} />);
  fireEvent.change(statusSelect(), { target: { value: 'CLOSED' } });
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: /確認結案/ }));

  const alert = await screen.findByRole('alert');
  assert.match(alert.textContent ?? '', /管理對話/);
  assert.equal(alertSpy.mock.calls.length, 0);
  alertSpy.mockRestore();
});
