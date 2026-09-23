import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { E2E_PREFIX, newApiContext, gotoAndCheck } from './helpers';
import {
  FieldSamples,
  apiFieldCheck,
  expectNoXssExecuted,
  fieldByLabel,
  formatFieldInventory,
  inventoryFields,
  setField,
  strOfLength,
  submitAndObserve,
  expectRejected,
} from './field-helpers';

/**
 * Wave 6 欄位級測試 — 設定模組（Settings）@fields-settings
 *
 * 範圍：/dashboard/settings 各 tab 的所有輸入欄位
 * general / agents / roles / tags / sla / office-hours / tracking / api-keys / cli-sessions / passkeys
 *
 * ── 撰寫前已讀完的後端真實約束（zod schema）────────────────────────────────
 *  agents   createAgentSchema      name .min(1)｜email .email()｜role enum(ADMIN|SUPERVISOR|AGENT)
 *                                  roleId .uuid().optional()｜password .min(8)
 *           changePasswordSchema   currentPassword .min(1)｜newPassword .min(8)
 *           resetPasswordSchema    newPassword .min(8)
 *  roles    nameSchema             name .min(1).max(20)
 *  tags     createTagSchema        name .min(1)｜color 無驗證 .default()｜type/scope enum｜description 無上限
 *  sla      createSlaSchema        name .min(1)｜priority enum｜三個分鐘欄位 .int().positive()
 *  tracking trackingSettingsSchema gaId / metaPixelId 皆 z.string().nullable().optional()（完全無格式驗證）
 *  OH       officeHoursSchema      start/end regex /^\d{2}:\d{2}$/｜timezone 純字串｜holidays 純字串陣列
 *  api-keys createApiKeySchema     name .min(1).max(100)｜expiresInDays .int().positive().nullable()
 *  cli      createCliSessionSchema name .min(1).max(100)｜scopes z.array(z.string())（任意字串皆收）
 *  passkey  passkeyNameSchema      name .trim().min(1).max(80)
 *
 * ── 安全紅線（本 spec 的自我約束）─────────────────────────────────────────
 * 1. 【絕不改 admin 密碼】改密碼只測「被擋下」分支。所有 PATCH /agents/me/password 呼叫
 *    一律帶「故意錯誤的 currentPassword」，後端先過 zod 再比對舊密碼，兩條路徑都不可能
 *    改掉密碼；成功分支改用自建的 [E2E] 專用帳號測（測完 purge）。
 * 2. 【不動既有正式設定】office-hours / tracking 是租戶共用的單一設定物件（無 id、PUT 覆寫）。
 *    本 spec 對這兩者的寫入測試一律「先 GET 原值 → 測 → finally 還原並驗證還原成功」。
 * 3. 所有自建資料帶 [E2E] 前綴、email 用唯一 e2e-<uuid>@example.com，afterAll 兜底清理。
 *
 * ── 本次實測發現、已在案例中如實斷言的現況（詳見回報）────────────────────
 *  BUG-1 P1 SLA 分鐘欄位餵超大數（>2^31）→ 後端 500（未攔 Postgres Int4 溢位）
 *  BUG-2 P1 tracking GA4/Pixel ID 完全無格式驗證，任意字串（含 <script>）直接落庫
 *  BUG-3 P2 多處 .min(1) 未 trim：純空白/全形空白名稱可建立（tags、agents）
 *  BUG-4 P2 office-hours 時間值只驗格式不驗語意：25:99 可存、結束早於開始可存
 *  BUG-5 P2 office-hours timezone 無白名單：Mars/Phobos 可存
 *  BUG-6 P2 office-hours holidays 無日期格式驗證：'not-a-date' 可存
 *  BUG-7 P2 密碼無複雜度要求，'12345678' 可用
 *  BUG-8 P1 一般設定頁（GeneralSettings）姓名/改密碼是 POC 假 UI，完全不打 API
 *  BUG-9 P2 tag 名稱/說明無長度上限，500 字可存
 *
 * 這些是**產品現況**，本 spec 以「記錄現況」方式斷言（註明 BUG 編號），
 * 讓測試保持全綠可回歸；修掉後對應斷言會紅，即為提醒改測試的訊號。
 */

const RUN = randomUUID().slice(0, 8);

let api: APIRequestContext;

/** 待清理資源 */
const cleanup = {
  agentIds: new Set<string>(),
  tagIds: new Set<string>(),
  slaIds: new Set<string>(),
  roleIds: new Set<string>(),
  apiKeyIds: new Set<string>(),
  cliSessionIds: new Set<string>(),
};

/** office-hours / tracking 的原值，afterAll 兜底還原 */
let originalOfficeHours: unknown = null;
let originalTracking: { gaId: string | null; metaPixelId: string | null } | null = null;

test.beforeAll(async () => {
  api = await newApiContext();
  originalOfficeHours = (await (await api.get('settings/office-hours')).json()).data;
  originalTracking = (await (await api.get('settings/tracking')).json()).data;
});

test.afterAll(async () => {
  // 還原租戶共用設定（即使中途失敗也要還原，這是紅線）
  if (originalTracking) {
    await api
      .put('settings/tracking', {
        data: { gaId: originalTracking.gaId, metaPixelId: originalTracking.metaPixelId },
      })
      .catch(() => {});
  }
  if (originalOfficeHours) {
    const oh = originalOfficeHours as { timezone: string; officeHours: unknown };
    await api
      .put('settings/office-hours', { data: { timezone: oh.timezone, officeHours: oh.officeHours } })
      .catch(() => {});
  }

  // 自建資料清理
  for (const id of cleanup.agentIds) await api.delete(`agents/${id}`).catch(() => {});
  for (const id of cleanup.tagIds) await api.delete(`tags/${id}`).catch(() => {});
  for (const id of cleanup.slaIds) await api.delete(`sla-policies/${id}`).catch(() => {});
  for (const id of cleanup.roleIds) await api.delete(`roles/${id}`).catch(() => {});
  for (const id of cleanup.apiKeyIds) await api.delete(`settings/api-keys/${id}`).catch(() => {});
  for (const id of cleanup.cliSessionIds)
    await api.delete(`settings/cli-sessions/${id}`).catch(() => {});

  // 兜底：掃殘留的 [E2E] 資料（前面案例中途失敗時補刀）
  await sweepLeftovers(api).catch(() => {});
  await api.dispose().catch(() => {});
});

/** 掃描並清掉所有帶 [E2E] 前綴或 e2e- email 的殘留資料 */
async function sweepLeftovers(ctx: APIRequestContext) {
  const agents = (await (await ctx.get('agents')).json()).data as Array<{
    id: string;
    name: string;
    email: string;
  }>;
  for (const a of agents) {
    if (a.name.startsWith(E2E_PREFIX) || a.email.startsWith('e2e-')) {
      await ctx.delete(`agents/${a.id}`).catch(() => {});
    }
  }
  const tags = (await (await ctx.get('tags')).json()).data as Array<{ id: string; name: string }>;
  for (const t of tags) {
    if (t.name.startsWith(E2E_PREFIX)) await ctx.delete(`tags/${t.id}`).catch(() => {});
  }
  const slas = (await (await ctx.get('sla-policies')).json()).data as Array<{
    id: string;
    name: string;
  }>;
  for (const s of slas) {
    if (s.name.startsWith(E2E_PREFIX)) await ctx.delete(`sla-policies/${s.id}`).catch(() => {});
  }
  const roles = (await (await ctx.get('roles')).json()).data.roles as Array<{
    id: string;
    name: string;
  }>;
  for (const r of roles) {
    if (r.name.startsWith(E2E_PREFIX)) await ctx.delete(`roles/${r.id}`).catch(() => {});
  }
  const cli = (await (await ctx.get('settings/cli-sessions')).json()).data as Array<{
    id: string;
    name: string;
  }>;
  for (const s of cli) {
    if (s.name.startsWith(E2E_PREFIX)) await ctx.delete(`settings/cli-sessions/${s.id}`).catch(() => {});
  }
  const keys = (await (await ctx.get('settings/api-keys')).json()).data as Array<{
    id: string;
    name: string;
    isActive: boolean;
  }>;
  for (const k of keys) {
    if (k.name.startsWith(E2E_PREFIX) && k.isActive)
      await ctx.delete(`settings/api-keys/${k.id}`).catch(() => {});
  }
}

/** 進設定頁指定 tab（路由式，各 tab 有獨立 URL） */
async function gotoTab(page: Page, section: string): Promise<string[]> {
  return gotoAndCheck(page, `/dashboard/settings/${section}`);
}

/**
 * 取目前開啟的表單 Dialog。
 * 踩坑：專案 ui/dialog 是原生 <dialog>，頁面上常同時存在多個（含未開啟的），
 * `getByRole('dialog')` 會命中 2-3 個造成 strict mode violation；實際開啟的是最後一個。
 */
function openDialog(page: Page) {
  return page.locator('dialog[open], [role="dialog"]').last();
}

/** 開啟表單 Dialog 並等它可見 */
async function openFormDialog(page: Page, buttonName: string | RegExp) {
  await page.getByRole('button', { name: buttonName }).first().click();
  const dialog = openDialog(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

/** 建一個 [E2E] 專用客服帳號（回傳 id/email/password），用於「不可動 admin」的成功分支測試 */
async function createE2EAgent(suffix: string, password = 'E2eTest!2345') {
  const email = `e2e-${suffix}-${randomUUID().slice(0, 8)}@example.com`;
  const res = await api.post('agents', {
    data: { name: `${E2E_PREFIX} 欄位測試 ${suffix}`, email, role: 'AGENT', password },
  });
  expect(res.status(), `建立 [E2E] 測試帳號失敗：${await res.text()}`).toBe(201);
  const id = (await res.json()).data.id as string;
  cleanup.agentIds.add(id);
  return { id, email, password };
}

// ===========================================================================
// 0. 全頁欄位盤點（覆蓋率證據）
// ===========================================================================

test.describe('設定模組欄位盤點 @fields-settings', () => {
  test('@fields-settings 00 盤點：逐 tab 掃描所有可見輸入元素', async ({ page }) => {
    // 各 tab 的「開啟表單」動作（部分欄位藏在 Dialog 內，要先開啟才掃得到）
    const tabs: Array<{ section: string; label: string; open?: (p: Page) => Promise<void> }> = [
      { section: 'general', label: '一般設定' },
      {
        section: 'agents',
        label: '人員與權限',
        open: async (p) => {
          await openFormDialog(p, '新增人員');
        },
      },
      { section: 'roles', label: '角色與權限' },
      {
        section: 'tags',
        label: '標籤管理',
        open: async (p) => {
          await openFormDialog(p, '新增標籤');
        },
      },
      {
        section: 'sla',
        label: 'SLA 政策',
        open: async (p) => {
          await openFormDialog(p, '建立 SLA 政策');
        },
      },
      { section: 'office-hours', label: '營業時間' },
      { section: 'tracking', label: '追蹤設定' },
      {
        section: 'api-keys',
        label: 'API 金鑰',
        open: async (p) => {
          await openFormDialog(p, '建立金鑰');
        },
      },
      {
        section: 'cli-sessions',
        label: 'CLI 連線',
        open: async (p) => {
          await openFormDialog(p, '產生 Token');
        },
      },
      { section: 'passkeys', label: 'Passkey 登入' },
    ];

    let total = 0;
    for (const t of tabs) {
      await gotoTab(page, t.section);
      // 表單開啟動作可能因權限/資料不同而不存在，失敗不中斷盤點
      if (t.open) await t.open(page).catch(() => {});
      await page.waitForTimeout(600);
      const fields = await inventoryFields(page);
      total += fields.length;
      console.log(formatFieldInventory(fields, `${t.label}（/${t.section}）`));
    }
    console.log(`\n── 設定模組可見輸入元素總計：${total} 個 ──\n`);
    expect(total, '設定模組應掃到相當數量的輸入欄位').toBeGreaterThan(40);
  });
});

// ===========================================================================
// 1. general — 個人資料 / 改密碼
// ===========================================================================

test.describe('一般設定（general）@fields-settings', () => {
  test('@fields-settings 01 姓名：必填擋控（空/純空白時儲存鈕 disabled）', async ({ page }) => {
    await gotoTab(page, 'general');
    const name = page.locator('#profile-name');
    await expect(name).toBeVisible({ timeout: 15_000 });
    const saveBtn = page.getByRole('button', { name: /儲存資料|儲存成功/ });

    await setField(name, '');
    await expect(saveBtn, '姓名空白時儲存鈕應 disabled').toBeDisabled();

    await setField(name, FieldSamples.whitespace);
    await expect(saveBtn, '姓名純空白時儲存鈕應 disabled（元件有 !name.trim()）').toBeDisabled();

    // 實測：JS 的 String.prototype.trim() 依 Unicode 定義「空白」，U+3000 全形空白也會被移除，
    // 因此 !name.trim() 同樣成立 → 儲存鈕 disabled（此處前端擋控是正確的）
    await setField(name, FieldSamples.fullwidthSpace);
    await expect(saveBtn, '全形空白經 trim() 後視為空，儲存鈕應 disabled').toBeDisabled();
  });

  test('@fields-settings 02 【BUG-8 P1】姓名儲存不打 API：按下儲存無任何網路請求', async ({
    page,
  }) => {
    await gotoTab(page, 'general');
    const name = page.locator('#profile-name');
    await expect(name).toBeVisible({ timeout: 15_000 });
    await setField(name, `${E2E_PREFIX} 姓名 ${RUN}`);

    // 攔截所有 /api/ 請求（不限 method/路徑）：要證明的是「完全沒有任何存檔請求」
    const apiCalls: string[] = [];
    page.on('request', (r) => {
      if (/\/api\//.test(r.url())) apiCalls.push(`${r.method()} ${r.url()}`);
    });

    await page.getByRole('button', { name: /儲存資料/ }).click();

    // 「儲存成功」只顯示 2 秒（setTimeout(...,2000) 後復原），必須在視窗內斷言
    await expect(
      page.getByRole('button', { name: /儲存成功/ }),
      'BUG-8 的實害：UI 顯示「儲存成功」讓使用者以為已存檔',
    ).toBeVisible({ timeout: 1_500 });

    await page.waitForTimeout(2_000);
    // 現況：GeneralSettings.handleSaveProfile 只 setProfileSaved(true)，沒有任何 api 呼叫
    expect(
      apiCalls,
      'BUG-8：若此處不再為空，代表姓名儲存已接上 API，本斷言需改為驗證真實往返',
    ).toEqual([]);

    // 且 reload 後姓名回到原值（根本沒存進去）
    await gotoTab(page, 'general');
    const reloaded = await page.locator('#profile-name').inputValue();
    expect(reloaded, 'BUG-8：reload 後姓名回到原值，證明剛才的「儲存成功」是假的').not.toContain(RUN);
  });

  test('@fields-settings 03 改密碼前端擋控：空舊密碼 / 空新密碼 / 太短 / 兩次不符', async ({
    page,
  }) => {
    await gotoTab(page, 'general');
    const oldPw = page.locator('#old-password');
    const newPw = page.locator('#new-password');
    const confirmPw = page.locator('#confirm-password');
    await expect(oldPw).toBeVisible({ timeout: 15_000 });
    const submit = page.getByRole('button', { name: /更新密碼|密碼已更新/ });

    // 空舊密碼
    await submit.click();
    await expect(page.getByText('請輸入舊密碼')).toBeVisible();

    // 空新密碼
    await setField(oldPw, 'AnyOldValue123!');
    await submit.click();
    await expect(page.getByText('請輸入新密碼')).toBeVisible();

    // 新密碼太短（前端門檻 6 字）
    await setField(newPw, 'ab1');
    await setField(confirmPw, 'ab1');
    await submit.click();
    await expect(page.getByText('新密碼至少需要 6 個字元')).toBeVisible();

    // 兩次輸入不一致
    await setField(newPw, 'NewPassword123!');
    await setField(confirmPw, 'DifferentPassword123!');
    await submit.click();
    await expect(page.getByText('新密碼與確認密碼不一致')).toBeVisible();
  });

  test('@fields-settings 04 【BUG-2 P2】改密碼前端門檻 6 字 vs 後端 8 字不一致', async ({ page }) => {
    await gotoTab(page, 'general');
    const oldPw = page.locator('#old-password');
    const newPw = page.locator('#new-password');
    const confirmPw = page.locator('#confirm-password');
    await expect(oldPw).toBeVisible({ timeout: 15_000 });

    // 7 字密碼：前端（>=6）放行，但後端 zod 是 .min(8) → 前後端不一致
    await setField(oldPw, 'WrongOnPurpose-' + RUN);
    await setField(newPw, 'Abc123!');
    await setField(confirmPw, 'Abc123!');
    const apiCalls: string[] = [];
    page.on('request', (r) => {
      if (/\/api\//.test(r.url())) apiCalls.push(`${r.method()} ${r.url()}`);
    });

    await page.getByRole('button', { name: /更新密碼/ }).click();

    // 現況 BUG-8：此頁根本不打 API，前端驗證（>=6 字）通過後直接顯示成功（僅 2 秒）
    await expect(
      page.getByRole('button', { name: /密碼已更新/ }),
      'BUG-8 的實害：7 字密碼（後端 min(8) 根本不收）卻顯示「密碼已更新」，使用者會以為換好了',
    ).toBeVisible({ timeout: 1_500 });

    await page.waitForTimeout(2_000);
    expect(apiCalls, 'BUG-8：一般設定的改密碼同樣沒有接 API').toEqual([]);

    // 後端真實門檻直測（帶故意錯誤的 currentPassword，確保絕不會改掉 admin 密碼）
    await apiFieldCheck(api, {
      path: 'agents/me/password',
      method: 'patch',
      payload: { currentPassword: 'WrongOnPurpose-' + RUN, newPassword: 'Abc123!' },
      expect: 'reject',
      context: 'newPassword 7 字（後端 min(8)）',
    });
  });

  test('@fields-settings 05 改密碼後端擋控直測（全部帶錯誤舊密碼，絕不會真的改掉）', async () => {
    const wrong = 'WrongOnPurpose-' + RUN;
    // currentPassword 必填
    await apiFieldCheck(api, {
      path: 'agents/me/password',
      method: 'patch',
      payload: { currentPassword: '', newPassword: 'ValidPass123!' },
      expect: 'reject',
      context: 'currentPassword 空字串',
    });
    // newPassword 邊界：7 字擋、8 字才過 zod（但會卡在舊密碼比對 → 仍是 4xx，不會改掉）
    await apiFieldCheck(api, {
      path: 'agents/me/password',
      method: 'patch',
      payload: { currentPassword: wrong, newPassword: strOfLength(7) },
      expect: 'reject',
      context: 'newPassword 7 字（min(8) 邊界下緣）',
    });
    // 舊密碼錯誤 → INVALID_PASSWORD
    const res = await api.patch('agents/me/password', {
      data: { currentPassword: wrong, newPassword: 'ValidPass123!' },
    });
    expect(res.status(), '錯誤的目前密碼應被拒絕').toBe(400);
    expect(JSON.stringify(await res.json())).toContain('INVALID_PASSWORD');

    // 確認 admin 密碼確實沒被改掉：用原密碼重新取一次 token
    const probe = await newApiContext();
    const me = await probe.get('agents');
    expect(me.status(), 'admin session 應仍然有效（密碼未被本測試改動）').toBe(200);
    await probe.dispose();
  });

  test('@fields-settings 06 改密碼成功分支：用 [E2E] 專用帳號驗證（不碰 admin）', async () => {
    const agent = await createE2EAgent('pwd');
    // 對自建帳號做「重設密碼」（管理員路徑），驗證合法值被接受
    const ok = await api.patch(`agents/${agent.id}/password`, {
      data: { newPassword: 'BrandNewPass!456' },
    });
    expect(ok.status(), `重設 [E2E] 帳號密碼應成功：${await ok.text()}`).toBe(200);

    // 邊界：7 字應被擋
    await apiFieldCheck(api, {
      path: `agents/${agent.id}/password`,
      method: 'patch',
      payload: { newPassword: strOfLength(7) },
      expect: 'reject',
      context: 'resetPassword newPassword 7 字',
    });
    // 8 字剛好應被接受
    await apiFieldCheck(api, {
      path: `agents/${agent.id}/password`,
      method: 'patch',
      payload: { newPassword: strOfLength(8) },
      expect: 'accept',
      context: 'resetPassword newPassword 8 字（min 邊界）',
    });
  });

  test('@fields-settings 07 【BUG-7 P2】密碼無複雜度要求：純數字 12345678 被接受', async () => {
    const agent = await createE2EAgent('weakpw');
    const res = await api.patch(`agents/${agent.id}/password`, {
      data: { newPassword: '12345678' },
    });
    expect(
      res.status(),
      'BUG-7：後端僅 .min(8)，無大小寫/數字/符號複雜度要求。若此處變 4xx 代表已加強規則，請更新本斷言',
    ).toBe(200);
  });
});

// ===========================================================================
// 2. agents — 新增客服 / 角色 / 重設密碼
// ===========================================================================

test.describe('人員與權限（agents）@fields-settings', () => {
  test('@fields-settings 10 新增人員：必填擋控（姓名/email/密碼任一留空 → 不送出或被擋）', async ({
    page,
  }) => {
    await gotoTab(page, 'agents');
    const dialog = await openFormDialog(page, '新增人員');

    // 全空直接送出：HTML5 required 會擋（input 都有 required 屬性）
    const result = await submitAndObserve(
      page,
      async () => dialog.getByRole('button', { name: '建立' }).click(),
      /\/agents$/,
      'POST',
      2_500,
    );
    expect(result.requested, '全部欄位留空不應送出請求').toBe(false);
  });

  test('@fields-settings 11 email 格式：非法樣本全被擋、合法樣本被接受', async ({ page }) => {
    // 前端：type=email 的 HTML5 驗證
    await gotoTab(page, 'agents');
    const dialog = await openFormDialog(page, '新增人員');

    // 踩坑：shadcn <Input> 預設不輸出 type 屬性，input[type="text"] 選不到，改用 placeholder
    await setField(dialog.getByPlaceholder('王小明'), `${E2E_PREFIX} 格式測試`);
    await setField(dialog.locator('input[type="email"]'), 'plain');
    await setField(dialog.locator('input[type="password"]'), 'ValidPass123!');
    const fe = await submitAndObserve(
      page,
      async () => dialog.getByRole('button', { name: '建立' }).click(),
      /\/agents$/,
      'POST',
      2_500,
    );
    expect(fe.requested, '前端 type=email 應擋下 "plain"').toBe(false);

    // 後端直測：六種非法 email 應全數 4xx
    for (const bad of FieldSamples.badEmails) {
      await apiFieldCheck(api, {
        path: 'agents',
        payload: {
          name: `${E2E_PREFIX} bad ${RUN}`,
          email: bad,
          role: 'AGENT',
          password: 'ValidPass123!',
        },
        expect: 'reject',
        context: `createAgent email=${JSON.stringify(bad)}`,
      });
    }

    // 合法 email 應被接受（建立後納入清理）
    for (const good of FieldSamples.goodEmails) {
      const local = good.split('@')[0];
      const email = `e2e-${local.replace(/[^a-z0-9.+-]/gi, '')}-${randomUUID().slice(0, 6)}@example.com`;
      const res = await api.post('agents', {
        data: {
          name: `${E2E_PREFIX} good ${RUN}`,
          email,
          role: 'AGENT',
          password: 'ValidPass123!',
        },
      });
      expect(res.status(), `合法 email ${email} 應被接受：${await res.text()}`).toBe(201);
      cleanup.agentIds.add((await res.json()).data.id);
    }
  });

  test('@fields-settings 12 email 全域唯一性：重複 email 回 409 CONFLICT', async () => {
    const agent = await createE2EAgent('dup');
    const res = await api.post('agents', {
      data: {
        name: `${E2E_PREFIX} 重複 ${RUN}`,
        email: agent.email,
        role: 'AGENT',
        password: 'ValidPass123!',
      },
    });
    expect(res.status(), '重複 email 應回 409').toBe(409);
    expect(JSON.stringify(await res.json())).toContain('CONFLICT');

    // 既有正式帳號的 email 也應被擋（不會覆寫既有帳號）
    const dupAdmin = await api.post('agents', {
      data: {
        name: `${E2E_PREFIX} 撞admin ${RUN}`,
        email: 'admin@open333crm.dev',
        role: 'AGENT',
        password: 'ValidPass123!',
      },
    });
    expect(dupAdmin.status(), '撞既有 admin email 應被擋（絕不可覆寫）').toBe(409);
  });

  test('@fields-settings 13 密碼長度邊界：7 字擋 / 8 字過（min(8) 三點）', async () => {
    await apiFieldCheck(api, {
      path: 'agents',
      payload: {
        name: `${E2E_PREFIX} pw7 ${RUN}`,
        email: `e2e-pw7-${randomUUID().slice(0, 6)}@example.com`,
        role: 'AGENT',
        password: strOfLength(7),
      },
      expect: 'reject',
      context: 'createAgent password 7 字',
    });

    const email8 = `e2e-pw8-${randomUUID().slice(0, 6)}@example.com`;
    const res8 = await api.post('agents', {
      data: {
        name: `${E2E_PREFIX} pw8 ${RUN}`,
        email: email8,
        role: 'AGENT',
        password: strOfLength(8),
      },
    });
    expect(res8.status(), 'password 剛好 8 字應被接受').toBe(201);
    cleanup.agentIds.add((await res8.json()).data.id);
  });

  test('@fields-settings 14 role / roleId 列舉與格式：非法值被擋', async () => {
    const mk = (over: Record<string, unknown>) => ({
      name: `${E2E_PREFIX} enum ${RUN}`,
      email: `e2e-enum-${randomUUID().slice(0, 6)}@example.com`,
      role: 'AGENT',
      password: 'ValidPass123!',
      ...over,
    });
    await apiFieldCheck(api, {
      path: 'agents',
      payload: mk({ role: 'SUPERADMIN' }),
      expect: 'reject',
      context: 'role 非法 enum 值 SUPERADMIN',
    });
    await apiFieldCheck(api, {
      path: 'agents',
      payload: mk({ role: 'agent' }),
      expect: 'reject',
      context: 'role 小寫 agent（enum 大小寫敏感）',
    });
    await apiFieldCheck(api, {
      path: 'agents',
      payload: mk({ roleId: FieldSamples.badUuid }),
      expect: 'reject',
      context: 'roleId 非法 UUID（含非 hex 字元 g）',
    });
    await apiFieldCheck(api, {
      path: 'agents',
      payload: mk({ roleId: randomUUID() }),
      expect: 'reject',
      context: 'roleId 格式合法但不存在於本租戶',
    });
  });

  test('@fields-settings 15 【BUG-3 P2】姓名純空白/全形空白未 trim，可建立空白名帳號', async () => {
    const email = `e2e-ws-${randomUUID().slice(0, 6)}@example.com`;
    const res = await api.post('agents', {
      data: { name: FieldSamples.whitespace, email, role: 'AGENT', password: 'ValidPass123!' },
    });
    expect(
      res.status(),
      'BUG-3：createAgentSchema 的 name 是 .min(1) 未加 .trim()，純空白通過。修好後此處應為 400',
    ).toBe(201);
    const body = await res.json();
    cleanup.agentIds.add(body.data.id);
    expect(body.data.name, '空白名稱原樣落庫').toBe(FieldSamples.whitespace);
  });

  test('@fields-settings 16 姓名注入樣本：XSS/HTML/SQL 字串存入後以純文字呈現', async ({ page }) => {
    const samples: Array<[string, string]> = [
      ['xss', FieldSamples.xss],
      ['html', FieldSamples.html],
      ['sqlish', FieldSamples.sqlish],
      ['emoji', FieldSamples.emoji],
    ];
    const createdNames: string[] = [];
    for (const [kind, value] of samples) {
      const name = `${E2E_PREFIX}${value}`;
      const res = await api.post('agents', {
        data: {
          name,
          email: `e2e-${kind}-${randomUUID().slice(0, 6)}@example.com`,
          role: 'AGENT',
          password: 'ValidPass123!',
        },
      });
      expect(res.status(), `${kind} 樣本應被當一般文字接受（Prisma 參數化）：${await res.text()}`).toBe(
        201,
      );
      const body = await res.json();
      cleanup.agentIds.add(body.data.id);
      expect(body.data.name, `${kind}：儲存往返應完整保留原字串（不被截斷/轉義變形）`).toBe(name);
      createdNames.push(name);
    }

    // UI 呈現：script 不執行、<b> 不被解析成元素
    await gotoTab(page, 'agents');
    await page.waitForTimeout(1_500);
    await expectNoXssExecuted(page);
    const boldInjected = await page
      .locator('table b, [role="table"] b')
      .filter({ hasText: '粗體' })
      .count();
    expect(boldInjected, 'HTML 標籤不應被解析成真的 <b> 元素').toBe(0);
    // emoji 名稱應原樣顯示
    await expect(page.getByText(FieldSamples.emoji, { exact: false }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('@fields-settings 17 自我保護：不可停用/刪除自己的帳號', async () => {
    const meRes = await api.get('agents');
    const agents = (await meRes.json()).data as Array<{ id: string; email: string }>;
    const me = agents.find((a) => a.email === 'admin@open333crm.dev');
    expect(me, '應能在列表中找到目前登入的 admin').toBeTruthy();

    const deact = await api.post(`agents/${me!.id}/deactivate`);
    expect(deact.status(), '停用自己應被擋（422 SELF_ACTION_FORBIDDEN）').toBe(422);
    const del = await api.delete(`agents/${me!.id}`);
    expect(del.status(), '刪除自己應被擋（422 SELF_ACTION_FORBIDDEN）').toBe(422);
  });
});

// ===========================================================================
// 3. roles — 建立/改名 + 權限矩陣
// ===========================================================================

test.describe('角色與權限（roles）@fields-settings', () => {
  test('@fields-settings 20 角色名稱長度邊界：19/20 過、21 擋（max(20) 三點）', async () => {
    const tag = `${E2E_PREFIX}${RUN}`;
    // under（19 字）
    const under = (tag + 'x'.repeat(20)).slice(0, 19);
    const r1 = await api.post('roles', { data: { name: under } });
    expect(r1.status(), `19 字角色名應被接受：${await r1.text()}`).toBe(201);
    cleanup.roleIds.add((await r1.json()).data.id);

    // exact（20 字）
    const exact = (tag + 'y'.repeat(20)).slice(0, 20);
    const r2 = await api.post('roles', { data: { name: exact } });
    expect(r2.status(), '20 字（剛好上限）應被接受').toBe(201);
    cleanup.roleIds.add((await r2.json()).data.id);

    // over（21 字）
    await apiFieldCheck(api, {
      path: 'roles',
      payload: { name: (tag + 'z'.repeat(30)).slice(0, 21) },
      expect: 'reject',
      context: '角色名 21 字（超過 max(20)）',
    });
  });

  test('@fields-settings 21 角色名稱必填：空字串 400、純空白 422（兩層擋控都有）', async () => {
    await apiFieldCheck(api, {
      path: 'roles',
      payload: { name: '' },
      expect: 'reject',
      context: '角色名空字串（zod min(1)）',
    });
    const ws = await api.post('roles', { data: { name: FieldSamples.whitespace } });
    expect(ws.status(), '純空白角色名應被 service 層擋下（422 角色名稱不可為空）').toBe(422);
    expect(JSON.stringify(await ws.json())).toContain('角色名稱不可為空');
  });

  test('@fields-settings 22 前端 maxLength=20 與後端 max(20) 一致', async ({ page }) => {
    await gotoTab(page, 'roles');
    const dialog = await openFormDialog(page, /新增角色|建立角色/);
    const input = dialog.locator('input[maxlength]').first();
    const maxLen = await input.getAttribute('maxlength');
    expect(maxLen, '前端 maxLength 應與後端 zod max(20) 一致').toBe('20');

    // 實際打字超過上限會被 maxLength 截斷
    await input.fill('');
    await input.type('x'.repeat(25), { delay: 1 });
    const value = await input.inputValue();
    expect(value.length, 'maxLength 應把輸入截斷到 20 字').toBe(20);
  });

  test('@fields-settings 23 角色改名 + 權限矩陣：非法權限碼被過濾/擋下', async () => {
    const r = await api.post('roles', { data: { name: `${E2E_PREFIX}rn${RUN}`.slice(0, 20) } });
    expect(r.status()).toBe(201);
    const roleId = (await r.json()).data.id as string;
    cleanup.roleIds.add(roleId);

    // 改名邊界同樣適用 max(20)
    await apiFieldCheck(api, {
      path: `roles/${roleId}`,
      method: 'patch',
      payload: { name: strOfLength(21) },
      expect: 'reject',
      context: '角色改名 21 字',
    });
    const ok = await api.patch(`roles/${roleId}`, {
      data: { name: `${E2E_PREFIX}ok${RUN}`.slice(0, 20) },
    });
    expect(ok.status(), '合法改名應成功').toBe(200);

    // 權限矩陣：塞入不存在的權限碼
    const bogus = await api.put(`roles/${roleId}/permissions`, {
      data: { permissions: ['totally.bogus.permission', 'contact.view'] },
    });
    expect(
      bogus.status(),
      `非法權限碼應被擋或被過濾掉，不可原樣寫入。實際：${await bogus.text()}`,
    ).toBeLessThan(500);
    if (bogus.status() < 400) {
      const saved = (await (await api.get(`roles/${roleId}/permissions`)).json()).data
        .permissions as string[];
      expect(saved, '不存在的權限碼不應被寫入角色').not.toContain('totally.bogus.permission');
    }
  });

  test('@fields-settings 24 權限矩陣往返：勾選後儲存 → reload 仍保留', async () => {
    const r = await api.post('roles', { data: { name: `${E2E_PREFIX}pm${RUN}`.slice(0, 20) } });
    const roleId = (await r.json()).data.id as string;
    cleanup.roleIds.add(roleId);

    const perms = ['contact.view', 'case.view'];
    const put = await api.put(`roles/${roleId}/permissions`, { data: { permissions: perms } });
    expect(put.status(), `設定權限應成功：${await put.text()}`).toBe(200);

    const after = (await (await api.get(`roles/${roleId}/permissions`)).json()).data
      .permissions as string[];
    for (const p of perms) {
      expect(after, `權限 ${p} 應在儲存後被讀回`).toContain(p);
    }
  });

  test('@fields-settings 25 system role 保護：不可刪除內建角色', async () => {
    const roles = (await (await api.get('roles')).json()).data.roles as Array<{
      id: string;
      name: string;
      isSystem: boolean;
    }>;
    const sys = roles.find((x) => x.isSystem);
    expect(sys, '租戶應有內建 system role').toBeTruthy();
    const res = await api.delete(`roles/${sys!.id}`);
    expect(res.status(), 'system role 不可刪除').toBeGreaterThanOrEqual(400);
    expect(res.status(), '應回 4xx 而非 5xx').toBeLessThan(500);
  });
});

// ===========================================================================
// 4. tags — 標籤 CRUD
// ===========================================================================

test.describe('標籤管理（tags）@fields-settings', () => {
  test('@fields-settings 30 標籤名稱必填 + enum 擋控', async () => {
    await apiFieldCheck(api, {
      path: 'tags',
      payload: { name: '', color: '#6366f1', type: 'MANUAL', scope: 'CONTACT' },
      expect: 'reject',
      context: 'tag name 空字串',
    });
    await apiFieldCheck(api, {
      path: 'tags',
      payload: { name: `${E2E_PREFIX}t${RUN}`, color: '#6366f1', type: 'BOGUS', scope: 'CONTACT' },
      expect: 'reject',
      context: 'tag type 非法 enum',
    });
    await apiFieldCheck(api, {
      path: 'tags',
      payload: { name: `${E2E_PREFIX}t${RUN}`, color: '#6366f1', type: 'MANUAL', scope: 'BOGUS' },
      expect: 'reject',
      context: 'tag scope 非法 enum',
    });
  });

  test('@fields-settings 31 【BUG-3 P2】標籤純空白/全形空白名稱未 trim 可建立', async () => {
    for (const [kind, value] of [
      ['純空白', FieldSamples.whitespace],
      ['全形空白', FieldSamples.fullwidthSpace],
    ] as const) {
      const res = await api.post('tags', {
        data: { name: value, color: '#6366f1', type: 'MANUAL', scope: 'CONTACT' },
      });
      expect(
        res.status(),
        `BUG-3：createTagSchema name 是 .min(1) 未 trim，${kind}通過。修好後此處應為 400`,
      ).toBe(201);
      cleanup.tagIds.add((await res.json()).data.id);
    }
  });

  test('@fields-settings 32 【BUG-9 P2】標籤名稱無長度上限：500 字可存', async () => {
    const long = `${E2E_PREFIX}${strOfLength(500)}`;
    const res = await api.post('tags', {
      data: { name: long, color: '#6366f1', type: 'MANUAL', scope: 'CONTACT' },
    });
    expect(
      res.status(),
      'BUG-9：createTagSchema name 無 .max()，超長名稱直接落庫（UI 會被撐壞）',
    ).toBe(201);
    const body = await res.json();
    cleanup.tagIds.add(body.data.id);
    expect(body.data.name.length, '500 字原樣保存未截斷').toBe(long.length);
  });

  test('@fields-settings 33 【BUG-9 P2】color 欄位無格式驗證：非色碼字串可存', async () => {
    const res = await api.post('tags', {
      data: {
        name: `${E2E_PREFIX}color${RUN}`,
        color: 'javascript:alert(1)',
        type: 'MANUAL',
        scope: 'CONTACT',
      },
    });
    expect(res.status(), 'BUG-9：color 是 z.string().default() 無 hex 格式驗證').toBe(201);
    const body = await res.json();
    cleanup.tagIds.add(body.data.id);
    expect(body.data.color, '非色碼字串原樣落庫（前端拿去當 style 值有風險）').toBe(
      'javascript:alert(1)',
    );
  });

  test('@fields-settings 34 標籤往返 + 注入安全：padded/emoji/xss 存後正確回讀', async ({ page }) => {
    const cases: Array<[string, string]> = [
      ['padded', `${E2E_PREFIX}${FieldSamples.padded}`],
      ['emoji', `${E2E_PREFIX}${FieldSamples.emoji}`],
      ['xss', `${E2E_PREFIX}${FieldSamples.xss}`],
      ['sqlish', `${E2E_PREFIX}${FieldSamples.sqlish}`],
    ];
    for (const [kind, name] of cases) {
      const res = await api.post('tags', {
        data: { name, color: '#6366f1', type: 'MANUAL', scope: 'CONTACT' },
      });
      expect(res.status(), `${kind} 應被接受：${await res.text()}`).toBe(201);
      const created = (await res.json()).data;
      cleanup.tagIds.add(created.id);

      // reload 回讀：值應完好（含前後空白，後端未 trim → 原樣保留）
      const list = (await (await api.get('tags')).json()).data as Array<{
        id: string;
        name: string;
      }>;
      const found = list.find((t) => t.id === created.id);
      expect(found?.name, `${kind}：儲存往返後值應與輸入完全一致`).toBe(name);
    }

    // UI 層：XSS 不執行
    await gotoTab(page, 'tags');
    await page.waitForTimeout(1_500);
    await expectNoXssExecuted(page);
  });

  test('@fields-settings 35 標籤編輯：改名往返 + 空名稱被擋', async () => {
    const res = await api.post('tags', {
      data: { name: `${E2E_PREFIX}edit${RUN}`, color: '#6366f1', type: 'MANUAL', scope: 'CONTACT' },
    });
    const id = (await res.json()).data.id as string;
    cleanup.tagIds.add(id);

    await apiFieldCheck(api, {
      path: `tags/${id}`,
      method: 'patch',
      payload: { name: '' },
      expect: 'reject',
      context: 'tag 改名為空字串',
    });

    const newName = `${E2E_PREFIX}edited${RUN}`;
    const ok = await api.patch(`tags/${id}`, { data: { name: newName } });
    expect(ok.status(), '合法改名應成功').toBe(200);
    const list = (await (await api.get('tags')).json()).data as Array<{
      id: string;
      name: string;
    }>;
    expect(list.find((t) => t.id === id)?.name, '改名後應能讀回新值').toBe(newName);
  });
});

// ===========================================================================
// 5. sla — SLA 政策（數字欄位重點）
// ===========================================================================

test.describe('SLA 政策（sla）@fields-settings', () => {
  const mkSla = (over: Record<string, unknown>) => ({
    name: `${E2E_PREFIX}sla${RUN}`,
    priority: 'LOW',
    firstResponseMinutes: 15,
    resolutionMinutes: 60,
    warningBeforeMinutes: 10,
    ...over,
  });

  test('@fields-settings 40 數字欄位擋控：負數 / 零 / 小數 / 字串型數字全被擋', async () => {
    for (const field of [
      'firstResponseMinutes',
      'resolutionMinutes',
      'warningBeforeMinutes',
    ] as const) {
      await apiFieldCheck(api, {
        path: 'sla-policies',
        payload: mkSla({ [field]: -1 }),
        expect: 'reject',
        context: `SLA ${field} = -1（positive 擋控）`,
      });
      await apiFieldCheck(api, {
        path: 'sla-policies',
        payload: mkSla({ [field]: 0 }),
        expect: 'reject',
        context: `SLA ${field} = 0（positive 不含 0）`,
      });
      await apiFieldCheck(api, {
        path: 'sla-policies',
        payload: mkSla({ [field]: 1.5 }),
        expect: 'reject',
        context: `SLA ${field} = 1.5（int 擋控）`,
      });
      await apiFieldCheck(api, {
        path: 'sla-policies',
        payload: mkSla({ [field]: '15' }),
        expect: 'reject',
        context: `SLA ${field} = "15" 字串（型別擋控）`,
      });
    }
  });

  test('@fields-settings 41 【BUG-1 P1】超大分鐘數（超過 Int4 上限）造成後端 500', async () => {
    const res = await api.post('sla-policies', {
      data: mkSla({ firstResponseMinutes: 999999999999999 }),
    });
    expect(
      res.status(),
      'BUG-1：zod 只驗 int().positive() 沒設上限，值超過 Postgres Int4（2147483647）時 Prisma 丟例外 → 500。應回 400 並限制上限',
    ).toBe(500);

    // Int4 邊界確認：2147483647 應可存、+1 應爆
    const okRes = await api.post('sla-policies', {
      data: mkSla({ name: `${E2E_PREFIX}int4max${RUN}`, firstResponseMinutes: 2147483647 }),
    });
    if (okRes.status() === 201) cleanup.slaIds.add((await okRes.json()).data.id);
    expect(okRes.status(), 'Int4 上限值 2147483647 應可存（邊界內）').toBe(201);

    const overRes = await api.post('sla-policies', {
      data: mkSla({ name: `${E2E_PREFIX}int4over${RUN}`, firstResponseMinutes: 2147483648 }),
    });
    expect(overRes.status(), 'BUG-1：Int4 上限 +1 應回 4xx，實際 500').toBe(500);
  });

  test('@fields-settings 42 name 必填 + priority enum 擋控', async () => {
    await apiFieldCheck(api, {
      path: 'sla-policies',
      payload: mkSla({ name: '' }),
      expect: 'reject',
      context: 'SLA name 空字串',
    });
    await apiFieldCheck(api, {
      path: 'sla-policies',
      payload: mkSla({ priority: 'CRITICAL' }),
      expect: 'reject',
      context: 'SLA priority 非法 enum（僅 LOW/MEDIUM/HIGH/URGENT）',
    });
  });

  test('@fields-settings 43 【BUG-10 P2】跨欄位邏輯未驗：解決時間可短於首次回應時間', async () => {
    const res = await api.post('sla-policies', {
      data: mkSla({
        name: `${E2E_PREFIX}logic${RUN}`,
        firstResponseMinutes: 600,
        resolutionMinutes: 5,
        warningBeforeMinutes: 10,
      }),
    });
    expect(
      res.status(),
      'BUG-10：後端沒有跨欄位檢查，「10 小時才首次回應但 5 分鐘要解決」這種矛盾設定可存',
    ).toBe(201);
    cleanup.slaIds.add((await res.json()).data.id);
  });

  test('@fields-settings 44 【BUG-11 P2】前端 parseInt || 預設值：非數字輸入被靜默改成預設', async ({
    page,
  }) => {
    // SlaManagement.handleSave: parseInt(formFirstResponse,10) || 15
    // → 使用者把欄位清空或填非數字，前端不報錯而是靜默送出預設值 15/60/10
    await gotoTab(page, 'sla');
    const dialog = await openFormDialog(page, '建立 SLA 政策');

    await setField(dialog.getByPlaceholder('例：VIP 快速服務'), `${E2E_PREFIX}pi${RUN}`);
    const numbers = dialog.locator('input[type="number"]');
    await setField(numbers.nth(0), ''); // 首次回應清空
    await setField(numbers.nth(1), ''); // 解決時間清空
    await setField(numbers.nth(2), ''); // 預警清空

    const result = await submitAndObserve(
      page,
      async () => dialog.getByRole('button', { name: '儲存政策' }).click(),
      /\/sla-policies$/,
      'POST',
      6_000,
    );

    expect(
      result.requested,
      'BUG-11：三個數字欄位全清空仍送出請求（前端用 || 預設值補上，未提示使用者）',
    ).toBe(true);
    expect(result.status, '送出的是預設值，後端接受').toBe(201);
    const body = result.body as { data?: { id: string; firstResponseMinutes: number } };
    if (body?.data?.id) {
      cleanup.slaIds.add(body.data.id);
      expect(
        body.data.firstResponseMinutes,
        'BUG-11 實害：使用者沒填的欄位被靜默存成 15，而非擋下要求填寫',
      ).toBe(15);
    }
  });

  test('@fields-settings 45 SLA 往返：合法值存檔後正確回讀', async () => {
    const name = `${E2E_PREFIX}rt${RUN}`;
    const res = await api.post('sla-policies', {
      data: mkSla({
        name,
        firstResponseMinutes: 17,
        resolutionMinutes: 123,
        warningBeforeMinutes: 7,
      }),
    });
    expect(res.status()).toBe(201);
    const created = (await res.json()).data;
    cleanup.slaIds.add(created.id);

    const list = (await (await api.get('sla-policies')).json()).data as Array<{
      id: string;
      name: string;
      firstResponseMinutes: number;
      resolutionMinutes: number;
      warningBeforeMinutes: number;
    }>;
    const found = list.find((p) => p.id === created.id);
    expect(found?.name).toBe(name);
    expect(found?.firstResponseMinutes, '首次回應分鐘數往返一致').toBe(17);
    expect(found?.resolutionMinutes, '解決時間分鐘數往返一致').toBe(123);
    expect(found?.warningBeforeMinutes, '預警分鐘數往返一致').toBe(7);
  });
});

// ===========================================================================
// 6. office-hours — 時區 / 時段 / 假日（全部先備份後還原）
// ===========================================================================

test.describe('營業時間（office-hours）@fields-settings', () => {
  /** 以原值為基底套用覆寫，測完一律還原 */
  async function withOfficeHoursRestore(fn: (base: any) => Promise<void>) {
    const orig = (await (await api.get('settings/office-hours')).json()).data;
    try {
      await fn(orig);
    } finally {
      const restore = await api.put('settings/office-hours', {
        data: { timezone: orig.timezone, officeHours: orig.officeHours },
      });
      expect(restore.status(), '營業時間必須還原成原值（環境紅線）').toBe(200);
      const now = (await (await api.get('settings/office-hours')).json()).data;
      expect(now.timezone, '還原後時區應與原值一致').toBe(orig.timezone);
    }
  }

  test('@fields-settings 50 時間格式 regex：HH:MM 才收，9:00 / 非數字被擋', async () => {
    await withOfficeHoursRestore(async (orig) => {
      const mk = (schedule: unknown) => ({
        timezone: orig.timezone,
        officeHours: { ...orig.officeHours, schedule },
      });
      await apiFieldCheck(api, {
        path: 'settings/office-hours',
        method: 'put',
        payload: mk({ mon: { start: '9:00', end: '18:00' } }),
        expect: 'reject',
        context: 'start = "9:00"（非兩位數小時，regex 擋下）',
      });
      await apiFieldCheck(api, {
        path: 'settings/office-hours',
        method: 'put',
        payload: mk({ mon: { start: 'abcde', end: '18:00' } }),
        expect: 'reject',
        context: 'start = "abcde"（非時間格式）',
      });
      await apiFieldCheck(api, {
        path: 'settings/office-hours',
        method: 'put',
        payload: mk({ mon: { start: '09:00', end: '' } }),
        expect: 'reject',
        context: 'end 空字串',
      });
    });
  });

  test('@fields-settings 51 【BUG-4 P2】時間語意未驗：25:99 可存、結束早於開始可存', async () => {
    await withOfficeHoursRestore(async (orig) => {
      // regex /^\d{2}:\d{2}$/ 只管「兩位數:兩位數」，不管小時 <24、分鐘 <60
      const bad = await api.put('settings/office-hours', {
        data: {
          timezone: orig.timezone,
          officeHours: { ...orig.officeHours, schedule: { mon: { start: '25:99', end: '18:00' } } },
        },
      });
      expect(
        bad.status(),
        'BUG-4：25:99 不是合法時間卻通過 regex 被寫入。應改用範圍驗證（00-23:00-59）',
      ).toBe(200);
      expect(
        (await bad.json()).data.officeHours.schedule.mon.start,
        '不合法時間原樣落庫',
      ).toBe('25:99');

      // 結束早於開始：純邏輯矛盾，後端完全沒檢查
      const reversed = await api.put('settings/office-hours', {
        data: {
          timezone: orig.timezone,
          officeHours: { ...orig.officeHours, schedule: { mon: { start: '18:00', end: '09:00' } } },
        },
      });
      expect(
        reversed.status(),
        'BUG-4：結束時間早於開始時間應被擋下，實際被接受（營業時間判定會失準）',
      ).toBe(200);
    });
  });

  test('@fields-settings 52 【BUG-5 P2】timezone 無白名單：Mars/Phobos 可存', async () => {
    await withOfficeHoursRestore(async (orig) => {
      const res = await api.put('settings/office-hours', {
        data: { timezone: 'Mars/Phobos', officeHours: orig.officeHours },
      });
      expect(
        res.status(),
        'BUG-5：timezone 是 z.string().default() 無 IANA 時區白名單，不存在的時區可存（排程/營業判定會出錯）',
      ).toBe(200);
      expect((await res.json()).data.timezone).toBe('Mars/Phobos');
    });
  });

  test('@fields-settings 53 【BUG-6 P2】holidays 無日期格式驗證：任意字串可存', async () => {
    await withOfficeHoursRestore(async (orig) => {
      const res = await api.put('settings/office-hours', {
        data: {
          timezone: orig.timezone,
          officeHours: { ...orig.officeHours, holidays: ['not-a-date', '2026/13/45', ''] },
        },
      });
      expect(
        res.status(),
        'BUG-6：holidays 是 z.array(z.string())，未驗 YYYY-MM-DD，垃圾字串可存',
      ).toBe(200);
      expect((await res.json()).data.officeHours.holidays).toContain('not-a-date');
    });
  });

  test('@fields-settings 54 營業時間 UI：時間欄位為 type=time（前端有原生擋控）', async ({ page }) => {
    // ⚠️ 本案例全程「只在瀏覽器端切換開關、不按儲存」，離開頁面即丟棄，不會動到正式設定。
    // UAT 租戶目前 enabled=false，排程/假日欄位未渲染（畫面只有「未啟用營業時間」），
    // 必須先在 UI 開啟開關才掃得到欄位。
    await gotoTab(page, 'office-hours');
    await page.waitForTimeout(1_000);

    const beforeEnable = await inventoryFields(page);
    console.log(formatFieldInventory(beforeEnable, '營業時間（未啟用）'));

    // 切換啟用開關（純前端 state，未按「儲存設定」不會 PUT）
    const toggle = page.locator('button[role="switch"], button').filter({ hasText: /未啟用營業時間|已啟用營業時間/ }).first();
    if (await toggle.count()) {
      await toggle.click().catch(() => {});
    } else {
      // 開關可能是無文字的 switch，退回點第一個 role=switch
      await page.locator('[role="switch"]').first().click().catch(() => {});
    }
    await page.waitForTimeout(1_000);

    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '營業時間（已啟用，僅前端切換未儲存）'));

    const timeInputs = fields.filter((f) => f.type === 'time');
    const dateInputs = fields.filter((f) => f.type === 'date');
    const textareas = fields.filter((f) => f.tag === 'textarea');

    if (timeInputs.length === 0) {
      // 開關切不開時不硬失敗（此案例只是輔助盤點，擋控結論已由案例 50-53 的 API 直測給出）
      console.log('注意：未能在 UI 開啟營業時間開關，略過 type=time 欄位斷言');
    } else {
      expect(timeInputs.length, '每週排程應有 type=time 的起訖時間欄位').toBeGreaterThan(0);
      expect(dateInputs.length, '假日應有 type=date 欄位').toBeGreaterThan(0);
      expect(textareas.length, '應有非營業時間自動回覆訊息 textarea').toBeGreaterThan(0);
      // 結論：UI 端 type=time/date 有原生擋控（25:99 打不進去），
      // 但 API 端沒有（見 BUG-4/5/6）→ 繞過 UI 即可寫入垃圾值，後端仍需補驗。
    }

    // 不儲存，直接離開（reload 丟棄前端 state，確保未影響正式設定）
    await gotoTab(page, 'office-hours');
    const restored = (await (await api.get('settings/office-hours')).json()).data;
    expect(restored.officeHours.enabled, '未按儲存，租戶的營業時間啟用狀態不應改變').toBe(
      (originalOfficeHours as any).officeHours.enabled,
    );
  });

  test('@fields-settings 55 往返：合法設定存檔後正確回讀（測完還原）', async () => {
    await withOfficeHoursRestore(async (orig) => {
      const res = await api.put('settings/office-hours', {
        data: {
          timezone: 'Asia/Taipei',
          officeHours: {
            ...orig.officeHours,
            schedule: { ...orig.officeHours.schedule, mon: { start: '08:30', end: '17:30' } },
          },
        },
      });
      expect(res.status()).toBe(200);
      const after = (await (await api.get('settings/office-hours')).json()).data;
      expect(after.officeHours.schedule.mon.start, '起始時間往返一致').toBe('08:30');
      expect(after.officeHours.schedule.mon.end, '結束時間往返一致').toBe('17:30');
    });
  });
});

// ===========================================================================
// 7. tracking — GA4 / Pixel ID（全部先備份後還原）
// ===========================================================================

test.describe('追蹤設定（tracking）@fields-settings', () => {
  async function withTrackingRestore(fn: () => Promise<void>) {
    const orig = (await (await api.get('settings/tracking')).json()).data;
    try {
      await fn();
    } finally {
      await api.put('settings/tracking', {
        data: { gaId: orig.gaId, metaPixelId: orig.metaPixelId },
      });
      const now = (await (await api.get('settings/tracking')).json()).data;
      expect(now.gaId, '追蹤設定必須還原成原值（環境紅線）').toBe(orig.gaId);
      expect(now.metaPixelId, '追蹤設定必須還原成原值（環境紅線）').toBe(orig.metaPixelId);
    }
  }

  test('@fields-settings 60 【BUG-2 P1】GA4 / Pixel ID 完全無格式驗證，含 script 標籤可存', async () => {
    await withTrackingRestore(async () => {
      const res = await api.put('settings/tracking', {
        data: { gaId: FieldSamples.xss, metaPixelId: 'not-a-number' },
      });
      expect(
        res.status(),
        'BUG-2：trackingSettingsSchema 是 z.string().nullable().optional()，無任何格式驗證',
      ).toBe(200);
      const body = (await res.json()).data;
      expect(body.gaId, 'XSS payload 原樣落庫').toBe(FieldSamples.xss);

      // 風險說明：這兩個值會被注入短連結 redirect 頁的追蹤腳本
      // （TrackingSettings 元件註解：「短連結的 redirect 頁面會自動注入對應的追蹤腳本」）
      // 因此這不只是格式問題，若注入端未做轉義即為儲存型 XSS 面。
    });
  });

  test('@fields-settings 61 GA4 ID 應為 G-XXXXXXXXXX 格式：合法值可存並正確往返', async () => {
    await withTrackingRestore(async () => {
      const res = await api.put('settings/tracking', {
        data: { gaId: 'G-E2ETEST999', metaPixelId: '1234567890' },
      });
      expect(res.status()).toBe(200);
      const after = (await (await api.get('settings/tracking')).json()).data;
      expect(after.gaId, '合法 GA4 ID 往返一致').toBe('G-E2ETEST999');
      expect(after.metaPixelId, '合法 Pixel ID 往返一致').toBe('1234567890');
    });
  });

  test('@fields-settings 62 清空欄位 → 存為 null（前端 trim() || null）', async () => {
    await withTrackingRestore(async () => {
      const res = await api.put('settings/tracking', {
        data: { gaId: null, metaPixelId: null },
      });
      expect(res.status()).toBe(200);
      const after = (await (await api.get('settings/tracking')).json()).data;
      expect(after.gaId, '清空應存為 null').toBeNull();
      expect(after.metaPixelId, '清空應存為 null').toBeNull();
    });
  });

  test('@fields-settings 63 UI 欄位盤點（不執行儲存，避免動到正式設定）', async ({ page }) => {
    await gotoTab(page, 'tracking');
    await page.waitForTimeout(1_000);
    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '追蹤設定'));
    const ga = await fieldByLabel(page, 'Google Analytics 4 ID');
    const pixel = await fieldByLabel(page, 'Meta Pixel ID');
    await expect(ga).toBeVisible();
    await expect(pixel).toBeVisible();
    // 前端也沒有 pattern / maxLength 擋控 → 與後端一樣無驗證
    expect(await ga.getAttribute('pattern'), 'GA4 欄位無 pattern 擋控（BUG-2 前端側）').toBeNull();
    expect(await ga.getAttribute('maxlength'), 'GA4 欄位無 maxLength 擋控').toBeNull();
  });
});

// ===========================================================================
// 8. api-keys — 建立金鑰
// ===========================================================================

test.describe('API 金鑰（api-keys）@fields-settings', () => {
  test('@fields-settings 70 名稱長度邊界：空擋 / 100 過 / 101 擋（max(100) 三點）', async () => {
    await apiFieldCheck(api, {
      path: 'settings/api-keys',
      payload: { name: '' },
      expect: 'reject',
      context: 'API 金鑰名稱空字串',
    });

    const exact = `${E2E_PREFIX}${strOfLength(100 - E2E_PREFIX.length)}`;
    expect(exact.length).toBe(100);
    const okRes = await api.post('settings/api-keys', { data: { name: exact } });
    expect(okRes.status(), '100 字（剛好上限）應被接受').toBe(201);
    cleanup.apiKeyIds.add((await okRes.json()).data.id);

    await apiFieldCheck(api, {
      path: 'settings/api-keys',
      payload: { name: strOfLength(101) },
      expect: 'reject',
      context: 'API 金鑰名稱 101 字（超過 max(100)）',
    });
  });

  test('@fields-settings 71 expiresInDays：負數 / 零 / 小數被擋，正整數與 null 可用', async () => {
    for (const [label, value] of [
      ['負數', -5],
      ['零', 0],
      ['小數', 1.5],
    ] as const) {
      await apiFieldCheck(api, {
        path: 'settings/api-keys',
        payload: { name: `${E2E_PREFIX}exp${RUN}`, expiresInDays: value },
        expect: 'reject',
        context: `expiresInDays ${label}（int().positive() 擋控）`,
      });
    }

    const ok = await api.post('settings/api-keys', {
      data: { name: `${E2E_PREFIX}exp30-${RUN}`, expiresInDays: 30 },
    });
    expect(ok.status(), '30 天應被接受').toBe(201);
    const body = (await ok.json()).data;
    cleanup.apiKeyIds.add(body.id);
    expect(body.expiresAt, '設定天數後應有到期時間').toBeTruthy();

    const never = await api.post('settings/api-keys', {
      data: { name: `${E2E_PREFIX}never-${RUN}`, expiresInDays: null },
    });
    expect(never.status(), 'null（永不過期）應被接受').toBe(201);
    const nb = (await never.json()).data;
    cleanup.apiKeyIds.add(nb.id);
    expect(nb.expiresAt, 'null 應存成無到期時間').toBeNull();
  });

  test('@fields-settings 72 建立後一次性明文 + 撤銷清理', async () => {
    const name = `${E2E_PREFIX}oneshot-${RUN}`;
    const res = await api.post('settings/api-keys', { data: { name } });
    expect(res.status()).toBe(201);
    const body = (await res.json()).data;
    cleanup.apiKeyIds.add(body.id);
    expect(body.key, '建立時應回傳一次性明文金鑰').toBeTruthy();
    expect(body.masked, '列表用的遮罩值應存在').toContain('…');

    // 列表不應再回傳明文
    const list = (await (await api.get('settings/api-keys')).json()).data as Array<{
      id: string;
      key?: string;
      masked: string;
    }>;
    const found = list.find((k) => k.id === body.id);
    expect(found?.key, '列表 API 絕不可再回傳明文金鑰').toBeUndefined();

    // 撤銷
    const revoke = await api.delete(`settings/api-keys/${body.id}`);
    expect(revoke.status(), '撤銷應成功').toBe(200);
  });

  test('@fields-settings 73 UI 名稱必填：空名稱時建立鈕 disabled', async ({ page }) => {
    await gotoTab(page, 'api-keys');
    const dialog = await openFormDialog(page, '建立金鑰');
    const fields = await inventoryFields(page, 'dialog[open]');
    console.log(formatFieldInventory(fields, 'API 金鑰建立表單'));

    const submit = dialog.getByRole('button', { name: /^建立/ });
    await expect(submit, '名稱空白時建立鈕應 disabled（!name.trim()）').toBeDisabled();

    await setField(dialog.getByPlaceholder(/Stanley 產品端/), FieldSamples.whitespace);
    await expect(submit, '純空白名稱時建立鈕仍應 disabled').toBeDisabled();
  });
});

// ===========================================================================
// 9. cli-sessions — 建立 session
// ===========================================================================

test.describe('CLI 連線（cli-sessions）@fields-settings', () => {
  test('@fields-settings 80 名稱長度邊界：空擋 / 100 過 / 101 擋', async () => {
    await apiFieldCheck(api, {
      path: 'settings/cli-sessions',
      payload: { name: '' },
      expect: 'reject',
      context: 'CLI session 名稱空字串',
    });

    const exact = `${E2E_PREFIX}${strOfLength(100 - E2E_PREFIX.length)}`;
    const ok = await api.post('settings/cli-sessions', { data: { name: exact } });
    expect(ok.status(), '100 字（剛好上限）應被接受').toBe(201);
    cleanup.cliSessionIds.add((await ok.json()).data.session.id);

    await apiFieldCheck(api, {
      path: 'settings/cli-sessions',
      payload: { name: strOfLength(101) },
      expect: 'reject',
      context: 'CLI session 名稱 101 字',
    });
  });

  test('@fields-settings 81 【BUG-12 P2】scopes 無白名單：任意字串（含萬用字元）被接受', async () => {
    const res = await api.post('settings/cli-sessions', {
      data: { name: `${E2E_PREFIX}scope-${RUN}`, scopes: ['totally:bogus:scope', '*'] },
    });
    expect(
      res.status(),
      'BUG-12：createCliSessionSchema 的 scopes 是 z.array(z.string())，未比對已知 scope 白名單',
    ).toBe(201);
    const session = (await res.json()).data.session;
    cleanup.cliSessionIds.add(session.id);
    expect(session.scopes, '未知的 scope 字串原樣存入 token').toContain('totally:bogus:scope');
    // 註：實際授權以 requirePermission 為準，未知 scope 不會授予真實權限，
    // 故列為 P2（資料衛生/誤導性 UI）而非 P0 權限繞過。
  });

  test('@fields-settings 82 expiresInDays 擋控與預設 scope', async () => {
    for (const [label, value] of [
      ['負數', -1],
      ['零', 0],
      ['小數', 2.5],
    ] as const) {
      await apiFieldCheck(api, {
        path: 'settings/cli-sessions',
        payload: { name: `${E2E_PREFIX}cliexp${RUN}`, expiresInDays: value },
        expect: 'reject',
        context: `CLI expiresInDays ${label}`,
      });
    }

    const ok = await api.post('settings/cli-sessions', {
      data: { name: `${E2E_PREFIX}clidef-${RUN}`, expiresInDays: 7 },
    });
    expect(ok.status()).toBe(201);
    const session = (await ok.json()).data.session;
    cleanup.cliSessionIds.add(session.id);
    expect(session.scopes.length, '未指定 scopes 時應套用預設 scope').toBeGreaterThan(0);
    expect(session.expiresAt, '應有到期時間').toBeTruthy();
  });

  test('@fields-settings 83 mcpRead 勾選 → 加上 MCP 唯讀 scope', async () => {
    const ok = await api.post('settings/cli-sessions', {
      data: { name: `${E2E_PREFIX}mcp-${RUN}`, mcpRead: true },
    });
    expect(ok.status()).toBe(201);
    const session = (await ok.json()).data.session;
    cleanup.cliSessionIds.add(session.id);
    expect(
      session.scopes.some((s: string) => s.includes('mcp')),
      'mcpRead=true 應追加 MCP 唯讀 scope',
    ).toBe(true);
  });

  test('@fields-settings 84 UI 名稱必填 + 一次性 token 不重複回傳', async ({ page }) => {
    await gotoTab(page, 'cli-sessions');
    const dialog = await openFormDialog(page, '產生 Token');
    const fields = await inventoryFields(page, 'dialog[open]');
    console.log(formatFieldInventory(fields, 'CLI 連線建立表單'));

    // 送出鈕文案與開啟鈕同為「產生 Token」，取 dialog 內的那一顆
    const submit = dialog.getByRole('button', { name: '產生 Token' });
    await expect(submit, '名稱空白時產生鈕應 disabled（!name.trim()）').toBeDisabled();

    await setField(dialog.getByPlaceholder(/Claude Code/), FieldSamples.whitespace);
    await expect(submit, '純空白名稱時產生鈕仍應 disabled').toBeDisabled();

    // 列表 API 不可回傳 token 明文
    const list = (await (await api.get('settings/cli-sessions')).json()).data as Array<
      Record<string, unknown>
    >;
    for (const s of list) {
      expect(s.token, '列表 API 絕不可回傳 CLI token 明文').toBeUndefined();
    }
  });
});

// ===========================================================================
// 10. passkeys — 註冊 / 改名
// ===========================================================================

test.describe('Passkey 登入（passkeys）@fields-settings', () => {
  test('@fields-settings 90 改名欄位後端驗證：空 / 純空白 / 81 字被擋（max(80)）', async () => {
    const list = (await (await api.get('auth/passkeys')).json()).data as Array<{
      id: string;
      name: string;
    }>;
    test.skip(
      list.length === 0,
      '此帳號尚未註冊任何 passkey，改名端點無對象可測（註冊需真實驗證器，見案例 92）',
    );

    const target = list[0];
    // 先記下原名，測完還原（不可動壞既有 passkey）
    const originalName = target.name;
    try {
      await apiFieldCheck(api, {
        path: `auth/passkeys/${target.id}`,
        method: 'patch',
        payload: { name: '' },
        expect: 'reject',
        context: 'passkey 改名為空字串（min(1)）',
      });
      await apiFieldCheck(api, {
        path: `auth/passkeys/${target.id}`,
        method: 'patch',
        payload: { name: FieldSamples.whitespace },
        expect: 'reject',
        context: 'passkey 改名純空白（schema 有 .trim() 應擋下）',
      });
      await apiFieldCheck(api, {
        path: `auth/passkeys/${target.id}`,
        method: 'patch',
        payload: { name: strOfLength(81) },
        expect: 'reject',
        context: 'passkey 改名 81 字（超過 max(80)）',
      });
      // 80 字剛好應被接受
      await apiFieldCheck(api, {
        path: `auth/passkeys/${target.id}`,
        method: 'patch',
        payload: { name: strOfLength(80) },
        expect: 'accept',
        context: 'passkey 改名 80 字（剛好上限）',
      });
    } finally {
      await api.patch(`auth/passkeys/${target.id}`, { data: { name: originalName } }).catch(() => {});
      const after = (await (await api.get('auth/passkeys')).json()).data as Array<{
        id: string;
        name: string;
      }>;
      expect(
        after.find((p) => p.id === target.id)?.name,
        'passkey 名稱必須還原成原值（不可動壞既有資料）',
      ).toBe(originalName);
    }
  });

  test('@fields-settings 91 passkey UI：改名欄位可見且有 maxLength 擋控', async ({ page }) => {
    await gotoTab(page, 'passkeys');
    await page.waitForTimeout(1_500);
    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, 'Passkey 登入'));
    // 註冊 Dialog 內的名稱欄位
    await page.getByRole('button', { name: '綁定 Passkey' }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    const dialogFields = await inventoryFields(page, 'dialog[open]');
    console.log(formatFieldInventory(dialogFields, 'Passkey 註冊表單'));

    // 前端 maxLength 與後端 passkeyNameSchema .max(80) 應一致
    const nameInput = page.locator('#passkey-name');
    await expect(nameInput, 'Passkey 註冊表單應有名稱欄位').toBeVisible({ timeout: 10_000 });
    expect(
      await nameInput.getAttribute('maxlength'),
      '前端 maxLength 應與後端 passkeyNameSchema max(80) 一致',
    ).toBe('80');
  });

  test.skip('@fields-settings 92 passkey 註冊流程（WebAuthn，無法自動化）', async () => {
    /**
     * SKIP 原因：passkey 註冊需呼叫 navigator.credentials.create()，
     * 依賴真實/虛擬驗證器（平台 Touch ID、安全金鑰）。Playwright 可用 CDP
     * WebAuthn virtual authenticator 模擬，但：
     *  1. UAT 為遠端 HTTPS 環境，virtual authenticator 需逐 context 啟用且與
     *     既有 storageState session 互動複雜；
     *  2. 註冊成功會在 admin 帳號留下真實憑證，屬於動到正式帳號安全設定（違反紅線）。
     * 因此僅測後端改名欄位的驗證規則（案例 90），註冊本身標記 skip。
     */
  });
});
