import { describe, it, expect } from 'vitest';
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

describe('RBAC permission registry', () => {
  it('正式 registry 通過所有完整性驗證（無重複/懸空/成環/feature 缺失）', () => {
    const errors = validatePermissionRegistry();
    expect(errors).toEqual([]);
  });

  it('每個權限點恰好歸屬一個存在的 feature', () => {
    for (const p of PERMISSIONS) {
      expect(FEATURE_SLUGS.has(p.feature)).toBe(true);
    }
  });

  it('每個 feature 宣告的權限碼都存在於 registry（反向對應）', () => {
    const fp = buildFeaturePerms();
    for (const codes of fp.values()) {
      for (const code of codes) expect(PERMISSION_CODES.has(code)).toBe(true);
    }
  });

  it('dependsOn / implies 參照的權限碼都存在', () => {
    for (const p of PERMISSIONS) {
      for (const d of p.dependsOn ?? []) expect(PERMISSION_CODES.has(d)).toBe(true);
      for (const i of p.implies ?? []) expect(PERMISSION_CODES.has(i)).toBe(true);
    }
  });
});

describe('resolveImplied（implies 遞迴閉包）', () => {
  it('case.assign 展開後含 agent.view（跨模組隱含）', () => {
    const eff = resolveImplied(['case.assign']);
    expect(eff.has('case.assign')).toBe(true);
    expect(eff.has('agent.view')).toBe(true);
  });

  it('marketing.broadcast 展開後含 channel.view', () => {
    const eff = resolveImplied(['marketing.broadcast']);
    expect(eff.has('channel.view')).toBe(true);
  });

  it('無 implies 的權限只回自己', () => {
    const eff = resolveImplied(['inbox.view']);
    expect([...eff]).toEqual(['inbox.view']);
  });
});

describe('permsForFeatures（feature → 權限點天花板）', () => {
  it('inbox feature 展開含 inbox.* case.* 等', () => {
    const ceiling = permsForFeatures(['inbox']);
    expect(ceiling.has('inbox.view')).toBe(true);
    expect(ceiling.has('case.assign')).toBe(true);
    expect(ceiling.has('channel.create')).toBe(false); // 不屬 inbox
  });

  it('core feature 展開含 role.manage / agent.manage / settings.manage', () => {
    const ceiling = permsForFeatures(['core']);
    expect(ceiling.has('role.manage')).toBe(true);
    expect(ceiling.has('agent.manage')).toBe(true);
    expect(ceiling.has('settings.manage')).toBe(true);
  });
});

describe('validateRouteCodes（route-to-registry 一致性）', () => {
  it('全部存在的碼 → 無錯', () => {
    expect(validateRouteCodes(['inbox.view', 'channel.create'])).toEqual([]);
  });

  it('不存在的碼 → 報錯', () => {
    const errors = validateRouteCodes(['nonexistent.code']);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('nonexistent.code');
  });
});
