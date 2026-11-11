/**
 * MinioStorageProvider 的連線設定（原 AUDIT STO-01，已修正）：workers 的 .env 只提供 api 的 S3_*，
 * 原本只讀 MINIO_*，沒設定時連到 localhost:9000，容器內連回自己。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

const created = vi.hoisted(() => [] as unknown[]);
vi.mock('minio', () => ({
  Client: class {
    constructor(opts: unknown) {
      created.push(opts);
    }
  },
}));
const warnings = vi.hoisted(() => [] as string[]);
vi.mock('#src/logger/index.js', () => ({
  logger: { warn: (msg: string) => warnings.push(msg), error: () => undefined, info: () => undefined },
}));

const { resolveMinioConfig } = await import('#src/storage/minio-config.js');
const { MinioStorageProvider } = await import('#src/storage/minio-provider.js');

test('只有 S3_* 時：從 S3_ENDPOINT 解析主機、port 與 http，金鑰用 S3_ACCESS_KEY、S3_SECRET_KEY', () => {
  const cfg = resolveMinioConfig({ S3_ENDPOINT: 'http://minio:9000', S3_ACCESS_KEY: 'ak', S3_SECRET_KEY: 'sk' });
  assert.deepEqual(cfg, { endPoint: 'minio', port: 9000, useSSL: false, accessKey: 'ak', secretKey: 'sk', source: 'S3' });
});

test('S3_ENDPOINT 是 https 時 useSSL，沒有 port 時依協定預設 443；http 沒有 port 時是 80', () => {
  const https = resolveMinioConfig({ S3_ENDPOINT: 'https://s3.example.test', S3_ACCESS_KEY: 'ak', S3_SECRET_KEY: 'sk' });
  assert.equal(https.useSSL, true);
  assert.equal(https.port, 443);
  assert.equal(https.endPoint, 's3.example.test');
  assert.equal(resolveMinioConfig({ S3_ENDPOINT: 'http://files.example.test' }).port, 80);
});

test('有 MINIO_ENDPOINT 時優先用 MINIO_*（相容舊設定）', () => {
  const cfg = resolveMinioConfig({
    MINIO_ENDPOINT: 'legacy',
    MINIO_PORT: '9100',
    MINIO_USE_SSL: 'true',
    MINIO_ACCESS_KEY: 'mak',
    MINIO_SECRET_KEY: 'msk',
    S3_ENDPOINT: 'http://minio:9000',
    S3_ACCESS_KEY: 'ak',
    S3_SECRET_KEY: 'sk',
  });
  assert.deepEqual(cfg, { endPoint: 'legacy', port: 9100, useSSL: true, accessKey: 'mak', secretKey: 'msk', source: 'MINIO' });
});

test('兩邊都沒設定時用本機預設值，source 是 default', () => {
  const cfg = resolveMinioConfig({});
  assert.equal(cfg.source, 'default');
  assert.equal(cfg.endPoint, 'localhost');
  assert.equal(cfg.port, 9000);
});

test('S3_ENDPOINT 格式錯誤時丟出說明的錯誤', () => {
  assert.throws(() => resolveMinioConfig({ S3_ENDPOINT: 'minio:9000:x' }), /S3_ENDPOINT/);
});

test('provider 以解析結果建立 client；兩邊都沒設定時寫一次 warn log', () => {
  const saved = { ...process.env };
  try {
    for (const k of Object.keys(process.env)) if (/^(MINIO|S3)_/.test(k)) delete process.env[k];
    process.env.S3_ENDPOINT = 'https://s3.example.test:8443';
    process.env.S3_ACCESS_KEY = 'ak';
    process.env.S3_SECRET_KEY = 'sk';
    new MinioStorageProvider();
    assert.deepEqual(created.at(-1), { endPoint: 's3.example.test', port: 8443, useSSL: true, accessKey: 'ak', secretKey: 'sk' });
    assert.equal(warnings.length, 0);

    delete process.env.S3_ENDPOINT;
    new MinioStorageProvider();
    new MinioStorageProvider();
    assert.equal(warnings.length, 1, '同一個行程只警告一次');
    assert.match(warnings[0], /S3_ENDPOINT/);
  } finally {
    process.env = saved;
  }
});
