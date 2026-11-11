/**
 * workers 在任何模組讀取 process.env 之前載入 repo 根目錄的 .env。
 *
 * workers 是 ESM：靜態 import 的模組都比 index.ts 本身的程式先執行。若在 index.ts 裡呼叫
 * loadEnv()，data-export、data-erasure 的 S3_BUCKET 與 core 的 REDIS_URL 會在載入 .env 之前
 * 取值，在主機上直接執行 workers 時用到預設值。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vitest';

const KEY = 'WORKERS_LOAD_ENV_TEST';
let root: string | undefined;

afterEach(() => {
  delete process.env[KEY];
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

test('從工作目錄往上找到第一個 .env 並載入', async () => {
  root = mkdtempSync(join(tmpdir(), 'workers-load-env-'));
  const cwd = join(root, 'apps', 'workers');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(root, '.env'), `${KEY}=from-root-env\n`);

  const { loadEnv } = await import('#src/load-env.js');
  loadEnv(cwd);

  assert.equal(process.env[KEY], 'from-root-env');
});

test('index.ts 的第一個 import 是 load-env.js，其他模組載入前 .env 已經載入', () => {
  // ESM 依 import 的順序執行模組，這個順序無法用載入 index.ts 的行為測試確認：載入就會啟動 workers
  const source = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
  const firstImport = source.match(/^import [^;]+;/m)?.[0];
  assert.equal(firstImport, "import './load-env.js';");
});
