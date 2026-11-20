/**
 * 導覽目錄的每個 target 在前端程式碼裡都有對應的 `data-guide` 值（change add-dashboard-guide-assistant）。
 *
 * 這是讀原始碼的測試：導覽元素分散在 12 個頁面，行為測試要渲染每一頁才能檢查。
 * 頁面改版時刪掉或改名 `data-guide`，導覽就會「找不到這個欄位」，這個測試先擋下來。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { GUIDE_CATALOG } from '@open333crm/shared';

const SRC = fileURLToPath(new URL('../../../../src', import.meta.url));

function readSources(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return readSources(path);
      return /\.tsx?$/.test(entry.name) ? readFileSync(path, 'utf8') : '';
    })
    .join('\n');
}

test('每個導覽步驟的 target 都有 data-guide', () => {
  const source = readSources(SRC);
  for (const guide of GUIDE_CATALOG) {
    for (const step of guide.steps) {
      const found =
        source.includes(`data-guide="${step.target}"`) ||
        source.includes(`'${step.target}'`) ||
        source.includes(`guide="${step.target}"`);
      assert.ok(found, `${guide.id} 的 ${step.target} 在 apps/web/src 找不到`);
    }
  }
});
