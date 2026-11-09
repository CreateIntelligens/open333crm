/**
 * scripts/recover-erased-media-orphans.mjs 的參數解析與 MinIO 設定換算（issue #474）。資料庫與物件儲存的行為在
 * tests/feature/scripts/recover-erased-media-orphans.test.ts。
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parseArgs: (argv: string[]) => any;
let minioEnvFromS3: (env: Record<string, string | undefined>) => Record<string, string>;

beforeAll(async () => {
  ({ parseArgs, minioEnvFromS3 } = await import(
    pathToFileURL(resolve(repoRoot, 'scripts/recover-erased-media-orphans.mjs')).href
  ));
});

const TENANT = 'a0000000-0000-0000-0000-000000000001';

test('預設 dry-run、所有租戶、輸出到目前目錄', () => {
  const opts = parseArgs([]);
  assert.equal(opts.apply, false);
  assert.deepEqual(opts.tenants, []);
  assert.equal(opts.expectObjects, null);
  assert.equal(opts.outDir, process.cwd());
});

test('--tenant 可重複，轉成小寫；不是 UUID 時拒絕', () => {
  assert.deepEqual(parseArgs(['--tenant', TENANT.toUpperCase(), `--tenant=${TENANT}`]).tenants, [TENANT, TENANT]);
  assert.throws(() => parseArgs(['--tenant', 'demo']), /UUID/);
});

test('--apply 沒有帶 --expect-objects 時拒絕', () => {
  assert.throws(() => parseArgs(['--apply']), /--expect-objects/);
  const opts = parseArgs(['--apply', '--expect-objects', '12', '--out-dir', '/tmp']);
  assert.equal(opts.apply, true);
  assert.equal(opts.expectObjects, 12);
  assert.equal(opts.outDir, '/tmp');
});

test('--expect-objects 要是整數；不認得的參數拒絕', () => {
  assert.throws(() => parseArgs(['--expect-objects', '-1']), /整數/);
  assert.throws(() => parseArgs(['--expect-objects', 'abc']), /整數/);
  assert.throws(() => parseArgs(['--cutoff', 'x']), /不認得的參數/);
});

test('沒有 MINIO_ENDPOINT 時從 S3_* 換算（STO-01）', () => {
  assert.deepEqual(
    minioEnvFromS3({ S3_ENDPOINT: 'http://minio:9000', S3_ACCESS_KEY: 'ak', S3_SECRET_KEY: 'sk' }),
    { MINIO_ENDPOINT: 'minio', MINIO_PORT: '9000', MINIO_USE_SSL: 'false', MINIO_ACCESS_KEY: 'ak', MINIO_SECRET_KEY: 'sk' },
  );
  assert.deepEqual(minioEnvFromS3({ S3_ENDPOINT: 'https://s3.example.test' }), {
    MINIO_ENDPOINT: 's3.example.test',
    MINIO_PORT: '443',
    MINIO_USE_SSL: 'true',
  });
});

test('已有 MINIO_ENDPOINT 或沒有 S3_ENDPOINT 時不動', () => {
  assert.deepEqual(minioEnvFromS3({ MINIO_ENDPOINT: 'x', S3_ENDPOINT: 'http://minio:9000' }), {});
  assert.deepEqual(minioEnvFromS3({}), {});
});
