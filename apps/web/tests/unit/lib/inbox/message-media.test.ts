/**
 * 收件匣訊息的媒體顯示（issue #206，change fix-line-audio-file-messages）。
 * LINE 外掛原本把 mediaUrl 設為 `line-content:<id>` 佔位，前端優先讀 mediaUrl，
 * 拿到瀏覽器打不開的網址，LINE 的圖片與影片顯示不出來；語音與檔案則只顯示文字。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { describeMessageMedia, extractMediaUrl, formatFileSize } from '#src/lib/inbox/message-media.js';

test('Audio message：有儲存網址時顯示播放器', () => {
  assert.deepEqual(describeMessageMedia('audio', { text: '[語音]', url: 'https://cdn.example.com/a.m4a' }), {
    kind: 'audio',
    url: 'https://cdn.example.com/a.m4a',
  });
});

test('File message：顯示檔名與大小的下載連結', () => {
  assert.deepEqual(
    describeMessageMedia('file', {
      text: '[檔案] 報價單.pdf',
      url: 'https://cdn.example.com/f.pdf',
      fileName: '報價單.pdf',
      fileSize: 20480,
    }),
    { kind: 'file', url: 'https://cdn.example.com/f.pdf', fileName: '報價單.pdf', sizeLabel: '20 KB' },
  );
});

test('Stored LINE message still holds the placeholder：略過 line-content，改用 url', () => {
  assert.equal(
    extractMediaUrl({ mediaUrl: 'line-content:123', url: 'https://cdn.example.com/a.jpg' }),
    'https://cdn.example.com/a.jpg',
  );
});

test('Media not downloaded yet：只有佔位網址時顯示文字', () => {
  assert.deepEqual(describeMessageMedia('file', { text: '[檔案] 報價單.pdf', mediaUrl: 'line-content:123' }), {
    kind: 'text',
  });
});

test('Media download failed：顯示失敗原因', () => {
  assert.deepEqual(
    describeMessageMedia('file', { text: '[檔案] big.zip', contentId: 'm2', mediaError: '檔案超過 25 MB，未下載' }),
    { kind: 'text', error: '檔案超過 25 MB，未下載' },
  );
});

test('與共用的 getMediaUrl 同順序：先 url 再 mediaUrl', () => {
  assert.equal(extractMediaUrl({ mediaUrl: 'https://a/1.jpg', url: 'https://b/2.jpg' }), 'https://b/2.jpg');
  assert.equal(extractMediaUrl({ mediaUrl: '/api/v1/storage/x.jpg' }), '/api/v1/storage/x.jpg');
});

test('純文字內容是網址或 data URI 時沿用（相容舊資料），不採用 javascript:', () => {
  assert.equal(extractMediaUrl('https://a/1.jpg'), 'https://a/1.jpg');
  assert.equal(extractMediaUrl({ text: 'data:image/png;base64,AAA' }), 'data:image/png;base64,AAA');
  assert.equal(extractMediaUrl({ text: '[圖片]' }), null);
  assert.equal(extractMediaUrl({ url: 'javascript:alert(1)' }), null);
});

test('檔案大小格式', () => {
  assert.equal(formatFileSize(20480), '20 KB');
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(1572864), '1.5 MB');
  assert.equal(formatFileSize(undefined), '');
});

test('非媒體類型一律顯示文字', () => {
  assert.deepEqual(describeMessageMedia('text', { text: 'https://example.com' }), { kind: 'text' });
});

/* PR #223 審查：data: 網址原本全部接受，data:text/html、svg 會在點開時執行 */
test('Unsafe data URI：data: 只接受 png、jpeg、gif、webp 圖片', () => {
  assert.equal(extractMediaUrl({ url: 'data:image/png;base64,AAA' }), 'data:image/png;base64,AAA');
  assert.equal(extractMediaUrl({ url: 'data:text/html,<script>alert(1)</script>' }), null);
  assert.equal(extractMediaUrl({ url: 'data:image/svg+xml,<svg onload=alert(1)>' }), null);
  assert.equal(extractMediaUrl({ text: 'data:image/svg+xml;base64,AAA' }), null);
});

test('檔案連結不接受 data: 網址', () => {
  assert.deepEqual(describeMessageMedia('file', { url: 'data:image/png;base64,AAA', fileName: 'a.png' }), { kind: 'text' });
});
