/**
 * 舊寫法的數量不得增加（主規格 tenant-transaction-context，issue #337 的搬遷 ratchet）。
 *
 * scripts/check-tenant-ctx.mjs 計算 TenantDb、request.tenantPrisma，以及 service 檔內的
 * withTenant(、$transaction(、inTenant( 次數，以檔案為單位與基準檔比較。
 * 目前沒有 CI，這個測試讓 `pnpm test` 執行它。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

const run = promisify(execFile);
const script = resolve(repoRoot, 'scripts/check-tenant-ctx.mjs');

async function check(args: string[]): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [script, ...args], { cwd: repoRoot });
    return { code: 0, output: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

let dir = '';
let scanDir = '';
let baseline = '';

/** 在暫存的掃描目錄寫一個檔案 */
async function put(rel: string, lines: string[]) {
  const p = join(scanDir, rel);
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, lines.join('\n'));
}

function args(...extra: string[]) {
  return ['--scan-dir', scanDir, '--baseline', baseline, ...extra];
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tenant-ctx-ratchet-'));
  scanDir = join(dir, 'src');
  baseline = join(dir, 'baseline.json');
  await put('modules/a/a.service.ts', ['export async function f(prisma: TenantDb) {}']);
  await put('modules/a/a.routes.ts', ['const x = request.tenantPrisma;', 'const y = request.tenantPrisma;']);
  const { code, output } = await check(args('--update-baseline'));
  assert.equal(code, 0, output);
});

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('新增一處舊寫法：strict 失敗，列出寫法與檔案', { timeout: 30_000 }, async () => {
  await put('modules/b/b.service.ts', ['export async function g(prisma: TenantDb) {}']);
  const { code, output } = await check(args('--strict'));
  assert.equal(code, 1, output);
  assert.match(output, /TenantDb/);
  assert.match(output, /modules\/b\/b\.service\.ts/);
});

test('舊寫法減少：strict 通過，提示更新基準檔', { timeout: 30_000 }, async () => {
  await put('modules/a/a.routes.ts', ['const x = request.tenantPrisma;']);
  const { code, output } = await check(args('--strict'));
  assert.equal(code, 0, output);
  assert.match(output, /--update-baseline/);
});

test('不帶 strict 只輸出報告', { timeout: 30_000 }, async () => {
  await put('modules/b/b.service.ts', ['export async function g(prisma: TenantDb) {}']);
  const { code, output } = await check(args());
  assert.equal(code, 0, output);
  assert.match(output, /modules\/b\/b\.service\.ts/);
});

test('一個檔案減少、另一個檔案增加，仍然失敗', { timeout: 30_000 }, async () => {
  await put('modules/a/a.routes.ts', ['const x = request.tenantPrisma;']);
  await put('modules/c/c.routes.ts', ['const z = req.tenantPrisma;']);
  const { code, output } = await check(args('--strict'));
  assert.equal(code, 1, output);
  assert.match(output, /modules\/c\/c\.routes\.ts/);
});

test('service 檔內自己開交易：inTenant(、withTenant(、$transaction( 都算增加', { timeout: 30_000 }, async () => {
  await put('modules/a/a.service.ts', [
    'export async function f(prisma: TenantDb) {}',
    'await inTenant(deps, tenantId, fn);',
    'await withTenant(prisma, tenantId, fn);',
    'await prisma.$transaction(fn);',
  ]);
  const { code, output } = await check(args('--strict'));
  assert.equal(code, 1, output);
  assert.match(output, /inTenant\(/);
  assert.match(output, /withTenant\(/);
  assert.match(output, /\$transaction\(/);
});

test('service 檔內帶泛型參數或空白的交易呼叫也算增加', { timeout: 30_000 }, async () => {
  await put('modules/a/a.service.ts', ['export async function f(prisma: TenantDb) {}']);
  await put('modules/g1/g1.service.ts', ['await inTenant<string>(deps, tenantId, fn);']);
  await put('modules/g2/g2.service.ts', ['await withTenant <Row[]>(prisma, tenantId, fn);']);
  await put('modules/g3/g3.service.ts', ['await prisma.$transaction (fn);']);
  const { code, output } = await check(args('--strict'));
  assert.equal(code, 1, output);
  assert.match(output, /modules\/g1\/g1\.service\.ts/);
  assert.match(output, /modules\/g2\/g2\.service\.ts/);
  assert.match(output, /modules\/g3\/g3\.service\.ts/);
});

test('route 檔內的 inTenant( 不算：入口本來就該開交易', { timeout: 30_000 }, async () => {
  await put('modules/a/a.routes.ts', [
    'const x = request.tenantPrisma;',
    'const y = request.tenantPrisma;',
    'await inTenant(deps, tenantId, fn);',
  ]);
  const { code, output } = await check(args('--strict'));
  assert.equal(code, 0, output);
});

test('repo 本身：舊寫法沒有比基準檔多', { timeout: 30_000 }, async () => {
  const { code, output } = await check(['--strict']);
  assert.equal(code, 0, `舊寫法增加。新程式請用 inTenant() / tenantHandler()；確實要減少時執行 --update-baseline：\n${output}`);
});

test('--scan-dir 或 --baseline 沒有值：exit 2 並說明缺值的參數，不丟出 TypeError', async () => {
  for (const argv of [['--scan-dir'], ['--baseline'], ['--scan-dir', '--strict']]) {
    const { code, output } = await check(argv);
    assert.equal(code, 2, `${argv.join(' ')}：${output}`);
    assert.match(output, new RegExp(`${argv[0]} 需要一個路徑`));
    assert.doesNotMatch(output, /TypeError/);
  }
});
