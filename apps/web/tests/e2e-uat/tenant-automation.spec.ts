import { test, expect, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import { E2E_PREFIX, newApiContext, gotoAndCheck } from './helpers';

/**
 * 自動化規則 — 列表 / 新增 / 條件建構器 / 動作清單 / 啟停 / dry-run / 刪除 @automation
 *
 * ⚠️ UI/API 現況與盤點不符（撰寫時發現，皆已於下方各案例內就地註記）：
 *
 * 1. 儲存規則沒有 toast：`src/app/dashboard/automation/[ruleId]/page.tsx` 的
 *    `handleSave` 成功後，新增規則是 `router.push(`/dashboard/automation/${newId}`)`，
 *    編輯規則是 `mutate()`——兩者都沒有呼叫任何 toast/通知元件。判斷「儲存成功」只能靠
 *    URL 換成真實 UUID（新增）或 PATCH 回應 200（編輯），不能等 `expectToast`。
 *
 * 2. 刪除規則同樣沒有 toast，`handleDelete` confirm 後呼叫 DELETE 成功就直接
 *    `router.push('/dashboard/automation')` 導回列表頁。
 *
 * 3. `DELETE /automation/rules/:id` 是軟刪：043cd782（CM-170）起分開「刪除」（enabled=false）
 *    與「停用」（isActive=false），已刪除的規則列表不顯示、GET 回 404。
 *    afterAll 清理直接用同一支 DELETE（軟刪即符合清理語意，不會留下真孤兒資料）。
 *
 * 4. 儲存按鈕沒有「至少一個動作」的前端擋控：`handleSave` 只檢查
 *    `!form.name.trim()` 就會 disabled，動作陣列為空也能點下去。但後端
 *    `createRuleSchema`/`updateRuleSchema` 的 `actions` 是 `z.array(...).min(1)`，
 *    零動作送出會被 400 擋下、且前端 `handleSave` 的 catch 只
 *    `console.error`，畫面上沒有任何錯誤提示（使用者會覺得按了沒反應）。
 *    因此本 spec 的所有「儲存成功」案例都確保先加至少一個動作再存。
 *
 * 5. `react-querybuilder` v7 渲染的是原生 `<select>`（欄位/運算子）+ 依欄位定義決定
 *    文字輸入或 `<select>`（值），標準 class 為 `.rule-fields` / `.rule-operators` /
 *    `.rule-value`，新增條件按鈕已中文化為「+ 新增條件」（原本是套件內建英文 `+ Rule`，
 *    `ConditionBuilder.tsx` 客製化 translations，故非繁體中文，這裡如實使用該文案）。
 *
 * 6. 觸發事件下拉選單為原生 `<select>`（`src/components/ui/select.tsx` 的 `Select`
 *    元件直接包一層 `<select>`），非 shadcn combobox，用 `selectOption` 操作。
 *
 * 種資料 / 清理策略：
 * - 案例 02 建立的規則貫穿本 spec 後續案例（dry-run、刪除），afterAll 統一用
 *   API DELETE 軟刪清理（try/catch 不讓清理失敗炸測試）。
 */

const RUN = randomUUID().slice(0, 8);
const RULE_NAME = `${E2E_PREFIX} 自動化規則測試 ${RUN}`;

let api: APIRequestContext;
/** 案例 02 建立後回填，供後續案例（03/04/05/06/07/08）沿用同一條規則 */
let ruleId: string | null = null;

test.beforeAll(async () => {
  api = await newApiContext();
});

/**
 * 編輯頁載入完成訊號：名稱輸入框可見且值已回填為 RULE_NAME。
 * 舊版 Playwright type 定義沒有 `page.getByDisplayValue`（只有較新版才有），
 * 這裡改用 placeholder 定位 + `toHaveValue` 斷言達到相同效果。
 */
async function expectRuleFormLoaded(page: import('@playwright/test').Page) {
  const nameInput = page.getByPlaceholder('例如：客訴自動開工單');
  await expect(nameInput).toHaveValue(RULE_NAME, { timeout: 15_000 });
}

test.afterAll(async () => {
  if (ruleId) {
    try {
      await api.delete(`automation/rules/${ruleId}`);
    } catch {
      // 清理失敗不炸測試（軟刪本身就是清理，DB 不會留下真孤兒資料）
    }
  }
  await api.dispose().catch(() => {});
});

test.describe.serial('自動化規則 @automation', () => {
  test('@automation 01 列表頁載入：新增按鈕可見', async ({ page }) => {
    const errors = await gotoAndCheck(page, '/dashboard/automation');
    expect(errors, `console errors: ${errors.join('; ')}`).toEqual([]);

    await expect(page.getByRole('button', { name: '新增規則' })).toBeVisible({
      timeout: 15_000,
    });

    // 若既有規則存在，表頭與啟用 toggle 欄位應可見（不強求一定要有資料列，
    // 空狀態也是合法情境——用 EmptyState 或表頭其中一種來判斷頁面已渲染完成）
    const hasTable = await page.locator('table thead').isVisible().catch(() => false);
    if (hasTable) {
      await expect(page.getByText('啟用', { exact: true })).toBeVisible();
    } else {
      await expect(page.getByText('沒有自動化規則')).toBeVisible();
    }
  });

  test('@automation 02 新增規則：非 keyword 觸發事件（新對話建立）+ 一個動作 → 儲存成功', async ({
    page,
  }) => {
    await gotoAndCheck(page, '/dashboard/automation/new');
    await expect(page.getByRole('button', { name: '儲存規則' })).toBeVisible({
      timeout: 15_000,
    });

    // 名稱
    await page.getByPlaceholder('例如：客訴自動開工單').fill(RULE_NAME);

    // 觸發事件：選「新對話建立」（conversation.created，非 keyword.matched，
    // 條件與動作可選欄位較單純，符合盤點建議的「減少複雜度」原則）
    const triggerSelect = page.locator('select').filter({ hasText: '收到訊息' });
    await triggerSelect.selectOption({ label: '新對話建立' });

    // 沒有 keyword 子區塊出現
    await expect(page.getByText('比對方式')).toHaveCount(0);

    // 動作：預設「動作」卡片顯示尚未設定，點「新增動作」新增一個
    await expect(page.getByText('尚未設定動作')).toBeVisible();
    await page.getByRole('button', { name: '新增動作' }).click();

    // 第一個動作預設是該事件可選動作清單的第一項（依 composeAutomationContract 排序，
    // conversation.created 提供 tenant/contact/conversation 三個 scope，
    // 第一個符合資格的動作是「傳送訊息」send_message）
    const actionCard = page.locator('div.rounded-md.border', { hasText: '動作類型' }).first();
    await expect(actionCard).toBeVisible({ timeout: 10_000 });
    const actionTypeSelect = actionCard.locator('select').first();
    await expect(actionTypeSelect).toHaveValue('send_message');

    // 填動作參數（傳送訊息的「訊息內容」文字框）
    await actionCard.getByPlaceholder('輸入要發送的訊息...').fill(`${E2E_PREFIX} 自動回覆內容 ${RUN}`);

    // 儲存：新增規則成功後會 router.push 到 /dashboard/automation/<真實 UUID>，
    // 沒有 toast（見檔頭說明 1），用 URL 變化 + POST 回應斷言
    const createRes = page.waitForResponse(
      (res) => res.url().includes('/automation/rules') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '儲存規則' }).click();
    const res = await createRes;
    expect(res.ok(), `建立規則失敗（${res.status()}）${await res.text()}`).toBeTruthy();
    const body = await res.json();
    ruleId = body?.data?.id;
    expect(ruleId, '建立規則回應中應有 id').toBeTruthy();
    // 新增頁「啟用這條規則」預設不勾：規則要建立成停用（原本 API 丟掉 isActive，一律啟用）
    expect(body?.data?.isActive, '沒勾「啟用」時規則應建立成停用').toBe(false);

    await expect(page).toHaveURL(new RegExp(`/dashboard/automation/${ruleId}$`), {
      timeout: 15_000,
    });
  });

  test('@automation 03 條件建構器：新增一個簡單條件（欄位+運算子+值）→ 儲存成功', async ({ page }) => {
    test.skip(!ruleId, '前置測試（案例 02）未成功建立規則');
    await gotoAndCheck(page, `/dashboard/automation/${ruleId}`);
    await expectRuleFormLoaded(page);

    // react-querybuilder：初始為空群組，點「+ 新增條件」（ConditionBuilder 以 translations 中文化）
    const qb = page.locator('.condition-builder');
    await expect(qb).toBeVisible({ timeout: 10_000 });
    await qb.getByRole('button', { name: '+ 新增條件', exact: true }).click();

    const rule = qb.locator('.rule').first();
    await expect(rule).toBeVisible({ timeout: 10_000 });

    // 欄位下拉：conversation.created 事件可用欄位（見 packages/automation/src/contracts/facts.ts
    // 依 requires 交集 provides=['tenant','contact','conversation']），第一個是「聯絡人名稱」
    const fieldSelect = rule.locator('.rule-fields');
    await expect(fieldSelect).toBeVisible();
    await fieldSelect.selectOption('contact.name');

    // 運算子：contact.name 的 operators 為 equal/notEqual/contains，選「等於」
    const operatorSelect = rule.locator('.rule-operators');
    await operatorSelect.selectOption({ label: '等於' });

    // 值：contact.name 沒有 values（非 select 型），走文字輸入
    const valueInput = rule.locator('.rule-value');
    await valueInput.fill(`${E2E_PREFIX} 條件值 ${RUN}`);

    const saveRes = page.waitForResponse(
      (res) =>
        res.url().includes(`/automation/rules/${ruleId}`) &&
        res.request().method() === 'PATCH' &&
        res.ok(),
    );
    await page.getByRole('button', { name: '儲存規則' }).click();
    await saveRes;

    // reload 確認條件真的落地（同 Wave 2 對 PATCH 落地的保守做法，避免 SWR race）
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.condition-builder .rule').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('.condition-builder .rule-fields').first()).toHaveValue(
      'contact.name',
    );
    await expect(page.locator('.condition-builder .rule-value').first()).toHaveValue(
      `${E2E_PREFIX} 條件值 ${RUN}`,
    );
  });

  test('@automation 04 動作清單：新增第二個動作、設定參數、移除一個動作 → 儲存成功', async ({ page }) => {
    test.skip(!ruleId, '前置測試（案例 02）未成功建立規則');
    await gotoAndCheck(page, `/dashboard/automation/${ruleId}`);
    await expectRuleFormLoaded(page);

    const actionCards = page.locator('div.rounded-md.border', { hasText: '動作類型' });
    await expect(actionCards).toHaveCount(1, { timeout: 15_000 });

    // 新增第二個動作
    await page.getByRole('button', { name: '新增動作' }).click();
    await expect(actionCards).toHaveCount(2, { timeout: 10_000 });

    // 第二個動作改選「傳送通知」notify（conversation.created 可用動作之一，requires=['tenant']）
    const secondCard = actionCards.nth(1);
    const typeSelect = secondCard.locator('select').first();
    await typeSelect.selectOption('notify');
    // 「通知訊息」欄位實際渲染是純 <input>，沒有 placeholder（ActionEditor.tsx 的
    // '輸入通知內容...' placeholder 屬於別的分支/欄位），改用 label 文字定位其相鄰 input
    await secondCard
      .locator('div', { hasText: '通知訊息' })
      .locator('input[type="text"]')
      .last()
      .fill(`${E2E_PREFIX} 通知內容 ${RUN}`);

    const saveRes1 = page.waitForResponse(
      (res) =>
        res.url().includes(`/automation/rules/${ruleId}`) &&
        res.request().method() === 'PATCH' &&
        res.ok(),
    );
    await page.getByRole('button', { name: '儲存規則' }).click();
    await saveRes1;

    await page.reload({ waitUntil: 'networkidle' });
    await expect(actionCards).toHaveCount(2, { timeout: 15_000 });

    // 移除其中一個動作（移除第二個，含垃圾桶 icon 的 ghost 按鈕）
    await actionCards.nth(1).getByRole('button').last().click();
    await expect(actionCards).toHaveCount(1, { timeout: 10_000 });

    const saveRes2 = page.waitForResponse(
      (res) =>
        res.url().includes(`/automation/rules/${ruleId}`) &&
        res.request().method() === 'PATCH' &&
        res.ok(),
    );
    await page.getByRole('button', { name: '儲存規則' }).click();
    await saveRes2;

    await page.reload({ waitUntil: 'networkidle' });
    await expect(actionCards).toHaveCount(1, { timeout: 15_000 });
  });

  test('@automation 05 試跑表單：依條件填值 → 以中文顯示會不會觸發', async ({ page }) => {
    test.skip(!ruleId, '前置測試（案例 02）未成功建立規則');
    await gotoAndCheck(page, `/dashboard/automation/${ruleId}`);
    await expectRuleFormLoaded(page);

    // 試跑卡片只在既有規則（非 new）才顯示；欄位依「已儲存的條件」產生（案例 03 存了聯絡人名稱）
    const card = page
      .getByText('試試看這條規則', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    const input = card.locator('input').first();
    await expect(input).toBeVisible();
    await input.fill(`${E2E_PREFIX} 條件值 ${RUN}`);

    const testRes = page.waitForResponse(
      (res) =>
        res.url().includes(`/automation/rules/${ruleId}/test`) &&
        res.request().method() === 'POST',
    );
    await card.getByRole('button', { name: '試試看' }).click();
    const res = await testRes;
    expect(res.ok(), `試跑失敗（${res.status()}）${await res.text()}`).toBeTruthy();

    // 結果以中文說明；規則在案例 02 建立時未勾「啟用」，條件符合也要說明不會執行
    await expect(card.locator('p.font-medium')).toHaveText(/觸發|不會執行/, { timeout: 15_000 });
  });

  test('@automation 06 試跑表單：不需要手寫 JSON', async ({ page }) => {
    test.skip(!ruleId, '前置測試（案例 02）未成功建立規則');
    await gotoAndCheck(page, `/dashboard/automation/${ruleId}`);
    await expectRuleFormLoaded(page);

    await expect(page.getByText('試試看這條規則', { exact: true })).toBeVisible({ timeout: 10_000 });
    // 原本的 Facts JSON 輸入框已移除（一般管理員無法使用）
    await expect(page.locator('textarea.font-mono')).toHaveCount(0);
    await expect(page.getByText('JSON', { exact: false })).toHaveCount(0);
  });

  test('@automation 07 列表 toggle 啟用/停用：點擊後 PATCH 成功、reload 驗證狀態', async ({ page }) => {
    test.skip(!ruleId, '前置測試（案例 02）未成功建立規則');
    await gotoAndCheck(page, '/dashboard/automation');
    await expect(page.getByRole('button', { name: '新增規則' })).toBeVisible({ timeout: 15_000 });

    const row = page.locator('tbody tr', { hasText: RULE_NAME });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // toggleActive 用 PATCH { isActive: !currentActive }。案例 02 在新增頁沒勾「啟用」，
    // 規則建立為停用（2026-10-05 起 API 依 isActive 建立；之前一律啟用），點擊後應變 true。用 waitForResponse 確認落地，不直接斷言點擊瞬間的 UI（同
    // 檔頭說明沿用 Wave 2 對 SWR 快取的保守做法）
    const toggleBtn = row.locator('button').first();
    await expect(toggleBtn).toBeVisible();

    const patchRes = page.waitForResponse(
      (res) =>
        res.url().includes(`/automation/rules/${ruleId}`) &&
        res.request().method() === 'PATCH' &&
        res.ok(),
    );
    await toggleBtn.click();
    const res = await patchRes;
    const body = await res.json();
    expect(body?.data?.isActive, 'PATCH 後 isActive 應變為 true').toBe(true);

    await page.reload({ waitUntil: 'networkidle' });
    const reloadedRow = page.locator('tbody tr', { hasText: RULE_NAME });
    await expect(reloadedRow).toBeVisible({ timeout: 15_000 });
    // 啟用狀態下 toggle 的內側圓點應在右側（translate-x-6）
    await expect(reloadedRow.locator('button').first().locator('span')).toHaveClass(
      /translate-x-6/,
    );

    // 切回停用：E2E 規則不應在 UAT 上啟用執行
    const patchRes2 = page.waitForResponse(
      (res) =>
        res.url().includes(`/automation/rules/${ruleId}`) &&
        res.request().method() === 'PATCH' &&
        res.ok(),
    );
    await reloadedRow.locator('button').first().click();
    await patchRes2;
  });

  test('@automation 08 刪除規則：編輯頁點刪除（confirm）→ 列表不再顯示（043cd782，CM-170）', async ({
    page,
  }) => {
    test.skip(!ruleId, '前置測試（案例 02）未成功建立規則');
    await gotoAndCheck(page, `/dashboard/automation/${ruleId}`);
    await expectRuleFormLoaded(page);

    const dialogMsg = new Promise<string>((resolve) => {
      page.once('dialog', async (dialog) => {
        const msg = dialog.message();
        await dialog.accept();
        resolve(msg);
      });
    });
    const deleteRes = page.waitForResponse(
      (res) =>
        res.url().includes(`/automation/rules/${ruleId}`) &&
        res.request().method() === 'DELETE' &&
        res.ok(),
    );
    await page.getByRole('button', { name: '刪除規則' }).click();
    expect(await dialogMsg).toContain('確定要刪除此規則嗎');
    const res = await deleteRes;

    // 刪除是軟刪（enabled=false），043cd782（CM-170）起列表與 GET 都不再出現已刪除的規則
    const body = await res.json();
    expect(body?.data?.isActive, '刪除後 isActive 應為 false（軟刪）').toBe(false);

    // handleDelete 成功後 router.push 回列表頁（無 toast，見檔頭說明 2）
    await expect(page).toHaveURL(/\/dashboard\/automation$/, { timeout: 15_000 });
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('tbody tr', { hasText: RULE_NAME })).toHaveCount(0);

    // 單筆 GET 也要讀不到，不能只有列表過濾
    const getRes = await api.get(`automation/rules/${ruleId}`);
    expect(getRes.status(), '刪除後 GET 應回 404').toBe(404);
  });
});
