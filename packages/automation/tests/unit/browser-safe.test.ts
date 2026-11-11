/**
 * apps/web 會打包 @open333crm/automation（規則編輯頁），所以這個套件不能 import @open333crm/core，
 * 也不能 import @open333crm/channel-plugins（它的 index 經 webchat 帶進 core）：
 * core 的 index 帶進 BullMQ，BullMQ 需要 child_process、net 等 Node 模組，web build 會失敗。
 * 這個限制只在打包時才會出錯，行為測試測不到，所以檢查原始碼與 package.json。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';

const pkgDir = join(import.meta.dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const SERVER_ONLY = ['@open333crm/core', '@open333crm/channel-plugins'];

test('套件原始碼不 import 只能在伺服器執行的套件', () => {
  const offenders = sourceFiles(join(pkgDir, 'src')).flatMap((file) => {
    const code = readFileSync(file, 'utf8');
    return SERVER_ONLY.filter((name) => new RegExp(`from ['"]${name}(/[^'"]*)?['"]`).test(code)).map((name) => `${file}: ${name}`);
  });
  assert.deepEqual(offenders, []);
});

test('package.json 不依賴只能在伺服器執行的套件', () => {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
  assert.deepEqual(SERVER_ONLY.filter((name) => pkg.dependencies?.[name]), []);
});
