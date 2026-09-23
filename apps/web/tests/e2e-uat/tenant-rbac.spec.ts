import { test, expect, APIRequestContext, request as pwRequest } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { API_BASE, gotoAndCheck } from './helpers';

/**
 * 三角色 RBAC 矩陣驗證（唯讀）：驗證側欄可見性 + 頁面存取 + API 403 邊界符合實際權限矩陣。
 *
 * ⚠️ 本檔完全不寫入任何資料，純粹用三個角色各自的 session 讀取/導覽頁面。
 *
 * 權限矩陣基準（2026-09-03 直接查 UAT `/auth/me/permissions`，即前端 hasPermission 用的
 * 「有效權限」——已含 implies 閉包，非 role.service 的原始 RolePermission 清單）：
 *
 *   權限碼             ADMIN  SUPERVISOR  AGENT
 *   automation.view      Y       Y          N
 *   knowledge.view       Y       Y          Y
 *   marketing.view       Y       Y          N
 *   richmenu.manage      Y       Y          N
 *   portal.view          Y       N          N
 *   shortlink.view       Y       Y          Y
 *   analytics.view       Y       Y          N   （AGENT 只有 analytics.view.self）
 *   settings.manage      Y       Y          N
 *   role.view            Y       Y          N   （SUPERVISOR 經 agent.role.assign implies role.view 取得，
 *                                                 但 role.service 的 RolePermission 原始清單裡看不到，
 *                                                 只有查 /auth/me/permissions 這種「有效權限」才看得到）
 *
 * 也就是說：本 UAT 租戶 SUPERVISOR 側欄可見性幾乎與 ADMIN 一致（差在 portal），
 * AGENT 明顯較窄（automation/marketing/richmenu/portal/analytics/settings/role 皆無）。
 *
 * 前端行為澄清（讀程式碼確認，非猜測）：
 * - DashboardLayout（src/app/dashboard/layout.tsx）只在 `!agent`（未登入）時導回 /login，
 *   對已登入但缺權限的角色「不會」做頁面級導頁或阻擋——受限頁面（如 /dashboard/settings、
 *   /dashboard/analytics、/dashboard/portal、/dashboard/shortlinks）本身沒有 usePermission 頁面守衛，
 *   直接訪問一樣會正常載入外殼（Topbar/版面），差別在於：
 *     1. 側欄不會顯示該連結入口（Sidebar.tsx 依 hasPermission 過濾）
 *     2. settings 頁內「角色與權限」tab 依 role.view 決定是否顯示在 tab 清單中
 *     3. 頁面內部呼叫對應 API 時，後端 requirePermission 會回 403（前端各元件對 403 的
 *        呈現不盡相同，不逐一斷言 UI 訊息文字，改用 API 層 403 驗證更可靠、不受 UI 文案影響）
 * - 因此「直接訪問受限頁面」的驗證重點放在「頁面外殼仍載入（非跳轉 /login）」，
 *   實際的權限邊界用 API 層 403/200 驗證（更直接可靠，見案例 5）。
 */

/**
 * RBAC 測試場景會出現「預期中」的 console 噪音，不能套用 gotoAndCheck 慣用的零錯誤斷言：
 * ① 低權限角色（SUPERVISOR/AGENT）在頁面打無權限 API（automation/rules、portal/activities…）
 *    收到合法的 401/403，這正是 RBAC 生效的證據而非 bug；
 * ② dashboard `cases?status=open` 400 是已知 CM-163（大小寫不符），待部署後解除，非本次該擋；
 * ③ 第三方 WebTalk SDK 載入失敗是環境噪音，與 RBAC 無關。
 * 真正異常（500、未攔截的 JS 例外等）仍要抓出來，故用白名單排除法而非整段吞掉。
 */
function assertNoUnexpectedConsoleErrors(consoleErrors: string[]) {
  const unexpected = consoleErrors.filter(
    (e) =>
      !/status of (401|403)/.test(e) &&
      !(/status of 400/.test(e) && /cases\?status=open/.test(e)) &&
      !/Failed to initialize WebTalk|Failed to load WebTalk SDK/.test(e),
  );
  expect(unexpected, `非預期 console 錯誤：\n${unexpected.join('\n')}`).toHaveLength(0);
}

test.describe('@rbac 三角色 RBAC 矩陣', () => {
  // ---------------------------------------------------------------------
  // 共用：各角色獨立 API token（用 refreshToken cookie 換 accessToken）
  // ---------------------------------------------------------------------

  async function getApiTokenForRole(stateFile: string): Promise<string> {
    const state = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../', stateFile), 'utf8'),
    );
    const cookie = (state.cookies || []).find(
      (c: { name: string }) => c.name === 'refreshToken',
    );
    if (!cookie) throw new Error(`${stateFile} 內找不到 refreshToken，請重跑 capture-auth-role`);
    const ctx = await pwRequest.newContext({ ignoreHTTPSErrors: true });
    try {
      const res = await ctx.post(`${API_BASE}/auth/refresh`, {
        headers: { Cookie: `refreshToken=${cookie.value}` },
        data: {},
      });
      if (!res.ok()) {
        throw new Error(
          `${stateFile} auth/refresh 失敗（${res.status()}）——session 已失效，請重跑 capture-auth-role`,
        );
      }
      const body = await res.json();
      const token = body?.data?.accessToken;
      if (!token) throw new Error(`${stateFile} auth/refresh 回應中沒有 accessToken`);
      return token;
    } finally {
      await ctx.dispose();
    }
  }

  async function newRoleApiContext(stateFile: string): Promise<APIRequestContext> {
    const token = await getApiTokenForRole(stateFile);
    return pwRequest.newContext({
      baseURL: `${API_BASE}/`,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  // ---------------------------------------------------------------------
  // 案例 1：ADMIN — 側欄全可見 + /dashboard/settings 可正常載入
  // ---------------------------------------------------------------------
  test.describe('ADMIN', () => {
    test.use({ storageState: 'auth-state.json' });

    test('@rbac ADMIN 側欄可見管理類連結（analytics/settings/portal/shortlinks）', async ({
      page,
    }) => {
      await gotoAndCheck(page, '/dashboard');
      const nav = page.locator('nav');
      await expect(nav.getByRole('link', { name: '報表' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '設定' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '粉絲活動' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '短連結' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '自動化' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '行銷' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '方案' })).toBeVisible();
    });

    test('@rbac ADMIN 直接訪問 /dashboard/settings 可正常載入，且「角色與權限」tab 可見', async ({
      page,
    }) => {
      const consoleErrors = await gotoAndCheck(page, '/dashboard/settings');
      await expect(page.getByRole('button', { name: '角色與權限' })).toBeVisible();
      assertNoUnexpectedConsoleErrors(consoleErrors);
    });
  });

  // ---------------------------------------------------------------------
  // 案例 2：SUPERVISOR — 本租戶實測與 ADMIN 幾乎一致（差在 portal.view）
  // ---------------------------------------------------------------------
  test.describe('SUPERVISOR', () => {
    test.use({ storageState: 'auth-state-supervisor.json' });

    test('@rbac SUPERVISOR 側欄可見性：與 ADMIN 相同，唯獨「粉絲活動」不可見（無 portal.view）', async ({
      page,
    }) => {
      await gotoAndCheck(page, '/dashboard');
      const nav = page.locator('nav');
      await expect(nav.getByRole('link', { name: '報表' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '設定' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '短連結' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '自動化' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '行銷' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '方案' })).toBeVisible();
      // 唯一差異：SUPERVISOR 無 portal.view，「粉絲活動」連結不應出現
      await expect(nav.getByRole('link', { name: '粉絲活動' })).toHaveCount(0);
    });

    test('@rbac SUPERVISOR 直接訪問 /dashboard/settings 頁面外殼仍正常載入（有 settings.manage + role.view）', async ({
      page,
    }) => {
      const consoleErrors = await gotoAndCheck(page, '/dashboard/settings');
      // SUPERVISOR 經 agent.role.assign 隱含 role.view，「角色與權限」tab 應可見
      await expect(page.getByRole('button', { name: '角色與權限' })).toBeVisible();
      assertNoUnexpectedConsoleErrors(consoleErrors);
    });

    test('@rbac SUPERVISOR 直接訪問 /dashboard/portal（無 portal.view）頁面外殼仍載入，非導回登入頁', async ({
      page,
    }) => {
      // DashboardLayout 只在未登入時導頁，缺權限不會被導頁——驗證「仍在受限頁面」而非跳轉
      const consoleErrors = await gotoAndCheck(page, '/dashboard/portal');
      expect(page.url()).toContain('/dashboard/portal');
      // 側欄本身仍應渲染（版面外殼正常，只是入口連結不會出現在導覽中）
      await expect(page.locator('nav').first()).toBeVisible();
      assertNoUnexpectedConsoleErrors(consoleErrors);
    });
  });

  // ---------------------------------------------------------------------
  // 案例 3：AGENT — 管理類連結大多不可見，直接訪問受限頁仍載入外殼
  // ---------------------------------------------------------------------
  test.describe('AGENT', () => {
    test.use({ storageState: 'auth-state-agent.json' });

    test('@rbac AGENT 側欄不可見管理類連結（automation/marketing/richmenu/portal/analytics/settings 相關的方案連結）', async ({
      page,
    }) => {
      await gotoAndCheck(page, '/dashboard');
      const nav = page.locator('nav');
      await expect(nav.getByRole('link', { name: '自動化' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: '行銷' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'LINE 管理' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: '粉絲活動' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: '報表' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: '方案' })).toHaveCount(0);
      // AGENT 仍有 shortlink.view/knowledge.view → 這兩個連結應可見
      await expect(nav.getByRole('link', { name: '短連結' })).toBeVisible();
      await expect(nav.getByRole('link', { name: '知識庫' })).toBeVisible();
      // 「設定」連結本身無 perm gating（一律顯示），但內容依權限收斂（見下個案例）
      await expect(nav.getByRole('link', { name: '設定' })).toBeVisible();
    });

    test('@rbac AGENT 直接訪問 /dashboard/settings 頁面外殼仍載入，但「角色與權限」tab 不可見（無 role.view）', async ({
      page,
    }) => {
      const consoleErrors = await gotoAndCheck(page, '/dashboard/settings');
      expect(page.url()).toContain('/dashboard/settings');
      await expect(page.getByRole('button', { name: '角色與權限' })).toHaveCount(0);
      assertNoUnexpectedConsoleErrors(consoleErrors);
    });
  });

  // ---------------------------------------------------------------------
  // 案例 4：三角色都能存取的核心工作頁面
  // ---------------------------------------------------------------------
  const CORE_PAGES: Array<{ path: string; name: string }> = [
    { path: '/dashboard', name: '儀表板首頁' },
    { path: '/dashboard/inbox', name: '收件匣' },
    { path: '/dashboard/cases', name: '案件' },
  ];
  const ROLE_STATES: Array<{ label: string; storageState: string }> = [
    { label: 'ADMIN', storageState: 'auth-state.json' },
    { label: 'SUPERVISOR', storageState: 'auth-state-supervisor.json' },
    { label: 'AGENT', storageState: 'auth-state-agent.json' },
  ];

  for (const role of ROLE_STATES) {
    test.describe(`核心頁面 - ${role.label}`, () => {
      test.use({ storageState: role.storageState });

      for (const p of CORE_PAGES) {
        test(`@rbac ${role.label} 可正常載入「${p.name}」(${p.path})`, async ({ page }) => {
          const consoleErrors = await gotoAndCheck(page, p.path);
          await expect(page.locator('main, [role="main"], .dashboard, body').first()).not.toBeEmpty();
          assertNoUnexpectedConsoleErrors(consoleErrors);
        });
      }
    });
  }

  // ---------------------------------------------------------------------
  // 案例 5：代表性 API 403 驗證（settingsRoutes 對整個 plugin 掛
  // requirePermission('settings.manage')，故 /settings/api-keys 對三角色而言
  // 是 settings.manage 的直接照妖鏡：ADMIN/SUPERVISOR 200，AGENT 403）
  // ---------------------------------------------------------------------
  test('@rbac API 層 settings.manage 邊界：ADMIN/SUPERVISOR 200，AGENT 403（GET /settings/api-keys）', async () => {
    const adminApi = await newRoleApiContext('auth-state.json');
    const supervisorApi = await newRoleApiContext('auth-state-supervisor.json');
    const agentApi = await newRoleApiContext('auth-state-agent.json');
    try {
      const [adminRes, supervisorRes, agentRes] = await Promise.all([
        adminApi.get('settings/api-keys'),
        supervisorApi.get('settings/api-keys'),
        agentApi.get('settings/api-keys'),
      ]);
      expect(adminRes.status(), 'ADMIN 應有 settings.manage → 200').toBe(200);
      expect(supervisorRes.status(), 'SUPERVISOR 應有 settings.manage → 200').toBe(200);
      expect(agentRes.status(), 'AGENT 無 settings.manage → 403').toBe(403);
    } finally {
      await adminApi.dispose();
      await supervisorApi.dispose();
      await agentApi.dispose();
    }
  });

  // 補充：role.view 邊界（GET /roles）——ADMIN/SUPERVISOR 200（SUPERVISOR 經 implies 取得），AGENT 403
  test('@rbac API 層 role.view 邊界：ADMIN/SUPERVISOR 200，AGENT 403（GET /roles）', async () => {
    const adminApi = await newRoleApiContext('auth-state.json');
    const supervisorApi = await newRoleApiContext('auth-state-supervisor.json');
    const agentApi = await newRoleApiContext('auth-state-agent.json');
    try {
      const [adminRes, supervisorRes, agentRes] = await Promise.all([
        adminApi.get('roles'),
        supervisorApi.get('roles'),
        agentApi.get('roles'),
      ]);
      expect(adminRes.status(), 'ADMIN 有 role.view → 200').toBe(200);
      expect(
        supervisorRes.status(),
        'SUPERVISOR 經 agent.role.assign implies role.view → 200',
      ).toBe(200);
      expect(agentRes.status(), 'AGENT 無 role.view → 403').toBe(403);
    } finally {
      await adminApi.dispose();
      await supervisorApi.dispose();
      await agentApi.dispose();
    }
  });
});
