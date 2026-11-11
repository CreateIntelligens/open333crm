// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/hooks/useQuickReplyPresets.js', () => ({ useQuickReplyPresets: () => ({ presets: [] }) }));
import { MessageInput } from '#src/components/inbox/MessageInput.js';

beforeEach(() => api.get.mockReset());
afterEach(cleanup);

test('default masked agent reply', async () => {
  api.get.mockResolvedValue({ data: { data: { enabled: true } } });
  const onSend = vi.fn(async () => undefined);
  render(<MessageInput onSend={onSend} conversationId="conv-1" channelType="WEBCHAT" />);
  await screen.findByRole('button', { name: '個資遮罩' });
  fireEvent.change(screen.getByPlaceholderText(/輸入訊息/), { target: { value: '電話 0912345678' } });
  fireEvent.click(screen.getByRole('button', { name: '送出訊息' }));
  await waitFor(() => assert.deepEqual(onSend.mock.calls[0], ['電話 0912345678', 'text', undefined, 'mask']));
});

test('explicit original selection', async () => {
  api.get.mockResolvedValue({ data: { data: { enabled: true } } });
  const onSend = vi.fn(async () => undefined);
  render(<MessageInput onSend={onSend} conversationId="conv-1" channelType="WEBCHAT" />);
  await screen.findByRole('button', { name: '個資遮罩' });
  fireEvent.click(screen.getByRole('button', { name: '個資遮罩' }));
  assert.ok(screen.getByRole('button', { name: '保留原文' }));
  fireEvent.change(screen.getByPlaceholderText(/輸入訊息/), { target: { value: '電話 0912345678' } });
  fireEvent.click(screen.getByRole('button', { name: '送出訊息' }));
  await waitFor(() => assert.deepEqual(onSend.mock.calls[0], ['電話 0912345678', 'text', undefined, 'original']));
});

test('policy-off state', async () => {
  api.get.mockResolvedValue({ data: { data: { enabled: false } } });
  const onSend = vi.fn(async () => undefined);
  render(<MessageInput onSend={onSend} conversationId="conv-1" channelType="WEBCHAT" />);
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: '個資遮罩' }), null));
  fireEvent.change(screen.getByPlaceholderText(/輸入訊息/), { target: { value: '電話 0912345678' } });
  fireEvent.click(screen.getByRole('button', { name: '送出訊息' }));
  await waitFor(() => assert.deepEqual(onSend.mock.calls[0], ['電話 0912345678', 'text', undefined, undefined]));
});
