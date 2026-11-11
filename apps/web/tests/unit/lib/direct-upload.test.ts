/**
 * 直傳流程（change line-video-direct-upload）：申請網址 → 直接 PUT 到 storage → 通知 API 完成檢查。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const apiPost = vi.fn();
vi.mock('#src/lib/api.js', () => ({ default: { post: (...args: unknown[]) => apiPost(...args) } }));
const axiosPut = vi.fn();
vi.mock('axios', () => ({ default: { put: (...args: unknown[]) => axiosPut(...args) } }));

const { uploadDirect } = await import('#src/lib/direct-upload.js');

beforeEach(() => {
  apiPost.mockReset();
  axiosPut.mockReset();
});

test('依序申請網址、上傳、完成，回傳正式網址', async () => {
  apiPost
    .mockResolvedValueOnce({ data: { data: { key: 't/quarantine/media/a.mp4', uploadUrl: 'https://s3.example/put?sig' } } })
    .mockResolvedValueOnce({ data: { data: { key: 't/media/a.mp4', url: 'https://s3.example/t/media/a.mp4' } } });
  axiosPut.mockImplementation(async (_url, _body, config) => {
    config.onUploadProgress?.({ loaded: 50, total: 100 });
    return { status: 200 };
  });
  const file = new File(['abc'], 'a.mp4', { type: 'video/mp4' });
  const progress: number[] = [];

  const url = await uploadDirect(file, 'line-video', (p) => progress.push(p));

  assert.equal(url, 'https://s3.example/t/media/a.mp4');
  assert.deepEqual(apiPost.mock.calls[0], [
    '/files/presign-upload',
    { filename: 'a.mp4', mimeType: 'video/mp4', size: 3, purpose: 'line-video' },
  ]);
  const [putUrl, putBody, putConfig] = axiosPut.mock.calls[0];
  assert.equal(putUrl, 'https://s3.example/put?sig');
  assert.equal(putBody, file);
  assert.deepEqual(putConfig.headers, { 'Content-Type': 'video/mp4' }, '只送簽名用到的標頭，不帶登入 token');
  assert.deepEqual(apiPost.mock.calls[1], [
    '/files/complete-upload',
    { key: 't/quarantine/media/a.mp4', filename: 'a.mp4', mimeType: 'video/mp4', purpose: 'line-video' },
  ]);
  assert.deepEqual(progress, [50]);
});

test('storage 拒收時說明原因，不呼叫完成', async () => {
  apiPost.mockResolvedValueOnce({ data: { data: { key: 'k', uploadUrl: 'https://s3.example/put' } } });
  axiosPut.mockRejectedValue({ response: { status: 413 } });
  await assert.rejects(
    uploadDirect(new File(['a'], 'a.mp4', { type: 'video/mp4' }), 'line-video'),
    (e: Error) => /HTTP 413/.test(e.message),
  );
  assert.equal(apiPost.mock.calls.length, 1);
});
