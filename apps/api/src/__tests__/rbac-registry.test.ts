/**
 * RBAC 權限登錄檔完整性驗證。
 *   npx tsx src/__tests__/rbac-registry.test.ts
 *
 * ⚠️ 這支測試原本用 vitest 撰寫，但專案從未安裝 vitest
 * （root 與 apps/api 的 package.json 都沒有），所以從寫出來到
 * 2026-09-23 為止從來沒有真正執行過——11 個案例一直是死的。
 * 改寫成與其他測試一致的 node:assert + tsx 寫法，內容與斷言維持原樣。
 *
 * 驗的是權限系統的結構完整性：沒有重複／懸空參照／成環／feature 缺失。
 * 這類錯誤在執行期不會拋例外，只會讓某些人默默拿不到該有的權限，
 * 或拿到不該有的——所以值得用測試釘住。
 */
import assert from 'node:assert/strict';
import {
  PERMISSIONS,
  PERMISSION_CODES,
  validatePermissionRegistry,
  validateRouteCodes,
  resolveImplied,
  permsForFeatures,
  buildFeaturePerms,
  FEATURE_SLUGS,
} from '@open333crm/core';

let pass = 0;
let fail = 0;

function t(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${(err as Error).message}`);
    fail += 1;
  }
}

// ─── registry 完整性 ──────────────────────────────────────────────────────

t('正式 registry 通過所有完整性驗證（無重複/懸空/成環/feature 缺失）', () => {
  assert.deepEqual(validatePermissionRegistry(), []);
});

t('每個權限點恰好歸屬一個存在的 feature', () => {
  for (const p of PERMISSIONS) {
    assert.ok(FEATURE_SLUGS.has(p.feature), `權限 ${p.code} 的 feature「${p.feature}」不存在`);
  }
});

t('每個 feature 宣告的權限碼都存在於 registry（反向對應）', () => {
  const fp = buildFeaturePerms();
  for (const [feature, codes] of fp.entries()) {
    for (const code of codes) {
      assert.ok(PERMISSION_CODES.has(code), `feature「${feature}」宣告了不存在的權限碼 ${code}`);
    }
  }
});

t('dependsOn / implies 參照的權限碼都存在', () => {
  for (const p of PERMISSIONS) {
    for (const d of p.dependsOn ?? []) {
      assert.ok(PERMISSION_CODES.has(d), `${p.code} 的 dependsOn 參照了不存在的 ${d}`);
    }
    for (const i of p.implies ?? []) {
      assert.ok(PERMISSION_CODES.has(i), `${p.code} 的 implies 參照了不存在的 ${i}`);
    }
  }
});

// ─── resolveImplied（implies 遞迴閉包）───────────────────────────────────

t('case.assign 展開後含 agent.view（跨模組隱含）', () => {
  const eff = resolveImplied(['case.assign']);
  assert.ok(eff.has('case.assign'));
  assert.ok(eff.has('agent.view'), 'case.assign 應隱含 agent.view');
});

t('marketing.broadcast 展開後含 channel.view', () => {
  const eff = resolveImplied(['marketing.broadcast']);
  assert.ok(eff.has('channel.view'));
});

t('無 implies 的權限只回自己', () => {
  assert.deepEqual([...resolveImplied(['inbox.view'])], ['inbox.view']);
});

// ─── permsForFeatures（feature → 權限點天花板）──────────────────────────

t('inbox feature 展開含 inbox.* case.* 等', () => {
  const ceiling = permsForFeatures(['inbox']);
  assert.ok(ceiling.has('inbox.view'));
  assert.ok(ceiling.has('case.assign'));
  assert.equal(ceiling.has('channel.create'), false, 'channel.create 不屬於 inbox feature');
});

t('core feature 展開含 role.manage / agent.manage / settings.manage', () => {
  const ceiling = permsForFeatures(['core']);
  assert.ok(ceiling.has('role.manage'));
  assert.ok(ceiling.has('agent.manage'));
  assert.ok(ceiling.has('settings.manage'));
});

// ─── validateRouteCodes（route-to-registry 一致性）──────────────────────

t('全部存在的碼 → 無錯', () => {
  assert.deepEqual(validateRouteCodes(['inbox.view', 'channel.create']), []);
});

t('不存在的碼 → 報錯', () => {
  const errors = validateRouteCodes(['nonexistent.code']);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('nonexistent.code'), '錯誤訊息應指出是哪個碼');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
