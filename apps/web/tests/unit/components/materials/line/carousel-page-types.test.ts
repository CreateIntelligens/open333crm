/**
 * 卡片訊息切換頁面類型時的示範圖（change line-sample-images-public-url）。
 * 儲存後示範圖會換成完整網址；再切換頁面類型時，完整網址的示範圖也要換成新類型的示範圖。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { switchPageType } from '#src/components/materials/line/carousel-page-types.js';

// 網站自己的來源：只有這個來源底下的 /material-samples/... 才是示範圖
beforeEach(() => vi.stubGlobal('location', { origin: 'https://uat.example.com' }));
afterEach(() => vi.unstubAllGlobals());

test('卡片訊息切換頁面類型時，完整網址的示範圖也換掉', () => {
  const page = { imageUrl: 'https://uat.example.com/material-samples/product.jpeg', title: '商品' };
  assert.equal(switchPageType(page, 'location').imageUrl, '/material-samples/place.jpeg');
  assert.equal(switchPageType({ ...page, imageUrl: '/material-samples/product.jpeg' }, 'location').imageUrl, '/material-samples/place.jpeg');
});

test('使用者自己的圖切換頁面類型時保留', () => {
  const page = { imageUrl: 'https://cdn.example.com/my-photo.jpeg', title: '商品' };
  assert.equal(switchPageType(page, 'location').imageUrl, 'https://cdn.example.com/my-photo.jpeg');
  // 只是結尾相同、路徑不是 /material-samples/... 的圖不算示範圖
  const lookalike = { imageUrl: 'https://cdn.example.com/user/material-samples/product.jpeg', title: '商品' };
  assert.equal(switchPageType(lookalike, 'location').imageUrl, 'https://cdn.example.com/user/material-samples/product.jpeg');
  // 路徑完全相同、但不是網站自己的網域
  const otherHost = { imageUrl: 'https://cdn.example.com/material-samples/product.jpeg', title: '商品' };
  assert.equal(switchPageType(otherHost, 'location').imageUrl, 'https://cdn.example.com/material-samples/product.jpeg');
});
