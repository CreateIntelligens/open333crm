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
  PERMISSION_BY_CODE,
  DEFAULT_ROLE_PERMISSIONS,
} from '#src/rbac/index.js';

import { test as t } from 'vitest';
// ─── registry 完整性 ──────────────────────────────────────────────────────

t('正式的註冊表通過驗證：無重複、懸空參照、循環與不存在的功能', () => {
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

// 前端的角色與權限頁只處理一層 dependsOn：勾選時只補直接的前置權限，取消時只連帶直接的相依權限，
// admin 內建鎖定也只鎖 adminLock 碼的直接前置權限。註冊表出現多層時，頁面會做出後端拒絕（422）的設定。
t('dependsOn 只有一層：前置權限本身沒有 dependsOn', () => {
  for (const p of PERMISSIONS) {
    for (const d of p.dependsOn ?? []) {
      const nested = PERMISSION_BY_CODE.get(d)?.dependsOn ?? [];
      assert.deepEqual(
        nested,
        [],
        `${p.code} 依賴 ${d}，${d} 又依賴 ${nested.join('、')}。` +
          '要支援多層 dependsOn，先改 apps/web/src/components/settings/RolePermissionMatrix.tsx 的 ' +
          'enablePrereqs()、dependents() 與 adminLockedCodes，改成遞迴處理，再調整這個測試',
      );
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

t('implies 的權限碼遞迴加入：case.assign 展開後含 agent.view', () => {
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

t('路由用的權限碼都在註冊表內：沒有錯誤', () => {
  assert.deepEqual(validateRouteCodes(['inbox.view', 'channel.create']), []);
});

t('路由用了不在註冊表的權限碼：錯誤訊息含該碼', () => {
  const errors = validateRouteCodes(['newfeature.action']);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('newfeature.action'), '錯誤訊息應指出是哪個碼');
});

// ─── 主規格 permission-model（change restore-rbac-permission-specs）──────────

t('每個權限點的必要欄位都有值：code、group、feature、label、description 不是空字串', () => {
  for (const p of PERMISSIONS) {
    for (const field of ['code', 'group', 'feature', 'label', 'description'] as const) {
      assert.ok(p[field]?.trim(), `${p.code} 的 ${field} 是空的`);
    }
  }
});

t('註冊表的權限碼都符合命名規則：兩段以上的小寫片段，片段可含 - 與 _', () => {
  for (const code of PERMISSION_CODES) {
    assert.match(code, /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]*)+$/, `${code} 不符合命名規則`);
  }
});

const COMPLIANCE_CODES = ['audit.view', 'data.export', 'data.erase'];

t('三個權限碼屬於 core 功能：audit.view、data.export、data.erase', () => {
  for (const code of COMPLIANCE_CODES) {
    assert.equal(PERMISSION_BY_CODE.get(code)?.feature, 'core', code);
  }
});

t('data.erase 依賴 contact.view', () => {
  assert.ok(PERMISSION_BY_CODE.get('data.erase')?.dependsOn?.includes('contact.view'));
});

t('預設只有 admin 有：supervisor 與 agent 的預設權限不含稽核與合規的權限碼', () => {
  for (const code of COMPLIANCE_CODES) {
    assert.ok(DEFAULT_ROLE_PERMISSIONS.admin.includes(code), `admin 應有 ${code}`);
    assert.equal(DEFAULT_ROLE_PERMISSIONS.supervisor.includes(code), false, `supervisor 不應有 ${code}`);
    assert.equal(DEFAULT_ROLE_PERMISSIONS.agent.includes(code), false, `agent 不應有 ${code}`);
  }
});
