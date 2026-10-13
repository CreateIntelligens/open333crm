/**
 * LINE 圖片編輯器的預設內容不設縮圖（change readable-material-validation-errors，spec material-system
 * 「LINE Image Thumbnail Defaults To The Image」）。預設縮圖是站內示範圖，只換主圖時會留下來，
 * LINE 擋下存檔，客人也會看到另一張圖。
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

const { DEFAULT_BODY_FOR_TYPE } = (await import(
  pathToFileURL(join(repoRoot, 'apps/web/src/components/materials/default-bodies.ts')).href
)) as { DEFAULT_BODY_FOR_TYPE: Record<string, Record<string, unknown>> };

test('Replace only the image：line_image 預設內容沒有 previewUrl，換主圖後不會留下示範縮圖', () => {
  const body = { ...DEFAULT_BODY_FOR_TYPE.line_image, mediaUrl: 'https://example.com/new.jpg' };
  assert.equal(body.previewUrl, undefined);
});

test('line_video 預設內容沒有 endCard：結束畫面已從編輯器移除，存進去的示範值以後補上發送時會被送出', () => {
  assert.equal(DEFAULT_BODY_FOR_TYPE.line_video.endCard, undefined);
});
