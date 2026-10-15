// @vitest-environment jsdom
/**
 * WebTalk 載入、掛載與生命週期（change webtalk-multi-tenant，spec webtalk-collaboration）。
 * jsdom 不會真的下載外部 script：測試在 script 插入後放上假的 window.WebTalk，再觸發 load 事件。
 * 假 SDK 與真 SDK 一樣，unmount() 會把 window.WebTalk 設為 undefined。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn() },
  auth: { agent: null as null | { id: string; name: string; avatar?: string } },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({ useAuth: () => ({ agent: auth.agent }) }));

const SDK_URL = 'https://sdk.example.test/webtalk.js';
const enabledSession = (over: object = {}) => ({
  enabled: true,
  roomId: 'o333-room-a',
  sdkUrl: SDK_URL,
  sdkIntegrity: null,
  aiEnabled: false,
  aiEndpoint: null,
  ...over,
});

const sdk = {
  mount: vi.fn(),
  unmount: vi.fn(),
  /** mount 被呼叫當下 localStorage 裡的使用者資料 */
  userInfoAtMount: [] as unknown[],
};

function installFakeSdk() {
  (window as any).WebTalk = {
    mount: sdk.mount,
    unmount: () => {
      sdk.unmount();
      (window as any).WebTalk = undefined;
    },
  };
}

const sdkScripts = () => document.querySelectorAll<HTMLScriptElement>('script[data-open333-webtalk-sdk="true"]');

/** 等 script 插入後模擬下載完成 */
async function finishSdkLoad() {
  await waitFor(() => assert.equal(sdkScripts().length, 1));
  installFakeSdk();
  sdkScripts()[0]!.dispatchEvent(new Event('load'));
}

async function loadComponent() {
  const mod = await import('#src/components/webtalk/WebTalkGlobal.js');
  return mod.WebTalkGlobal;
}

beforeEach(() => {
  vi.resetModules();
  api.get.mockReset();
  sdk.mount.mockReset();
  sdk.unmount.mockReset();
  sdk.userInfoAtMount = [];
  sdk.mount.mockImplementation(() => {
    sdk.userInfoAtMount.push(JSON.parse(localStorage.getItem('WEB_TALK_WEB:sync:WEB_TALK_USER_INFO') ?? 'null'));
  });
  auth.agent = { id: 'a1', name: '王小明' };
  localStorage.clear();
  document.head.innerHTML = '';
  (window as any).WebTalk = undefined;
});

afterEach(() => {
  cleanup();
});

test('WebTalk is disabled for the tenant or not configured', async () => {
  for (const reason of ['TENANT_DISABLED', 'NOT_CONFIGURED']) {
    api.get.mockResolvedValue({ data: { data: { enabled: false, reason } } });
    const WebTalkGlobal = await loadComponent();
    render(<WebTalkGlobal />);
    await waitFor(() => assert.equal(api.get.mock.calls.length > 0, true));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(sdkScripts().length, 0, `${reason}：不插入 SDK script`);
    assert.equal(document.querySelectorAll('script').length, 0);
    assert.equal(sdk.mount.mock.calls.length, 0);
    cleanup();
    api.get.mockReset();
  }
});

test('session 取得失敗時不載入 SDK', async () => {
  api.get.mockRejectedValue(new Error('network'));
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const WebTalkGlobal = await loadComponent();
  render(<WebTalkGlobal />);
  await waitFor(() => assert.equal(errorSpy.mock.calls.length > 0, true));
  assert.equal(sdkScripts().length, 0);
  errorSpy.mockRestore();
});

test('WebTalk script is inserted with required attributes', async () => {
  api.get.mockResolvedValue({ data: { data: enabledSession({ sdkIntegrity: 'sha384-abc' }) } });
  const WebTalkGlobal = await loadComponent();
  render(<WebTalkGlobal />);
  await waitFor(() => assert.equal(sdkScripts().length, 1));
  const script = sdkScripts()[0]!;
  assert.equal(api.get.mock.calls[0]![0], '/webtalk/session');
  assert.equal(script.getAttribute('src'), SDK_URL);
  assert.equal(script.getAttribute('data-webtalk-auto-mount'), 'false');
  assert.equal(script.getAttribute('integrity'), 'sha384-abc');
  assert.equal(script.getAttribute('crossorigin'), 'anonymous');
});

test('WebTalk script is not duplicated', async () => {
  api.get.mockResolvedValue({ data: { data: enabledSession() } });
  const WebTalkGlobal = await loadComponent();
  const first = render(<WebTalkGlobal />);
  await finishSdkLoad();
  await waitFor(() => assert.equal(sdk.mount.mock.calls.length, 1));
  first.unmount();
  render(<WebTalkGlobal />);
  await waitFor(() => assert.equal(sdk.mount.mock.calls.length, 2));
  assert.equal(sdkScripts().length, 1);
});

test('WebTalk mounts after SDK readiness / AI summary disabled by default', async () => {
  api.get.mockResolvedValue({ data: { data: enabledSession() } });
  const WebTalkGlobal = await loadComponent();
  render(<WebTalkGlobal />);
  await finishSdkLoad();
  await waitFor(() => assert.equal(sdk.mount.mock.calls.length, 1));
  const options = sdk.mount.mock.calls[0]![0];
  assert.equal(options.roomId, 'o333-room-a');
  assert.equal(options.enableVirtualRoom, false);
  assert.equal(options.aiEndpoint, 'http://localhost:3001/api/v1/webtalk/ai-disabled');
  assert.ok(!('scope' in options), '不可帶 scope');
  assert.ok(!('siteId' in options), '不可帶 siteId');
});

test('AI summary enabled by the tenant', async () => {
  api.get.mockResolvedValue({
    data: { data: enabledSession({ aiEnabled: true, aiEndpoint: 'https://ai.example.test/api/webtalk/ai' }) },
  });
  const WebTalkGlobal = await loadComponent();
  render(<WebTalkGlobal />);
  await finishSdkLoad();
  await waitFor(() => assert.equal(sdk.mount.mock.calls.length, 1));
  assert.equal(sdk.mount.mock.calls[0]![0].aiEndpoint, 'https://ai.example.test/api/webtalk/ai');
});

test('Agent name is shown in WebTalk', async () => {
  localStorage.setItem('WEB_TALK_WEB:sync:WEB_TALK_USER_INFO', JSON.stringify({ id: 'x', name: '亂取的暱稱', themeMode: 'dark' }));
  api.get.mockResolvedValue({ data: { data: enabledSession() } });
  const WebTalkGlobal = await loadComponent();
  render(<WebTalkGlobal />);
  await finishSdkLoad();
  await waitFor(() => assert.equal(sdk.mount.mock.calls.length, 1));
  const info = sdk.userInfoAtMount[0] as Record<string, unknown>;
  assert.equal(info.id, 'a1');
  assert.equal(info.name, '王小明');
  assert.equal(info.themeMode, 'dark', '保留使用者其他偏好');
});

test('WebTalk unmounts when leaving authenticated dashboard', async () => {
  api.get.mockResolvedValue({ data: { data: enabledSession() } });
  const WebTalkGlobal = await loadComponent();
  const view = render(<WebTalkGlobal />);
  await finishSdkLoad();
  await waitFor(() => assert.equal(sdk.mount.mock.calls.length, 1));
  localStorage.setItem('WEB_TALK_2.0.2:WEB_TALK_APP_STATUS', '{}');
  view.unmount();
  assert.equal(sdk.unmount.mock.calls.length, 1);
  assert.equal(localStorage.getItem('WEB_TALK_WEB:sync:WEB_TALK_USER_INFO'), null, '清除身分資料');
  assert.equal(localStorage.getItem('WEB_TALK_2.0.2:WEB_TALK_APP_STATUS'), null);
});

test('WebTalk remounts after the operator changes', async () => {
  api.get
    .mockResolvedValueOnce({ data: { data: enabledSession({ roomId: 'o333-room-a' }) } })
    .mockResolvedValueOnce({ data: { data: enabledSession({ roomId: 'o333-room-b' }) } });
  const WebTalkGlobal = await loadComponent();
  const view = render(<WebTalkGlobal />);
  await finishSdkLoad();
  await waitFor(() => assert.equal(sdk.mount.mock.calls.length, 1));

  auth.agent = { id: 'b1', name: '李小華' };
  view.rerender(<WebTalkGlobal />);
  await waitFor(() => assert.equal(sdk.mount.mock.calls.length, 2));
  assert.equal(sdk.unmount.mock.calls.length, 1, '先卸載上一位成員的房間');
  assert.equal(sdk.mount.mock.calls[1]![0].roomId, 'o333-room-b');
  assert.equal((sdk.userInfoAtMount[1] as Record<string, unknown>).name, '李小華');
  assert.equal(api.get.mock.calls.length, 2, '重新取得 session');
});

test('元件在 SDK 載入期間卸載時，SDK 載完後卸載且不掛載', async () => {
  api.get.mockResolvedValue({ data: { data: enabledSession() } });
  const WebTalkGlobal = await loadComponent();
  const view = render(<WebTalkGlobal />);
  await waitFor(() => assert.equal(sdkScripts().length, 1));
  view.unmount();
  installFakeSdk();
  sdkScripts()[0]!.dispatchEvent(new Event('load'));
  await waitFor(() => assert.equal(sdk.unmount.mock.calls.length, 1));
  assert.equal(sdk.mount.mock.calls.length, 0, '已卸載的元件不掛載');
});

test('元件在 mount() 進行中卸載時，mount 完成後再次卸載', async () => {
  api.get.mockResolvedValue({ data: { data: enabledSession() } });
  let finishMount!: () => void;
  sdk.mount.mockImplementation(() => new Promise<void>((resolve) => { finishMount = resolve; }));
  const WebTalkGlobal = await loadComponent();
  const view = render(<WebTalkGlobal />);
  await finishSdkLoad();
  await waitFor(() => assert.equal(sdk.mount.mock.calls.length, 1));
  view.unmount();
  assert.equal(sdk.unmount.mock.calls.length, 1, '元件清理時卸載一次');
  finishMount();
  await waitFor(() => assert.equal(sdk.unmount.mock.calls.length, 2, 'mount 完成後再卸載一次'));
});
