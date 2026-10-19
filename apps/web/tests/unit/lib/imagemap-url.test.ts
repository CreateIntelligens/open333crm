/**
 * 圖文訊息底圖的預覽網址（2026-10-13 code review）。
 *
 * 上傳的底圖存的是 LINE 規定的 baseUrl（不含寬度），API 只提供 baseUrl/{寬度}；
 * 編輯器與預覽直接用 baseUrl 當 <img src> 會 404、破圖。示範用的靜態圖不受影響。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

// 示範底圖網址由 API 來源組成；constants 在載入時讀 NEXT_PUBLIC_API_URL
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = 'https://uat.example.com/api';
});

import { imagemapPreviewSrc, IMAGEMAP_DEMO_BASE_URL } from '#src/lib/imagemap-url.js';
import { DEFAULT_BODY_FOR_TYPE } from '#src/components/materials/default-bodies.js';

const BASE = 'https://uat.example.com/line-imagemap/a0000000-0000-0000-0000-000000000001/7857c500-764c-4db4-9a99-14f48298411d';

test('上傳的底圖：baseUrl 加上 /1040（LINE 的全寬尺寸）', () => {
  assert.equal(imagemapPreviewSrc(BASE), `${BASE}/1040`);
});

test('已帶寬度的網址不重複加', () => {
  assert.equal(imagemapPreviewSrc(`${BASE}/460`), `${BASE}/460`);
});

test('示範用的靜態圖與空值原樣回傳', () => {
  assert.equal(imagemapPreviewSrc('/material-samples/promo-banner.jpeg'), '/material-samples/promo-banner.jpeg');
  assert.equal(imagemapPreviewSrc(''), '');
  assert.equal(imagemapPreviewSrc(undefined), '');
});

test('新建圖文訊息預設帶入公開的示範底圖', () => {
  const body = DEFAULT_BODY_FOR_TYPE.line_imagemap;
  assert.equal(IMAGEMAP_DEMO_BASE_URL, 'https://uat.example.com/line-imagemap/demo');
  assert.equal(body.baseImageUrl, 'https://uat.example.com/line-imagemap/demo');
  assert.equal(body.width, 1040);
  assert.equal(body.height, 700);
});

test('預覽示範底圖', () => {
  assert.equal(
    imagemapPreviewSrc('https://uat.example.com/line-imagemap/demo'),
    'https://uat.example.com/line-imagemap/demo/1040',
  );
  assert.equal(imagemapPreviewSrc('https://uat.example.com/line-imagemap/demo/460'), 'https://uat.example.com/line-imagemap/demo/460');
});

test('不是上傳產生的 baseUrl 形狀時原樣回傳', () => {
  assert.equal(imagemapPreviewSrc('https://cdn.example.com/a/line-imagemap/x.jpg'), 'https://cdn.example.com/a/line-imagemap/x.jpg');
  assert.equal(imagemapPreviewSrc(`${BASE}?v=1`), `${BASE}?v=1`);
});
