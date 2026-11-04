// @vitest-environment jsdom
/**
 * 渠道管理頁（change fix-admin-settings-safeguards，channel-management）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api, channelsState, mutate, deniedPermissions } = vi.hoisted(() => ({
  api: {
    get: vi.fn(async (..._args: unknown[]) => ({ data: { data: {} } })),
    post: vi.fn(async (..._args: unknown[]) => ({ data: { data: [] } })),
    patch: vi.fn(async (..._args: unknown[]) => ({ data: { data: {} } })),
    put: vi.fn(),
    delete: vi.fn(),
  },
  channelsState: { channels: [] as unknown[], error: null as unknown },
  mutate: vi.fn(),
  deniedPermissions: new Set<string>(),
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: (code: string) => !deniedPermissions.has(code) }));
vi.mock('#src/hooks/useChannels.js', () => ({
  useChannels: () => ({ channels: channelsState.channels, isLoading: false, error: channelsState.error, mutate }),
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
  channelsState.error = null;
  deniedPermissions.clear();
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

test('從卡片停用渠道', async () => {
  channelsState.channels = [channel('a', 'LINE', true), channel('z', 'LINE', false)];
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<ChannelManagement />);
  fireEvent.click(screen.getByRole('button', { name: '停用' }));
  assert.equal(confirmSpy.mock.calls.length, 1);
  await waitFor(() => {
    const call = api.patch.mock.calls.find(([url]) => url === '/channels/a');
    assert.deepEqual(call?.[1], { isActive: false });
  });

  // 停用的渠道可以重新啟用（不需確認）
  fireEvent.click(screen.getByRole('button', { name: '啟用' }));
  await waitFor(() => {
    const call = api.patch.mock.calls.find(([url]) => url === '/channels/z');
    assert.deepEqual(call?.[1], { isActive: true });
  });
});

test('分店成員看不到套用欄位：沒有 channel.view_all 時不顯示 Webhook 公開網址的套用', () => {
  // 會改寫全租戶每個渠道，後端只允許總店（issue #408）
  deniedPermissions.add('channel.view_all');
  render(<ChannelManagement />);
  assert.ok(screen.queryByRole('button', { name: '套用' }) === null);
  assert.ok(screen.queryByPlaceholderText(/^例：https:\/\//) === null);
});

// ── 渠道列表讀取失敗（issue #411，RBAC-11）──

const forbidden = {
  response: {
    status: 403,
    data: { success: false, error: { code: 'FORBIDDEN', message: '權限不足', details: { requiredPermission: 'channel.view' } } },
  },
};

test('沒有檢視權限時顯示無權限訊息：列表回 403 時不顯示沒有渠道', () => {
  channelsState.channels = [];
  channelsState.error = forbidden;
  render(<ChannelManagement />);
  const alert = screen.queryByRole('alert');
  assert.ok(alert !== null, '應顯示無權限訊息');
  assert.match(alert.textContent ?? '', /沒有權限/);
  assert.match(alert.textContent ?? '', /檢視渠道/);
  assert.ok(screen.queryByText('沒有渠道') === null);
  assert.ok(screen.queryByText(/新增您的第一個渠道/) === null);
  // 403 重新載入也不會成功，不顯示重新載入
  assert.ok(screen.queryByRole('button', { name: '重新載入' }) === null);
});

test('列表讀取失敗時顯示錯誤與重新載入：非 403 不顯示沒有渠道', () => {
  channelsState.channels = [];
  channelsState.error = { response: { status: 500, data: { error: { message: '系統發生錯誤，請稍後重試' } } } };
  render(<ChannelManagement />);
  const alert = screen.queryByRole('alert');
  assert.ok(alert !== null, '應顯示讀取失敗訊息');
  assert.match(alert.textContent ?? '', /系統發生錯誤/);
  assert.ok(screen.queryByText('沒有渠道') === null);
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  assert.equal(mutate.mock.calls.length, 1);
});

test('沒有新增權限時不顯示新增按鈕：缺 channel.create 時不顯示新增渠道與設定精靈', () => {
  channelsState.channels = [];
  deniedPermissions.add('channel.create');
  render(<ChannelManagement />);
  assert.ok(screen.getByText('沒有渠道'));
  assert.equal(screen.queryAllByRole('button', { name: /新增渠道/ }).length, 0);
  assert.equal(screen.queryAllByRole('button', { name: '設定精靈' }).length, 0);
});
