// @vitest-environment jsdom
/**
 * WebTalk 本機資料清除與身分帶入（change webtalk-multi-tenant，spec webtalk-collaboration）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

vi.mock('#src/lib/api.js', () => ({ default: { get: vi.fn() } }));

import { clearWebTalkLocalData, seedWebTalkIdentity, teardownWebTalk } from '#src/lib/webtalk.js';

beforeEach(() => {
  localStorage.clear();
  (window as any).WebTalk = undefined;
});

test('Logout removes WebTalk local data', async () => {
  localStorage.setItem('WEB_TALK_WEB:sync:WEB_TALK_USER_INFO', '{"name":"王小明"}');
  localStorage.setItem('WEB_TALK_WEB:local:WEB_TALK_USER_AVATARS', '{}');
  localStorage.setItem('WEB_TALK_2.0.2:WEB_TALK_APP_STATUS', '{}');
  localStorage.setItem('theme', 'dark');
  localStorage.setItem('open333-sidebar', 'collapsed');
  await clearWebTalkLocalData();
  const keys = Object.keys(localStorage);
  assert.equal(keys.filter((k) => k.startsWith('WEB_TALK_')).length, 0);
  assert.deepEqual(keys.sort(), ['open333-sidebar', 'theme']);
});

test('teardownWebTalk 呼叫 SDK unmount 並清除本機資料；SDK 沒載入過時回傳 false', () => {
  const unmount = vi.fn();
  (window as any).WebTalk = { mount: vi.fn(), unmount };
  localStorage.setItem('WEB_TALK_WEB:sync:WEB_TALK_USER_INFO', '{}');
  assert.equal(teardownWebTalk(), false, '這個頁面沒有載入過 SDK');
  assert.equal(unmount.mock.calls.length, 1);
  assert.equal(localStorage.getItem('WEB_TALK_WEB:sync:WEB_TALK_USER_INFO'), null);
});

test('seedWebTalkIdentity 寫入成員 ID、名稱，只接受 http(s) 頭像', () => {
  seedWebTalkIdentity({ id: 'a1', name: '王小明', avatar: 'javascript:alert(1)' });
  const info = JSON.parse(localStorage.getItem('WEB_TALK_WEB:sync:WEB_TALK_USER_INFO')!);
  assert.equal(info.id, 'a1');
  assert.equal(info.name, '王小明');
  assert.equal(info.language, 'auto', '補上 SDK 需要的預設欄位');
  assert.equal(localStorage.getItem('WEB_TALK_WEB:local:WEB_TALK_USER_AVATARS'), null);

  seedWebTalkIdentity({ id: 'a1', name: '王小明', avatar: 'https://cdn.example.test/a.png' });
  assert.deepEqual(JSON.parse(localStorage.getItem('WEB_TALK_WEB:local:WEB_TALK_USER_AVATARS')!), {
    avatar: 'https://cdn.example.test/a.png',
  });
});

/** loadWebTalkSdk 用模組層級狀態快取 mount，每個測試重新載入模組以取得乾淨狀態 */
async function freshWebTalk() {
  vi.resetModules();
  return import('#src/lib/webtalk.js');
}

const SDK_URL = 'https://sdk.example.test/webtalk.js';
const markedScripts = () => document.querySelectorAll<HTMLScriptElement>('script[data-open333-webtalk-sdk="true"]');

function addMarkedScript(src: string, integrity?: string): HTMLScriptElement {
  const script = document.createElement('script');
  script.src = src;
  script.dataset.open333WebtalkSdk = 'true';
  if (integrity) script.setAttribute('integrity', integrity);
  document.head.appendChild(script);
  return script;
}

test('頁面已有 window.WebTalk 時取得 mount 也記錄 SDK 已載入，登出改整頁導向', async () => {
  document.head.innerHTML = '';
  const mount = vi.fn();
  (window as any).WebTalk = { mount, unmount: vi.fn() };
  const mod = await freshWebTalk();
  assert.equal(await mod.loadWebTalkSdk(SDK_URL, null), mount);
  assert.equal(markedScripts().length, 0, '不再插入 script');
  assert.equal(mod.teardownWebTalk(), true, 'SDK 已在頁面上，登出須整頁導向');
});

test('既有 SDK script 的 src 與 integrity 都相符時才重用', async () => {
  document.head.innerHTML = '';
  const existing = addMarkedScript(SDK_URL, 'sha384-abc');
  const mod = await freshWebTalk();
  const pending = mod.loadWebTalkSdk(SDK_URL, 'sha384-abc');
  assert.equal(markedScripts().length, 1);
  assert.equal(markedScripts()[0], existing, '重用既有 script');
  const mount = vi.fn();
  (window as any).WebTalk = { mount, unmount: vi.fn() };
  existing.dispatchEvent(new Event('load'));
  assert.equal(await pending, mount);
});

test('既有 SDK script 的 src 不同時移除並以這次的網址與 SRI 重新載入', async () => {
  document.head.innerHTML = '';
  const stale = addMarkedScript('https://evil.example.test/webtalk.js');
  const mod = await freshWebTalk();
  void mod.loadWebTalkSdk(SDK_URL, 'sha384-abc');
  assert.equal(stale.isConnected, false, '舊 script 已移除');
  assert.equal(markedScripts().length, 1);
  const script = markedScripts()[0]!;
  assert.equal(script.getAttribute('src'), SDK_URL);
  assert.equal(script.getAttribute('integrity'), 'sha384-abc');
  assert.equal(script.getAttribute('crossorigin'), 'anonymous');
});

test('既有 SDK script 的 integrity 與這次設定不同時不重用', async () => {
  document.head.innerHTML = '';
  for (const staleIntegrity of [undefined, 'sha384-old']) {
    document.head.innerHTML = '';
    const stale = addMarkedScript(SDK_URL, staleIntegrity);
    const mod = await freshWebTalk();
    void mod.loadWebTalkSdk(SDK_URL, 'sha384-abc');
    assert.equal(stale.isConnected, false, `integrity=${staleIntegrity}：舊 script 已移除`);
    assert.equal(markedScripts().length, 1);
    assert.equal(markedScripts()[0]!.getAttribute('integrity'), 'sha384-abc');
  }
});
