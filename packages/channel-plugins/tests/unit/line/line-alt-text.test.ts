/**
 * 卡片訊息與圖文訊息的預覽文字（change line-carousel-imagemap-preview-text，spec material-system
 * 「卡片訊息與圖文訊息的預覽文字」）。LINE 在聊天列表與通知顯示 altText。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildLineMessage } from '#src/line/index.js';

const carousel = (altText?: unknown) =>
  buildLineMessage('line_carousel', {
    pageType: 'product',
    pages: [{ imageUrl: 'https://example.com/a.jpg', title: 't' }],
    altText,
  }) as { altText: string };

const imagemap = (altText?: unknown) =>
  buildLineMessage('line_imagemap', {
    baseImageUrl: 'https://example.com/imagemap/x',
    width: 1040,
    height: 700,
    areas: [{ x: 0, y: 0, width: 1040, height: 700, action: { type: 'message', text: 'hi' } }],
    altText,
  }) as { altText: string };

test('送出卡片訊息時用填的預覽文字', () => {
  assert.equal(carousel('  秋季新品上市  ').altText, '秋季新品上市');
});

test('送出圖文訊息時用填的預覽文字', () => {
  assert.equal(imagemap('點圖看優惠').altText, '點圖看優惠');
});

test('沒填預覽文字時用預設文字', () => {
  for (const altText of [undefined, '', '   ']) {
    assert.equal(carousel(altText).altText, '多頁訊息', JSON.stringify(altText));
    assert.equal(imagemap(altText).altText, '圖文訊息', JSON.stringify(altText));
  }
});
