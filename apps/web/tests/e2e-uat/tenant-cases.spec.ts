import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import {
  BASE_URL,
  E2E_PREFIX,
  WEBCHAT_CHANNEL_ID,
  newApiContext,
  seedWebchatConversation,
  acceptNextDialog,
  gotoAndCheck,
  SeededConversation,
} from './helpers';

/**
 * 案件（工單）功能層測試 @cases
 *
 * 種資料策略：
 * - beforeAll 種一條 WEBCHAT 對話（rate limit 10 次/分，只 seed 1 條），
 *   再用 API 建兩個 [E2E] 前綴測試案件：
 *   - 主案件：POST /cases/from-conversation/:conversationId（priority MEDIUM，跑完整流程）
 *   - 對照組：POST /cases（priority LOW，驗搜尋/篩選的「別的案件消失」）
 * - afterAll 用 API 刪除所有自建案件（try/catch，不讓清理失敗炸測試）。
 * - 只動自建 [E2E] 案件，不對既有 UAT 資料寫入。
 *
 * 狀態流轉遵守 shared 的 VALID_CASE_TRANSITIONS：
 *   OPEN→(指派自動)IN_PROGRESS→ESCALATED→IN_PROGRESS→RESOLVED→CLOSED→OPEN
 * 注意：ESCALATED→RESOLVED 是「不合法轉換」（Topbar 雖顯示「標記解決」但後端會擋），
 * 因此升級後先用狀態下拉切回處理中，再標記解決。
 *
 * 已知 UI 現況（測試據此放寬斷言）：
 * - CaseStatusBadge 的 statusConfig key 是小寫（'open'），但 API 回大寫（'OPEN'），
 *   查表落空 → badge 顯示原始英文大寫（如 OPEN）而非中文標籤。
 *   狀態斷言一律以「狀態下拉的 value」為準，badge 用 /中文|英文/ 寬鬆比對。
 * - 列表排序固定 slaDueAt asc（無 SLA 的案件排最後），自建案件可能不在第 1 頁，
 *   因此用「搜尋 + 逐頁翻找」的 findCaseRow 定位列。
 */

// 本輪執行的唯一識別碼（進標題，供搜尋與清理辨識）
const RUN = randomUUID().slice(0, 8);
const RUN_B = randomUUID().slice(0, 8);
const TITLE_MAIN = `${E2E_PREFIX} 案件流程 ${RUN}`;
const TITLE_RENAMED = `${E2E_PREFIX} 案件流程改名 ${RUN}`;
const TITLE_B = `${E2E_PREFIX} 對照組 ${RUN_B}`;

let api: APIRequestContext;
let seeded: SeededConversation;
let mainCaseId = '';
let caseBId = '';
const createdCaseIds: string[] = [];

// ---------------------------------------------------------------------------
// 共用 locator / 小工具
// ---------------------------------------------------------------------------

/** 列表頁搜尋框（client-side 過濾，至少 2 個字） */
const searchBox = (page: Page) => page.getByPlaceholder('搜尋工單標題');

/** 列表頁「優先級」篩選（用含 URGENT option 辨識，避免抓到負責人/分類/SLA 下拉） */
const priorityFilter = (page: Page) =>
  page.locator('select', { has: page.locator('option[value="URGENT"]') }).first();

/** 詳情頁各區塊的下拉：結構為 <div><h4>標籤</h4><select/></div>，用 h4 兄弟節點定位 */
const detailSelect = (page: Page, label: string) =>
  page.locator(`h4:text-is("${label}")`).locator('xpath=following-sibling::select[1]');

/** 詳情頁狀態下拉（斷言狀態一律以此 value 為準，避開 badge 大小寫 bug） */
const statusSelect = (page: Page) => detailSelect(page, '狀態');

/**
 * 在列表中逐頁翻找含指定文字的列（列表排序 slaDueAt asc、無 SLA 排最後，
 * 自建案件常落在後面頁）。找不到且無下一頁時丟錯。
 */
async function findCaseRow(page: Page, text: string) {
  const row = page.locator('tbody tr', { hasText: text }).first();
  for (let i = 0; i < 30; i++) {
    try {
      await expect(row).toBeVisible({ timeout: 4_000 });
      return row;
    } catch {
      // 這頁沒有 → 翻下一頁
    }
    const next = page.locator('button:has(.lucide-chevron-right)').first();
    const hasNext =
      (await next.isVisible().catch(() => false)) && !(await next.isDisabled().catch(() => true));
    if (!hasNext) {
      throw new Error(`翻遍列表找不到含「${text}」的案件列`);
    }
    await next.click();
  }
  throw new Error(`翻頁超過上限仍找不到「${text}」`);
}

/** 等待列表重新抓取（URL 帶指定 query 片段的 /cases 請求回來） */
function waitCasesFetch(page: Page, urlPart: string) {
  return page.waitForResponse(
    (r) => r.url().includes('/cases?') && r.url().includes(urlPart) && r.ok(),
    { timeout: 15_000 },
  );
}

async function gotoCasesList(page: Page) {
  await gotoAndCheck(page, '/dashboard/cases');
}

async function gotoCaseDetail(page: Page, caseId: string) {
  await gotoAndCheck(page, `/dashboard/cases/${caseId}`);
  // 詳情載入完成的訊號：狀態下拉出現
  await expect(statusSelect(page)).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// 種資料 / 清理
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  api = await newApiContext();
  seeded = await seedWebchatConversation(api, '案件測試');

  // 主案件：從對話建立（會連結對話，priority MEDIUM 讓後續升級有更高階可選）
  const resMain = await api.post(`cases/from-conversation/${seeded.conversationId}`, {
    data: {
      title: TITLE_MAIN,
      description: `E2E 自動化測試案件（勿動）${RUN}`,
      priority: 'MEDIUM',
    },
  });
  if (!resMain.ok()) {
    throw new Error(`建立主案件失敗（${resMain.status()}）${await resMain.text()}`);
  }
  mainCaseId = (await resMain.json())?.data?.id;
  if (!mainCaseId) throw new Error('from-conversation 回應中沒有案件 id');
  createdCaseIds.push(mainCaseId);

  // 對照組案件：直接 POST /cases（必填 contactId + channelId + title）
  const resB = await api.post('cases', {
    data: {
      contactId: seeded.contactId,
      channelId: WEBCHAT_CHANNEL_ID,
      title: TITLE_B,
      description: `E2E 搜尋對照組（勿動）${RUN_B}`,
      priority: 'LOW',
    },
  });
  if (!resB.ok()) {
    throw new Error(`建立對照組案件失敗（${resB.status()}）${await resB.text()}`);
  }
  caseBId = (await resB.json())?.data?.id;
  createdCaseIds.push(caseBId);
});

test.afterAll(async () => {
  // 清理所有自建案件；主案件若已被 UI 測試刪掉會 404，一律 try/catch 吞掉
  for (const id of createdCaseIds) {
    try {
      await api.delete(`cases/${id}`);
    } catch {
      // 清理失敗不炸測試
    }
  }
  await api.dispose().catch(() => {});
});

// ---------------------------------------------------------------------------
// 測試本體（serial：後面的測試依賴前面造成的狀態）
// ---------------------------------------------------------------------------

test.describe.serial('案件（工單）功能 @cases', () => {
  test('@cases 01 列表頁載入：四張統計卡有數字、自建 [E2E] 案件可見', async ({ page }) => {
    await gotoCasesList(page);

    // 統計卡：四張、各有標籤與數字（「SLA 違規」也出現在篩選 option，限定 p 元素避免 strict violation）
    for (const label of ['開啟中', 'SLA 違規', '即將到期', '今日解決']) {
      await expect(
        page.locator('p', { hasText: new RegExp(`^${label}$`) }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }
    const statValues = page.locator('p.text-2xl');
    await expect(statValues).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(statValues.nth(i)).toHaveText(/^\d+$/, { timeout: 15_000 });
    }

    // 自建主案件可見（搜尋縮小範圍後逐頁翻找）
    await searchBox(page).fill(RUN);
    const row = await findCaseRow(page, RUN);
    await expect(row).toContainText(TITLE_MAIN.slice(0, 30)); // 列表標題超過 30 字會截斷
  });

  test('@cases 02 狀態 Tabs：「開啟」分頁包含自建案件、tab 計數為數字', async ({ page }) => {
    await gotoCasesList(page);

    // 全部 tab 計數應為數字（statusCounts 載入後顯示 (n)）
    await expect(page.getByRole('button', { name: /^全部/ })).toContainText(/\(\d+\)/, {
      timeout: 15_000,
    });

    // 切到「開啟」分頁（主案件此時仍是 OPEN）
    const fetchOpen = waitCasesFetch(page, 'status=OPEN');
    await page.getByRole('button', { name: /^開啟/ }).first().click();
    await fetchOpen;

    await searchBox(page).fill(RUN);
    await findCaseRow(page, RUN);
  });

  test('@cases 03 搜尋：輸入 [E2E] 標題關鍵字後只剩該案件', async ({ page }) => {
    await gotoCasesList(page);

    // client-side 搜尋（≥2 字才過濾）：用本輪唯一識別碼
    await searchBox(page).fill(RUN);
    await findCaseRow(page, RUN);

    // 對照組（不同識別碼）與其他案件被過濾掉：不含 RUN 的列數應為 0
    // （不能先 count 再逐列斷言——列表過濾是非同步重繪，count 會 stale）
    await expect(page.locator('tbody tr').filter({ hasNotText: RUN })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.locator('tbody tr', { hasText: RUN_B })).toHaveCount(0);
  });

  test('@cases 04 篩選：選自建案件的優先級仍在、選別的則消失', async ({ page }) => {
    await gotoCasesList(page);
    await searchBox(page).fill(RUN);

    // 主案件目前 priority=MEDIUM → 選「中」仍可找到
    const fetchMedium = waitCasesFetch(page, 'priority=MEDIUM');
    await priorityFilter(page).selectOption('MEDIUM');
    await fetchMedium;
    await findCaseRow(page, RUN);

    // 選「緊急」→ server-side 過濾排除主案件，列表不再有它
    const fetchUrgent = waitCasesFetch(page, 'priority=URGENT');
    await priorityFilter(page).selectOption('URGENT');
    await fetchUrgent;
    await expect(page.locator('tbody tr', { hasText: RUN })).toHaveCount(0);
  });

  test('@cases 05 詳情頁：內聯編輯標題（點標題→改字→Enter）', async ({ page }) => {
    await gotoCaseDetail(page, mainCaseId);

    // 點標題進入編輯模式（CardTitle 帶 title="點擊編輯標題"）
    const titleEl = page.locator('[title="點擊編輯標題"]');
    await expect(titleEl).toContainText(TITLE_MAIN);
    await titleEl.click();

    const input = page.locator('input.text-xl');
    await expect(input).toBeVisible();
    await input.fill(TITLE_RENAMED);
    await input.press('Enter');

    // PATCH 後 onRefresh 重抓 → 標題更新
    await expect(page.locator('[title="點擊編輯標題"]')).toContainText('案件流程改名', {
      timeout: 15_000,
    });

    // reload 保險：確認已持久化
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[title="點擊編輯標題"]')).toContainText(TITLE_RENAMED, {
      timeout: 15_000,
    });
  });

  test('@cases 06 詳情頁：變更優先級與分類', async ({ page }) => {
    await gotoCaseDetail(page, mainCaseId);

    // 優先級 MEDIUM → HIGH（升級測試需要現值 < URGENT）
    await expect(detailSelect(page, '優先級')).toHaveValue('MEDIUM');
    await detailSelect(page, '優先級').selectOption('HIGH');
    await expect(detailSelect(page, '優先級')).toHaveValue('HIGH', { timeout: 15_000 });

    // 分類 未分類 → 其他（「其他」在詳情頁與 API 分類清單都存在）
    await detailSelect(page, '分類').selectOption('其他');
    await expect(detailSelect(page, '分類')).toHaveValue('其他', { timeout: 15_000 });

    // reload 保險
    await page.reload({ waitUntil: 'networkidle' });
    await expect(detailSelect(page, '優先級')).toHaveValue('HIGH', { timeout: 15_000 });
    await expect(detailSelect(page, '分類')).toHaveValue('其他');
  });

  test('@cases 07 詳情頁：指派負責人（OPEN 案件自動轉處理中）', async ({ page }) => {
    await gotoCaseDetail(page, mainCaseId);

    const assignee = detailSelect(page, '負責人');
    await expect(assignee).toHaveValue(''); // 未指派

    // 等 /agents 載入（下拉至少有「未指派」+ 1 位 agent）
    await expect
      .poll(async () => assignee.locator('option').count(), { timeout: 15_000 })
      .toBeGreaterThan(1);

    // 選第一位 agent
    await assignee.selectOption({ index: 1 });
    await expect(assignee).not.toHaveValue('', { timeout: 15_000 });

    // 後端規則：OPEN 案件被指派時自動轉 IN_PROGRESS
    await expect(statusSelect(page)).toHaveValue('IN_PROGRESS', { timeout: 15_000 });

    // 時間軸出現指派事件
    await expect(page.getByText(/指派給/).first()).toBeVisible({ timeout: 15_000 });
  });

  test('@cases 08 詳情頁：新增內部備註後時間軸出現', async ({ page }) => {
    await gotoCaseDetail(page, mainCaseId);

    const noteText = `${E2E_PREFIX} 自動化測試備註 ${RUN}`;
    await page.getByPlaceholder('撰寫備註...').fill(noteText);

    // 「內部備註」預設勾選，仍明確確保勾上
    const internalCheckbox = page.locator('label:has-text("內部備註") input[type="checkbox"]');
    await internalCheckbox.check();

    await page.getByRole('button', { name: '新增備註', exact: true }).click();

    // 時間軸出現備註內容 + 「內部」徽章
    await expect(page.getByText(noteText).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('內部', { exact: true }).first()).toBeVisible();

    // reload 保險：備註已持久化
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText(noteText).first()).toBeVisible({ timeout: 15_000 });
  });

  test('@cases 09 升級流程：填原因與新優先級後狀態變已升級', async ({ page }) => {
    await gotoCaseDetail(page, mainCaseId);
    await expect(statusSelect(page)).toHaveValue('IN_PROGRESS'); // 升級前置（IN_PROGRESS→ESCALATED 合法）

    await page.getByRole('button', { name: '升級', exact: true }).click();

    const dlg = page.locator('dialog[open]');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText('案件升級')).toBeVisible();

    // 升級原因：點快選 chip
    await dlg.getByRole('button', { name: 'SLA 已違規', exact: true }).click();

    // 升級後優先級：現值 HIGH → 預設帶入唯一更高階 URGENT，明確再選一次
    const dlgPriority = dlg.locator('select', { has: page.locator('option[value="URGENT"]') });
    await dlgPriority.selectOption('URGENT');
    await expect(dlgPriority).toHaveValue('URGENT');

    await dlg.getByRole('button', { name: '確認升級', exact: true }).click();

    // 成功後 modal 關閉、狀態變 ESCALATED、優先級變 URGENT
    await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 15_000 });
    await expect(statusSelect(page)).toHaveValue('ESCALATED', { timeout: 15_000 });
    await expect(detailSelect(page, '優先級')).toHaveValue('URGENT');

    // 狀態 badge 顯示已升級（badge 目前有大小寫查表 bug，寬鬆比對中英文）
    await expect(page.getByText(/已升級|ESCALATED/).first()).toBeVisible();

    // 時間軸出現升級事件
    await expect(page.getByText(/案件升級/).first()).toBeVisible({ timeout: 15_000 });
  });

  test('@cases 10 狀態流轉：處理中→已解決→已關閉（有確認）→重新開啟', async ({ page }) => {
    await gotoCaseDetail(page, mainCaseId);
    await expect(statusSelect(page)).toHaveValue('ESCALATED');

    // ESCALATED→RESOLVED 不是合法轉換，先切回處理中（ESCALATED→IN_PROGRESS 合法）
    await statusSelect(page).selectOption('IN_PROGRESS');
    await expect(statusSelect(page)).toHaveValue('IN_PROGRESS', { timeout: 15_000 });

    // 標記解決（IN_PROGRESS→RESOLVED）
    await page.getByRole('button', { name: '標記解決', exact: true }).click();
    await expect(statusSelect(page)).toHaveValue('RESOLVED', { timeout: 15_000 });

    // 關閉（RESOLVED→CLOSED）：走狀態下拉會跳確認 Dialog
    await statusSelect(page).selectOption('CLOSED');
    const closeDlg = page.locator('dialog[open]');
    await expect(closeDlg.getByText('確認關閉案件')).toBeVisible();
    await closeDlg.getByRole('button', { name: '確認關閉', exact: true }).click();
    await expect(statusSelect(page)).toHaveValue('CLOSED', { timeout: 15_000 });

    // 重新開啟（CLOSED→OPEN）
    await page.getByRole('button', { name: '重新開啟', exact: true }).click();
    await expect(statusSelect(page)).toHaveValue('OPEN', { timeout: 15_000 });

    // 時間軸留下狀態軌跡（CaseTimeline 文案格式：「狀態：X → Y」）
    await expect(page.getByText(/狀態：.*→.*已解決|狀態：.*已解決.*→/).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('@cases 11 刪除：列表刪除自建案件（原生 confirm）後列表消失', async ({ page }) => {
    await gotoCasesList(page);

    await searchBox(page).fill(RUN);
    const row = await findCaseRow(page, RUN);

    // 列上唯一按鈕就是刪除（垃圾桶 icon）；先掛 dialog handler 再點
    const dialogMsg = acceptNextDialog(page);
    await row.getByRole('button').click();
    expect(await dialogMsg).toContain('確定要刪除此工單');

    // 刪除後列表重抓，該列消失
    await expect(page.locator('tbody tr', { hasText: RUN })).toHaveCount(0, { timeout: 15_000 });
  });
});
