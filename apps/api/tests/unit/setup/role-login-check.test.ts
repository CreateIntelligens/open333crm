/**
 * feature 測試的全域 setup：app_tenant／app_admin 登不進測試資料庫時，要在跑測試前停下來並說明原因。
 * 這兩個角色屬於整個 PostgreSQL，setup 只在角色還沒有密碼時設定密碼。本機的角色若已有其他密碼，
 * 原本每個用到這兩個角色的測試都會以 500 INTERNAL_ERROR 失敗，看不出原因。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { findRolesWithWrongPassword, roleLoginErrorMessage } from '../../setup/role-login-check.js';

const authError = (role: string) =>
  Object.assign(new Error(`Authentication failed against database server, the provided database credentials for \`${role}\` are not valid.`), { errorCode: 'P1000' });

test('密碼錯誤的角色會被找出來', async () => {
  const roles = await findRolesWithWrongPassword(['app_tenant', 'app_admin'], async (role) => {
    if (role === 'app_tenant') throw authError(role);
  });
  assert.deepEqual(roles, ['app_tenant']);
});

test('兩個角色都登得進去時回傳空陣列', async () => {
  const roles = await findRolesWithWrongPassword(['app_tenant', 'app_admin'], async () => {});
  assert.deepEqual(roles, []);
});

test('不是密碼錯誤的連線錯誤照樣拋出', async () => {
  await assert.rejects(
    findRolesWithWrongPassword(['app_tenant'], async () => { throw new Error("Can't reach database server"); }),
    /Can't reach database server/,
  );
});

test('錯誤訊息列出角色，並說明兩種修正方式', () => {
  const message = roleLoginErrorMessage(['app_tenant', 'app_admin']);
  assert.match(message, /app_tenant/);
  assert.match(message, /app_admin/);
  assert.match(message, /TEST_APP_TENANT_PASSWORD/);
  assert.match(message, /TEST_APP_ADMIN_PASSWORD/);
  assert.match(message, /ALTER ROLE app_tenant PASSWORD 'app_tenant_local'/);
});

test('以環境變數提供的密碼不出現在錯誤訊息中', () => {
  const message = roleLoginErrorMessage(['app_tenant'], { app_tenant: "s3cret'pw", app_admin: 'app_admin_local' });
  assert.doesNotMatch(message, /s3cret/);
  assert.match(message, /\\password app_tenant/);
});
