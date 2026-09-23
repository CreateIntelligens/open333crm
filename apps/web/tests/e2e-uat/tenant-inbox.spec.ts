import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import {
  BASE_URL,
  E2E_PREFIX,
  newApiContext,
  seedWebchatConversation,
  sendVisitorMessage,
  type SeededConversation,
} from './helpers';

/**
 * 收件匣（/dashboard/inbox）功能層測試。
 *
 * 策略：
 * - 整個 spec 只 seed 一條 WEBCHAT 對話（chatbox sessions 有 10 次/分/IP rate limit），
 *   所有測試 serial 串著對同一條對話操作。
 * - 只對自己種的 [E2E] 資料做寫入；指派/狀態/標籤/結案全部只動這條對話。
 * - 標籤與工單都是測試自建（帶 E2E_PREFIX），afterAll 清理；清理失敗僅 warn 不炸測試。
 *
 * 實際 UI 文案（與盤點稿不同處，以程式碼為準）：
 * - 接管按鈕是「接管對話」（StatusBanner.tsx / MessageInput.tsx），非「接管 Bot 對話」
 * - 結案確認按鈕是「確認結案」；「結案此對話」是 Dialog 標題
 * - 建立工單 Modal 標題是「建立案件」，「分類」為必填；成功後導頁到 /dashboard/cases/:id
 */
test.describe.configure({ mode: 'serial' });

test.describe('@inbox 收件匣功能層', () => {
  let api: APIRequestContext;
  let seeded: SeededConversation;
  /** 測試自建的 CONVERSATION scope 標籤（afterAll 刪除） */
  let e2eTagId: string | null = null;
  let e2eTagName = '';
  /** 測試建立的工單 id（afterAll 刪除） */
  let createdCaseId: string | null = null;

  test.beforeAll(async () => {
    api = await newApiContext();

    // 種一條 WEBCHAT 訪客對話（整個 spec 共用這一條）
    seeded = await seedWebchatConversation(api, '收件匣測試');

    // 預先建立一個對話 scope 的 [E2E] 標籤，供測試 8 在 UI 掛/摘
    e2eTagName = `${E2E_PREFIX} 收件匣標籤 ${randomUUID().slice(0, 6)}`;
    const tagRes = await api.post('tags', {
      data: {
        name: e2eTagName,
        color: '#6366f1',
        type: 'MANUAL',
        scope: 'CONVERSATION',
      },
    });
    if (tagRes.ok()) {
      e2eTagId = (await tagRes.json())?.data?.id ?? null;
    } else {
      console.warn(`[E2E] 建立測試標籤失敗（${tagRes.status()}）：${await tagRes.text()}`);
    }
  });

  test.afterAll(async () => {
    // 清理原則：只動自己種的資料；任何一步失敗都不讓測試 run 掛掉
    if (createdCaseId) {
      try {
        await api.delete(`cases/${createdCaseId}`);
      } catch (err) {
        console.warn(`[E2E] 清理工單 ${createdCaseId} 失敗：`, err);
      }
    }
    if (e2eTagId) {
      try {
        await api.delete(`tags/${e2eTagId}`);
      } catch (err) {
        console.warn(`[E2E] 清理標籤 ${e2eTagId} 失敗：`, err);
      }
    }
    if (seeded?.conversationId) {
      try {
        // 測試 12 會重新開啟對話，最後統一結案讓 UAT 收件匣保持乾淨
        await api.post(`conversations/${seeded.conversationId}/close`, {
          data: { reason: `${E2E_PREFIX} 測試結束自動清理` },
        });
      } catch (err) {
        console.warn(`[E2E] 結案清理對話 ${seeded.conversationId} 失敗：`, err);
      }
    }
    await api.dispose();
  });

  // -------------------------------------------------------------------------
  // 共用 locator / 動作
  // -------------------------------------------------------------------------

  /** 開啟指定對話（?conv= 直達，省去列表找尋） */
  async function openConversation(page: Page) {
    await page.goto(`${BASE_URL}/dashboard/inbox?conv=${seeded.conversationId}`, {
      waitUntil: 'networkidle',
    });
    // 等 chat header 的聯繫人名字出現，代表對話已載入
    await expect(
      page.getByRole('heading', { name: seeded.contactName || 'Chatbox Visitor' }).first(),
    ).toBeVisible({ timeout: 20_000 });
  }

  /** 若對話目前是 Bot 處理中（BOT_HANDLED），先按「接管對話」；不是就跳過 */
  async function takeoverIfBotHandled(page: Page) {
    const takeover = page.getByRole('button', { name: '接管對話' }).first();
    let visible = false;
    try {
      await takeover.waitFor({ state: 'visible', timeout: 3_000 });
      visible = true;
    } catch {
      // 沒有接管按鈕 = 非 Bot 對話，不用做事
    }
    if (visible) {
      await takeover.click();
      // 接管後輸入框要變成可用
      await expect(page.locator('textarea[data-message-input]')).toBeEnabled({ timeout: 15_000 });
    }
    return visible;
  }

  /**
   * header 的指派下拉（native select，含「未指派」選項）。
   * ⚠️ 對話列表的篩選下拉（所有/我的對話/未指派）也含「未指派」——必須用
   * hasNot「我的對話」排除，否則會選到篩選器（首輪就抓錯過）。
   */
  function assignSelect(page: Page) {
    return page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: '未指派' }) })
      .filter({ hasNot: page.locator('option', { hasText: '我的對話' }) })
      .first();
  }

  /** header 的狀態下拉（native select，選項值 ACTIVE / AGENT_HANDLED / CLOSED） */
  function statusSelect(page: Page) {
    return page
      .locator('select')
      .filter({ has: page.locator('option[value="AGENT_HANDLED"]') })
      .first();
  }

  // -------------------------------------------------------------------------
  // 測試案例
  // -------------------------------------------------------------------------

  test('@inbox 1. 列表搜尋能找到剛種的對話', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/inbox`, { waitUntil: 'networkidle' });

    // 搜尋是前端過濾（比對聯繫人名稱與最後訊息文字）；名稱拿不到時退而用 marker
    const query = seeded.contactName || seeded.marker;
    await page.getByPlaceholder('搜尋對話...').fill(query);

    await expect(page.getByText(query).first()).toBeVisible({ timeout: 20_000 });
  });

  test('@inbox 2. ?conv= 直開對話，訪客 marker 訊息顯示在聊天串', async ({ page }) => {
    await openConversation(page);
    await expect(page.getByText(seeded.marker).first()).toBeVisible({ timeout: 20_000 });
  });

  test('@inbox 3.（條件式）Bot 對話先接管，輸入框恢復可用', async ({ page }) => {
    await openConversation(page);
    const wasBot = await takeoverIfBotHandled(page);
    if (!wasBot) {
      console.warn('[E2E] 此對話不是 BOT_HANDLED，接管步驟跳過（渠道未開 Bot 屬正常）');
    }
    // 不論有無接管，走到這裡輸入框都應該可用（對話尚未結案）
    await expect(page.locator('textarea[data-message-input]')).toBeEnabled({ timeout: 15_000 });
  });

  test('@inbox 4. 客服發送文字回覆，訊息出現在聊天串', async ({ page }) => {
    await openConversation(page);
    await takeoverIfBotHandled(page); // 保險：前一測若沒接管成功這裡再補

    const replyText = `${E2E_PREFIX} 客服回覆 ${randomUUID().slice(0, 8)}`;
    const input = page.locator('textarea[data-message-input]');
    await expect(input).toBeEnabled({ timeout: 15_000 });
    await input.fill(replyText);
    await input.press('Enter'); // Enter 送出（Shift+Enter 才是換行）

    await expect(page.getByText(replyText).first()).toBeVisible({ timeout: 20_000 });
  });

  test('@inbox 5. 訪客補發訊息，聊天串收得到（socket/輪詢，必要時 reload）', async ({ page }) => {
    await openConversation(page);

    const visitorText = `${E2E_PREFIX} 訪客追問 ${randomUUID().slice(0, 8)}`;
    await sendVisitorMessage(seeded, visitorText);

    const bubble = page.getByText(visitorText).first();
    try {
      // 先等 socket 即時推播
      await expect(bubble).toBeVisible({ timeout: 15_000 });
    } catch {
      // socket 沒到就 reload 走 API 重抓（SWR 快取保險）
      await page.reload({ waitUntil: 'networkidle' });
      await expect(bubble).toBeVisible({ timeout: 20_000 });
    }
  });

  test('@inbox 6. 指派客服：header 下拉選一個客服並保存', async ({ page }) => {
    await openConversation(page);

    const select = assignSelect(page);
    await expect(select).toBeVisible({ timeout: 15_000 });

    // 選第一個真人客服（index 0 是「未指派」）
    const options = select.locator('option');
    const count = await options.count();
    expect(count, '租戶內至少要有一個客服可指派').toBeGreaterThan(1);
    const agentValue = await options.nth(1).getAttribute('value');
    expect(agentValue).toBeTruthy();

    // selectOption 只改 DOM，PATCH 是非同步發出——必須等到後端回 200 才能 reload，
    // 否則 reload 會打斷在途請求，指派根本沒寫進去（首輪就踩到這個 race）
    const patchDone = page.waitForResponse(
      (res) =>
        res.url().includes(`/conversations/${seeded.conversationId}`) &&
        res.request().method() === 'PATCH' &&
        res.ok(),
      { timeout: 15_000 },
    );
    await select.selectOption(agentValue!);
    await patchDone;

    // reload 驗證有真的寫進後端（不是只有前端 state）
    await page.reload({ waitUntil: 'networkidle' });
    await expect(assignSelect(page)).toHaveValue(agentValue!, { timeout: 20_000 });
  });

  test('@inbox 7. 變更狀態為「已處理」再改回「進行中」', async ({ page }) => {
    await openConversation(page);

    const select = statusSelect(page);
    await expect(select).toBeVisible({ timeout: 15_000 });

    // 同第 6 條：等 PATCH 真的回 200 再 reload，避免打斷在途請求的 race
    const waitPatch = () =>
      page.waitForResponse(
        (res) =>
          res.url().includes(`/conversations/${seeded.conversationId}`) &&
          res.request().method() === 'PATCH' &&
          res.ok(),
        { timeout: 15_000 },
      );

    // 改為已處理（AGENT_HANDLED）
    let patchDone = waitPatch();
    await select.selectOption('AGENT_HANDLED');
    await patchDone;

    // reload 驗證持久化
    await page.reload({ waitUntil: 'networkidle' });
    await expect(statusSelect(page)).toHaveValue('AGENT_HANDLED', { timeout: 20_000 });

    // 改回進行中（ACTIVE），讓後續測試在正常狀態下進行
    patchDone = waitPatch();
    await statusSelect(page).selectOption('ACTIVE');
    await patchDone;
    await expect(statusSelect(page)).toHaveValue('ACTIVE', { timeout: 15_000 });
  });

  test('@inbox 8. 對話標籤：掛上 [E2E] 標籤出現 chip，移除後消失', async ({ page }) => {
    test.skip(!e2eTagId, '前置建立 [E2E] 對話標籤失敗，跳過');

    await openConversation(page);

    // 右側 ContactInfoPanel 的 TagManager：選擇標籤下拉（選項含我們的 [E2E] 標籤）
    const tagSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: e2eTagName }) })
      .first();
    await expect(tagSelect).toBeVisible({ timeout: 20_000 });
    await tagSelect.selectOption({ label: e2eTagName });

    // 加入按鈕是純 Plus 圖示、無 accessible name，用相鄰結構定位（select 的下一個 button）
    await tagSelect.locator('xpath=following-sibling::button[1]').click();

    // chip 出現：Badge 是 span/div 都可能，直接以「標籤文字」+「其祖層含移除按鈕」定位
    const chipText = page.getByText(e2eTagName, { exact: true }).first();
    await expect(chipText).toBeVisible({ timeout: 20_000 });

    // 移除：chip 內的「移除標籤」按鈕（往上找最近的含該按鈕的容器）
    const chip = chipText.locator('xpath=ancestor-or-self::*[.//button[@title="移除標籤"]][1]');
    await chip.getByTitle('移除標籤').click();
    await expect(chipText).not.toBeVisible({ timeout: 20_000 });
  });

  test('@inbox 9. 從對話建立工單：填標題與分類送出，導頁到案件詳情', async ({ page }) => {
    await openConversation(page);

    // 右側面板「建立工單」→ 開「建立案件」Modal
    await page.getByRole('button', { name: '建立工單' }).click();
    await expect(page.getByText('建立案件').first()).toBeVisible({ timeout: 15_000 });

    const caseTitle = `${E2E_PREFIX} 收件匣工單 ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('案件標題...').fill(caseTitle);

    // 「分類」是必填（不選的話送出按鈕停用）；用含「請選擇分類」選項的下拉定位
    await page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: '請選擇分類' }) })
      .first()
      .selectOption('其他');

    await page.getByRole('button', { name: '建立案件', exact: true }).click();

    // 成功表現＝router.push 導到 /dashboard/cases/:id（沒有 toast），順便從 URL 抓 id 供清理
    await page.waitForURL(/\/dashboard\/cases\/[0-9a-f-]+/, { timeout: 20_000 });
    const m = page.url().match(/\/dashboard\/cases\/([0-9a-f-]+)/);
    createdCaseId = m ? m[1] : null;
    expect(createdCaseId, '應能從導頁 URL 取得新工單 id').toBeTruthy();

    // 案件詳情頁應顯示剛填的標題
    await expect(page.getByText(caseTitle).first()).toBeVisible({ timeout: 20_000 });
  });

  test('@inbox 10. 結案：填原因確認後，對話顯示已關閉', async ({ page }) => {
    await openConversation(page);

    // header「結案」按鈕 → 開「結案此對話」Dialog
    await page.getByRole('button', { name: '結案', exact: true }).click();
    await expect(page.getByText('結案此對話').first()).toBeVisible({ timeout: 15_000 });

    await page
      .getByPlaceholder('例：問題已解決 / 客戶未回覆 / 重複對話...')
      .fill(`${E2E_PREFIX} E2E 測試結案`);

    // 確認按鈕文案是「確認結案」（「結案此對話」是 Dialog 標題）
    await page.getByRole('button', { name: '確認結案' }).click();

    // StatusBanner 顯示已關閉，輸入框停用
    await expect(page.getByText('此對話已關閉').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('textarea[data-message-input]')).toBeDisabled({ timeout: 15_000 });
  });

  test('@inbox 11. 「已關閉」分頁能看到剛結案的對話', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/inbox`, { waitUntil: 'networkidle' });

    // Tabs 是自製元件（純 button，非 role=tab）
    await page.getByRole('button', { name: '已關閉', exact: true }).click();

    // 已關閉分頁預設抓最近 30 天；用搜尋縮小到自己種的對話
    const query = seeded.contactName || seeded.marker;
    await page.getByPlaceholder('搜尋對話...').fill(query);
    await expect(page.getByText(query).first()).toBeVisible({ timeout: 20_000 });
  });

  test('@inbox 12. 重新開啟已結案對話，恢復進行中', async ({ page }) => {
    await openConversation(page);

    // StatusBanner 的「重新開啟對話」
    await page.getByRole('button', { name: '重新開啟對話' }).click();

    // banner 消失、狀態下拉回到 ACTIVE、輸入框恢復可用
    await expect(page.getByText('此對話已關閉')).not.toBeVisible({ timeout: 20_000 });
    await expect(statusSelect(page)).toHaveValue('ACTIVE', { timeout: 20_000 });
    await expect(page.locator('textarea[data-message-input]')).toBeEnabled({ timeout: 15_000 });
  });
});
