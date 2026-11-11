/**
 * CLI 連線頁與 API 金鑰頁的使用說明，主機位址要取自這個部署的 API，不可寫死 UAT。
 * CLI 會在主機後面接 /api/v1，所以主機是 API 網址去掉 /api/v1，保留子路徑。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resolvePublicApiHost } from '#src/lib/public-api-host.js';

test('API 網址是絕對網址：去掉 /api/v1', () => {
  assert.equal(resolvePublicApiHost('https://crm.example.com/api/v1', 'https://web.example.com'), 'https://crm.example.com');
});

test('部署在子路徑：保留子路徑', () => {
  assert.equal(resolvePublicApiHost('https://host.example.com/open333/api/v1/', 'https://web.example.com'), 'https://host.example.com/open333');
});

test('API 網址是相對路徑：接在目前頁面的 origin 後面', () => {
  assert.equal(resolvePublicApiHost('/api/v1', 'https://web.example.com'), 'https://web.example.com');
  assert.equal(resolvePublicApiHost('/open333/api/v1', 'https://web.example.com'), 'https://web.example.com/open333');
});
