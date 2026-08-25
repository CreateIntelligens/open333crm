/**
 * Registry 驗證與解析工具
 *
 * - validatePermissionRegistry(): 啟動/CI 驗證（重複 code、懸空參照、implies 成環、feature 對應）
 * - resolveImplied(): 展開 implies 遞迴閉包（權限判斷用）
 * - buildFeaturePerms(): feature → 涵蓋的權限點
 * - permsForFeatures(): 一組 feature 展開成權限點天花板（平台 entitlement 用）
 *
 * 對應 SPEC.md §3.3（完整性驗證）、§4.6/permission-check（implies 閉包）、
 * ARCH-PLATFORM-LAYER §0.1（feature 對應驗證）。
 */

import { PERMISSIONS, PERMISSION_BY_CODE, type PermissionDef } from './permissions';
import { FEATURE_SLUGS } from './features';

/** feature slug → 該 feature 涵蓋的權限碼陣列 */
export function buildFeaturePerms(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const p of PERMISSIONS) {
    const arr = m.get(p.feature) ?? [];
    arr.push(p.code);
    m.set(p.feature, arr);
  }
  return m;
}

/** 一組 feature slug 展開成權限碼天花板集合 */
export function permsForFeatures(features: Iterable<string>): Set<string> {
  const featurePerms = buildFeaturePerms();
  const out = new Set<string>();
  for (const f of features) {
    for (const code of featurePerms.get(f) ?? []) out.add(code);
  }
  return out;
}

/**
 * 展開一組明確授予的權限碼，加上 implies 遞迴閉包。
 * 用於權限判斷：有效權限 = 明確授予 ∪ implies 閉包。
 */
export function resolveImplied(granted: Iterable<string>): Set<string> {
  const result = new Set<string>();
  const stack = [...granted];
  while (stack.length) {
    const code = stack.pop()!;
    if (result.has(code)) continue;
    result.add(code);
    const def = PERMISSION_BY_CODE.get(code);
    if (def?.implies) {
      for (const imp of def.implies) {
        if (!result.has(imp)) stack.push(imp);
      }
    }
  }
  return result;
}

/**
 * 驗證權限 registry 完整性。回傳錯誤訊息陣列（空 = 通過）。
 * 應在啟動時呼叫，有錯即讓啟動失敗。
 */
export function validatePermissionRegistry(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const p of PERMISSIONS) {
    // 1. 重複 code
    if (seen.has(p.code)) errors.push(`重複的權限碼: ${p.code}`);
    seen.add(p.code);

    // 2. feature 必須存在
    if (!FEATURE_SLUGS.has(p.feature)) {
      errors.push(`權限 ${p.code} 的 feature「${p.feature}」不存在於 FEATURE registry`);
    }

    // 3. dependsOn / implies 懸空參照
    for (const dep of p.dependsOn ?? []) {
      if (!PERMISSION_BY_CODE.has(dep)) errors.push(`權限 ${p.code} 的 dependsOn「${dep}」不存在`);
    }
    for (const imp of p.implies ?? []) {
      if (!PERMISSION_BY_CODE.has(imp)) errors.push(`權限 ${p.code} 的 implies「${imp}」不存在`);
    }

    // 4. 同一對不可同時出現在 dependsOn 與 implies
    const deps = new Set(p.dependsOn ?? []);
    for (const imp of p.implies ?? []) {
      if (deps.has(imp)) errors.push(`權限 ${p.code} 的「${imp}」不可同時為 dependsOn 與 implies`);
    }
  }

  // 5. implies 成環偵測（DFS）
  const cycleErr = detectImpliesCycle();
  if (cycleErr) errors.push(cycleErr);

  // 6. self-lock 完整性：至少需一個 selfLock:true 權限（如 role.manage）。
  //    否則 agent.service 的「防自我降級鎖死」守門（SELF_LOCK_CODES 為空時整段跳過）
  //    會無聲失效（fail-open）→ 最後一位管理者可把自己降級鎖死租戶。fail-loud 擋在啟動。
  if (!PERMISSIONS.some((p) => p.selfLock)) {
    errors.push('registry 缺少任何 selfLock:true 權限點：防自我降級鎖死守門將失效，請保留至少一個（如 role.manage）');
  }

  return errors;
}

function detectImpliesCycle(): string | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const path: string[] = [];

  function dfs(code: string): string | null {
    color.set(code, GRAY);
    path.push(code);
    const def = PERMISSION_BY_CODE.get(code);
    for (const imp of def?.implies ?? []) {
      const c = color.get(imp) ?? WHITE;
      if (c === GRAY) {
        const idx = path.indexOf(imp);
        return `implies 成環: ${path.slice(idx).concat(imp).join(' → ')}`;
      }
      if (c === WHITE) {
        const r = dfs(imp);
        if (r) return r;
      }
    }
    path.pop();
    color.set(code, BLACK);
    return null;
  }

  for (const p of PERMISSIONS) {
    if ((color.get(p.code) ?? WHITE) === WHITE) {
      const r = dfs(p.code);
      if (r) return r;
    }
  }
  return null;
}

/**
 * 驗證一組「路由使用的權限碼」都存在於 registry（route-to-registry 一致性）。
 * usedCodes 由路由掃描或 requirePermission 註冊收集。
 */
export function validateRouteCodes(usedCodes: Iterable<string>): string[] {
  const errors: string[] = [];
  for (const code of usedCodes) {
    if (!PERMISSION_BY_CODE.has(code)) {
      errors.push(`路由使用的權限碼「${code}」不存在於 registry`);
    }
  }
  return errors;
}

export type { PermissionDef };
