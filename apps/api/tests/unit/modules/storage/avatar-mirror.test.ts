/**
 * 渠道頭像存進物件儲存（spec inbound-contact-resolution「渠道頭像存進物件儲存」，AUDIT IDENT-06）。
 * DNS、fetch 與物件儲存都換成替身，不連網路也不需要 MinIO。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-avatar-mirror-secret';

const dns = vi.hoisted(() => ({ hosts: {} as Record<string, string> }));
vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => {
    const address = dns.hosts[host];
    if (!address) throw new Error(`ENOTFOUND ${host}`);
    return [{ address, family: 4 }];
  },
}));

import { mirrorAvatar, isStoredAvatarUrl } from '#src/modules/storage/avatar-mirror.service.js';
import { setStorageProviderForTests } from '#src/modules/storage/storage.service.js';
import type { StorageProvider } from '#src/modules/storage/storage.provider.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PUBLIC_BASE = 'https://files.example.test/open333crm';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

let uploads: Array<{ key: string; mimeType: string; size: number }>;

function fakeProvider(): StorageProvider {
  return {
    async upload(buffer: Buffer, key: string, mimeType: string) {
      uploads.push({ key, mimeType, size: buffer.length });
      return { key, url: `${PUBLIC_BASE}/${key}` };
    },
    getPublicUrl: (key: string) => `${PUBLIC_BASE}/${key}`,
  } as unknown as StorageProvider;
}

type Route = { status?: number; type?: string; body?: Buffer; location?: string; length?: string };

function stubFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(url);
    assert.equal(init?.redirect, 'manual', '轉址要自己處理，每一站都檢查網址');
    const r = routes[url];
    if (!r) throw new Error(`unexpected fetch ${url}`);
    const headers = new Headers();
    if (r.type) headers.set('content-type', r.type);
    if (r.location) headers.set('location', r.location);
    if (r.length) headers.set('content-length', r.length);
    return new Response(r.body ?? null, { status: r.status ?? 200, headers });
  });
  return calls;
}

beforeEach(() => {
  uploads = [];
  dns.hosts = {
    'platform-lookaside.fbsbx.com': '157.240.1.1',
    'scontent.xx.fbcdn.net': '157.240.2.2',
    'internal.example.test': '10.0.0.5',
  };
  setStorageProviderForTests(fakeProvider());
});

afterEach(() => {
  vi.unstubAllGlobals();
  setStorageProviderForTests(null);
});

test('新聯絡人的頭像存進物件儲存：沿著轉址下載，上傳到本租戶的 avatars 目錄', async () => {
  const source = 'https://platform-lookaside.fbsbx.com/platform/profilepic/?psid=1';
  stubFetch({
    [source]: { status: 302, location: 'https://scontent.xx.fbcdn.net/v/p.jpg' },
    'https://scontent.xx.fbcdn.net/v/p.jpg': { type: 'image/jpeg', body: JPEG },
  });

  const url = await mirrorAvatar(TENANT, source);

  assert.equal(uploads.length, 1);
  assert.match(uploads[0].key, new RegExp(`^${TENANT}/avatars/[0-9a-f-]+\\.jpg$`));
  assert.equal(uploads[0].mimeType, 'image/jpeg');
  assert.equal(url, `${PUBLIC_BASE}/${uploads[0].key}`);
  assert.equal(isStoredAvatarUrl(TENANT, url!), true);
  assert.equal(isStoredAvatarUrl(TENANT, source), false);
});

test('只有本租戶 avatars 目錄的網址算已存好的頭像', () => {
  const other = '22222222-2222-4222-8222-222222222222';
  assert.equal(isStoredAvatarUrl(TENANT, `${PUBLIC_BASE}/${TENANT}/avatars/a.jpg`), true);
  assert.equal(isStoredAvatarUrl(TENANT, `${PUBLIC_BASE}/${other}/avatars/a.jpg`), false, '其他租戶');
  assert.equal(isStoredAvatarUrl(TENANT, `${PUBLIC_BASE}/${TENANT}/media/a.jpg`), false, '不是 avatars 目錄');
});

test('最多跟 3 次轉址', async () => {
  const hop = (n: number) => `https://scontent.xx.fbcdn.net/v/hop${n}.jpg`;
  const routes: Record<string, Route> = {};
  for (let i = 0; i < 4; i++) routes[hop(i)] = { status: 302, location: hop(i + 1) };
  routes[hop(4)] = { type: 'image/jpeg', body: JPEG };
  stubFetch(routes);

  assert.ok(await mirrorAvatar(TENANT, hop(1)), '3 次轉址可以');
  assert.equal(await mirrorAvatar(TENANT, hop(0)), null, '4 次轉址不行');
  assert.equal(uploads.length, 1);
});

test('不安全或不是圖片的網址不存：http 網址', async () => {
  const calls = stubFetch({});
  assert.equal(await mirrorAvatar(TENANT, 'http://scontent.xx.fbcdn.net/p.jpg'), null);
  assert.equal(calls.length, 0);
  assert.equal(uploads.length, 0);
});

test('不安全或不是圖片的網址不存：轉址到內部網路', async () => {
  const source = 'https://platform-lookaside.fbsbx.com/platform/profilepic/?psid=2';
  const calls = stubFetch({
    [source]: { status: 302, location: 'https://internal.example.test/p.jpg' },
  });
  assert.equal(await mirrorAvatar(TENANT, source), null);
  assert.deepEqual(calls, [source], '內部網路的網址不送出請求');
  assert.equal(uploads.length, 0);
});

test('不安全或不是圖片的網址不存：回應不是允許的圖片類型', async () => {
  const source = 'https://scontent.xx.fbcdn.net/v/page.html';
  stubFetch({ [source]: { type: 'text/html', body: Buffer.from('<html>') } });
  assert.equal(await mirrorAvatar(TENANT, source), null);
  assert.equal(uploads.length, 0);
});

test('不安全或不是圖片的網址不存：宣告是圖片、內容不是', async () => {
  const source = 'https://scontent.xx.fbcdn.net/v/fake.jpg';
  stubFetch({ [source]: { type: 'image/jpeg', body: Buffer.from('<html><script>alert(1)</script></html>') } });
  assert.equal(await mirrorAvatar(TENANT, source), null);
  assert.equal(uploads.length, 0);
});

test('不安全或不是圖片的網址不存：超過 5 MB', async () => {
  const declared = 'https://scontent.xx.fbcdn.net/v/declared.jpg';
  const undeclared = 'https://scontent.xx.fbcdn.net/v/undeclared.jpg';
  stubFetch({
    [declared]: { type: 'image/jpeg', length: String(6 * 1024 * 1024), body: JPEG },
    [undeclared]: { type: 'image/jpeg', body: Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]) },
  });
  assert.equal(await mirrorAvatar(TENANT, declared), null, 'content-length 超過上限');
  assert.equal(await mirrorAvatar(TENANT, undeclared), null, '沒宣告長度、實際內容超過上限');
  assert.equal(uploads.length, 0);
});

test('不安全或不是圖片的網址不存：平台回 404（網址已失效）', async () => {
  const source = 'https://platform-lookaside.fbsbx.com/platform/profilepic/?psid=3';
  // 類型給圖片，確定是狀態碼擋下，不是類型檢查
  stubFetch({ [source]: { status: 404, type: 'image/jpeg', body: JPEG } });
  assert.equal(await mirrorAvatar(TENANT, source), null);
  assert.equal(uploads.length, 0);
});
