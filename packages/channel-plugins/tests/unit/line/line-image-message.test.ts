/**
 * LINE 圖片縮圖預設使用圖片（change readable-material-validation-errors，spec material-system
 * 「LINE Image Thumbnail Defaults To The Image」）。編輯器清空縮圖時送出空字串。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildLineMessage } from '#src/line/index.js';

const IMG = 'https://example.com/a.jpg';

test('Blank thumbnail：縮圖空白或沒有時用圖片', () => {
  for (const previewUrl of ['', '   ', undefined]) {
    const msg = buildLineMessage('line_image', { mediaUrl: IMG, previewUrl }) as { previewImageUrl: string };
    assert.equal(msg.previewImageUrl, IMG, JSON.stringify(previewUrl));
  }
});

test('有縮圖時使用縮圖', () => {
  const msg = buildLineMessage('line_image', { mediaUrl: IMG, previewUrl: 'https://example.com/t.jpg' }) as { previewImageUrl: string };
  assert.equal(msg.previewImageUrl, 'https://example.com/t.jpg');
});
