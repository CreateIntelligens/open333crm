/**
 * 檢查 feature 測試用的 app_tenant／app_admin 能不能登入測試資料庫。
 *
 * 這兩個角色屬於整個 PostgreSQL，與開發資料庫共用。全域 setup 只在角色還沒有密碼時設定密碼，
 * 本機的角色若已有其他密碼，setup 不會改它，用到這兩個角色的測試就全部以 500 INTERNAL_ERROR 失敗。
 * 這裡在跑測試前先試著登入，失敗時停下來並說明怎麼修。
 */
import { appRolePasswords } from './feature-config.js';

export type AppRole = keyof typeof appRolePasswords;

const ENV_VAR: Record<AppRole, string> = {
  app_tenant: 'TEST_APP_TENANT_PASSWORD',
  app_admin: 'TEST_APP_ADMIN_PASSWORD',
};

/** Prisma 的 P1000：帳號或密碼錯誤 */
function isAuthFailure(err: unknown): boolean {
  const e = err as { errorCode?: string; message?: string };
  return e?.errorCode === 'P1000' || /Authentication failed/i.test(e?.message ?? '');
}

/**
 * 逐一試登入，回傳密碼錯誤的角色。其他連線錯誤照樣拋出，不當成密碼錯誤。
 * @param tryLogin 以設定的密碼登入測試資料庫，失敗時拋出錯誤
 */
export async function findRolesWithWrongPassword(
  roles: AppRole[],
  tryLogin: (role: AppRole) => Promise<void>,
): Promise<AppRole[]> {
  const wrong: AppRole[] = [];
  for (const role of roles) {
    try {
      await tryLogin(role);
    } catch (err) {
      if (!isAuthFailure(err)) throw err;
      wrong.push(role);
    }
  }
  return wrong;
}

/** 說明哪些角色登不進去，以及兩種修正方式 */
export function roleLoginErrorMessage(roles: AppRole[], passwords = appRolePasswords): string {
  const envLines = roles.map((role) => `    ${ENV_VAR[role]}=<${role} 目前的密碼>`).join('\n');
  const sqlLines = roles.map((role) => `    ALTER ROLE ${role} PASSWORD '${passwords[role]}';`).join('\n');
  return [
    `Feature 測試無法以 ${roles.join('、')} 登入測試資料庫：密碼錯誤。`,
    '這兩個角色屬於整個 PostgreSQL，與開發資料庫共用；角色已經有密碼時，setup 不會修改它。',
    '修正方式擇一：',
    '  1. 以環境變數提供角色目前的密碼：',
    envLines,
    '  2. 開發環境沒有以這些角色連線時，把角色密碼改成測試設定的密碼（只在本機執行）：',
    sqlLines,
    '     例如：docker exec -i open333crm-dev-postgres-1 psql -U crm -d postgres',
  ].join('\n');
}
