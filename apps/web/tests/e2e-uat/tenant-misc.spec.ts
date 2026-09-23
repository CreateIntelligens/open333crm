import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import { E2E_PREFIX, newApiContext, gotoAndCheck, acceptNextDialog } from './helpers';

/**
 * 通知 / 短連結 / 粉絲門戶 / 方案 四個雜項模組功能層測試（跑在 UAT）。
 *
 * 讀碼盤點（與任務描述不同處，以實際程式碼為準）：
 * - 三個頁面（通知/短連結/粉絲門戶）的 Tab 都是自製元件（src/components/ui/tabs.tsx），
 *   TabsTrigger 渲染為普通 `<button>`，**未加 `role="tab"`**（與 tenant-marketing.spec.ts
 *   記錄的踩坑一致）。故本檔全面改用 `getByRole('button', { exact: true })` 定位 tab，
 *   不用 `getByRole('tab')`，也沒有 aria-selected 可斷言，改用「該 tab 內容區的標題/按鈕
 *   是否出現」來驗證切換成功。
 * - 通知頁（src/app/dashboard/notifications/page.tsx）：點擊單則通知會呼叫 markAsRead
 *   再依 clickUrl router.push；已讀樣式差異是移除 `bg-accent/20 border-accent` 與已讀
 *   小按鈕消失。全站無 toast，全部靜默刷新（SWR mutate）。
 * - 短連結頁（src/app/dashboard/shortlinks/page.tsx）：LinkFormDialog 是原生 `<dialog>`
 *   （getByRole('dialog') 可定位）。刪除為**硬刪**（shortlink.service.ts
 *   `deleteShortLink` → `prisma.shortLink.delete`），confirm 文案是
 *   `'確定刪除此短連結？'`（非「確定要刪除…嗎」句型）。全站無 toast，儲存/刪除成功後
 *   皆靜默關閉 dialog + SWR mutate。QR Code 用 `<img>` 顯示 base64 data URI，來源 API
 *   `GET /shortlinks/:id/qrcode`；`<img>` 無 alt 文字，故用 dialog 容器 + loading 消失
 *   來斷言，不用 `getByRole('img', { name })`。
 * - 粉絲門戶頁（src/app/dashboard/portal/page.tsx）：ActivityFormDialog 是原生
 *   `<dialog>`。活動狀態機（portal.service.ts）：建立必為 DRAFT；publishActivity 只允許
 *   DRAFT→PUBLISHED；endActivity 只允許 PUBLISHED→ENDED；deleteActivity 只允許
 *   status === 'DRAFT'（否則 400 'Only DRAFT activities can be deleted'）——故活動一旦
 *   發布/結束就無法再刪除，測試「結束活動」後不再嘗試刪除，任其保留為 ENDED（符合任務指示）。
 *   發布/結束按鈕**沒有 confirm dialog**（ActivityList.handlePublish/handleEnd 直接呼叫
 *   API，未包 `confirm()`），故不用 acceptNextDialog。
 *   積分管理 tab（PointsTab.tsx）搜尋走 `GET /contacts?q=...`，「手動調整」會呼叫
 *   `POST /portal/points/adjust` 寫入真實聯絡人的積分交易——本檔完全不觸碰此按鈕，
 *   只驗證搜尋框/按鈕存在（唯讀）。
 *   SubmissionsView 的「抽獎」（`POST /activities/:id/draw`）完全不測，見下方風險說明。
 * - 方案頁（src/app/dashboard/plan/page.tsx）：無 Tab，單頁表單。
 *   `POST /plan-change` 需要 `settings.manage` 權限（plan-change.routes.ts
 *   requirePermission('settings.manage')），ADMIN 角色測試帳號應具備。
 *   已有 pending 申請時，表單整塊被「您有一筆處理中的申請…」文字取代（隱藏，非停用按鈕）。
 *   送出成功後畫面顯示綠色文字「✓ 申請已送出，等待平台方核准」（非浮動 toast，
 *   是頁面內常駐 `<div>`）——本檔不會走到這一步，見下方風險說明。
 *
 * ⚠️ 風險與保守決策：
 * 1. 粉絲門戶「抽獎」（SubmissionsView 的 `POST .../draw`）完全不測：會產生無法復原的
 *    真實抽獎結果（寫入 PortalSubmission.isWinner 等），且抽獎名單若含真實聯絡人可能
 *    造成後續人工混淆。任務明確要求跳過，本檔未寫此案例。
 * 2. 積分調整（PointsTab 的「手動調整」）完全不測：會寫入真實聯絡人的積分交易記錄且
 *    無安全復原路徑（新增一筆負向交易只是「抵銷」，不是真正撤銷，且會搜到不可控的
 *    真實客戶資料作為調整對象）。對應案例僅驗證搜尋輸入框/按鈕可見（唯讀）。
 * 3. 方案申請（PlanPage 送出申請）本檔選擇**只做唯讀驗證，不實際送出申請**：
 *    雖然 `POST /plan-change` 本身只寫入 `PlanChangeRequest` 表（pending 狀態），
 *    不會觸發任何真實開通/扣款（要核准才會改 tenant.planId 或加 token 額度，
 *    見 plan-change.service.ts approveRequest，本檔不會觸碰核准端點），但這筆假申請
 *    會真實出現在平台方待審核佇列（UAT 環境的平台管理員後台），可能造成人工混淆
 *    ——不同於行銷模組的草稿（純租戶內部可見），核准佇列是會被平台方人員實際看到、
 *    可能誤以為是真實客戶需求的資料。故本檔僅測試頁面載入 + 升級/加購模式切換，
 *    不點擊「送出申請」，「pending 時擋重送」邏輯的存在已由讀碼確認
 *    （plan-change.service.ts createPlanChangeRequest：已有 pending 時拋 409 CONFLICT），
 *    不需要用真實送出來驗證。
 *
 * 軟刪/硬刪盤點：短連結＝硬刪；粉絲活動＝硬刪但受狀態機限制（僅 DRAFT 可刪）；
 * 通知無刪除功能。
 */
test.describe.configure({ mode: 'serial' });

// ── 通知 ───────────────────────────────────────────────────────────────────
test.describe('@notifications 通知功能層', () => {
  async function gotoNotifications(page: Page) {
    await gotoAndCheck(page, '/dashboard/notifications');
  }

  test('@notifications 頁面載入：全部/未讀/已讀三個 tab 皆可切換並渲染', async ({ page }) => {
    await gotoNotifications(page);
    await expect(page.getByRole('button', { name: '全部', exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: '未讀', exact: true }).click();
    // 未讀 tab 下，空狀態或列表其中一種會出現；用「已讀」按鈕仍可見來確認頁面未壞
    await expect(page.getByRole('button', { name: '已讀', exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '已讀', exact: true }).click();
    await expect(page.getByRole('button', { name: '全部', exact: true })).toBeVisible({ timeout: 10_000 });

    // 切回全部確認可逆
    await page.getByRole('button', { name: '全部', exact: true }).click();
    await expect(page.getByRole('button', { name: '未讀', exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('@notifications 點擊單則未讀通知：應標記已讀（API 反查驗證）', async ({ page }) => {
    await gotoNotifications(page);
    await page.getByRole('button', { name: '未讀', exact: true }).click();
    await page.waitForTimeout(1000);

    const emptyText = page.getByText('沒有未讀通知');
    if (await emptyText.isVisible().catch(() => false)) {
      test.skip(true, '目前無未讀通知可測（環境資料狀態），略過此案例');
    }

    // 未讀通知卡片點擊會呼叫 markAsRead（handleNotificationClick），取第一筆卡片點擊
    const firstCard = page.locator('div.cursor-pointer.hover\\:bg-accent\\/50').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });

    const readRes = page.waitForResponse(
      (res) => /\/notifications\/[^/]+\/read/.test(res.url()) && res.request().method() === 'PATCH',
    );
    await firstCard.click();
    const res = await readRes;
    expect(res.ok(), `標記已讀失敗：${await res.text()}`).toBeTruthy();
  });

  test('@notifications 全部已讀：點擊後未讀數變 0', async ({ page }) => {
    await gotoNotifications(page);
    await page.getByRole('button', { name: '未讀', exact: true }).click();
    await page.waitForTimeout(1000);

    const emptyText = page.getByText('沒有未讀通知');
    if (await emptyText.isVisible().catch(() => false)) {
      test.skip(true, '目前無未讀通知（已是 0），無法驗證「全部已讀」後未讀數變化，略過');
    }

    const readAllRes = page.waitForResponse(
      (res) => res.url().includes('/notifications/read-all') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '全部已讀' }).click();
    const res = await readAllRes;
    expect(res.ok(), `全部已讀失敗：${await res.text()}`).toBeTruthy();

    // 未讀 tab 應變成空狀態
    await expect(page.getByText('沒有未讀通知')).toBeVisible({ timeout: 10_000 });
  });

  test('@notifications 分頁：通知數量夠多時分頁按鈕可用，否則略過', async ({ page }) => {
    await gotoNotifications(page);
    await expect(page.getByRole('button', { name: '全部', exact: true })).toBeVisible({ timeout: 15_000 });

    const pager = page.getByText(/第 \d+ \/ \d+ 頁/);
    if (!(await pager.isVisible().catch(() => false))) {
      test.skip(true, '通知總數不足一頁（totalPages <= 1），分頁 UI 未渲染，環境資料量限制，非功能 bug');
    }

    const nextBtn = page.getByRole('button', { name: '下一頁' });
    await expect(nextBtn).toBeVisible();
    if (await nextBtn.isDisabled()) {
      test.skip(true, '目前已在最後一頁，無法驗證換頁，環境資料量限制');
    }
    await nextBtn.click();
    await expect(page.getByText('第 2 / ')).toBeVisible({ timeout: 10_000 });
    const prevBtn = page.getByRole('button', { name: '上一頁' });
    await expect(prevBtn).toBeEnabled();
    await prevBtn.click();
    await expect(page.getByText(/第 1 \//)).toBeVisible({ timeout: 10_000 });
  });
});

// ── 短連結 ─────────────────────────────────────────────────────────────────
test.describe('@shortlinks 短連結功能層', () => {
  let api: APIRequestContext;
  const runId = randomUUID().slice(0, 6);
  const linkTitle = `${E2E_PREFIX} 短連結 ${runId}`;
  const linkTitleEdited = `${E2E_PREFIX} 短連結已編輯 ${runId}`;
  let linkId = '';

  test.beforeAll(async () => {
    api = await newApiContext();
  });

  test.afterAll(async () => {
    if (!api) return;
    if (linkId) {
      try {
        await api.delete(`shortlinks/${linkId}`);
      } catch {
        // 可能測試流程中已刪除，略過
      }
    }
    await api.dispose();
  });

  async function gotoShortlinks(page: Page, tab?: 'links' | 'stats') {
    await gotoAndCheck(page, '/dashboard/shortlinks');
    if (tab === 'stats') {
      await page.getByRole('button', { name: '統計分析', exact: true }).click();
      await expect(page.getByText('來源分布')).toBeVisible({ timeout: 10_000 });
    }
  }

  test('@shortlinks 頁面載入：連結管理/統計分析 tab 皆可切換', async ({ page }) => {
    await gotoShortlinks(page);
    await expect(page.getByRole('button', { name: '連結管理', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '建立連結' })).toBeVisible();

    await page.getByRole('button', { name: '統計分析', exact: true }).click();
    // 「選擇連結」是收合 select 裡的 <option>，收合狀態天生 hidden，不能用 toBeVisible；
    // 改斷言該 select 本身存在（ClickStatsView 的下拉容器）
    await expect(
      page.locator('select').filter({ has: page.getByText('選擇連結') }),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '連結管理', exact: true }).click();
    await expect(page.getByRole('button', { name: '建立連結' })).toBeVisible({ timeout: 10_000 });
  });

  test('@shortlinks 建立短連結：標題 + 目標 URL → 成功出現在列表', async ({ page }) => {
    // CM-171 已修復並部署 UAT（shortlink.routes.ts 改用 request.tenantPrisma）：短連結
    // CRUD 恢復正常。QR/編輯/刪除三條案例依賴這裡建立的 linkId。
    await gotoShortlinks(page);
    await page.getByRole('button', { name: '建立連結' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('建立短連結')).toBeVisible();

    await dialog.getByPlaceholder('https://example.com/page').fill('https://example.com/e2e-target');
    await dialog.getByPlaceholder('連結描述').fill(linkTitle);

    const createRes = page.waitForResponse(
      (res) => res.url().includes('/shortlinks') && res.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '建立', exact: true }).click();
    const res = await createRes;
    expect(res.ok(), `建立短連結失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    linkId = body?.data?.id;
    expect(linkId, '建立回應應含短連結 id').toBeTruthy();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(linkTitle, { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('@shortlinks QR Code：點擊 QR 按鈕 → dialog 顯示 QR 圖片', async ({ page }) => {
    test.skip(!linkId, '前置「建立短連結」未成功，無 linkId 可測');
    await gotoShortlinks(page);
    const row = page.locator('tbody tr', { hasText: linkTitle }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const qrRes = page.waitForResponse(
      (res) => res.url().includes(`/shortlinks/${linkId}/qrcode`) && res.request().method() === 'GET',
    );
    await row.getByTitle('QR Code').click();
    const res = await qrRes;
    expect(res.ok(), `取得 QR Code 失敗：${await res.text()}`).toBeTruthy();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('QR Code')).toBeVisible();
    // QrCodeDialog 的 <img> 無 alt/role 文字定位，改用 dialog 內 img 元素直接定位
    await expect(dialog.locator('img')).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: '關閉' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  test('@shortlinks 編輯短連結：改標題 → 儲存成功', async ({ page }) => {
    test.skip(!linkId, '前置「建立短連結」未成功，無 linkId 可測');
    await gotoShortlinks(page);
    const row = page.locator('tbody tr', { hasText: linkTitle }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByTitle('編輯').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('編輯短連結')).toBeVisible();
    const titleInput = dialog.getByPlaceholder('連結描述');
    await titleInput.fill('');
    await titleInput.fill(linkTitleEdited);

    const patchRes = page.waitForResponse(
      (res) => res.url().includes(`/shortlinks/${linkId}`) && res.request().method() === 'PATCH',
    );
    await dialog.getByRole('button', { name: '儲存', exact: true }).click();
    const res = await patchRes;
    expect(res.ok(), `編輯短連結失敗：${await res.text()}`).toBeTruthy();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(linkTitleEdited, { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('@shortlinks 刪除短連結（硬刪）：確認後從列表消失，API 查詢應 404', async ({ page }) => {
    test.skip(!linkId, '前置「建立短連結」未成功，無 linkId 可測');
    await gotoShortlinks(page);
    const row = page.locator('tbody tr', { hasText: linkTitleEdited }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const dialogPromise = acceptNextDialog(page);
    const deleteRes = page.waitForResponse(
      (res) => res.url().includes(`/shortlinks/${linkId}`) && res.request().method() === 'DELETE',
    );
    await row.getByTitle('刪除').click();
    const msg = await dialogPromise;
    expect(msg).toContain('確定刪除此短連結');
    const res = await deleteRes;
    expect(res.ok(), `刪除短連結失敗：${await res.text()}`).toBeTruthy();

    await expect(page.getByText(linkTitleEdited, { exact: true })).toBeHidden({ timeout: 10_000 });

    const checkRes = await api.get(`shortlinks/${linkId}`);
    expect(checkRes.status(), '硬刪後 API 應查不到（404）').toBe(404);
    linkId = ''; // 已刪除，afterAll 不必再清理
  });
});

// ── 粉絲門戶 ───────────────────────────────────────────────────────────────
test.describe('@portal 粉絲門戶功能層', () => {
  let api: APIRequestContext;
  const runId = randomUUID().slice(0, 6);
  const activityTitle = `${E2E_PREFIX} 投票活動 ${runId}`;
  let activityId = '';

  test.beforeAll(async () => {
    api = await newApiContext();
  });

  test.afterAll(async () => {
    if (!api) return;
    // 活動若仍是 DRAFT 才刪得掉；一旦發布/結束（本檔測試流程會推進到 ENDED）就刪不掉，
    // try/catch 吞掉 400 即可（讀碼確認：deleteActivity 只允許 status === 'DRAFT'）。
    if (activityId) {
      try {
        await api.delete(`portal/activities/${activityId}`);
      } catch {
        // 非 DRAFT 狀態刪不掉是預期行為，略過
      }
    }
    await api.dispose();
  });

  async function gotoPortal(page: Page, tab?: 'activities' | 'submissions' | 'points') {
    await gotoAndCheck(page, '/dashboard/portal');
    if (tab === 'submissions') {
      await page.getByRole('button', { name: '提交紀錄', exact: true }).click();
      await expect(page.getByText('選擇活動')).toBeVisible({ timeout: 10_000 });
    } else if (tab === 'points') {
      await page.getByRole('button', { name: '積分管理', exact: true }).click();
      await expect(page.getByPlaceholder('搜尋聯繫人（名稱、電話、Email）')).toBeVisible({ timeout: 10_000 });
    }
  }

  test('@portal 建立 POLL 類型活動：[E2E] 標題 + 選項 → 成功出現在列表', async ({ page }) => {
    // CM-172 修復已 commit（本機分支 feat/platform-user-management，未 push/部署 UAT）：
    // portal.routes.ts 改用 request.tenantPrisma。UAT 部署前這裡預期仍會紅（RLS 擋下），
    // 部署後應轉綠——保留不 skip，讓它如實反映 UAT 現況。
    await gotoPortal(page);
    await expect(page.getByRole('button', { name: '建立活動' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '建立活動' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('建立活動')).toBeVisible();

    // 類型下拉預設就是 POLL，不需另選
    await dialog.getByPlaceholder('活動標題').fill(activityTitle);
    await dialog.getByPlaceholder('活動描述').fill(`${E2E_PREFIX} 測試描述 ${runId}`);

    // 預設就有一個空選項輸入框，填入內容
    const optionInput = dialog.getByPlaceholder('選項 1');
    await optionInput.fill(`${E2E_PREFIX} 選項A`);
    // 再新增第二個選項
    await dialog.getByRole('button', { name: '新增' }).click();
    await dialog.getByPlaceholder('選項 2').fill(`${E2E_PREFIX} 選項B`);

    const createRes = page.waitForResponse(
      (res) => res.url().includes('/portal/activities') && res.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '建立', exact: true }).click();
    const res = await createRes;
    expect(res.ok(), `建立活動失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    activityId = body?.data?.id;
    expect(activityId, '建立回應應含活動 id').toBeTruthy();
    expect(body?.data?.status, '新建立活動應為 DRAFT').toBe('DRAFT');

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(activityTitle, { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('@portal 發布活動：DRAFT → PUBLISHED（無 confirm）→ 狀態變化', async ({ page }) => {
    test.skip(!activityId, '前置「建立活動」未成功，無 activityId 可測');
    await gotoPortal(page);
    const card = page
      .locator('h3.font-medium', { hasText: activityTitle })
      .first()
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText('草稿', { exact: true })).toBeVisible();

    const publishRes = page.waitForResponse(
      (res) => res.url().includes(`/portal/activities/${activityId}/publish`) && res.request().method() === 'POST',
    );
    await card.getByRole('button', { name: '發布' }).click();
    const res = await publishRes;
    expect(res.ok(), `發布活動失敗：${await res.text()}`).toBeTruthy();

    await expect(card.getByText('進行中', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('@portal 結束活動：PUBLISHED → ENDED（無 confirm）→ 狀態變化（結束後不可再刪除）', async ({ page }) => {
    test.skip(!activityId, '前置「建立活動」未成功，無 activityId 可測');
    await gotoPortal(page);
    const card = page
      .locator('h3.font-medium', { hasText: activityTitle })
      .first()
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText('進行中', { exact: true })).toBeVisible();

    const endRes = page.waitForResponse(
      (res) => res.url().includes(`/portal/activities/${activityId}/end`) && res.request().method() === 'POST',
    );
    await card.getByRole('button', { name: '結束' }).click();
    const res = await endRes;
    expect(res.ok(), `結束活動失敗：${await res.text()}`).toBeTruthy();

    await expect(card.getByText('已結束', { exact: true })).toBeVisible({ timeout: 10_000 });

    // 讀碼確認：ENDED 狀態的卡片不再渲染任何操作按鈕（發布/編輯/刪除僅 DRAFT 有，
    // 結束僅 PUBLISHED 有），故此活動之後保留為 ENDED，afterAll 嘗試刪除會被 API 擋下（預期行為）。
  });

  test('@portal 積分管理 tab：僅驗證唯讀介面（不對真實聯絡人做積分調整）', async ({ page }) => {
    await gotoPortal(page, 'points');
    await expect(page.getByPlaceholder('搜尋聯繫人（名稱、電話、Email）')).toBeVisible({ timeout: 10_000 });
    // 搜尋按鈕（放大鏡圖示，無文字 label）緊鄰搜尋輸入框，驗證存在即可，不執行搜尋
    const searchInput = page.getByPlaceholder('搜尋聯繫人（名稱、電話、Email）');
    const searchButton = searchInput.locator('xpath=following-sibling::button[1]');
    await expect(searchButton).toBeVisible();
  });
});

// ── 方案 ───────────────────────────────────────────────────────────────────
test.describe('@plan 方案功能層', () => {
  test('@plan 頁面載入：能看到目前方案表單，升級/加購兩種申請模式可切換（唯讀，不實際送出）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/plan');
    await expect(page.getByRole('heading', { name: '方案' })).toBeVisible({ timeout: 15_000 });

    // 若目前有 pending 申請，表單區塊會被提示文字取代，屬正常狀態，兩者擇一驗證
    const pendingNotice = page.getByText('您有一筆處理中的申請');
    const hasPending = await pendingNotice.isVisible().catch(() => false);
    if (hasPending) {
      await expect(pendingNotice).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: '升級方案' })).toBeVisible();
      await expect(page.getByRole('button', { name: '加購 Token' })).toBeVisible();

      // 預設模式為升級方案，應顯示目標方案下拉
      await expect(page.getByText('目標方案')).toBeVisible();

      // 切到加購 Token 模式，應顯示額度選擇按鈕
      await page.getByRole('button', { name: '加購 Token' }).click();
      await expect(page.getByText('加購額度')).toBeVisible();

      // 切回升級方案確認可逆
      await page.getByRole('button', { name: '升級方案' }).click();
      await expect(page.getByText('目標方案')).toBeVisible();
    }

    // 申請記錄區塊應可見（無論有無記錄）
    await expect(page.getByRole('heading', { name: '申請記錄' })).toBeVisible();

    // ⚠️ 刻意不點擊「送出申請」：雖然 POST /plan-change 本身只建立 pending 記錄、
    // 不會觸發真實開通（核准才會改方案/加額度，見 plan-change.service.ts approveRequest，
    // 本檔完全不觸碰核准端點），但這筆申請會真實進入平台方待審核佇列，可能被平台方
    // 人員誤認為真實客戶需求造成困擾。「pending 時擋重送」邏輯已由讀碼確認
    // （createPlanChangeRequest：已有 pending 時拋 409 CONFLICT），不需實際送出驗證。
  });
});
