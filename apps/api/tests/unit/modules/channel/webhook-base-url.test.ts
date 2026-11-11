/**
 * Webhook 公開網址的格式（change fix-admin-settings-safeguards，channel-management）。
 * G08：這個網址會改寫全租戶所有渠道的 webhook 網址，填錯所有渠道都收不到訊息。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { updateWebhookBaseUrlSchema } from '#src/modules/channel/channel.routes.js';

const ok = (baseUrl: string) => updateWebhookBaseUrlSchema.safeParse({ baseUrl }).success;

test('https 網址可以套用', () => {
  assert.equal(ok('https://crm.example.com/'), true);
  assert.equal(ok('https://crm.example.com/prefix'), true);
});

test('http 網址被拒', () => {
  assert.equal(ok('http://crm.example.com'), false);
  assert.equal(ok('crm.example.com'), false);
  assert.equal(ok('javascript:alert(1)'), false);
});

test('帶查詢字串的網址被拒', () => {
  assert.equal(ok('https://crm.example.com?x=1'), false);
  assert.equal(ok('https://crm.example.com/#a'), false);
  assert.equal(ok('https://user:pass@crm.example.com'), false);
});
