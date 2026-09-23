import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import {
  E2E_PREFIX,
  newApiContext,
  acceptNextDialog,
  dismissNextDialog,
  gotoAndCheck,
} from './helpers';

/**
 * LINE 素材管理三兄弟功能層測試 @line-materials
 *   1. Rich Menu（草稿層級 CRUD，含發布確認框的「取消」分支）
 *   2. 關鍵字回覆（automation rules 的薄包裝）
 *   3. Quick Reply 預設組
 *
 * ⚠️ 絕對紅線：Rich Menu「發布」「取消發布」「綁定受眾」都是會真的打 LINE 官方 API 的操作
 * （發布會真的把選單推上 LINE 官方帳號、取消發布會真的從 LINE 移除）。
 * 本檔全程只在草稿層級操作：
 *   - 發布按鈕只驗證「點擊後出現原生 confirm」，一律用 dismissNextDialog 取消，絕不 acceptNextDialog。
 *   - 完全不觸碰「綁定受眾」（RichMenuBindDialog，只在 published 狀態才會出現，本檔草稿不會碰到）。
 *   - 刪除草稿是安全操作（只刪 DB 草稿記錄，不影響 LINE 上任何東西），用 acceptNextDialog。
 *
 * 種資料 / 清理策略：
 * - beforeAll：用 API 找一個 active 的 LINE 渠道（沒有就整份 spec skip，UAT 環境現況待確認）；
 *   並用 API 建一則 [E2E] LINE 純文字素材，供關鍵字回覆挑選用。
 * - afterAll：用 API 刪除所有自建 Rich Menu 草稿 / 關鍵字回覆規則（automation rule）/
 *   Quick Reply 預設組 / 測試素材，try/catch 各自獨立不讓清理失敗炸測試。
 * - 只動自建 [E2E] 資料，不對既有 UAT 資料寫入或刪除。
 *
 * 已知 UI 現況（測試據此放寬斷言，撰寫時逐檔讀 page.tsx / 元件確認）：
 * - LineModuleTabs（src/components/line/LineModuleTabs.tsx）目前只有「Rich Menu」「關鍵字回覆」兩個可點 tab，
 *   Quick Reply 預設組頁面（/dashboard/line/quick-replies）存在且功能完整，但沒有從 tab bar 連過去的入口
 *   （盤點稿 TEST-PLAN.md 只列到 rich-menus/keyword-replies/quick-replies 三塊，未提及此缺口）。
 *   → 本測試直接用網址進入 quick-replies 頁，不透過 tab 點擊。
 * - Rich Menu 列表頁「發布」confirm 文案是「確定發布到 LINE？...」，
 *   編輯頁按鈕文字是「發布到 LINE」（列表頁卡片按鈕文字只是「發布」）—— 文案不同但 confirm message 相同。
 * - RichMenuEditor 存草稿前端會擋：名稱 / 底部按鈕文字 / 背景圖三者皆必填（imageUrl 為空會擋在 handleSave，
 *   不會打 API），因此背景圖上傳這步無法用 test.skip 迴避，改用一張本地產生的最小 PNG 走真實上傳。
 */

test.describe.configure({ mode: 'serial' });

const RUN = randomUUID().slice(0, 8);

// Rich Menu
const RM_NAME = `${E2E_PREFIX} RichMenu ${RUN}`;
const RM_NAME_RENAMED = `${E2E_PREFIX} RichMenu 改名 ${RUN}`;

// 關鍵字回覆
const KR_NAME = `${E2E_PREFIX} 關鍵字回覆 ${RUN}`;
const KR_NAME_RENAMED = `${E2E_PREFIX} 關鍵字回覆改名 ${RUN}`;
const KR_KEYWORD = `${E2E_PREFIX}關鍵字${RUN}`;
const MATERIAL_NAME = `${E2E_PREFIX} 關鍵字回覆測試素材 ${RUN}`;

// Quick Reply 預設組
const QR_NAME = `${E2E_PREFIX} QuickReply ${RUN}`;
const QR_NAME_RENAMED = `${E2E_PREFIX} QuickReply 改名 ${RUN}`;

// 1×1 透明 PNG（base64），供 Rich Menu 背景圖上傳測試用——不依賴外部檔案/相依套件
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

let api: APIRequestContext;
/** UAT 中找到的 active LINE 渠道 id；找不到時整份 spec skip */
let lineChannelId: string | null = null;
/** 供關鍵字回覆挑選的測試素材 id */
let materialId = '';

/** 本輪建立的 Rich Menu 草稿 id（含測試 5 複製出的第二個），afterAll 統一清理 */
const createdRichMenuIds: string[] = [];
let mainRichMenuId = '';

// ---------------------------------------------------------------------------
// 共用 locator / 小工具
// ---------------------------------------------------------------------------

async function gotoRichMenuList(page: Page, channelId: string) {
  await gotoAndCheck(page, `/dashboard/line/rich-menus?channelId=${channelId}`);
  await expect(page.getByRole('heading', { name: 'Rich Menu' })).toBeVisible({ timeout: 15_000 });
}

/**
 * Rich Menu 卡片：以卡片內文字定位到最外層卡片容器。
 * ⚠️ 複製出的卡片名稱是「原名稱（副本）」，對原名稱做子字串比對（hasText 預設行為）
 * 會連副本一起命中——用「卡片標題文字精確等於 name」排除副本卡片，避免刪錯/測錯對象。
 */
function richMenuCard(page: Page, name: string) {
  return page
    .locator('div.rounded-lg.border')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
}

async function gotoKeywordReplies(page: Page) {
  await gotoAndCheck(page, '/dashboard/line/keyword-replies');
  await expect(page.getByRole('heading', { name: '關鍵字回覆' })).toBeVisible({ timeout: 15_000 });
}

async function gotoQuickReplies(page: Page) {
  // ⚠️ 此頁未掛在 LineModuleTabs，直接網址進入（見檔頭已知 UI 現況說明）
  await gotoAndCheck(page, '/dashboard/line/quick-replies');
  await expect(page.getByRole('heading', { name: 'Quick Reply 預設組' })).toBeVisible({
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// 種資料 / 清理
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  api = await newApiContext();

  // 找一個 active 的 LINE 渠道（Rich Menu / 關鍵字回覆都需要 LINE 渠道環境）
  const chRes = await api.get('channels');
  if (chRes.ok()) {
    const body = await chRes.json();
    const channels: Array<Record<string, unknown>> = body?.data ?? [];
    const line = channels.find(
      (c) =>
        ((c.type as string) === 'LINE' || (c.channelType as string) === 'LINE') &&
        c.isActive === true,
    );
    lineChannelId = line ? String(line.id) : null;
  }

  // 建一則 [E2E] LINE 純文字素材，供關鍵字回覆挑選用
  const matRes = await api.post('marketing/materials', {
    data: {
      name: MATERIAL_NAME,
      channelType: 'line',
      contentType: 'line_text',
      body: { text: `E2E 自動化測試素材（勿動）${RUN}` },
      status: 'approved',
    },
  });
  if (matRes.ok()) {
    materialId = (await matRes.json())?.data?.id ?? '';
  } else {
    console.warn(`[E2E] 建立測試素材失敗（${matRes.status()}）：${await matRes.text()}`);
  }
});

test.afterAll(async () => {
  // Rich Menu 草稿：try/catch 各自獨立
  for (const id of createdRichMenuIds) {
    try {
      await api.delete(`line/rich-menus/${id}`);
    } catch {
      // 清理失敗不炸測試
    }
  }
  // 關鍵字回覆（automation rule）：測試 9 應該已刪掉，這裡保險再清一次
  try {
    const res = await api.get('automation/rules', { params: { trigger: 'keyword.matched', limit: '100' } });
    if (res.ok()) {
      const body = await res.json();
      const rules: Array<Record<string, unknown>> = body?.data ?? [];
      const leftover = rules.filter((r) => String(r.name).includes(RUN));
      for (const r of leftover) {
        try {
          await api.delete(`automation/rules/${r.id}`);
        } catch {
          // 忽略
        }
      }
    }
  } catch {
    // 忽略
  }
  // 測試素材
  if (materialId) {
    try {
      await api.delete(`marketing/materials/${materialId}`);
    } catch {
      // 忽略
    }
  }
  await api.dispose().catch(() => {});
});

// ---------------------------------------------------------------------------
// 測試本體
// ---------------------------------------------------------------------------

test.describe('LINE 素材管理功能 @line-materials', () => {
  test('@line-materials 00 前置：確認 UAT 有 active 的 LINE 渠道', async () => {
    test.skip(!lineChannelId, 'UAT 租戶目前沒有 active 的 LINE 渠道，整份 spec 依賴此渠道，全部 skip');
  });

  test('@line-materials 01 Rich Menu 列表頁：OaSwitcher 切到 LINE 渠道後頁面正常載入', async ({ page }) => {
    test.skip(!lineChannelId, '無 active LINE 渠道');
    await gotoRichMenuList(page, lineChannelId!);

    // OaSwitcher 顯示為已選取該渠道（select 的 value）
    const oaSelect = page.locator('select').first();
    await expect(oaSelect).toHaveValue(lineChannelId!, { timeout: 15_000 });

    // 「建立 Rich Menu」按鈕出現（channelId 已選）
    await expect(page.getByRole('button', { name: '建立 Rich Menu' })).toBeVisible();
  });

  test('@line-materials 02 建立 Rich Menu：選版型 → 填名稱/按鈕文字 → 上傳背景圖 → 儲存草稿', async ({
    page,
  }) => {
    test.skip(!lineChannelId, '無 active LINE 渠道');
    await gotoRichMenuList(page, lineChannelId!);

    await page.getByRole('button', { name: '建立 Rich Menu' }).click();
    await expect(page).toHaveURL(/\/dashboard\/line\/rich-menus\/new\?channelId=/);
    await expect(page.getByRole('heading', { name: '選擇版型' })).toBeVisible({ timeout: 15_000 });

    // LayoutPicker：選第一張小選單版型「全寬單格」（結構最簡單，只有 1 個 action 區）
    await page.getByText('全寬單格', { exact: true }).click();

    // 進入編輯器：填名稱 + 按鈕文字
    const nameInput = page.getByPlaceholder('如：主選單 v1');
    await expect(nameInput).toBeVisible({ timeout: 15_000 });
    await nameInput.fill(RM_NAME);

    const chatBarInput = page.getByPlaceholder('如：菜單');
    await chatBarInput.fill('E2E選單');

    // 區域 action：預設 type=postback 但 data 必填（未填會被後端 400 擋下——
    // 「postback action requires data」，這是正常驗證，不是每個版型都有預設值）
    await page.getByPlaceholder('例：menu=main').fill('menu=e2e-test');

    // 背景圖：走真實上傳（1×1 透明 PNG，走 /files/upload 端點）
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'e2e-rich-menu-bg.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
    });
    // 上傳完成訊號：CompactImageField 縮圖出現 src（value 非空後 URL 輸入框會帶入網址）
    const urlInput = page.locator('input[placeholder="圖片網址"]');
    await expect(urlInput).not.toHaveValue('', { timeout: 20_000 });

    await page.getByRole('button', { name: '儲存草稿' }).click();

    // 成功後導回列表頁，卡片可見
    await expect(page).toHaveURL(/\/dashboard\/line\/rich-menus\?channelId=/, { timeout: 15_000 });
    await expect(richMenuCard(page, RM_NAME)).toBeVisible({ timeout: 15_000 });

    // 用 API 反查剛建立的 id，供後續測試與 afterAll 清理使用
    const res = await api.get('line/rich-menus', { params: { channelId: lineChannelId! } });
    expect(res.ok()).toBeTruthy();
    const list: Array<Record<string, unknown>> = (await res.json())?.data ?? [];
    const created = list.find((m) => m.name === RM_NAME);
    expect(created, `API 列表中應找到剛建立的 ${RM_NAME}`).toBeTruthy();
    mainRichMenuId = String(created!.id);
    createdRichMenuIds.push(mainRichMenuId);
  });

  test('@line-materials 03 草稿可編輯：進入編輯頁改名稱 → 儲存成功', async ({ page }) => {
    test.skip(!lineChannelId, '無 active LINE 渠道');
    test.skip(!mainRichMenuId, '測試 02 未成功建立 Rich Menu');

    await gotoRichMenuList(page, lineChannelId!);
    await richMenuCard(page, RM_NAME).getByRole('button', { name: '編輯' }).click();

    await expect(page).toHaveURL(new RegExp(`/dashboard/line/rich-menus/${mainRichMenuId}$`));
    await expect(page.getByText('草稿', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    const nameInput = page.getByPlaceholder('如：主選單 v1');
    await expect(nameInput).toHaveValue(RM_NAME, { timeout: 15_000 });
    await nameInput.fill(RM_NAME_RENAMED);

    await page.getByRole('button', { name: '儲存草稿' }).click();

    // 儲存後 mutate() 重抓：欄位仍是改後的值（此頁沒有 toast，用值持久化驗證）
    await expect(nameInput).toHaveValue(RM_NAME_RENAMED, { timeout: 15_000 });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByPlaceholder('如：主選單 v1')).toHaveValue(RM_NAME_RENAMED, {
      timeout: 15_000,
    });
  });

  test('@line-materials 04 發布按鈕存在且點擊後出現確認框，取消後仍是草稿（絕不 accept）', async ({
    page,
  }) => {
    test.skip(!lineChannelId, '無 active LINE 渠道');
    test.skip(!mainRichMenuId, '測試 02 未成功建立 Rich Menu');

    await gotoRichMenuList(page, lineChannelId!);
    const card = richMenuCard(page, RM_NAME_RENAMED);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // 先掛 dialog handler 再點「發布」，確認框訊息含「確定發布到 LINE」，一律 dismiss
    const dialogMsg = dismissNextDialog(page);
    await card.getByRole('button', { name: '發布', exact: true }).click();
    const msg = await dialogMsg;
    expect(msg).toContain('確定發布到 LINE');

    // 取消後：卡片仍顯示「草稿」badge、「發布」按鈕仍在（沒有變成「已發布」狀態）
    await expect(card.getByText('草稿', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(card.getByRole('button', { name: '發布', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: '取消發布' })).toHaveCount(0);

    // API 反查保險：status 仍是 draft，避免 UI 誤判
    const res = await api.get(`line/rich-menus/${mainRichMenuId}`);
    expect(res.ok()).toBeTruthy();
    const detail = (await res.json())?.data;
    expect(detail?.status).toBe('draft');
  });

  test('@line-materials 05 複製：more 選單「複製」→ 出現新的一則（記下 id 供清理）', async ({ page }) => {
    test.skip(!lineChannelId, '無 active LINE 渠道');
    test.skip(!mainRichMenuId, '測試 02 未成功建立 Rich Menu');

    await gotoRichMenuList(page, lineChannelId!);
    const card = richMenuCard(page, RM_NAME_RENAMED);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // more 選單（MoreHorizontal icon 按鈕）→ 複製
    await card.locator('button').filter({ has: page.locator('svg') }).last().click();
    await card.getByRole('button', { name: '複製', exact: true }).click();

    // 複製後列表新增一張「{原名} (Copy)」或類似字樣的卡片；用 API 反查最保險
    await expect
      .poll(
        async () => {
          const res = await api.get('line/rich-menus', { params: { channelId: lineChannelId! } });
          if (!res.ok()) return 0;
          const list: Array<Record<string, unknown>> = (await res.json())?.data ?? [];
          return list.filter((m) => String(m.name).includes(RM_NAME_RENAMED)).length;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(1);

    const res = await api.get('line/rich-menus', { params: { channelId: lineChannelId! } });
    const list: Array<Record<string, unknown>> = (await res.json())?.data ?? [];
    const dup = list.find(
      (m) => String(m.name).includes(RM_NAME_RENAMED) && String(m.id) !== mainRichMenuId,
    );
    expect(dup, '應能在 API 列表中找到複製出的第二則').toBeTruthy();
    createdRichMenuIds.push(String(dup!.id));
  });

  test('@line-materials 06 刪除草稿：more 選單「刪除」（安全操作，只刪 DB 草稿）→ 消失', async ({
    page,
  }) => {
    test.skip(!lineChannelId, '無 active LINE 渠道');
    test.skip(!mainRichMenuId, '測試 02 未成功建立 Rich Menu');

    await gotoRichMenuList(page, lineChannelId!);
    const card = richMenuCard(page, RM_NAME_RENAMED).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    const dialogMsg = acceptNextDialog(page);
    await card.locator('button').filter({ has: page.locator('svg') }).last().click();
    await card.getByRole('button', { name: '刪除', exact: true }).click();
    expect(await dialogMsg).toContain('確定要刪除這個 Rich Menu 草稿');

    // 該卡片消失（用主 id 的名稱定位；複製品名稱含相同關鍵字，等頁面上只剩一張或全部消失再判斷數量）
    await expect
      .poll(
        async () => {
          const res = await api.get(`line/rich-menus/${mainRichMenuId}`);
          return res.status();
        },
        { timeout: 15_000 },
      )
      .toBe(404);

    // 從清理清單移除，避免 afterAll 對已刪除 id 再刪一次噴 404（雖然有 try/catch，這裡明確一點）
    const idx = createdRichMenuIds.indexOf(mainRichMenuId);
    if (idx >= 0) createdRichMenuIds.splice(idx, 1);
  });

  // -------------------------------------------------------------------------
  // 關鍵字回覆
  // -------------------------------------------------------------------------

  test('@line-materials 07 關鍵字回覆：建立（規則名+關鍵字+選素材）→ 儲存成功', async ({ page }) => {
    test.skip(!materialId, '前置測試素材建立失敗，此測試依賴至少一則 LINE 素材');

    await gotoKeywordReplies(page);
    await page.getByRole('button', { name: '建立關鍵字回覆' }).click();

    const dlg = page.locator('div.fixed.inset-0');
    await expect(dlg.getByText('建立關鍵字回覆')).toBeVisible({ timeout: 10_000 });

    await dlg.getByPlaceholder('例：詢問營業時間、預約諮詢、產品 DM').fill(KR_NAME);

    const keywordInput = dlg.getByPlaceholder('輸入關鍵字後按 Enter 或點「加入」');
    await keywordInput.fill(KR_KEYWORD);
    await keywordInput.press('Enter');
    await expect(dlg.getByText(KR_KEYWORD, { exact: true })).toBeVisible();

    // 選素材：下拉選到 beforeAll 建立的測試素材
    const materialSelect = dlg.locator('select');
    await materialSelect.selectOption(materialId);
    // 選定後 dialog 內同時有 <option>（收合中天生 hidden，.first() 會選到它）與
    // 素材預覽卡片兩處都含此名稱，明確排除 option 只驗證預覽卡片
    await expect(
      dlg.locator('div.font-medium', { hasText: MATERIAL_NAME }).first(),
    ).toBeVisible();

    await dlg.getByRole('button', { name: '儲存', exact: true }).click();

    // dialog 關閉、列表出現新規則
    await expect(dlg).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('tbody tr', { hasText: KR_NAME })).toBeVisible({ timeout: 15_000 });
  });

  test('@line-materials 08 關鍵字回覆：編輯改名 + toggle 啟用/停用', async ({ page }) => {
    test.skip(!materialId, '前置測試素材建立失敗');

    await gotoKeywordReplies(page);
    const row = page.locator('tbody tr', { hasText: KR_NAME });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // 編輯：改名稱
    await row.getByRole('button', { name: '編輯', exact: true }).click();
    const dlg = page.locator('div.fixed.inset-0');
    await expect(dlg.getByText('編輯關鍵字回覆')).toBeVisible({ timeout: 10_000 });

    const nameInput = dlg.getByPlaceholder('例：詢問營業時間、預約諮詢、產品 DM');
    await expect(nameInput).toHaveValue(KR_NAME);
    await nameInput.fill(KR_NAME_RENAMED);
    // 等 PATCH 真的回 200 再判斷 dialog 關閉，避免 race（同 Wave 1 教訓）
    const saveRes = page.waitForResponse(
      (res) => res.url().includes('/automation/rules/') && res.request().method() === 'PATCH' && res.ok(),
    );
    await dlg.getByRole('button', { name: '儲存', exact: true }).click();
    await saveRes;
    await expect(dlg).toHaveCount(0, { timeout: 15_000 });

    // ⚠️ 產品端發現的快取失效 bug：useKeywordReplies 用兩層 SWR，列表顯示的名稱
    // 來自第二層 `['keyword-reply-details', ids.join(',')]`；rename 不改變 id 清單，
    // 這個 key 完全沒變，SWR 不會重抓，畫面停在改名前的舊名——直到手動 reload 才更新。
    // handleSave 呼叫的 `mutate()` 只 revalidate 第一層，不會連動第二層。
    // 這裡先 reload 繞開，已記錄此問題待開單（非本測試該掩蓋的行為，故意留白註記）。
    await page.reload({ waitUntil: 'networkidle' });

    const renamedRow = page.locator('tbody tr', { hasText: KR_NAME_RENAMED });
    await expect(renamedRow).toBeVisible({ timeout: 15_000 });

    // toggle 啟用/停用：預設啟用，點一下應變停用
    // ⚠️ 同上一段快取失效 bug：handleToggle 的 mutate() 一樣只 revalidate 第一層，
    // 畫面上按鈕文字點擊後不會立即改變，要等 reload 才反映後端真實狀態。
    // 這裡直接用 waitForResponse 確認 PATCH 成功，不斷言點擊後的即時 UI 變化。
    const toggleBtn = renamedRow.getByRole('button', { name: /^(啟用|停用)$/ });
    await expect(toggleBtn).toContainText('啟用', { timeout: 15_000 });
    const toggleRes = page.waitForResponse(
      (res) => res.url().includes('/automation/rules/') && res.request().method() === 'PATCH' && res.ok(),
    );
    await toggleBtn.click();
    await toggleRes;

    // reload 才能看到真實狀態（已知快取失效 bug，見上）
    await page.reload({ waitUntil: 'networkidle' });
    await expect(
      page.locator('tbody tr', { hasText: KR_NAME_RENAMED }).getByRole('button', { name: /^(啟用|停用)$/ }),
    ).toContainText('停用', { timeout: 15_000 });
  });

  test('@line-materials 09 關鍵字回覆：刪除按鈕實際只軟刪（isActive=false），列表不會過濾掉', async ({
    page,
  }) => {
    test.skip(!materialId, '前置測試素材建立失敗');

    await gotoKeywordReplies(page);
    const row = page.locator('tbody tr', { hasText: KR_NAME_RENAMED });
    await expect(row).toBeVisible({ timeout: 15_000 });

    const dialogMsg = acceptNextDialog(page);
    const deleteRes = page.waitForResponse(
      (res) => res.url().includes('/automation/rules/') && res.request().method() === 'DELETE' && res.ok(),
    );
    await row.getByRole('button', { name: '刪除', exact: true }).click();
    expect(await dialogMsg).toContain('確定刪除這條關鍵字回覆');
    const res = await deleteRes;

    // ⚠️ 產品端發現的功能缺陷：DELETE /automation/rules/:id 後端只是軟刪
    // （automation.service.ts deleteRule：`update({ isActive: false })`，資料庫記錄仍在），
    // 但關鍵字回覆列表的 GET /automation/rules?trigger=keyword.matched 沒有過濾 isActive，
    // 也沒有把 rule.isActive 反映成任何「已刪除/已停用」樣式（列表 UI 就是把它當硬刪設計的：
    // handleDelete 只 confirm+呼叫+mutate，沒有處理殘留展示）。
    // 結果：使用者點「刪除」、confirm、API 回 200，畫面卻仍照常顯示這筆規則，
    // 使用者會誤以為刪除沒有生效。這裡改用 API 驗證真實狀態，不斷言列表消失。
    const body = await res.json();
    expect(body?.data?.isActive, '刪除後 isActive 應為 false（軟刪）').toBe(false);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('tbody tr', { hasText: KR_NAME_RENAMED })).toBeVisible({
      timeout: 15_000,
    });
  });

  // -------------------------------------------------------------------------
  // Quick Reply 預設組
  // -------------------------------------------------------------------------

  test('@line-materials 10 Quick Reply 預設組：建立（名稱+2個按鈕）→ 編輯改名 → 刪除', async ({
    page,
  }) => {
    await gotoQuickReplies(page);
    await page.getByRole('button', { name: '建立預設組' }).click();

    const dlg = page.locator('div.fixed.inset-0');
    await expect(dlg.getByText('建立 Quick Reply 預設組')).toBeVisible({ timeout: 10_000 });

    await dlg.getByPlaceholder('例：滿意度調查、預約時段、是否同意條款').fill(QR_NAME);

    // 加兩個按鈕項（label + 點擊後送出文字）
    const labelInput = dlg.getByPlaceholder('例：同意');
    const textInput = dlg.getByPlaceholder('例：我同意（可留空 = 直接送「同意」）');
    const addBtn = dlg.getByRole('button', { name: '加入', exact: true });

    await labelInput.fill('E2E選項一');
    await textInput.fill('E2E送出文字一');
    await addBtn.click();

    await labelInput.fill('E2E選項二');
    await addBtn.click();

    // 輸入清單 label 與 LINE 擬真預覽按鈕都含相同文字，取第一個即可
    await expect(dlg.getByText('E2E選項一', { exact: true }).first()).toBeVisible();
    await expect(dlg.getByText('E2E選項二', { exact: true }).first()).toBeVisible();

    await dlg.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(dlg).toHaveCount(0, { timeout: 15_000 });

    const card = page.locator('div.rounded-lg.border', { hasText: QR_NAME }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('2 個按鈕');

    // 編輯：改名稱
    await card.getByRole('button', { name: '編輯', exact: true }).click();
    const editDlg = page.locator('div.fixed.inset-0');
    await expect(editDlg.getByText('編輯預設組')).toBeVisible({ timeout: 10_000 });
    const editNameInput = editDlg.getByPlaceholder('例：滿意度調查、預約時段、是否同意條款');
    await expect(editNameInput).toHaveValue(QR_NAME);
    await editNameInput.fill(QR_NAME_RENAMED);
    await editDlg.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(editDlg).toHaveCount(0, { timeout: 15_000 });

    const renamedCard = page.locator('div.rounded-lg.border', { hasText: QR_NAME_RENAMED }).first();
    await expect(renamedCard).toBeVisible({ timeout: 15_000 });

    // 刪除（confirm）
    const dialogMsg = acceptNextDialog(page);
    await renamedCard.getByRole('button', { name: '刪除', exact: true }).click();
    expect(await dialogMsg).toContain('確定刪除這個預設組');

    await expect(
      page.locator('div.rounded-lg.border', { hasText: QR_NAME_RENAMED }),
    ).toHaveCount(0, { timeout: 15_000 });
  });
});
