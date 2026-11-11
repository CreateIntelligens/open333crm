/**
 * FB 外掛發送時把站內路徑換成公開網址（change fix-fb-material-site-path-urls，
 * spec material-system「FB 素材發送時把站內路徑換成公開網址」）。
 *
 * 2026-10-27 UAT：FB 商品輪播沿用編輯器的示範圖 /material-samples/product.jpeg，
 * Facebook 回「image_url should represent a valid URL」，廣播整批失敗。Graph API 以假 fetch 取代。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { FbPlugin } from '#src/facebook/index.js';

const creds = { pageAccessToken: 'page-token' };
let sentBodies: Array<Record<string, any>> = [];

beforeEach(() => {
  sentBodies = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message_id: 'mid-1' }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const plugin = new FbPlugin({ siteBaseUrl: () => 'https://uat.example.com/' });

test('已存成站內路徑的商品輪播發送成功', async () => {
  const result = await plugin.sendMessage('psid-1', {
    contentType: 'fb_generic',
    content: {
      elements: [{
        title: '示範商品 A',
        image_url: '/material-samples/product.jpeg',
        buttons: [{ type: 'web_url', title: '了解更多', url: '/promo/autumn' }],
      }],
    },
  }, creds);
  assert.equal(result.success, true, result.error);
  const element = sentBodies[0].message.attachment.payload.elements[0];
  assert.equal(element.image_url, 'https://uat.example.com/material-samples/product.jpeg');
  assert.equal(element.buttons[0].url, 'https://uat.example.com/promo/autumn', '按鈕的站內路徑也換');
  assert.equal(element.title, '示範商品 A');
});

test('圖片、媒體與優惠券版型的站內路徑也換成公開網址', async () => {
  await plugin.sendMessage('psid-1', { contentType: 'fb_image', content: { url: '/material-samples/cafe.jpeg' } }, creds);
  assert.equal(sentBodies[0].message.attachment.payload.url, 'https://uat.example.com/material-samples/cafe.jpeg');

  await plugin.sendMessage('psid-1', { contentType: 'fb_image', content: { mediaUrl: '/material-samples/cafe.jpeg' } }, creds);
  assert.equal(sentBodies[1].message.attachment.payload.url, 'https://uat.example.com/material-samples/cafe.jpeg', '舊欄位 mediaUrl');

  await plugin.sendMessage('psid-1', { contentType: 'fb_coupon', content: { title: '8 折', image_url: '/material-samples/coupon.jpeg' } }, creds);
  assert.equal(sentBodies[2].message.attachment.payload.image_url, 'https://uat.example.com/material-samples/coupon.jpeg');

  await plugin.sendMessage('psid-1', { contentType: 'fb_media', content: { media_type: 'image', url: '/material-samples/product.jpeg' } }, creds);
  assert.equal(sentBodies[3].message.attachment.payload.elements[0].url, 'https://uat.example.com/material-samples/product.jpeg');
});

test('公開網址與文字欄位不變', async () => {
  await plugin.sendMessage('psid-1', {
    contentType: 'fb_generic',
    content: {
      elements: [{
        title: '/material-samples/product.jpeg',
        subtitle: '請看 /promo',
        image_url: 'https://cdn.example.com/a.jpg',
        buttons: [{ type: 'web_url', title: '官網', url: '//cdn.example.com/x' }],
      }],
    },
  }, creds);
  const element = sentBodies[0].message.attachment.payload.elements[0];
  assert.equal(element.title, '/material-samples/product.jpeg', '文字欄位不換');
  assert.equal(element.subtitle, '請看 /promo');
  assert.equal(element.image_url, 'https://cdn.example.com/a.jpg');
  assert.equal(element.buttons[0].url, '//cdn.example.com/x', '// 開頭不是站內路徑');
});

test('沒有設定網站公開網址', async () => {
  const noBase = new FbPlugin({ siteBaseUrl: () => undefined });
  const result = await noBase.sendMessage('psid-1', {
    contentType: 'fb_generic',
    content: { elements: [{ title: 'A', image_url: '/material-samples/product.jpeg' }] },
  }, creds);
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /WEB_BASE_URL/);
  assert.match(result.error ?? '', /\/material-samples\/product\.jpeg/, '錯誤訊息指出是哪個網址');
  assert.equal(sentBodies.length, 0, '沒有呼叫 Facebook');
});
