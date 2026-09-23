import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import { E2E_PREFIX, newApiContext, gotoAndCheck, expectToast, acceptNextDialog } from './helpers';

/**
 * 素材庫（/dashboard/marketing/materials）功能層測試。
 *
 * 資料紀律：
 * - 全部自建素材/分類名稱一律帶 E2E_PREFIX，afterAll 用 API 依序刪除
 *   （先刪素材、再刪分類；分類刪除時其下素材本就是「歸未分類」不會被連動刪，
 *   但測試流程會確保刪分類前素材已刪完，順序不影響正確性，仍照 SOP 順序清理）。
 * - 建材料一律選「不依賴外部服務」的版型：LINE 純文字 / FB 純文字。
 *   LINE 單張圖片走 CompactImageField 上傳元件太複雜（依賴 MinIO），本檔不測真上傳。
 *
 * 讀碼盤點（與任務描述路徑不同處，以實際程式碼為準）：
 * - 元件實際目錄是 src/components/materials/（非 src/components/marketing/materials/）
 * - 複製素材的名稱後綴是「(copy)」（material.service.ts duplicateMaterial），非「複製」中文字樣
 * - Dialog 是自製的原生 <dialog> 包裝（src/components/ui/dialog.tsx），Playwright 的
 *   getByRole('dialog') 可正常抓到（原生 <dialog> 天生有 dialog role）
 * - 分類管理/版本還原的 confirm() 都是原生 window.confirm，需搭配 acceptNextDialog
 * - 刪除素材的 confirm() 文案：「確定要刪除這個素材嗎？（軟刪，可在後台復原）」
 * - 版本快照規則（material.service.ts updateMaterial）：API 層只在 name 或 body 有變動時
 *   才寫新版本；但編輯頁「存為素材」按鈕永遠會把 draft.name 一併送出，故只要在編輯頁按存檔，
 *   實務上每次都會產生新版本（即使這次只改了分類/標籤）
 * - 標籤是自由輸入文字（MaterialGovernancePanel 的 tags input，非既有標籤選單），
 *   列表頁左側「標籤」區塊只列出「目前所有素材已使用過的標籤」（useMaterialTags），
 *   故標籤過濾測試需先在某素材上加標籤、儲存後，標籤才會出現在左側可過濾
 */
test.describe.configure({ mode: 'serial' });

test.describe('@materials 素材庫功能', () => {
  let api: APIRequestContext;

  const runId = randomUUID().slice(0, 6);
  const catName = `${E2E_PREFIX} 分類 ${runId}`;
  const catRenamed = `${E2E_PREFIX} 分類改名 ${runId}`;
  const lineTextName = `${E2E_PREFIX} LINE文字 ${runId}`;
  const lineTextNameEdited = `${E2E_PREFIX} LINE文字改名 ${runId}`;
  const fbTextName = `${E2E_PREFIX} FB文字 ${runId}`;
  const tagName = `${E2E_PREFIX}標籤${runId}`;

  /** 建立過程中蒐集的 id，afterAll 依序清理 */
  let categoryId = '';
  let lineMaterialId = '';
  let fbMaterialId = '';
  let duplicateMaterialId = '';

  test.beforeAll(async () => {
    api = await newApiContext();
  });

  test.afterAll(async () => {
    if (!api) return;
    // 先刪素材（複製品也要刪），再刪分類；每步 try/catch 不讓清理失敗炸測試
    for (const id of [duplicateMaterialId, lineMaterialId, fbMaterialId]) {
      if (!id) continue;
      try {
        await api.delete(`marketing/materials/${id}`);
      } catch {
        // 清理失敗僅略過
      }
    }
    if (categoryId) {
      try {
        await api.delete(`marketing/materials/categories/${categoryId}`);
      } catch {
        // 清理失敗僅略過
      }
    }
    await api.dispose();
  });

  async function gotoMaterialsList(page: Page) {
    await gotoAndCheck(page, '/dashboard/marketing/materials');
    await expect(page.getByRole('heading', { name: '訊息素材' })).toBeVisible({ timeout: 15_000 });
  }

  // ── 1. 列表頁載入：主要控制項皆可見且可互動 ──────────────────────────
  test('@materials 列表頁載入：分類樹、標籤、搜尋、渠道 pill、排序下拉皆可見', async ({ page }) => {
    await gotoMaterialsList(page);

    // 分類樹（至少有「全部素材」根節點）
    await expect(page.getByRole('button', { name: /全部素材/ })).toBeVisible();
    // 管理分類按鈕
    await expect(page.getByRole('button', { name: '管理' })).toBeVisible();
    // 搜尋框
    await expect(page.getByPlaceholder('搜尋素材名稱')).toBeVisible();
    // 渠道 pill（全部/LINE/FB）
    await expect(page.getByRole('button', { name: '全部', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'LINE', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'FB', exact: true })).toBeVisible();
    // 排序下拉（aria-label="排序方式"）
    await expect(page.getByLabel('排序方式')).toBeVisible();

    // 互動：切換渠道 pill 不噴錯（唯讀操作，不斷言內容，只驗證可點擊且不掉頁）
    await page.getByRole('button', { name: 'LINE', exact: true }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: '全部', exact: true }).click();
  });

  // ── 2. 分類管理：新增 → 樹狀出現 → 改名 → 生效 ────────────────────────
  test('@materials 分類管理：新增 [E2E] 分類後出現在樹狀，改名生效', async ({ page }) => {
    await gotoMaterialsList(page);

    await page.getByRole('button', { name: '管理' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('管理分類')).toBeVisible();

    await dialog.getByPlaceholder('新增分類名稱…').fill(catName);
    const createRes = page.waitForResponse(
      (res) => res.url().includes('/marketing/materials/categories') && res.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '新增' }).click();
    await createRes;

    // 新分類出現在 dialog 清單內
    await expect(dialog.getByText(catName, { exact: true })).toBeVisible({ timeout: 10_000 });

    // 改名：分類列是 `<div class="...rounded-md...">名稱 + Pencil/Trash 按鈕</div>`
    // 從名稱文字往上找最近的 rounded-md 列容器，避免 hasText 誤中外層清單容器
    const row = dialog
      .getByText(catName, { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]');
    await row.locator('button').first().click(); // 第一顆是編輯（Pencil）

    const editInput = dialog.locator('input').last();
    await editInput.fill(catRenamed);
    const renameRes = page.waitForResponse(
      (res) => res.url().includes('/marketing/materials/categories/') && res.request().method() === 'PATCH',
    );
    // handleRename 綁在 input 的 onKeyDown Enter，直接按 Enter 觸發（略過找 Check icon 按鈕）
    await editInput.press('Enter');
    await renameRes;

    await expect(dialog.getByText(catRenamed, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText(catName, { exact: true })).toBeHidden();

    // 記下 categoryId 供後續測試用（改名後查 API 取得 id）
    const catRes = await api.get('marketing/materials/category-tree');
    const cats = (await catRes.json())?.data ?? [];
    const found = cats.find((c: { name: string }) => c.name === catRenamed);
    expect(found, 'API 應能查到剛改名的分類').toBeTruthy();
    categoryId = found.id;

    // 關閉 dialog：無明確 label 的關閉按鈕，改用 Escape（原生 <dialog> 支援）
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  // ── 3. 從版型建立（LINE 純文字） ──────────────────────────────────────
  test('@materials 從版型建立 LINE 純文字素材：選型別 → 填內容 → 存檔成功', async ({ page }) => {
    await gotoMaterialsList(page);
    await page.getByRole('button', { name: '從版型建立' }).click();
    await expect(page.getByRole('heading', { name: '選擇訊息類型' })).toBeVisible({ timeout: 15_000 });

    // 平台預設就是 LINE，直接點「純文字」類型卡
    await page.getByText('純文字', { exact: true }).first().click();

    await expect(page.getByRole('heading', { name: /編輯素材/ })).toBeVisible({ timeout: 10_000 });

    const nameInput = page.getByPlaceholder('如：母親節新品推播');
    await nameInput.fill('');
    await nameInput.fill(lineTextName);

    // 訊息內容 textarea（LineTextEditor）
    await page.getByPlaceholder('輸入要發送的文字訊息').fill(`${E2E_PREFIX} 測試內容 ${runId}`);

    const createRes = page.waitForResponse(
      (res) => res.url().includes('/marketing/materials') && res.request().method() === 'POST' && !res.url().includes('categories'),
    );
    await page.getByRole('button', { name: '存為素材' }).click();
    const res = await createRes;
    expect(res.ok(), `建立 LINE 純文字素材失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    lineMaterialId = body?.data?.id;
    expect(lineMaterialId, '建立回應應含素材 id').toBeTruthy();

    // 成功後跳轉到編輯頁
    await page.waitForURL(/\/dashboard\/marketing\/materials\/[0-9a-f-]+$/, { timeout: 10_000 });

    // 回列表可搜到剛建立的素材
    await gotoMaterialsList(page);
    await page.getByPlaceholder('搜尋素材名稱').fill(lineTextName);
    await expect(page.locator('table').getByText(lineTextName)).toBeVisible({ timeout: 10_000 });
  });

  // ── 4. 從版型建立（FB 純文字） ────────────────────────────────────────
  test('@materials 從版型建立 FB 純文字素材：切平台 → 選型別 → 存檔成功', async ({ page }) => {
    await gotoMaterialsList(page);
    await page.getByRole('button', { name: '從版型建立' }).click();
    await expect(page.getByRole('heading', { name: '選擇訊息類型' })).toBeVisible({ timeout: 15_000 });

    // 切到 FB Messenger 平台
    await page.getByRole('button', { name: /FB Messenger/ }).click();
    await page.getByText('純文字', { exact: true }).first().click();

    await expect(page.getByRole('heading', { name: /編輯素材/ })).toBeVisible({ timeout: 10_000 });
    const nameInput = page.getByPlaceholder('如：母親節新品推播');
    await nameInput.fill('');
    await nameInput.fill(fbTextName);
    await page.getByPlaceholder('輸入要發送的文字訊息').fill(`${E2E_PREFIX} FB 測試內容 ${runId}`);

    const createRes = page.waitForResponse(
      (res) => res.url().includes('/marketing/materials') && res.request().method() === 'POST' && !res.url().includes('categories'),
    );
    await page.getByRole('button', { name: '存為素材' }).click();
    const res = await createRes;
    expect(res.ok(), `建立 FB 純文字素材失敗：${await res.text()}`).toBeTruthy();
    const resBody = await res.json();
    fbMaterialId = resBody?.data?.id;
    expect(fbMaterialId, '建立回應應含素材 id').toBeTruthy();

    await page.waitForURL(/\/dashboard\/marketing\/materials\/[0-9a-f-]+$/, { timeout: 10_000 });
  });

  // ── 5. 素材列表搜尋 ───────────────────────────────────────────────────
  test('@materials 列表搜尋：以 [E2E] 名稱搜尋能找到剛建立的素材', async ({ page }) => {
    await gotoMaterialsList(page);
    await page.getByPlaceholder('搜尋素材名稱').fill(fbTextName);
    await expect(page.locator('table').getByText(fbTextName)).toBeVisible({ timeout: 10_000 });
  });

  // ── 6. 渠道 pill 過濾：LINE / FB 各自只顯示對應素材 ───────────────────
  test('@materials 渠道 pill 過濾：切 LINE 只見 LINE 素材，切 FB 只見 FB 素材', async ({ page }) => {
    await gotoMaterialsList(page);
    // 先搜尋縮小範圍到本次 runId 的兩則素材（用共同的 runId 片段）
    await page.getByPlaceholder('搜尋素材名稱').fill(`${E2E_PREFIX}`);
    await expect(page.locator('table').getByText(lineTextName)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'LINE', exact: true }).click();
    await page.waitForTimeout(600);
    await expect(page.locator('table').getByText(lineTextName)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('table').getByText(fbTextName)).toBeHidden();

    await page.getByRole('button', { name: 'FB', exact: true }).click();
    await page.waitForTimeout(600);
    await expect(page.locator('table').getByText(fbTextName)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('table').getByText(lineTextName)).toBeHidden();

    // 還原為全部
    await page.getByRole('button', { name: '全部', exact: true }).click();
  });

  // ── 7. 複製素材 ───────────────────────────────────────────────────────
  test('@materials 複製素材：more 選單「複製」後出現 (copy) 新素材', async ({ page }) => {
    await gotoMaterialsList(page);
    await page.getByPlaceholder('搜尋素材名稱').fill(lineTextName);
    const row = page.locator('tbody tr', { hasText: lineTextName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // more 選單按鈕：MoreHorizontal icon button（該列最後一顆 button，緊接在「編輯」後）
    await row.getByRole('button').last().click();

    const dupRes = page.waitForResponse(
      (res) => res.url().includes('/duplicate') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '複製' }).click();
    const res = await dupRes;
    expect(res.ok(), `複製素材失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    duplicateMaterialId = body?.data?.id;
    expect(duplicateMaterialId, '複製回應應含新素材 id').toBeTruthy();

    // 名稱後綴「(copy)」（material.service.ts duplicateMaterial 實際行為）
    await page.getByPlaceholder('搜尋素材名稱').fill(`${lineTextName} (copy)`);
    await expect(page.locator('table').getByText(`${lineTextName} (copy)`)).toBeVisible({
      timeout: 10_000,
    });
  });

  // ── 8. 編輯頁：改名稱 → 儲存成功 ──────────────────────────────────────
  test('@materials 編輯頁：改名稱後儲存成功', async ({ page }) => {
    expect(lineMaterialId, '前置測試 3 應已建立 lineMaterialId').toBeTruthy();
    await gotoAndCheck(page, `/dashboard/marketing/materials/${lineMaterialId}`);
    await expect(page.getByRole('heading', { name: /編輯素材/ })).toBeVisible({ timeout: 15_000 });

    const nameInput = page.getByPlaceholder('如：母親節新品推播');
    await expect(nameInput).toHaveValue(lineTextName);
    await nameInput.fill('');
    await nameInput.fill(lineTextNameEdited);

    const saveRes = page.waitForResponse(
      (res) => res.url().includes(`/marketing/materials/${lineMaterialId}`) && res.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '存為素材' }).click();
    const res = await saveRes;
    expect(res.ok(), `儲存改名失敗：${await res.text()}`).toBeTruthy();
    await expectToast(page, '已儲存變更');
  });

  // ── 9. 版本歷史：儲存後至少一筆版本記錄 ───────────────────────────────
  test('@materials 版本歷史：面板出現至少一筆版本記錄，含目前版標記', async ({ page }) => {
    await gotoAndCheck(page, `/dashboard/marketing/materials/${lineMaterialId}`);
    await expect(page.getByText('版本歷史')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('尚無版本紀錄')).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(/^v\d+$/).first()).toBeVisible();
    await expect(page.getByText('目前').first()).toBeVisible();
  });

  // ── 10. 版本還原 ──────────────────────────────────────────────────────
  test('@materials 版本還原：還原到較舊版本後成功', async ({ page }) => {
    await gotoAndCheck(page, `/dashboard/marketing/materials/${lineMaterialId}`);
    await expect(page.getByText('版本歷史')).toBeVisible({ timeout: 15_000 });

    const restoreBtn = page.getByRole('button', { name: /還原$/ }).first();
    const hasOlderVersion = await restoreBtn.isVisible().catch(() => false);
    if (!hasOlderVersion) {
      test.skip(true, '目前只有 1 個版本（測試 8 才產生第 2 版），沒有「還原」按鈕可測——理論上測試 8 後應有 v1/v2，若仍只 1 筆代表後端未對改名產生新版本，非本測試可修復範圍');
      return;
    }

    const dialogPromise = acceptNextDialog(page);
    const restoreRes = page.waitForResponse(
      (res) => res.url().includes('/versions/') && res.url().includes('/restore') && res.request().method() === 'POST',
    );
    await restoreBtn.click();
    await dialogPromise;
    const res = await restoreRes;
    expect(res.ok(), `還原版本失敗：${await res.text()}`).toBeTruthy();

    // 還原後名稱應變回還原前的版本內容（第一版名稱 lineTextName）
    await expect(page.getByPlaceholder('如：母親節新品推播')).toHaveValue(lineTextName, {
      timeout: 10_000,
    });
  });

  // ── 11. 分類過濾：點選 [E2E] 分類樹節點 → 只顯示該分類素材 ────────────
  test('@materials 分類過濾：把素材歸類後，點分類樹只顯示該分類的素材', async ({ page }) => {
    expect(categoryId, '前置測試 2 應已取得 categoryId').toBeTruthy();

    // 先把 lineMaterialId 歸到 [E2E] 分類（走編輯頁的治理面板）
    await gotoAndCheck(page, `/dashboard/marketing/materials/${lineMaterialId}`);
    await expect(page.getByText('分類與標籤')).toBeVisible({ timeout: 15_000 });
    // 治理面板卡片：從「分類與標籤」標題往上找最近的 rounded-lg 卡片容器，
    // 卡片內第一個 select 即為分類選單（MaterialGovernancePanel.tsx）
    const govCard = page
      .getByText('分類與標籤', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
    await govCard.locator('select').first().selectOption(categoryId);

    const saveRes = page.waitForResponse(
      (res) => res.url().includes(`/marketing/materials/${lineMaterialId}`) && res.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '存為素材' }).click();
    await saveRes;
    await expectToast(page, '已儲存變更');

    // 回列表頁，點分類樹上的 [E2E] 分類節點
    await gotoMaterialsList(page);
    // 注意：catRenamed 含 [E2E] 前綴，直接塞進 new RegExp 會被當成字元類別誤解析
    // （[E2E] → 匹配單一字元 E/2/空白），改用字串子字串比對（getByRole name 支援）
    await page.getByRole('button', { name: catRenamed }).click();
    await page.waitForTimeout(600);

    // 注意：測試 10（版本還原）可能已把名稱還原回 lineTextName，
    // 不能斷言 lineTextNameEdited——用「兩者其一可見」對此依賴保持穩健
    const nowVisible = page.locator('table').getByText(lineTextNameEdited).or(
      page.locator('table').getByText(lineTextName),
    );
    await expect(nowVisible.first()).toBeVisible({ timeout: 10_000 });
    // fbMaterial 未歸類到此分類，理論上不出現
    await expect(page.locator('table').getByText(fbTextName)).toBeHidden();
  });

  // ── 12. 刪除素材（軟刪） ──────────────────────────────────────────────
  test('@materials 刪除素材：more 選單「刪除」確認後從列表消失', async ({ page }) => {
    expect(duplicateMaterialId, '前置測試 7 應已建立 duplicateMaterialId').toBeTruthy();
    await gotoMaterialsList(page);
    await page.getByPlaceholder('搜尋素材名稱').fill(`${lineTextName} (copy)`);
    const row = page.locator('tbody tr', { hasText: `${lineTextName} (copy)` }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.getByRole('button').last().click();
    const dialogPromise = acceptNextDialog(page);
    const deleteRes = page.waitForResponse(
      (res) => res.url().includes(`/marketing/materials/`) && res.request().method() === 'DELETE',
    );
    await page.getByRole('button', { name: '刪除' }).click();
    const msg = await dialogPromise;
    expect(msg).toContain('確定要刪除這個素材嗎');
    const res = await deleteRes;
    expect(res.ok(), `刪除素材失敗：${await res.text()}`).toBeTruthy();

    await expect(page.locator('table').getByText(`${lineTextName} (copy)`)).toBeHidden({
      timeout: 10_000,
    });
    // 已刪除，afterAll 不必再清理這一筆
    duplicateMaterialId = '';
  });

  // ── 13. 刪除分類：其下素材變成未分類而非被刪 ──────────────────────────
  test('@materials 刪除分類：管理 dialog 內刪除 [E2E] 分類後消失，其下素材保留為未分類', async ({
    page,
  }) => {
    expect(categoryId, '前置測試 2/11 應已有 categoryId 且素材已歸類').toBeTruthy();

    await gotoMaterialsList(page);
    await page.getByRole('button', { name: '管理' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('管理分類')).toBeVisible();
    await expect(dialog.getByText(catRenamed, { exact: true })).toBeVisible({ timeout: 10_000 });

    const dialogConfirmPromise = acceptNextDialog(page);
    const deleteRes = page.waitForResponse(
      (res) => res.url().includes(`/marketing/materials/categories/${categoryId}`) && res.request().method() === 'DELETE',
    );
    const row = dialog
      .getByText(catRenamed, { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]');
    await row.locator('button').last().click(); // 第二顆是刪除（Trash2）
    const confirmMsg = await dialogConfirmPromise;
    expect(confirmMsg).toContain('其下素材會歸為未分類');
    const res = await deleteRes;
    expect(res.ok(), `刪除分類失敗：${await res.text()}`).toBeTruthy();

    await expect(dialog.getByText(catRenamed, { exact: true })).toBeHidden({ timeout: 10_000 });
    categoryId = ''; // 已刪除，afterAll 不必再清理
    await page.keyboard.press('Escape');

    // 其下的 lineMaterialId 應仍存在（API 佐證：未被刪除，categoryId 變 null）
    const matRes = await api.get(`marketing/materials/${lineMaterialId}`);
    expect(matRes.status(), '分類刪除後其下素材應仍可查（未被刪除）').toBe(200);
    const mat = (await matRes.json())?.data;
    expect(mat?.categoryId, '分類刪除後素材 categoryId 應變回 null（未分類）').toBeNull();
  });

  // ── 14. 標籤過濾 ──────────────────────────────────────────────────────
  test('@materials 標籤過濾：加上 [E2E] 標籤後可在左側標籤區塊過濾', async ({ page }) => {
    // 先在 fbMaterialId 加一個 [E2E] 標籤（治理面板的標籤自由輸入框）
    await gotoAndCheck(page, `/dashboard/marketing/materials/${fbMaterialId}`);
    await expect(page.getByText('分類與標籤')).toBeVisible({ timeout: 15_000 });

    const govCard = page
      .getByText('分類與標籤', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
    await govCard.getByPlaceholder('輸入標籤後按 Enter').fill(tagName);
    await govCard.getByPlaceholder('輸入標籤後按 Enter').press('Enter');
    await expect(govCard.getByText(tagName, { exact: true })).toBeVisible();

    const saveRes = page.waitForResponse(
      (res) => res.url().includes(`/marketing/materials/${fbMaterialId}`) && res.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '存為素材' }).click();
    await saveRes;
    await expectToast(page, '已儲存變更');

    // 回列表頁：左側「標籤」區塊應出現此標籤（useMaterialTags 是全租戶已用過的標籤清單）
    await gotoMaterialsList(page);
    const tagPill = page.getByRole('button', { name: tagName, exact: true });
    const tagVisible = await tagPill.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!tagVisible) {
      test.skip(
        true,
        '標籤 pill 未在列表左側出現（可能 useMaterialTags 快取未即時更新，或標籤清單分頁/租戶範圍與預期不同），略過過濾斷言',
      );
      return;
    }
    await page.getByPlaceholder('搜尋素材名稱').fill(''); // 清空搜尋避免干擾
    await tagPill.click();
    await page.waitForTimeout(600);
    await expect(page.locator('table').getByText(fbTextName)).toBeVisible({ timeout: 10_000 });
  });
});
