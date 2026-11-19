/**
 * scripts/check-doc-history.mjs：功能文件、模組文件、feature skill 與 AGENTS.md 只描述現況。
 * 擋下已關閉的 issue 編號、change 名稱、commit hash 與描述舊行為的句子。
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

type Violation = { line: number; rule: string; text: string };
let findViolations: (text: string, opts: { openIssues: Set<number> }) => Violation[];

beforeAll(async () => {
  ({ findViolations } = await import(pathToFileURL(resolve(repoRoot, 'scripts/check-doc-history.mjs')).href));
});

const opts = { openIssues: new Set([337, 405]) };
const rules = (text: string) => findViolations(text, opts).map((v) => v.rule);

test('已關閉的 issue 編號被擋下，還開著的 issue 放行', () => {
  assert.deepEqual(rules('刪除後回 404（#410）。'), ['issue']);
  assert.deepEqual(rules('見 issue #410。'), ['issue']);
  assert.deepEqual(rules('還沒搬的模組由 #337 處理，欄位見 #405。'), []);
});

test('change 名稱與 commit hash 被擋下', () => {
  assert.deepEqual(rules('見 change `migrate-csat-tenant-ctx`。'), ['change']);
  assert.deepEqual(rules('commit `4b384b7` 刪除了 ci.yml。'), ['commit']);
});

test('描述舊行為的句子被擋下', () => {
  assert.deepEqual(rules('修正前建立的活動仍能啟動。'), ['history']);
  assert.deepEqual(rules('2026-10-05 之前規則列表只取第一頁。'), ['history']);
  assert.deepEqual(rules('用量告警會再次通知（原 PLAN-13，2026-11-10 修正）。'), ['history']);
  assert.deepEqual(rules('AUTO-06 已修正。'), ['history']);
});

test('描述既有資料狀態的日期放行', () => {
  assert.deepEqual(rules('2026-11-04 之前直接關閉的工單沒有補上 `resolvedAt`。'), []);
  assert.deepEqual(rules('2026-10-05 之前建立、沒有綁定的渠道，已綁給當時所有啟用中的成員。'), []);
  assert.deepEqual(rules('2026-11-09 之前刪除的成員留下的紀錄沒有快照。'), []);
});

test('引號與行內程式碼裡的狀態名稱、純數字不算違規', () => {
  assert.deepEqual(rules('Do not keep it with the status "已修正".'), []);
  assert.deepEqual(rules('add the item to the `已修正` line at the top.'), []);
  assert.deepEqual(rules('- `topupTokens`：`200000`、`500000`、`1000000`。'), []);
});

test('程式碼區塊與標了放行註解的行不檢查', () => {
  assert.deepEqual(rules('```bash\ngit show 4b384b7 # 見 #410\n```'), []);
  assert.deepEqual(rules('修正前的資料格式相同。 <!-- doc-history: allow -->'), []);
});

test('回報違規所在的行號', () => {
  const v = findViolations('第一行\n第二行（#410）', opts);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 2);
});
