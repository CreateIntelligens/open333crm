/**
 * scripts/dedupe-sla-events.mjs 的參數解析（issue #320）。資料庫行為在
 * tests/feature/scripts/dedupe-sla-events.test.ts。
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parseArgs: (argv: string[]) => any;

beforeAll(async () => {
  ({ parseArgs } = await import(pathToFileURL(resolve(repoRoot, 'scripts/dedupe-sla-events.mjs')).href));
});

const TENANT = 'a0000000-0000-0000-0000-000000000001';

test('預設 dry-run、刪除重複通知、輸出到目前目錄', () => {
  const opts = parseArgs(['--cutoff', '2026-10-15T08:00:00Z']);
  assert.equal(opts.mode, 'report');
  assert.equal(opts.apply, false);
  assert.equal(opts.notifications, 'delete');
  assert.deepEqual(opts.tenants, []);
  assert.equal(opts.outDir, process.cwd());
  assert.equal(opts.cutoff.toISOString(), '2026-10-15T08:00:00.000Z');
});

test('--tenant 可重複，兩種寫法都接受', () => {
  const other = 'b0000000-0000-0000-0000-000000000002';
  const opts = parseArgs(['--cutoff=2026-10-15T16:00:00+08:00', '--tenant', TENANT, `--tenant=${other}`, '--apply']);
  assert.deepEqual(opts.tenants, [TENANT, other]);
  assert.equal(opts.apply, true);
  assert.equal(opts.cutoff.toISOString(), '2026-10-15T08:00:00.000Z');
});

test('沒有 --cutoff 時拒絕執行；--find-cutoff 不需要 cutoff', () => {
  assert.throws(() => parseArgs([]), /--cutoff/);
  assert.equal(parseArgs(['--find-cutoff']).mode, 'find-cutoff');
});

test('cutoff 沒有寫時區時拒絕，避免依執行環境的時區解讀', () => {
  assert.throws(() => parseArgs(['--cutoff', '2026-10-15T08:00:00']), /時區/);
  assert.throws(() => parseArgs(['--cutoff', 'yesterday']), /cutoff/);
});

test('不合法的租戶 ID、通知模式與預期筆數都拒絕', () => {
  const base = ['--cutoff', '2026-10-15T08:00:00Z'];
  assert.throws(() => parseArgs([...base, '--tenant', 'demo']), /租戶/);
  assert.throws(() => parseArgs([...base, '--notifications=mark-read']), /--notifications/);
  assert.throws(() => parseArgs([...base, '--expect-events', '-1']), /--expect-events/);
  assert.throws(() => parseArgs([...base, '--unknown']), /--unknown/);
  const opts = parseArgs([...base, '--notifications=skip', '--expect-events=12', '--expect-notifications', '0']);
  assert.equal(opts.notifications, 'skip');
  assert.equal(opts.expectEvents, 12);
  assert.equal(opts.expectNotifications, 0);
});
