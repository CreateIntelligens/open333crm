/**
 * Rich Menu 預設選單（change fix-rich-menu-default-safety，spec line-rich-menu
 * 「Default Rich Menu」的「Set default」「Cancel default」）。
 *
 * 既有行為的測試，以突變驗證：把 publishRichMenu／unpublishRichMenu 的 `if (menu.selected)`
 * 改成 `if (false)` 時，兩個「會呼叫」的測試都失敗。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { publishRichMenu, unpublishRichMenu } from '#src/modules/line/rich-menu.service.js';

process.env.CREDENTIAL_ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || 'test-credential-encryption-key-32-bytes!!';

const T = 'tenant-a';
const calls: Array<{ url: string; method: string }> = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url === 'https://img.example.com/menu.png') {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    }
    if (url.endsWith('/v2/bot/richmenu') && method === 'POST') {
      return new Response(JSON.stringify({ richMenuId: 'rm-line-1' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function db(menu: Record<string, unknown>) {
  return {
    richMenu: {
      findFirst: async () => ({
        id: 'rm-1',
        tenantId: T,
        channelId: 'ch-1',
        name: '主選單',
        chatBarText: '菜單',
        size: { width: 2500, height: 843 },
        areas: [],
        imageUrl: 'https://img.example.com/menu.png',
        lineRichMenuId: null,
        ...menu,
      }),
      findMany: async () => [],
      update: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'rm-1', ...data }),
      updateMany: async () => ({ count: 0 }),
    },
    channel: {
      findFirst: async () => ({
        id: 'ch-1',
        tenantId: T,
        channelType: 'LINE',
        credentialsEncrypted: encryptCredentials({ channelAccessToken: 'token' }),
      }),
    },
  } as never;
}

const setDefault = (c: { url: string; method: string }) =>
  c.method === 'POST' && c.url === 'https://api.line.me/v2/bot/user/all/richmenu/rm-line-1';
const cancelDefault = (c: { url: string; method: string }) =>
  c.method === 'DELETE' && c.url === 'https://api.line.me/v2/bot/user/all/richmenu';

test('Set default：發布 selected=true 的選單會設成所有好友的預設', async () => {
  await publishRichMenu(db({ status: 'draft', selected: true }), 'rm-1', T);
  assert.ok(calls.some(setDefault), '應呼叫 POST /v2/bot/user/all/richmenu/{id}');
});

test('發布 selected=false 的選單不會動到所有好友的預設', async () => {
  await publishRichMenu(db({ status: 'draft', selected: false }), 'rm-1', T);
  assert.ok(!calls.some(setDefault));
  assert.ok(!calls.some(cancelDefault));
});

test('Cancel default：取消發布 selected=true 的選單會清掉所有好友的預設', async () => {
  await unpublishRichMenu(db({ status: 'published', selected: true, lineRichMenuId: 'rm-line-1' }), 'rm-1', T);
  assert.ok(calls.some(cancelDefault), '應呼叫 DELETE /v2/bot/user/all/richmenu');
});

test('取消發布 selected=false 的選單不會清掉所有好友的預設', async () => {
  await unpublishRichMenu(db({ status: 'published', selected: false, lineRichMenuId: 'rm-line-1' }), 'rm-1', T);
  assert.ok(!calls.some(cancelDefault));
});
