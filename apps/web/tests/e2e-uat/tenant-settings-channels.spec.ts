import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import {
  E2E_PREFIX,
  newApiContext,
  gotoAndCheck,
  WEBCHAT_CHANNEL_ID,
} from './helpers';

/**
 * 設定頁「渠道管理」tab（/dashboard/settings，channels tab）功能層測試。
 *
 * ⚠️ 這是設定頁裡風險最高的一塊，本檔案採保守策略：
 * - 絕不修改/刪除任何既有 LINE/FB/THREADS 渠道（會影響正式收發訊息）
 * - 絕不點擊「Webhook 公開網址」卡片的「套用」按鈕（ChannelManagement.tsx handleSaveBaseUrl
 *   會呼叫 POST /channels/webhook-base-url，批次覆寫所有渠道的 webhook URL，直接影響正式收訊）
 * - 絕不對既有渠道按「測試連線」（ChannelManagement.tsx handleVerify 會對外呼叫渠道原生 API 驗證憑證，
 *   雖然理論上唯讀，但仍是對外真實請求，不確定是否有副作用，本檔案一律跳過不測）
 * - 絕不對既有渠道按「刪除」
 * - 對既有 UAT WEBCHAT 渠道（WEBCHAT_CHANNEL_ID）只做讀取/產生連結類操作（嵌入碼、預覽、
 *   產生網頁版連結），這些都不會修改渠道本身的 credentials/webhookUrl/isActive
 * - 需要驗證「儲存會真的寫入」的流程（Bot 設定表單存檔），一律改在自建的 [E2E] WEBCHAT
 *   測試渠道上做，測完在 afterAll 用 API 刪除
 *
 * 讀碼盤點（與任務描述路徑不同 / 需釐清之處，以實際程式碼為準）：
 * - 案例 4「產生網頁版連結」按鈕文字其實是動態的：渠道尚未有 publicKey 時顯示「產生連結」，
 *   已有 publicKey 後顯示「複製連結」（ChannelManagement.tsx 第 320 行 `ch.publicKey ? '複製連結' : '產生連結'`）。
 *   兩者背後都是同一個 handleShowChatboxLink，會 POST /channels/:id/chatbox-link
 *   （helpers.ts 的 getChatboxPublicKey 在其他 spec 中也是呼叫同一支端點取 publicKey，
 *   屬於「產生/確保 publicKey 存在」的冪等操作，不會動到渠道憑證或 webhookUrl，判定為安全的唯讀性操作）。
 * - 「Bot 設定」按鈕是渠道卡片右側一顆只有 icon（Bot lucide icon，title="Bot 設定"）的 ghost
 *   按鈕，沒有文字 label，需用 title 屬性定位。點擊後開啟 BotConfigForm dialog，
 *   dialog 標題是「Bot 設定 — {displayName}」，載入既有 settings.botConfig，
 *   只有按「儲存」才會 PATCH /channels/:id（settings 整包覆寫，含 botConfig + liffConfig）。
 * - 「預覽」按鈕（handlePreviewWidget）會真的注入 <script src="/webchat/widget.js">
 *   並插入 #o333-launcher / #o333-panel 到 DOM（非 iframe，是原生 widget script 注入）；
 *   關閉時移除對應 DOM 節點與 script tag，不會呼叫任何寫入 API，判定為安全。
 * - 新增渠道選 WEBCHAT 類型時，Channel Secret / Channel Access Token 為任意字串即可
 *   （ChannelFormDialog.tsx 第 429/441 行 placeholder「任意字串作為驗證金鑰/API Token」），
 *   不需要外部服務金鑰，因此案例 6 可行。
 */
test.describe.configure({ mode: 'serial' });

test.describe('@settings-channels 設定頁渠道管理', () => {
  let api: APIRequestContext;

  const runId = randomUUID().slice(0, 6);
  const webchatName = `${E2E_PREFIX} WEBCHAT測試渠道 ${runId}`;

  /** 自建測試渠道 id，afterAll 用 API 刪除 */
  let createdChannelId = '';

  test.beforeAll(async () => {
    api = await newApiContext();
  });

  test.afterAll(async () => {
    if (!api) return;
    if (createdChannelId) {
      try {
        await api.delete(`channels/${createdChannelId}`);
      } catch {
        // 清理失敗僅略過，不讓收尾動作炸掉整輪測試
      }
    }
    await api.dispose();
  });

  async function gotoChannelsTab(page: import('@playwright/test').Page) {
    await gotoAndCheck(page, '/dashboard/settings');
    await expect(page.getByRole('heading', { name: '渠道管理' })).toBeVisible({ timeout: 15_000 });
  }

  // ── 1. 渠道管理 tab 載入：渠道列表可見 ──────────────────────────────────
  test('@settings-channels 渠道管理 tab 載入：渠道卡片顯示類型/名稱/狀態', async ({ page }) => {
    await gotoChannelsTab(page);

    // 頁首與新增按鈕
    await expect(page.getByRole('button', { name: '設定精靈' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新增渠道' })).toBeVisible();

    // 至少應有一張渠道卡片（UAT 租戶應已有既有渠道），每張卡片含啟用/停用 Badge
    const statusBadge = page.getByText(/^(啟用|停用)$/).first();
    await expect(statusBadge).toBeVisible({ timeout: 15_000 });

    // Webhook 公開網址設定卡片本身可見（僅驗證可見，不觸碰「套用」按鈕）
    await expect(page.getByText('Webhook 公開網址')).toBeVisible();
  });

  // ── 2. 既有 WEBCHAT 渠道：取得嵌入碼（唯讀） ────────────────────────────
  test('@settings-channels 既有 WEBCHAT 渠道：取得嵌入碼內容含 channelId', async ({ page }) => {
    await gotoChannelsTab(page);

    // 用「取得嵌入碼」連結按鈕（scoped within its own card containing WEBCHAT badge）
    // 頁面上可能有多個 WEBCHAT 卡片，鎖定含 WEBCHAT_CHANNEL_ID 對應顯示名稱有困難，
    // 改用 API 先查該渠道 displayName 再用它精確定位卡片，避免點錯渠道。
    const chRes = await api.get(`channels/${WEBCHAT_CHANNEL_ID}`);
    expect(chRes.ok(), `查詢 WEBCHAT 渠道失敗：${await chRes.text()}`).toBeTruthy();
    const chBody = (await chRes.json())?.data;
    const displayName: string = chBody?.displayName;
    expect(displayName, 'WEBCHAT 渠道應有 displayName').toBeTruthy();

    const card = page.locator('div').filter({ hasText: displayName }).filter({ hasText: '取得嵌入碼' }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    const embedRes = page.waitForResponse(
      (res) => res.url().includes(`/channels/${WEBCHAT_CHANNEL_ID}/embed-code`) && res.request().method() === 'GET',
    );
    await card.getByRole('button', { name: '取得嵌入碼' }).click();
    const res = await embedRes;
    expect(res.ok(), `取得嵌入碼 API 失敗：${await res.text()}`).toBeTruthy();

    const dialog = page.getByRole('dialog').filter({ hasText: 'WebChat 嵌入碼' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const codeText = await dialog.locator('pre').innerText();
    expect(codeText).toContain('<script');
    expect(codeText).toContain(WEBCHAT_CHANNEL_ID);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  // ── 3. 既有 WEBCHAT 渠道：開啟預覽 → 元件出現 → 關閉預覽 ────────────────
  test('@settings-channels 既有 WEBCHAT 渠道：開啟預覽小工具後出現，關閉後移除', async ({ page }) => {
    await gotoChannelsTab(page);

    const chRes = await api.get(`channels/${WEBCHAT_CHANNEL_ID}`);
    const displayName: string = (await chRes.json())?.data?.displayName;
    const card = page.locator('div').filter({ hasText: displayName }).filter({ hasText: '預覽' }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    const previewBtn = card.getByRole('button', { name: '預覽' });
    await previewBtn.click();

    // useWebchat().load() 注入 <script src="/webchat/widget.js">，載入後會插入 launcher/panel
    await expect(page.locator('#open333crm-widget-script')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: '關閉預覽' })).toBeVisible({ timeout: 10_000 });

    // 關閉預覽：DOM 節點與 script tag 應被移除
    await page.getByRole('button', { name: '關閉預覽' }).click();
    await expect(page.locator('#open333crm-widget-script')).toHaveCount(0, { timeout: 5_000 });
    await expect(card.getByRole('button', { name: '預覽' })).toBeVisible();
  });

  // ── 4. 既有 WEBCHAT 渠道：產生網頁版連結（唯讀性 POST，不動渠道憑證） ──
  test('@settings-channels 既有 WEBCHAT 渠道：產生網頁版連結格式含 /chatbox?channel=', async ({ page }) => {
    await gotoChannelsTab(page);

    const chRes = await api.get(`channels/${WEBCHAT_CHANNEL_ID}`);
    const displayName: string = (await chRes.json())?.data?.displayName;

    // 此連結按鈕在頁首「Webhook 公開網址」卡片下方的「WebChat 網頁版連結」小節內，
    // 按鈕文字依是否已有 publicKey 顯示「產生連結」或「複製連結」
    const linkRow = page
      .locator('div')
      .filter({ hasText: displayName })
      .filter({ hasText: /產生連結|複製連結/ })
      .last();
    await expect(linkRow).toBeVisible({ timeout: 15_000 });

    const linkRes = page.waitForResponse(
      (res) => res.url().includes(`/channels/${WEBCHAT_CHANNEL_ID}/chatbox-link`) && res.request().method() === 'POST',
    );
    await linkRow.getByRole('button', { name: /產生連結|複製連結/ }).click();
    const res = await linkRes;
    expect(res.ok(), `產生網頁版連結失敗：${await res.text()}`).toBeTruthy();

    const dialog = page.getByRole('dialog').filter({ hasText: 'WebChat 網頁版連結' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const urlText = await dialog.locator('pre').innerText();
    expect(urlText).toContain('/chatbox?channel=');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  // ── 5. Bot 設定（既有渠道）：只驗證表單載入與既有值顯示，不儲存 ─────────
  test('@settings-channels 既有 WEBCHAT 渠道：Bot 設定表單載入既有值（不儲存變更）', async ({ page }) => {
    await gotoChannelsTab(page);

    const chRes = await api.get(`channels/${WEBCHAT_CHANNEL_ID}`);
    const displayName: string = (await chRes.json())?.data?.displayName;
    // ⚠️ 環境噪音（非產品 bug）：這個測試瀏覽器 profile 的 localStorage 殘留了
    // Webhook 公開網址輸入框的舊值，恰好也是 "tatung"，導致其所在的說明卡片
    // 也被 hasText/exact 文字比對命中，跟渠道卡片撞成兩個 rounded-xl 容器。
    // 用 ChannelBadge 圖示（渠道卡片獨有，說明卡片沒有）進一步縮限排除它。
    const nameEl = page.locator('p.font-medium').getByText(displayName, { exact: true });
    const card = nameEl
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
      .filter({ has: page.getByRole('button', { name: 'Bot 設定' }) });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByRole('button', { name: 'Bot 設定' }).click();

    const dialog = page.getByRole('dialog').filter({ hasText: 'Bot 設定' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText(`Bot 設定 — ${displayName}`)).toBeVisible();

    // 表單既有欄位載入：Bot 模式下拉、最大回覆次數、轉接訊息 textarea 皆可見
    await expect(dialog.getByText('Bot 模式')).toBeVisible();
    await expect(dialog.getByText('Bot 最大回覆次數')).toBeVisible();
    await expect(dialog.getByText('轉接關鍵字')).toBeVisible();
    await expect(dialog.getByText('轉接訊息')).toBeVisible();

    // 不點「儲存」，直接用 Escape/取消關閉，確保不送出任何 PATCH
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toBeHidden();
  });

  // ── 6. 新建 [E2E] WEBCHAT 測試渠道 → 完整讀寫驗證 Bot 設定 → 刪除 ───────
  test('@settings-channels 新建 [E2E] WEBCHAT 測試渠道並完整驗證 Bot 設定儲存', async ({ page }) => {
    await gotoChannelsTab(page);

    await page.getByRole('button', { name: '新增渠道' }).click();
    const formDialog = page.getByRole('dialog').filter({ hasText: '新增渠道' });
    await expect(formDialog).toBeVisible({ timeout: 10_000 });

    // 渠道類型選 WEBCHAT（唯一不需外部金鑰的類型）
    const typeSelect = formDialog.locator('select').first();
    await typeSelect.selectOption('WEBCHAT');

    await formDialog.getByPlaceholder('例：官網即時客服').fill(webchatName);
    // Channel Secret / Channel Access Token 為任意字串
    const secretInput = formDialog.getByPlaceholder('任意字串作為驗證金鑰');
    const tokenInput = formDialog.getByPlaceholder('任意字串作為 API Token');
    await secretInput.fill(`e2e-secret-${runId}`);
    await tokenInput.fill(`e2e-token-${runId}`);

    const createRes = page.waitForResponse(
      (res) => res.url().includes('/channels') && res.request().method() === 'POST' && !res.url().includes('chatbox-link'),
    );
    await formDialog.getByRole('button', { name: '儲存' }).click();
    const res = await createRes;
    expect(res.ok(), `新增 WEBCHAT 渠道失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    createdChannelId = body?.data?.id;
    expect(createdChannelId, '新增渠道回應應含 id').toBeTruthy();

    // 新增後 dialog 應關閉，列表出現新渠道卡片
    await expect(formDialog).toBeHidden({ timeout: 10_000 });
    // 同案例 5 的教訓：寬鬆的 div+hasText 會連整個列表容器一起選中，
    // 命中所有卡片的「Bot 設定」按鈕。用名稱文字節點 + 含該按鈕的祖先卡片精確鎖定。
    const newCard = page
      .locator('p.font-medium')
      .getByText(webchatName, { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
      .filter({ has: page.getByRole('button', { name: 'Bot 設定' }) });
    await expect(newCard).toBeVisible({ timeout: 15_000 });

    // 開啟該渠道的 Bot 設定，切換模式並儲存（完整讀寫驗證，僅動自建渠道）
    await newCard.getByRole('button', { name: 'Bot 設定' }).click();
    const botDialog = page.getByRole('dialog').filter({ hasText: 'Bot 設定' });
    await expect(botDialog).toBeVisible({ timeout: 10_000 });
    await expect(botDialog.getByText(`Bot 設定 — ${webchatName}`)).toBeVisible();

    // 預設模式為「關鍵字 + LLM（推薦）」，切成「僅關鍵字回覆」驗證可寫入
    const botModeSelect = botDialog.locator('select').first();
    await expect(botModeSelect).toHaveValue('keyword_then_llm');
    await botModeSelect.selectOption('keyword');

    const saveRes = page.waitForResponse(
      (res) => res.url().includes(`/channels/${createdChannelId}`) && res.request().method() === 'PATCH',
    );
    await botDialog.getByRole('button', { name: '儲存' }).click();
    const saveResult = await saveRes;
    expect(saveResult.ok(), `儲存 Bot 設定失敗：${await saveResult.text()}`).toBeTruthy();
    await expect(botDialog).toBeHidden({ timeout: 10_000 });

    // 重新開啟 Bot 設定，驗證剛剛的變更已持久化（讀回 keyword）
    await newCard.getByRole('button', { name: 'Bot 設定' }).click();
    const botDialog2 = page.getByRole('dialog').filter({ hasText: 'Bot 設定' });
    await expect(botDialog2).toBeVisible({ timeout: 10_000 });
    await expect(botDialog2.locator('select').first()).toHaveValue('keyword', { timeout: 10_000 });
    await botDialog2.getByRole('button', { name: '取消' }).click();
    await expect(botDialog2).toBeHidden();
  });
});
