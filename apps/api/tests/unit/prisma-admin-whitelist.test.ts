/**
 * BYPASSRLS 連線（prismaAdmin）只能在白名單內使用（主規格 tenant-isolation-rls
 * 「合法跨租戶操作走 BYPASSRLS 連線」；AUDIT RLS-07）。
 *
 * 目前沒有 CI 執行 scripts/check-prisma-admin-usage.mjs，短連結轉址自 207da85 起不在白名單，
 * `--strict` 一直失敗卻沒人發現。這個測試在 `pnpm test` 時執行它，新增的 prismaAdmin 用法
 * 若沒有加進白名單、寫明理由，測試就會失敗。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

const run = promisify(execFile);
const script = resolve(repoRoot, 'scripts/check-prisma-admin-usage.mjs');

/** 執行腳本；回傳 exit code 與輸出（腳本自己當掉時 stderr 不會有違規清單的標題） */
async function check(args: string[]): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [script, '--strict', ...args], { cwd: repoRoot });
    return { code: 0, output: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

test('check-prisma-admin-usage --strict 通過：prismaAdmin 只出現在白名單檔案', { timeout: 30_000 }, async () => {
  const { code, output } = await check([]);
  if (code !== 0) {
    assert.ok(output.includes('非白名單檔案使用 prismaAdmin'), `檢查腳本本身執行失敗：\n${output}`);
    assert.fail(`有檔案在白名單外使用 prismaAdmin：\n${output}`);
  }
});

/* code review：原本只認得 fastify. / request.server. / app. / this. 開頭，req.server.prismaAdmin 等寫法會漏掉 */
let fixtureDir = '';
beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'prisma-admin-check-'));
  await writeFile(
    join(fixtureDir, 'sample.routes.ts'),
    [
      'const a = req.server.prismaAdmin.channel.findFirst();',
      'const b = server.prismaAdmin;',
      'const { prismaAdmin } = app;',
      '// 註解裡提到 app.prismaAdmin 不算',
      'const ok = app.prisma.channel.findFirst();',
    ].join('\n'),
  );
});
afterAll(async () => {
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});

test('各種 prismaAdmin 寫法都抓得到，註解與 app.prisma 不算', { timeout: 30_000 }, async () => {
  const { code, output } = await check(['--scan-dir', fixtureDir]);
  assert.equal(code, 1, output);
  assert.match(output, /（3 處）/, output);
  for (const line of [':1 ', ':2 ', ':3 ']) assert.ok(output.includes(`sample.routes.ts${line}`), `${line}\n${output}`);
});
