/**
 * 導覽目錄的安全規則（change add-dashboard-guide-assistant，規格 dashboard-guide-assistant「導覽目錄的安全規則」）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { GUIDE_CATALOG } from '#src/guide/guide-catalog.js';
import { PERMISSIONS } from '#src/rbac/permissions.js';

test('目錄有關鍵字自動回覆的導覽', () => {
  const guide = GUIDE_CATALOG.find((g) => g.id === 'keyword-reply.create');
  assert.equal(guide?.route, '/dashboard/line/keyword-replies');
  assert.deepEqual(guide?.steps.map((s) => s.target), ['keyword-reply.open', 'keyword-reply.keyword']);
});

test('導覽的 id 不重複', () => {
  const ids = GUIDE_CATALOG.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('最後一步是標示', () => {
  for (const guide of GUIDE_CATALOG) {
    assert.ok(guide.steps.length > 0, `${guide.id} 至少一個步驟`);
    assert.equal(guide.steps.at(-1)?.action, 'highlight', guide.id);
  }
});

test('點開的目標以 .open 結尾', () => {
  for (const guide of GUIDE_CATALOG) {
    for (const step of guide.steps) {
      assert.ok(['click', 'highlight'].includes(step.action), `${guide.id} 的動作只能是 click 或 highlight`);
      if (step.action === 'click') assert.match(step.target, /\.open$/, `${guide.id} 的 ${step.target}`);
    }
  }
});

test('功能頁路徑以 /dashboard/ 開頭', () => {
  for (const guide of GUIDE_CATALOG) assert.match(guide.route, /^\/dashboard\//, guide.id);
});

test('權限碼存在於註冊表', () => {
  const codes = new Set(PERMISSIONS.map((p) => p.code));
  for (const guide of GUIDE_CATALOG) assert.ok(codes.has(guide.requiredPermission), `${guide.id}：${guide.requiredPermission}`);
});
