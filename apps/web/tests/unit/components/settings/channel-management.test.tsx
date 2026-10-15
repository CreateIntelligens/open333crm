// @vitest-environment jsdom
/**
 * 渠道管理頁（change fix-admin-settings-safeguards，channel-management）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api, channelsState, mutate } = vi.hoisted(() => ({
  api: {
    get: vi.fn(async () => ({ data: { data: {} } })),
    post: vi.fn(async () => ({ data: { data: [] } })),
    patch: vi.fn(async () => ({ data: { data: {} } })),
    put: vi.fn(),
    delete: vi.fn(),
  },
  channelsState: { channels: [] as unknown[] },
  mutate: vi.fn(),
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: () => true }));
vi.mock('#src/hooks/useChannels.js', () => ({
  useChannels: () => ({ channels: channelsState.channels, isLoading: false, error: null, mutate }),
}));
const webchat = { load: () => {}, unload: () => {} };
vi.mock('#src/hooks/useWebchat.js', () => ({ useWebchat: () => webchat }));
vi.mock('#src/components/settings/MetaConnect.js', () => ({
  META_CONNECT_ERROR_TEXT: {},
  MetaConnectButton: () => null,
  MetaConnectDialog: () => null,
  useMetaConnectConfigured: () => false,
}));

import { ChannelManagement } from '#src/components/settings/ChannelManagement.js';

const channel = (id: string, channelType: string, isActive = true) => ({
  id, channelType, displayName: `${channelType}-${id}`, isActive, createdAt: '2026-10-01T00:00:00Z',
});

beforeEach(() => {
  channelsState.channels = [channel('a', 'LINE'), channel('b', 'LINE')];
  api.get.mockClear();
  api.post.mockClear();
  api.patch.mockClear();
  mutate.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function applyBaseUrl(url: string) {
  fireEvent.change(screen.getByPlaceholderText(/^例：https:\/\//), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: '套用' }));
}

test('取消確認時不送出', () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<ChannelManagement />);
  applyBaseUrl('https://crm.example.com');
  assert.equal(confirmSpy.mock.calls.length, 1);
  assert.match(String(confirmSpy.mock.calls[0][0]), /2 個渠道/);
  assert.equal(api.post.mock.calls.filter(([url]) => url === '/channels/webhook-base-url').length, 0);
});

test('確認後送出', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<ChannelManagement />);
  applyBaseUrl('https://crm.example.com/');
  await waitFor(() => {
    const call = api.post.mock.calls.find(([url]) => url === '/channels/webhook-base-url');
    assert.deepEqual(call?.[1], { baseUrl: 'https://crm.example.com' });
  });
});

test('說明文字不要求填 ngrok', () => {
  render(<ChannelManagement />);
  assert.equal(screen.queryAllByText(/ngrok/).length, 0);
  assert.equal(screen.queryAllByPlaceholderText(/ngrok/).length, 0);
});

test('停用的 FB 渠道不查詢', async () => {
  channelsState.channels = [channel('on', 'FB', true), channel('off', 'FB', false)];
  render(<ChannelManagement />);
  await waitFor(() => assert.ok(api.get.mock.calls.some(([url]) => url === '/channels/on/status')));
  assert.equal(api.get.mock.calls.some(([url]) => url === '/channels/off/status'), false);
});
