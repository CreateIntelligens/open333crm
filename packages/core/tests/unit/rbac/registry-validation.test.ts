/**
 * 主規格 permission-model 的「權限碼命名」與「啟動時驗證註冊表」：註冊表有錯時驗證要失敗
 * （change restore-rbac-permission-specs）。
 *
 * validatePermissionRegistry() 讀模組層級的 PERMISSIONS，所以每個情境換掉 permissions 模組，
 * 再重新載入 registry。測試名稱以「情境名稱：說明」開頭。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import type { PermissionDef } from '#src/rbac/permissions.js';

const def = (code: string, extra: Partial<PermissionDef> = {}): PermissionDef => ({
  code,
  group: '測試',
  feature: 'core',
  label: code,
  description: code,
  ...extra,
});

/** 合法的最小註冊表：有一個 selfLock 權限點 */
const VALID = [def('role.manage', { selfLock: true }), def('tag.view')];

async function validateWith(perms: PermissionDef[]) {
  vi.resetModules();
  vi.doMock('#src/rbac/permissions.js', () => ({
    PERMISSIONS: perms,
    PERMISSION_CODES: new Set(perms.map((p) => p.code)),
    PERMISSION_BY_CODE: new Map(perms.map((p) => [p.code, p])),
  }));
  const { validatePermissionRegistry } = await import('#src/rbac/registry.js');
  return validatePermissionRegistry().join('\n');
}

afterEach(() => {
  vi.doUnmock('#src/rbac/permissions.js');
});

test('合法的最小註冊表：驗證沒有錯誤（確認以下情境的錯誤來自各自的缺陷）', async () => {
  assert.equal(await validateWith(VALID), '');
});

test('重複的權限碼讓驗證失敗：錯誤訊息含重複的碼', async () => {
  const errors = await validateWith([...VALID, def('tag.view')]);
  assert.match(errors, /tag\.view/);
});

test('指向不存在的權限碼：錯誤訊息含該碼', async () => {
  const errors = await validateWith([...VALID, def('tag.manage', { dependsOn: ['nonexistent.code'] })]);
  assert.match(errors, /nonexistent\.code/);
});

test('implies 形成循環：錯誤訊息含循環上的碼', async () => {
  const errors = await validateWith([
    ...VALID,
    def('a.x', { implies: ['b.y'] }),
    def('b.y', { implies: ['a.x'] }),
  ]);
  assert.match(errors, /a\.x/);
  assert.match(errors, /b\.y/);
});

test('同一個權限碼同時是前置與隱含權限：錯誤訊息含該碼', async () => {
  const errors = await validateWith([...VALID, def('tag.manage', { dependsOn: ['tag.view'], implies: ['tag.view'] })]);
  assert.match(errors, /tag\.view/);
});

test('不存在的功能：錯誤訊息含該權限碼', async () => {
  const errors = await validateWith([...VALID, def('ghost.view', { feature: 'no-such-feature' })]);
  assert.match(errors, /ghost\.view/);
});

test('沒有 selfLock 的權限點：驗證失敗', async () => {
  const errors = await validateWith([def('role.manage'), def('tag.view')]);
  assert.notEqual(errors, '');
});
