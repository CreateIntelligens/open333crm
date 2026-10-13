/**
 * 直傳的用途與大小上限（change line-video-direct-upload，spec upload-content-detection）。
 * 用假的 StorageProvider 記錄呼叫，不需要 MinIO。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, test } from 'vitest';
import { loadEnvConfig } from '#src/config/env.js';
import { preloadUploadContentDetector } from '#src/modules/upload/upload-content-detector.js';
import {
  buildQuarantineKey,
  completePresignedUpload,
  presignUpload,
  setStorageProviderForTests,
} from '#src/modules/storage/storage.service.js';
import { S3StorageProvider } from '#src/modules/storage/s3.provider.js';

const MB = 1024 * 1024;
const tenantId = '11111111-1111-4111-8111-111111111111';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAF/gL+3xO+VQAAAABJRU5ErkJggg==',
  'base64',
);

/** 1 秒黑畫面 mp4（ffmpeg 產生）；大檔測試用它重複組成內容 */
const mp4 = readFileSync(new URL('../../../fixtures/tiny.mp4', import.meta.url));

function loadTestConfig() {
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/open333',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-jwt-secret-12345',
    CREDENTIAL_ENCRYPTION_KEY: '12345678901234567890123456789012',
    MCP_ALLOWED_ORIGINS: 'http://localhost:3000',
    UPLOAD_CONTENT_DETECTION_ENABLED: 'true',
  });
  loadEnvConfig();
}

/** 假 provider：物件記大小，內容可以是實際 bytes 或依位置產生的函式（大檔不配置整份記憶體） */
type FakeObject = { size: number; bytes?: Buffer; byteAt?: (i: number) => number };
function fakeProvider(objects: Map<string, FakeObject>) {
  const calls = { presign: [] as unknown[][], ranges: [] as Array<[number, number]>, fullReads: 0, copies: [] as string[][], deleted: [] as string[] };
  setStorageProviderForTests({
    upload: async () => { throw new Error('直傳不應重新上傳整個檔案'); },
    getSignedUrl: async (key: string) => `https://storage.example/signed/${key}`,
    getPublicUrl: (key: string) => `https://storage.example/${key}`,
    getObject: async () => { calls.fullReads += 1; return null; },
    headObject: async (key: string) => {
      const o = objects.get(key);
      return o ? { size: o.size } : null;
    },
    getObjectRange: async (key: string, start: number, end: number) => {
      calls.ranges.push([start, end]);
      const o = objects.get(key);
      if (!o) return null;
      if (o.bytes) return o.bytes.subarray(start, end + 1);
      return Buffer.from(Array.from({ length: end - start + 1 }, (_, i) => o.byteAt!(start + i)));
    },
    copy: async (from: string, to: string) => {
      calls.copies.push([from, to]);
      return { key: to, url: `https://storage.example/${to}` };
    },
    delete: async (key: string) => { calls.deleted.push(key); objects.delete(key); },
    ensureBucket: async () => {},
    presignUpload: async (...args: unknown[]) => {
      calls.presign.push(args);
      return { key: args[0] as string, uploadUrl: `https://storage.example/upload/${args[0]}` };
    },
  } as never);
  return calls;
}

beforeAll(async () => {
  loadTestConfig();
  await preloadUploadContentDetector();
});
afterAll(() => setStorageProviderForTests(null));

test('Oversized presign request：超過用途上限回 413，不簽發網址', async () => {
  const calls = fakeProvider(new Map());
  for (const [purpose, size] of [['line-video', 201 * MB], ['generic', 26 * MB]] as const) {
    await assert.rejects(
      presignUpload(tenantId, { filename: 'a.mp4', mimeType: 'video/mp4', size, purpose }),
      (e: { statusCode?: number; code?: string }) => e.statusCode === 413 && e.code === 'FILE_TOO_LARGE',
      `${purpose} ${size}`,
    );
  }
  assert.equal(calls.presign.length, 0);
});

test('presign 把宣告的大小交給 provider 簽名', async () => {
  const calls = fakeProvider(new Map());
  const result = await presignUpload(tenantId, { filename: 'clip.mp4', mimeType: 'video/mp4', size: 150 * MB, purpose: 'line-video' });
  assert.match(result.key, new RegExp(`^${tenantId}/quarantine/media/`));
  assert.equal(calls.presign[0][2], 150 * MB);
});

test('Declared size is part of the signature / Upload URL is signed for the public storage host', async () => {
  const provider = new S3StorageProvider({
    endpoint: 'http://minio:9000',
    publicUrl: 'https://uat.example.com',
    region: 'us-east-1',
    accessKeyId: 'k',
    secretAccessKey: 's',
    bucket: 'open333crm',
  });
  const { uploadUrl } = await provider.presignUpload('t/quarantine/media/a.mp4', 'video/mp4', 150 * MB);
  const url = new URL(uploadUrl);
  assert.equal(url.origin, 'https://uat.example.com');
  assert.equal(url.pathname, '/open333crm/t/quarantine/media/a.mp4');
  assert.deepEqual(url.searchParams.get('X-Amz-SignedHeaders')?.split(';').sort(), ['content-length', 'host']);
  assert.equal(url.searchParams.get('x-amz-checksum-crc32'), null, '不可簽進空內容的檢查碼');
});

test('Completed object exceeds the purpose limit：回 413、刪除隔離檔、不轉正式檔', async () => {
  const key = buildQuarantineKey(tenantId, 'big.mp4', 'media');
  const calls = fakeProvider(new Map([[key, { size: 30 * MB }]]));
  await assert.rejects(
    completePresignedUpload(tenantId, { key, filename: 'big.mp4', mimeType: 'video/mp4', purpose: 'generic' }),
    (e: { statusCode?: number; code?: string }) => e.statusCode === 413 && e.code === 'FILE_TOO_LARGE',
  );
  assert.deepEqual(calls.deleted, [key]);
  assert.equal(calls.copies.length, 0);
  assert.equal(calls.ranges.length, 0, '超過上限不讀內容');
});

test('LINE video purpose accepts only mp4：PNG 被拒並刪除隔離檔', async () => {
  const key = buildQuarantineKey(tenantId, 'a.png', 'media');
  const calls = fakeProvider(new Map([[key, { size: png.length, bytes: png }]]));
  await assert.rejects(
    completePresignedUpload(tenantId, { key, filename: 'a.png', mimeType: 'image/png', purpose: 'line-video' }),
    (e: { code?: string }) => e.code === 'INVALID_FILE_TYPE',
  );
  assert.deepEqual(calls.deleted, [key]);
  assert.equal(calls.copies.length, 0);
});

test('Large file is scanned from samples：只讀開頭與結尾，用 storage 端複製轉正式檔', async () => {
  const size = 150 * MB;
  const key = buildQuarantineKey(tenantId, 'clip.mp4', 'media');
  const calls = fakeProvider(new Map([[key, { size, byteAt: (i: number) => mp4[i % mp4.length] }]]));
  const result = await completePresignedUpload(tenantId, { key, filename: 'clip.mp4', mimeType: 'video/mp4', purpose: 'line-video' });
  assert.equal(result.detectedMime, 'video/mp4');
  assert.equal(calls.fullReads, 0);
  for (const [start, end] of calls.ranges) assert.ok(end - start + 1 <= 1 * MB, `片段 ${start}-${end} 太大`);
  assert.equal(calls.ranges[0][0], 0, '要讀開頭');
  assert.equal(calls.ranges.at(-1)?.[1], size - 1, '要讀結尾');
  assert.equal(calls.copies.length, 1);
  assert.equal(calls.copies[0][0], key);
  assert.match(result.key, new RegExp(`^${tenantId}/media/`));
  assert.deepEqual(calls.deleted, [key]);
});

test('LINE 影片：小的 mp4 整份檢查後轉正式檔', async () => {
  const key = buildQuarantineKey(tenantId, 'tiny.mp4', 'media');
  const calls = fakeProvider(new Map([[key, { size: mp4.length, bytes: mp4 }]]));
  const result = await completePresignedUpload(tenantId, { key, filename: 'tiny.mp4', mimeType: 'video/mp4', purpose: 'line-video' });
  assert.equal(result.detectedMime, 'video/mp4');
  assert.deepEqual(calls.ranges, [[0, mp4.length - 1]]);
  assert.equal(calls.copies.length, 1);
});
