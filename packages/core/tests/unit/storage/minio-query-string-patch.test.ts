/**
 * patches/query-string@7.1.3.patch 的回歸測試（issue #382 第 2 項）。
 *
 * root pnpm.overrides 把 decode-uri-component 固定在 0.5.1（修 GHSA-qr28-fpjm-wq7f），
 * 0.5.x 只提供 ESM。query-string@7（minio 的相依套件）用 require() 載入它，
 * Node 以 require() 載入 ESM 時函式在 `default` 上，沒有補丁時 parse() 會丟
 * `TypeError: decodeComponent is not a function`。
 *
 * 測試以 minio 實際解析到的那份 query-string 為準，不是 workspace 任意一份。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'vitest';

const requireFromCore = createRequire(import.meta.url);
const requireFromMinio = createRequire(requireFromCore.resolve('minio'));

test('minio 使用的 query-string 搭配 decode-uri-component 0.5.x 時，parse() 能正確解碼', () => {
  // 確認前提：query-string 拿到的確實是 0.5.x（ESM），不是舊的 0.2.x
  const requireFromQs = createRequire(requireFromMinio.resolve('query-string'));
  // 0.5.x 的 exports 沒有開放 ./package.json，改從入口檔所在目錄讀
  const decodeEntry = requireFromQs.resolve('decode-uri-component');
  const decodeVersion = (JSON.parse(readFileSync(join(dirname(decodeEntry), 'package.json'), 'utf8')) as { version: string })
    .version;
  assert.match(decodeVersion, /^0\.5\./);

  const queryString = requireFromMinio('query-string') as { parse(input: string): Record<string, unknown> };

  assert.deepEqual({ ...queryString.parse('a=%E4%B8%AD&b=1') }, { a: '中', b: '1' });
});
