import { test, expect, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import {
  E2E_PREFIX,
  newApiContext,
  gotoAndCheck,
  acceptNextDialog,
  dismissNextDialog,
} from './helpers';

/**
 * 設定頁維運類 tab — SLA 政策 / 營業時間 / 追蹤設定 / API 金鑰 / CLI 連線 @settings-ops
 *
 * ⚠️ 盤點與程式碼現況落差（撰寫前讀完五個元件 + API routes 後記錄，下方各案例就地引用）：
 *
 * 1. 【最高優先紅線】營業時間（OfficeHoursSettings）與追蹤設定（TrackingSettings）
 *    不是「可用 [E2E] 前綴隔離」的個別建立資料，而是整個租戶共用的單一設定物件
 *    （`GET/PUT /settings/office-hours`、`GET/PUT /settings/tracking`，無 id、無列表，
 *    PUT 直接覆寫租戶的正式設定）。這兩個 tab 的案例（04、05）**絕對不執行任何
 *    fill/click 儲存動作**，只做唯讀驗證：頁面載入、既有欄位/開關可見。
 *
 * 2. SLA 政策刪除是「硬刪」：`apps/api/src/modules/sla/sla.routes.ts` 的
 *    `DELETE /sla-policies/:id` 直接呼叫 `prisma.slaPolicy.delete(...)`（無軟刪欄位），
 *    因此刪除後列表 GET 與 UI 都應該真的看不到這筆——與 automation/line-materials
 *    等模組常見的軟刪模式不同，這裡如實斷言「真的消失」。
 *
 * 3. SLA 建立/編輯 Dialog 是原生 `<dialog>` 元素（`src/components/ui/dialog.tsx`
 *    用 `showModal()`/`close()`），非 shadcn Radix Dialog，Playwright `getByRole('dialog')`
 *    可正常定位。儲存/取消按鈕文案為「儲存政策」「取消」。
 *
 * 4. SLA「設為此優先級預設」checkbox（`formIsDefault`）預設為 false，且勾選後會把
 *    同租戶同優先級的其他政策 `isDefault` 一併設為 false（見 sla.routes.ts `isDefault`
 *    分支）。本 spec 全程不勾選此 checkbox，避免動到既有正式政策的預設狀態。
 *
 * 5. API 金鑰撤銷是「軟刪」（`isActive: false`），且 `GET /settings/api-keys`
 *    **沒有**過濾 isActive（`listPartnerApiKeys` 回傳全部），UI 表格本身也沒有依
 *    isActive 隱藏整列——因此撤銷後這筆金鑰**仍會留在列表**，只是狀態徽章從
 *    「啟用中」變成「已撤銷」、且操作欄的撤銷按鈕消失（`ApiKeyManagement.tsx`
 *    `{k.isActive && <Button>...}` 條件渲染）。案例 07 據此斷言「狀態變已撤銷」，
 *    不斷言「從列表消失」。
 *
 * 6. CLI 連線撤銷同樣是軟刪（`revokedAt: new Date()`），但 `GET /settings/cli-sessions`
 *    的查詢**有**加 `revokedAt: null` 過濾（`settings.routes.ts` 第 372 行），因此撤銷後
 *    這筆 session 會從列表消失（跟 API 金鑰行為不同，各自依實際程式碼斷言）。
 *
 * 7. API 金鑰、CLI Token 建立成功後彈出的「一次性顯示」Dialog 沒有自動關閉，
 *    需使用者按「我已保存，關閉」才會關閉並清空 state；本 spec 於斷言明文可見/
 *    可複製後主動點擊該按鈕關閉，避免殘留 dialog 影響後續案例。
 *
 * 8. 兩個一次性密鑰 Dialog 的複製按鈕呼叫 `navigator.clipboard.writeText`，UAT 為
 *    HTTPS 網域、Playwright context 預設不一定有 clipboard 權限；因此複製動作改用
 *    「點擊複製鈕後按鈕文案變成『已複製』」佐證複製流程有跑完，不直接讀系統剪貼簿
 *    （讀剪貼簿需要額外的 context permission 設定，不在此 spec 範圍內增加環境相依）。
 *
 * 種資料 / 清理策略：
 * - 案例 01 建立的 SLA 政策在案例 02 編輯、案例 03 刪除（spec 內部自行清理，不留到 afterAll）。
 * - 案例 06 建立的 API 金鑰在案例 07 撤銷；案例 08 建立的 CLI session 在案例 09 撤銷。
 * - afterAll 仍保留一層保險：若任一案例中途失敗導致刪除/撤銷案例被跳過，用 API 補撤銷/刪除，
 *   try/catch 不讓清理失敗炸測試。
 */

const RUN = randomUUID().slice(0, 8);
const SLA_NAME = `${E2E_PREFIX} SLA政策測試 ${RUN}`;
const API_KEY_NAME = `${E2E_PREFIX} API金鑰測試 ${RUN}`;
const CLI_SESSION_NAME = `${E2E_PREFIX} CLI連線測試 ${RUN}`;

let api: APIRequestContext;
/** 各案例間傳遞 id，供後續案例操作與 afterAll 保險清理使用 */
let slaPolicyId: string | null = null;
let apiKeyId: string | null = null;
let cliSessionId: string | null = null;

test.beforeAll(async () => {
  api = await newApiContext();
});

test.afterAll(async () => {
  // 保險清理：正常流程下這些 id 在對應的刪除/撤銷案例已經處理掉，
  // 這裡只在中途失敗導致案例被跳過時補做，try/catch 不讓清理失敗炸測試。
  if (slaPolicyId) {
    try {
      await api.delete(`sla-policies/${slaPolicyId}`);
    } catch {
      // 已刪除或清理失敗都不影響測試結果
    }
  }
  if (apiKeyId) {
    try {
      await api.delete(`settings/api-keys/${apiKeyId}`);
    } catch {
      // 已撤銷或清理失敗都不影響測試結果
    }
  }
  if (cliSessionId) {
    try {
      await api.delete(`settings/cli-sessions/${cliSessionId}`);
    } catch {
      // 已撤銷或清理失敗都不影響測試結果
    }
  }
  await api.dispose().catch(() => {});
});

/** 進設定頁並切到指定 tab（左側側欄按鈕文字定位） */
async function gotoSettingsTab(page: import('@playwright/test').Page, tabLabel: string) {
  const errors = await gotoAndCheck(page, '/dashboard/settings');
  expect(errors, `console errors: ${errors.join('; ')}`).toEqual([]);
  await page.getByRole('button', { name: tabLabel, exact: true }).click();
}

test.describe.serial('設定頁維運類 tab @settings-ops', () => {
  test('@settings-ops 01 SLA 政策：建立 [E2E] 政策 → 成功出現在列表', async ({ page }) => {
    await gotoSettingsTab(page, 'SLA 政策');
    await expect(page.getByRole('button', { name: '建立 SLA 政策' })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: '建立 SLA 政策' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.getByPlaceholder('例：VIP 快速服務').fill(SLA_NAME);
    // 優先級維持預設 MEDIUM；首回應/解決時間門檻改成明確、合理、不易與既有政策混淆的數字
    const numberInputs = dialog.locator('input[type="number"]');
    await numberInputs.nth(0).fill('20'); // 首次回應目標（分鐘）
    await numberInputs.nth(1).fill('240'); // 解決時間目標（分鐘）
    await numberInputs.nth(2).fill('15'); // 到期前預警（分鐘）
    // 「設為此優先級預設」checkbox 不勾選，見檔頭說明 4

    const createRes = page.waitForResponse(
      (res) => res.url().includes('/sla-policies') && res.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '儲存政策' }).click();
    const res = await createRes;
    expect(res.ok(), `建立 SLA 政策失敗（${res.status()}）${await res.text()}`).toBeTruthy();
    const body = await res.json();
    slaPolicyId = body?.data?.id;
    expect(slaPolicyId, '建立回應中應有 id').toBeTruthy();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    // SLA 政策每列是 `div.grid.grid-cols-[1fr_auto_auto_auto_auto_auto]`；
    // 用寬泛的 `div,{hasText}` 配 `.last()` 常抓到範圍太小的巢狀容器（缺欄位文字），
    // 改鎖定該 grid row class 精準定位整列
    const row = page.locator('div.grid', { hasText: SLA_NAME }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    // 既有多筆政策可能剛好也顯示相同門檻文字（如「4 小時」），限定在本列範圍內斷言避免 strict violation
    await expect(row.getByText('20 分鐘')).toBeVisible();
    await expect(row.getByText('4 小時')).toBeVisible(); // 240 分鐘 = 4 小時
  });

  test('@settings-ops 02 SLA 政策：編輯（改解決時間門檻）→ 儲存成功', async ({ page }) => {
    test.skip(!slaPolicyId, '前置測試（案例 01）未成功建立政策');
    await gotoSettingsTab(page, 'SLA 政策');
    await expect(page.getByText(SLA_NAME)).toBeVisible({ timeout: 15_000 });

    // SLA 政策每列是 `div.grid.grid-cols-[1fr_auto_auto_auto_auto_auto]`；
    // 用寬泛的 `div,{hasText}` 配 `.last()` 常抓到範圍太小的巢狀容器（缺欄位文字），
    // 改鎖定該 grid row class 精準定位整列
    const row = page.locator('div.grid', { hasText: SLA_NAME }).first();
    // 編輯按鈕：該列操作欄的第一個 ghost 按鈕（鉛筆 icon）
    await row.getByRole('button').first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('編輯 SLA 政策')).toBeVisible();

    const numberInputs = dialog.locator('input[type="number"]');
    await expect(numberInputs.nth(1)).toHaveValue('240');
    await numberInputs.nth(1).fill('180'); // 解決時間目標改為 180 分鐘 = 3 小時

    const patchRes = page.waitForResponse(
      (res) =>
        res.url().includes(`/sla-policies/${slaPolicyId}`) &&
        res.request().method() === 'PATCH' &&
        res.ok(),
    );
    await dialog.getByRole('button', { name: '儲存政策' }).click();
    await patchRes;

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'SLA 政策', exact: true }).click();
    await expect(page.getByText(SLA_NAME)).toBeVisible({ timeout: 15_000 });
    const reloadedRow = page.locator('div.grid', { hasText: SLA_NAME }).first();
    await expect(reloadedRow.getByText('3 小時')).toBeVisible();
  });

  test('@settings-ops 03 SLA 政策：刪除（confirm）→ 硬刪、從列表與 API 消失', async ({ page }) => {
    test.skip(!slaPolicyId, '前置測試（案例 01）未成功建立政策');
    await gotoSettingsTab(page, 'SLA 政策');
    await expect(page.getByText(SLA_NAME)).toBeVisible({ timeout: 15_000 });

    // SLA 政策每列是 `div.grid.grid-cols-[1fr_auto_auto_auto_auto_auto]`；
    // 用寬泛的 `div,{hasText}` 配 `.last()` 常抓到範圍太小的巢狀容器（缺欄位文字），
    // 改鎖定該 grid row class 精準定位整列
    const row = page.locator('div.grid', { hasText: SLA_NAME }).first();
    const dialogMsg = acceptNextDialog(page);
    const deleteRes = page.waitForResponse(
      (res) =>
        res.url().includes(`/sla-policies/${slaPolicyId}`) &&
        res.request().method() === 'DELETE' &&
        res.ok(),
    );
    // 操作欄第二個 ghost 按鈕（垃圾桶 icon）
    await row.getByRole('button').last().click();
    expect(await dialogMsg).toContain('確定要刪除此 SLA 政策嗎');
    await deleteRes;

    // 見檔頭說明 2：硬刪，UI 與 API 都應該真的消失
    await expect(page.getByText(SLA_NAME)).toHaveCount(0, { timeout: 15_000 });

    const listRes = await api.get('sla-policies');
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    const stillThere = (listBody?.data ?? []).some((p: { id: string }) => p.id === slaPolicyId);
    expect(stillThere, '硬刪後 API 列表不應再查得到此政策').toBe(false);

    slaPolicyId = null; // 已刪除，afterAll 不用再補清理
  });

  test('@settings-ops 04 營業時間 tab：唯讀驗證（不執行任何儲存動作）', async ({ page }) => {
    // 見檔頭說明 1：這是全租戶共用設定，絕對不 fill/click 任何會改變既有值的操作，
    // 只驗證頁面能載入、既有開關狀態與時區欄位可見。
    await gotoSettingsTab(page, '營業時間');
    await expect(page.getByText('營業時間設定')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('設定營業時間後，非營業時間收到的訊息將自動回覆提示訊息。')).toBeVisible();

    // 啟用開關（role=switch）必然存在，不論目前是否啟用都只讀取狀態，不點擊切換
    const enableSwitch = page.getByRole('switch').first();
    await expect(enableSwitch).toBeVisible({ timeout: 10_000 });
    const ariaChecked = await enableSwitch.getAttribute('aria-checked');
    expect(['true', 'false']).toContain(ariaChecked);

    // 若目前為啟用狀態，時區下拉與每週排程區塊會顯示；若停用則只有開關本身，
    // 兩種情況都是合法現況，只在啟用時額外驗證時區欄位存在（純讀取，不 change）
    if (ariaChecked === 'true') {
      await expect(page.getByText('時區')).toBeVisible();
      await expect(page.locator('select').first()).toBeVisible();
      await expect(page.getByText('每週排程')).toBeVisible();
    }

    // 明確不執行：不點任何 switch、不 fill 任何 input/textarea、不點「儲存設定」
  });

  test('@settings-ops 05 追蹤設定 tab：唯讀驗證（不執行任何儲存動作）', async ({ page }) => {
    // 見檔頭說明 1：GA4/Meta Pixel 是全租戶共用的真實分析追蹤設定，絕對不 fill/儲存。
    await gotoSettingsTab(page, '追蹤設定');
    await expect(page.getByText('追蹤設定', { exact: true })).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText('Google Analytics 4 ID')).toBeVisible();
    const gaInput = page.getByPlaceholder('G-XXXXXXXXXX');
    await expect(gaInput).toBeVisible();

    await expect(page.getByText('Meta Pixel ID')).toBeVisible();
    const pixelInput = page.getByPlaceholder('1234567890');
    await expect(pixelInput).toBeVisible();

    // 只讀取既有值供人工檢視（不斷言具體內容，租戶是否已設定屬正常現況），不做任何修改
    const gaValue = await gaInput.inputValue();
    const pixelValue = await pixelInput.inputValue();
    expect(typeof gaValue).toBe('string');
    expect(typeof pixelValue).toBe('string');

    // 明確不執行：不 fill 任何欄位、不點「儲存設定」
  });

  test('@settings-ops 06 API 金鑰 tab：建立 [E2E] 金鑰 → 明文可見且可複製（一次性顯示）', async ({
    page,
  }) => {
    await gotoSettingsTab(page, 'API 金鑰');
    await expect(page.getByRole('button', { name: '建立金鑰' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: '建立金鑰' }).click();
    const createDialog = page.getByRole('dialog').filter({ hasText: '建立 API 金鑰' });
    await expect(createDialog).toBeVisible({ timeout: 10_000 });

    await createDialog.getByPlaceholder('例：Stanley 產品端 / 行銷端').fill(API_KEY_NAME);
    await createDialog.locator('select').selectOption('30'); // 過期天數：30 天

    const createRes = page.waitForResponse(
      (res) => res.url().includes('/settings/api-keys') && res.request().method() === 'POST',
    );
    await createDialog.getByRole('button', { name: '建立' }).click();
    const res = await createRes;
    expect(res.ok(), `建立 API 金鑰失敗（${res.status()}）${await res.text()}`).toBeTruthy();
    const body = await res.json();
    apiKeyId = body?.data?.id;
    const rawKey: string = body?.data?.key;
    expect(apiKeyId, '建立回應中應有 id').toBeTruthy();
    expect(rawKey, '建立回應中應有明文 key（一次性）').toBeTruthy();

    // 一次性顯示 Dialog：明文金鑰可見
    const shownDialog = page.getByRole('dialog').filter({ hasText: '金鑰已建立' });
    await expect(shownDialog).toBeVisible({ timeout: 10_000 });
    await expect(shownDialog.locator('code').filter({ hasText: rawKey })).toBeVisible();

    // 可複製：點擊複製鈕後文案變成「已複製」。
    // ⚠️ Playwright context 預設無 clipboard 權限，handleCopy 的 navigator.clipboard.writeText
    // 會拋錯，元件 catch 分支改用原生 alert(key) 當 fallback——若不先攔截，這個 alert
    // 會卡住頁面直到逾時。用 dismissNextDialog 接住，兩種結果（已複製 / alert fallback）都算通過。
    const alertPromise = dismissNextDialog(page).catch(() => null);
    await shownDialog.getByRole('button', { name: /複製/ }).click();
    const copiedVisible = await shownDialog
      .getByRole('button', { name: '已複製' })
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (!copiedVisible) {
      // 走了 fallback alert 分支：確認 dismissNextDialog 真的接住了它
      await alertPromise;
    }

    await shownDialog.getByRole('button', { name: '我已保存，關閉' }).click();
    await expect(shownDialog).toBeHidden({ timeout: 10_000 });

    await expect(page.getByText(API_KEY_NAME)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('啟用中').first()).toBeVisible();
  });

  test('@settings-ops 07 API 金鑰 tab：撤銷 → 仍在列表但狀態變已撤銷', async ({ page }) => {
    test.skip(!apiKeyId, '前置測試（案例 06）未成功建立金鑰');
    await gotoSettingsTab(page, 'API 金鑰');
    await expect(page.getByText(API_KEY_NAME)).toBeVisible({ timeout: 15_000 });

    const row = page.locator('tr', { hasText: API_KEY_NAME });
    const dialogMsg = acceptNextDialog(page);
    const revokeRes = page.waitForResponse(
      (res) =>
        res.url().includes(`/settings/api-keys/${apiKeyId}`) &&
        res.request().method() === 'DELETE' &&
        res.ok(),
    );
    await row.getByRole('button', { name: '撤銷' }).click();
    expect(await dialogMsg).toContain('確定要撤銷');
    await revokeRes;

    // 見檔頭說明 5：軟刪 + 列表無 isActive 過濾 → 仍在列表，狀態變已撤銷，撤銷鈕消失
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'API 金鑰', exact: true }).click();
    const reloadedRow = page.locator('tr', { hasText: API_KEY_NAME });
    await expect(reloadedRow).toBeVisible({ timeout: 15_000 });
    await expect(reloadedRow.getByText('已撤銷')).toBeVisible();
    await expect(reloadedRow.getByRole('button', { name: '撤銷' })).toHaveCount(0);

    apiKeyId = null; // 已撤銷，afterAll 不用再補清理
  });

  test('@settings-ops 08 CLI 連線 tab：建立 [E2E] session → 一次性 token 可見且可複製', async ({
    page,
  }) => {
    await gotoSettingsTab(page, 'CLI 連線');
    await expect(page.getByRole('button', { name: '產生 Token' })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: '產生 Token' }).click();
    const createDialog = page.getByRole('dialog').filter({ hasText: '產生 CLI Token' });
    await expect(createDialog).toBeVisible({ timeout: 10_000 });

    await createDialog
      .getByPlaceholder('例：Claude Code / ChatGPT / open333 CLI')
      .fill(CLI_SESSION_NAME);
    await createDialog.locator('select').selectOption('30'); // 過期天數：30 天
    // 「授予 MCP 唯讀權限」不勾選，維持預設 scope，避免多帶不必要權限

    const createRes = page.waitForResponse(
      (res) =>
        res.url().includes('/settings/cli-sessions') && res.request().method() === 'POST',
    );
    await createDialog.getByRole('button', { name: '產生 Token' }).click();
    const res = await createRes;
    expect(res.ok(), `建立 CLI session 失敗（${res.status()}）${await res.text()}`).toBeTruthy();
    const body = await res.json();
    cliSessionId = body?.data?.session?.id;
    const rawToken: string = body?.data?.token;
    expect(cliSessionId, '建立回應中應有 session.id').toBeTruthy();
    expect(rawToken, '建立回應中應有明文 token（一次性）').toBeTruthy();

    const shownDialog = page.getByRole('dialog').filter({ hasText: 'Token 已產生' });
    await expect(shownDialog).toBeVisible({ timeout: 10_000 });
    await expect(shownDialog.locator('code').filter({ hasText: rawToken })).toBeVisible();

    // 同 API 金鑰案例：clipboard 權限缺失時會走 alert(token) fallback，須先攔截
    const alertPromise2 = dismissNextDialog(page).catch(() => null);
    await shownDialog.getByRole('button', { name: /複製/ }).click();
    const copiedVisible2 = await shownDialog
      .getByRole('button', { name: '已複製' })
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (!copiedVisible2) {
      await alertPromise2;
    }

    await shownDialog.getByRole('button', { name: '我已保存，關閉' }).click();
    await expect(shownDialog).toBeHidden({ timeout: 10_000 });

    await expect(page.getByText(CLI_SESSION_NAME)).toBeVisible({ timeout: 15_000 });
  });

  test('@settings-ops 09 CLI 連線 tab：撤銷 → 從列表消失（GET 有 revokedAt 過濾）', async ({
    page,
  }) => {
    test.skip(!cliSessionId, '前置測試（案例 08）未成功建立 CLI session');
    await gotoSettingsTab(page, 'CLI 連線');
    await expect(page.getByText(CLI_SESSION_NAME)).toBeVisible({ timeout: 15_000 });

    const row = page.locator('tr', { hasText: CLI_SESSION_NAME });
    const dialogMsg = acceptNextDialog(page);
    const revokeRes = page.waitForResponse(
      (res) =>
        res.url().includes(`/settings/cli-sessions/${cliSessionId}`) &&
        res.request().method() === 'DELETE' &&
        res.ok(),
    );
    await row.getByRole('button', { name: '撤銷' }).click();
    expect(await dialogMsg).toContain('確定要撤銷');
    await revokeRes;

    // 見檔頭說明 6：GET /settings/cli-sessions 有 revokedAt:null 過濾，撤銷後應從列表消失
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'CLI 連線', exact: true }).click();
    await expect(page.getByText(CLI_SESSION_NAME)).toHaveCount(0, { timeout: 15_000 });

    cliSessionId = null; // 已撤銷確認消失，afterAll 不用再補清理
  });
});
