/**
 * 建立 LINE 素材時的錯誤訊息與卡片頁數上限（change readable-material-validation-errors，spec material-system）。
 * 訊息規則本身見 line-validate-error.test.ts；這裡確認 createMaterial() 依版型整理 LINE 的錯誤，
 * 並在呼叫 LINE 前擋下超過 12 個 bubble 的卡片訊息。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

vi.mock('#src/modules/channel/channel.service.js', () => ({
  decryptCredentials: () => ({ channelAccessToken: 'test-token' }),
}));

const { createMaterial } = await import('#src/modules/marketing/material.service.js');

const T = 'tenant-a';
const fetchCalls: unknown[] = [];
let lineResponse: { status: number; body: unknown } = { status: 200, body: {} };

beforeEach(() => {
  fetchCalls.length = 0;
  lineResponse = { status: 200, body: {} };
  vi.stubGlobal('fetch', async (url: unknown) => {
    fetchCalls.push(url);
    return new Response(JSON.stringify(lineResponse.body), { status: lineResponse.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

function fakeDb() {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    channel: { findFirst: async () => ({ credentialsEncrypted: 'x' }) },
    material: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: 'm1', ...data };
      },
    },
    materialVersion: { findFirst: async () => null, create: async () => ({}) },
  };
  return { db: db as never, writes };
}

test('LINE 擋下圖片素材時，錯誤訊息用編輯器的欄位名稱', async () => {
  lineResponse = {
    status: 400,
    body: {
      message: 'The request body has 1 error(s)',
      details: [{ message: 'Must be a valid HTTPS URL', property: 'messages[0].previewImageUrl' }],
    },
  };
  const { db, writes } = fakeDb();
  await assert.rejects(
    createMaterial(db, T, {
      name: '[E2E] 圖',
      channelType: 'line',
      contentType: 'line_image',
      body: { mediaUrl: 'https://example.com/a.jpg', previewUrl: '/material-samples/cafe.jpeg' },
    }),
    (e: { statusCode?: number; message?: string; details?: { line?: unknown } }) => {
      assert.equal(e.statusCode, 400);
      assert.equal(e.message, '素材格式不符合 LINE 規範：縮圖網址必須是 https:// 開頭的公開網址');
      assert.deepEqual(e.details?.line, lineResponse.body, 'LINE 原始回應保留在 details.line');
      return true;
    },
  );
  assert.equal(writes.length, 0);
});

test('Numeric text：純文字的 text 是數字時回 400 指出 body.text，不呼叫 LINE、不建立', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(
    createMaterial(db, T, { name: '[E2E] 數字', channelType: 'line', contentType: 'line_text', body: { text: 12345 } }),
    (e: { statusCode?: number; details?: { issues?: Array<{ path: string }> } }) => {
      assert.equal(e.statusCode, 400);
      assert.deepEqual(e.details?.issues?.map((i) => i.path), ['body.text']);
      return true;
    },
  );
  assert.equal(fetchCalls.length, 0);
  assert.equal(writes.length, 0);
});

test('String text：數字組成的字串照常交給 LINE 驗證', async () => {
  const { db, writes } = fakeDb();
  await createMaterial(db, T, { name: '[E2E] 字串', channelType: 'line', contentType: 'line_text', body: { text: '12345' } });
  assert.equal(fetchCalls.length, 1);
  assert.equal(writes.length, 1);
});

const page = (i: number) => ({ title: `E2E ${i}`, action1: { type: 'uri', label: '看看', uri: 'https://example.com' } });
const endPage = { label: '看更多', action: { type: 'uri', label: '看更多', uri: 'https://example.com' } };

test('Thirteen bubbles：12 頁加結尾頁回 400 指出 body.pages，不呼叫 LINE、不建立', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(
    createMaterial(db, T, {
      name: '[E2E] 卡片',
      channelType: 'line',
      contentType: 'line_carousel',
      body: { pageType: 'product', pages: Array.from({ length: 12 }, (_, i) => page(i)), endPage },
    }),
    (e: { statusCode?: number; details?: { issues?: Array<{ path: string }> } }) => {
      assert.equal(e.statusCode, 400);
      assert.ok(e.details?.issues?.some((i) => i.path === 'body.pages'), '錯誤應指出 body.pages');
      return true;
    },
  );
  assert.equal(fetchCalls.length, 0);
  assert.equal(writes.length, 0);
});

test('Editor maximum：10 頁加結尾頁不受頁數限制', async () => {
  const { db, writes } = fakeDb();
  await createMaterial(db, T, {
    name: '[E2E] 卡片',
    channelType: 'line',
    contentType: 'line_carousel',
    body: { pageType: 'product', pages: Array.from({ length: 10 }, (_, i) => page(i)), endPage },
  });
  assert.equal(fetchCalls.length, 1, '應交給 LINE 驗證');
  assert.equal(writes.length, 1);
});
