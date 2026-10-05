/**
 * LINE 進站媒體訊息（issue #206，change fix-line-audio-file-messages）。
 * `980781d5` 加入 contentProvider 判斷時，把原本 image / video / audio / file 共用的 case
 * 改成只剩 image 與 video：語音與檔案落到 default，只記下 `[audio]`、`[file]`，
 * 沒有 contentId，resolveInboundMedia() 因此永遠不會下載內容。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { LinePlugin } from '#src/line/index.js';

const line = new LinePlugin();
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function payload(message: Record<string, unknown>) {
  return Buffer.from(
    JSON.stringify({
      destination: 'Ubot',
      events: [{ type: 'message', timestamp: 1000, source: { type: 'user', userId: 'U1' }, message }],
    }),
  );
}

function mockContentApi(body: Uint8Array, contentType: string, status = 200) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(body, { status, headers: { 'content-type': contentType, 'content-length': String(body.length) } });
  }) as typeof fetch;
  return calls;
}

function recordUploads() {
  const uploads: Array<{ filename: string; mime: string }> = [];
  const upload = async (_b: Buffer, filename: string, mime: string) => {
    uploads.push({ filename, mime });
    return { url: `https://cdn/${filename}`, key: filename };
  };
  return { uploads, upload };
}

test('Audio downloaded and stored：解析為 audio，帶長度，下載後上傳', async () => {
  const [m] = await line.parseWebhook(
    payload({ id: 'm-audio', type: 'audio', duration: 6000, contentProvider: { type: 'line' } }),
    {},
  );
  assert.equal(m.contentType, 'audio');
  assert.deepEqual(m.content, { text: '[語音]', contentId: 'm-audio', duration: 6000 });

  mockContentApi(new Uint8Array([1]), 'audio/x-m4a');
  const { uploads, upload } = recordUploads();
  assert.deepEqual(await line.resolveInboundMedia(m.content, m.contentType, { channelAccessToken: 't' }, upload), {
    url: 'https://cdn/line_m-audio.m4a',
    storageKey: 'line_m-audio.m4a',
  });
  assert.deepEqual(uploads, [{ filename: 'line_m-audio.m4a', mime: 'audio/x-m4a' }]);
});

test('File downloaded and stored：解析為 file，帶檔名與大小；存檔保留副檔名', async () => {
  const [m] = await line.parseWebhook(
    payload({ id: 'm-file', type: 'file', fileName: '報價單.pdf', fileSize: 20480 }),
    {},
  );
  assert.equal(m.contentType, 'file');
  assert.deepEqual(m.content, { text: '[檔案] 報價單.pdf', contentId: 'm-file', fileName: '報價單.pdf', fileSize: 20480 });

  mockContentApi(new Uint8Array([1]), 'application/pdf');
  const { uploads, upload } = recordUploads();
  await line.resolveInboundMedia(m.content, m.contentType, { channelAccessToken: 't' }, upload);
  assert.deepEqual(uploads, [{ filename: 'line_m-file.pdf', mime: 'application/octet-stream' }]);
});

test('External-provider audio used directly：用 originalContentUrl，不呼叫內容 API', async () => {
  const [m] = await line.parseWebhook(
    payload({
      id: 'm-audio-ext',
      type: 'audio',
      duration: 3000,
      contentProvider: { type: 'external', originalContentUrl: 'https://example.com/a.m4a' },
    }),
    {},
  );
  assert.deepEqual(m.content, { text: '[語音]', url: 'https://example.com/a.m4a', duration: 3000 });
  const calls = mockContentApi(new Uint8Array([1]), 'audio/x-m4a');
  assert.equal(await line.resolveInboundMedia(m.content, m.contentType, {}, recordUploads().upload), null);
  assert.equal(calls.length, 0);
});

test('Media URL never expires：待下載的圖片不寫 line-content 佔位網址', async () => {
  const [m] = await line.parseWebhook(payload({ id: 'm-img', type: 'image', contentProvider: { type: 'line' } }), {});
  assert.deepEqual(m.content, { text: '[圖片]', contentId: 'm-img' });
});

test('檔案的 MIME 只保留圖片、影片、語音，其他一律存成 octet-stream（不讓 html、svg 在儲存網域執行）', async () => {
  const cases: Array<[string, string, string]> = [
    ['image', 'image/jpeg', 'image/jpeg'],
    ['image', 'image/svg+xml', 'application/octet-stream'],
    ['file', 'text/html', 'application/octet-stream'],
    ['video', 'video/mp4', 'video/mp4'],
  ];
  for (const [contentType, served, stored] of cases) {
    mockContentApi(new Uint8Array([1]), served);
    const { uploads, upload } = recordUploads();
    await line.resolveInboundMedia({ contentId: 'x', fileName: 'a.html' }, contentType, { channelAccessToken: 't' }, upload);
    assert.equal(uploads[0]!.mime, stored, `${contentType} ${served}`);
  }
});

test('檔案超過 25 MB：不下載，回報原因', async () => {
  const calls = mockContentApi(new Uint8Array([1]), 'application/pdf');
  await assert.rejects(
    line.resolveInboundMedia({ contentId: 'big', fileName: 'big.zip', fileSize: 26 * 1024 * 1024 }, 'file', { channelAccessToken: 't' }, recordUploads().upload),
    /檔案超過 25 MB/,
  );
  assert.equal(calls.length, 0);
});

test('LINE 內容 API 失敗：拋出錯誤，不默默回 null', async () => {
  mockContentApi(new Uint8Array(), 'text/plain', 404);
  await assert.rejects(
    line.resolveInboundMedia({ contentId: 'gone' }, 'audio', { channelAccessToken: 't' }, recordUploads().upload),
    /LINE 內容下載失敗（404）/,
  );
});

test('副檔名只取英數，避免檔名夾帶路徑或怪字元', async () => {
  mockContentApi(new Uint8Array([1]), 'application/octet-stream');
  const { uploads, upload } = recordUploads();
  await line.resolveInboundMedia({ contentId: 'f2', fileName: '../../etc/pass wd.p h p' }, 'file', { channelAccessToken: 't' }, upload);
  assert.equal(uploads[0]!.filename, 'line_f2');
});
