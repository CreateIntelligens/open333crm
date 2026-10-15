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
