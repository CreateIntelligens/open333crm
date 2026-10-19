/**
 * 卡片訊息切換頁面類型時的示範圖（change line-sample-images-public-url）。
 * 儲存後示範圖會換成完整網址；再切換頁面類型時，完整網址的示範圖也要換成新類型的示範圖。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { switchPageType } from '#src/components/materials/line/carousel-page-types.js';

test('卡片訊息切換頁面類型時，完整網址的示範圖也換掉', () => {
  const page = { imageUrl: 'https://uat.example.com/material-samples/product.jpeg', title: '商品' };
  assert.equal(switchPageType(page, 'location').imageUrl, '/material-samples/place.jpeg');
  assert.equal(switchPageType({ ...page, imageUrl: '/material-samples/product.jpeg' }, 'location').imageUrl, '/material-samples/place.jpeg');
});

test('使用者自己的圖切換頁面類型時保留', () => {
  const page = { imageUrl: 'https://cdn.example.com/my-photo.jpeg', title: '商品' };
  assert.equal(switchPageType(page, 'location').imageUrl, 'https://cdn.example.com/my-photo.jpeg');
});
