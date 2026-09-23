import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import {
  E2E_PREFIX,
  newApiContext,
  gotoAndCheck,
  dismissNextDialog,
} from './helpers';
import {
  FieldSamples,
  boundarySamples,
  strOfLength,
  inventoryFields,
  formatFieldInventory,
  submitAndObserve,
  expectRejected,
  expectAccepted,
  apiFieldCheck,
  expectNoXssExecuted,
} from './field-helpers';

/**
 * Wave 6 欄位級測試：行銷（Marketing）+ LINE 素材模組。
 *
 * ══ 紅線（本檔嚴格遵守，已逐條讀碼確認）════════════════════════════════
 * 1. 廣播「立即發送」（`title="立即發送"` 的 Play 按鈕 → `confirm('確定要立即發送嗎？')`）
 *    只測「確認框出現即取消」（dismissNextDialog），**永不 accept**。
 *    真發送只在 `POST /marketing/broadcasts/:id/send`，本檔不呼叫該端點。
 * 2. 廣播「建立」按鈕只打 `POST /marketing/broadcasts` 建草稿（createBroadcast 不碰渠道 API），
 *    與發送路徑完全分離，故點「建立」安全。
 * 3. Rich Menu「發布 / 取消發布」會真推到 LINE，本檔不點；Rich Menu 相關一律走 API 建草稿。
 * 4. 只動自建的 `[E2E]` 資料，測完清理。
 *
 * ══ 讀碼盤點（與任務描述不同處，以程式碼為準）════════════════════════
 * - **行銷頁沒有 tab UI**：activeTab 由「路徑最後一段」決定（src/app/dashboard/marketing/page.tsx
 *   VALID_TABS = campaigns/broadcasts/segments），由 [section]/page.tsx 承接。
 *   故切 tab 一律 `page.goto()`，不找 tab 按鈕。
 * - **活動沒有「預算」欄位**：後端 createCampaignSchema 與前端 CampaignTab 皆無 budget/預算。
 *   任務描述的「預算數字欄位」在系統中不存在 → 標記 skip（見 test.skip）。
 * - **廣播不是多步驟精靈**：是單一 Dialog 單頁表單，沒有「下一步」按鈕。
 * - **LINE 素材頁在 /dashboard/line/***（非 /dashboard/marketing/line-*）：
 *   rich-menus / keyword-replies / quick-replies 三頁。
 * - **關鍵字回覆沒有獨立後端模組**：它是 automation rule 的薄包裝
 *   （trigger.type='keyword.matched' + action.type='send_material'，見 hooks/useKeywordReplies.ts），
 *   故其欄位驗證走 `POST /automation/rules`，而 automation 的 trigger 是 `.passthrough()`
 *   只驗 type —— 這正是本檔抓到最多缺口的地方。
 * - **前端 label 與 input 完全沒有關聯**（無 htmlFor/id/name/aria-label）→ `getByLabel()` 全失效，
 *   一律用 placeholder / 原生 select 的 option 文字 / nth 索引定位。
 * - **全頁無 toast**：成功一律「靜默關 dialog + SWR mutate」，失敗一律 `alert()`。
 *   故成功/失敗斷言一律用 submitAndObserve 的 API 回應碼。
 * - Rich Menu 建立需背景圖（前端擋 `if (!draft.imageUrl)`），UI 端走 MinIO 上傳；
 *   本檔 Rich Menu 欄位邊界改走 API 直測（imageUrl 給合法 URL），避免依賴上傳環境。
 *
 * ══ 後端約束對照表（讀 zod 取得，測試即依此設計邊界）══════════════════
 * marketing.routes.ts
 *   campaign.name         min(1).max(200)      | description max(500)
 *   campaign.startDate    z.string() 無格式驗證 | endDate 同上，**無 endDate>startDate 檢查**
 *   campaign.status       enum(draft/active/completed/cancelled)
 *   segment.name          min(1).max(200)      | description max(500)
 *   segment.rules.conditions[].field  enum(tag/channelType/createdAfter/createdBefore)
 *   segment.rules.logic   enum(AND/OR)         | conditions[].value z.unknown() **無驗證**
 *   broadcast.name        min(1).max(200)      | channelId/materialId/campaignId/segmentId uuid
 *   broadcast.targetType  enum(all/segment/tags/contacts)
 *   broadcast.scheduledAt z.string() **無「須為未來」檢查**
 *   broadcast refine：materialId 與 templateId 必須「恰好一個」
 * line/rich-menu.routes.ts
 *   name min(1).max(200) | chatBarText min(1).max(14)（對齊 LINE 官方上限 14）
 *   areas min(1).max(20) | imageUrl z.string().url()
 *   action.label max(20) | data/displayText/text max(300) | **uri 只有 z.string()，無 .url()**
 *   service 層 validateAction 另檢查各 type 必填欄位與 bounds 是否超出 size
 * line/quick-reply-preset.routes.ts
 *   name min(1).max(100) | items min(1).max(13)（對齊 LINE 官方每則訊息 13 顆上限）
 *   items[].label min(1).max(20)（對齊 LINE 官方 20 字）| items[].text min(1).max(300)
 * automation.routes.ts（關鍵字回覆底層）
 *   name min(1).max(200) | actions min(1)
 *   trigger: z.object({ type: z.string().min(1) }).passthrough()  ← keywords/match_mode 完全不驗
 */

// ⚠️ 不用 serial：本檔多個案例是「已知 bug 的記錄」（用 test.fail() 標記），
// serial 模式下前面案例失敗會讓後面全部 skip，拿不到完整覆蓋報告。
// config 已設 workers:1 + fullyParallel:false，執行順序仍為由上而下。
// 唯一的跨案例相依（15 建草稿 → 16 讀該草稿）已在案例 16 內自行容錯。

// ─── UAT 既有 fixture（_probe 探測取得，皆為既有資料，本檔唯讀不修改）───
const FB_CHANNEL_ID = '56298974-9293-4ec2-b81b-5938cfe6530c';
const LINE_CHANNEL_ID = 'c4ca29ba-45f9-4f0f-adc9-8fb967469c1b';
const FB_MATERIAL_ID = '26ac505b-fbef-476c-ba03-531205d53957';
const LINE_MATERIAL_ID = 'dfee6ccb-8cfe-43da-8892-ed9416903bf5';

const runId = randomUUID().slice(0, 6);
const nameOf = (what: string) => `${E2E_PREFIX} ${what} ${runId}`;

/** 合法的 Rich Menu 區域（大選單 2500×1686 全幅一格） */
const VALID_AREA = {
  bounds: { x: 0, y: 0, width: 2500, height: 1686 },
  action: { type: 'postback', data: 'menu=main' },
};
const VALID_SIZE = { width: 2500, height: 1686 };
const VALID_IMAGE = 'https://example.com/richmenu.png';

/** 建 Rich Menu payload 的工廠（只覆寫要測的欄位） */
const richMenuPayload = (over: Record<string, unknown> = {}) => ({
  channelId: LINE_CHANNEL_ID,
  name: nameOf('RichMenu'),
  chatBarText: '菜單',
  size: VALID_SIZE,
  areas: [VALID_AREA],
  imageUrl: VALID_IMAGE,
  ...over,
});

/** 建關鍵字回覆（automation rule）payload 的工廠 */
const keywordReplyPayload = (over: Record<string, unknown> = {}) => ({
  name: nameOf('關鍵字'),
  trigger: { type: 'keyword.matched', keywords: ['測試關鍵字'], match_mode: 'any' },
  conditions: { all: [] },
  actions: [{ type: 'send_material', params: { materialId: LINE_MATERIAL_ID } }],
  ...over,
});

test.describe('@fields 行銷 + LINE 素材 欄位級驗證', () => {
  let api: APIRequestContext;
  /** 測試過程建立的資料，afterAll 統一清理 */
  const trash = {
    campaigns: [] as string[],
    segments: [] as string[],
    broadcasts: [] as string[],
    richMenus: [] as string[],
    presets: [] as string[],
    rules: [] as string[],
  };

  test.beforeAll(async () => {
    api = await newApiContext();
  });

  test.afterAll(async () => {
    // ⚠️ 清理限制（讀碼確認，非測試疏漏）：
    //  - 活動：deleteCampaign 只允許 status==='draft'，一旦轉 cancelled/active 就**永久無法刪除**。
    //    本檔建立的活動全程停在 draft，故可完整清掉。
    //  - 廣播：無 DELETE 端點，只能 cancel（draft/scheduled → cancelled）。cancelled 記錄會永久留存。
    //    故廣播的 [E2E] 資料必然殘留，這是系統設計，不是清理失敗。
    //  - 關鍵字回覆（automation rule）：DELETE 是軟刪（isActive=false）且列表未過濾（CM-170），
    //    刪除後仍會列在 GET /automation/rules 中。
    // 先刪活動（還是 draft）再處理廣播，順序不可顛倒。
    for (const id of trash.campaigns) await api.delete(`marketing/campaigns/${id}`).catch(() => {});
    for (const id of trash.broadcasts) await api.post(`marketing/broadcasts/${id}/cancel`).catch(() => {});
    for (const id of trash.segments) await api.delete(`marketing/segments/${id}`).catch(() => {});
    for (const id of trash.richMenus) await api.delete(`line/rich-menus/${id}`).catch(() => {});
    for (const id of trash.presets) await api.delete(`line/quick-reply-presets/${id}`).catch(() => {});
    for (const id of trash.rules) await api.delete(`automation/rules/${id}`).catch(() => {});
    await api.dispose();
  });

  /** 送 POST 並記錄建立的 id 以便清理 */
  async function createAndTrack(
    path: string,
    payload: Record<string, unknown>,
    bucket: keyof typeof trash,
  ): Promise<{ status: number; id: string | null; body: any }> {
    const res = await api.post(path, { data: payload });
    const body = await res.json().catch(() => null);
    const id = body?.data?.id ?? null;
    if (id) trash[bucket].push(id);
    return { status: res.status(), id, body };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1. 欄位盤點（覆蓋率證據）
  // ═══════════════════════════════════════════════════════════════════

  test('1. 欄位盤點：行銷三個 tab + LINE 三頁', async ({ page }) => {
    const report: string[] = [];

    // ── 行銷：活動 ──
    await gotoAndCheck(page, '/dashboard/marketing/campaigns');
    await expect(page.getByRole('heading', { name: '行銷活動' })).toBeVisible();
    await page.getByRole('button', { name: '新增活動' }).click();
    const campaignDialog = page.getByRole('dialog');
    await expect(campaignDialog.getByText('新增行銷活動')).toBeVisible();
    report.push(formatFieldInventory(await inventoryFields(page, 'dialog'), '行銷活動 建立表單'));
    await campaignDialog.getByRole('button', { name: '取消' }).click();

    // ── 行銷：廣播 ──
    await gotoAndCheck(page, '/dashboard/marketing/broadcasts');
    await expect(page.getByRole('heading', { name: '廣播歷史' })).toBeVisible();
    await page.getByRole('button', { name: '建立廣播' }).click();
    const bcDialog = page.getByRole('dialog');
    await expect(bcDialog.getByText('建立廣播', { exact: true })).toBeVisible();
    report.push(formatFieldInventory(await inventoryFields(page, 'dialog'), '廣播 建立表單'));
    await bcDialog.getByRole('button', { name: '取消', exact: true }).click();

    // ── 行銷：分群（含條件建構器）──
    await gotoAndCheck(page, '/dashboard/marketing/segments');
    await expect(page.getByRole('heading', { name: '受眾分群' })).toBeVisible();
    await page.getByRole('button', { name: '新增分群' }).click();
    const segDialog = page.getByRole('dialog');
    await expect(segDialog.getByText('新增受眾分群')).toBeVisible();
    // 多加一條條件，讓盤點涵蓋動態列
    await segDialog.getByRole('button', { name: '新增條件' }).click();
    report.push(formatFieldInventory(await inventoryFields(page, 'dialog'), '受眾分群 建立表單（2 條條件）'));
    await segDialog.getByRole('button', { name: '取消', exact: true }).click();

    // ── LINE：Quick Reply 預設組 ──
    await gotoAndCheck(page, '/dashboard/line/quick-replies');
    await page.getByRole('button', { name: '建立預設組' }).click();
    await expect(page.getByText('建立 Quick Reply 預設組')).toBeVisible();
    report.push(formatFieldInventory(await inventoryFields(page), 'Quick Reply 預設組 編輯'));
    await page.getByRole('button', { name: '取消' }).click();

    // ── LINE：關鍵字回覆 ──
    await gotoAndCheck(page, '/dashboard/line/keyword-replies');
    await page.getByRole('button', { name: '建立關鍵字回覆' }).click();
    await expect(page.getByText('建立關鍵字回覆', { exact: true }).last()).toBeVisible();
    report.push(formatFieldInventory(await inventoryFields(page), '關鍵字回覆 編輯'));
    await page.getByRole('button', { name: '取消' }).click();

    // ── LINE：Rich Menu（選版型後進編輯器）──
    await gotoAndCheck(page, `/dashboard/line/rich-menus/new?channelId=${LINE_CHANNEL_ID}`);
    await expect(page.getByRole('heading', { name: '選擇版型' })).toBeVisible();
    await page.getByText('2 × 2（四等分）').first().click();
    await expect(page.getByText('基本資訊')).toBeVisible();
    report.push(formatFieldInventory(await inventoryFields(page), 'Rich Menu 編輯器（2×2 版型，區域1 展開）'));

    console.log(report.join('\n'));
    // 盤點本身不斷言數量（UI 會演進），只確保每頁都掃到欄位
    for (const r of report) {
      expect(r, '某頁盤點結果為空—頁面可能沒載入').not.toContain('（0 個）');
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. 行銷活動（Campaign）欄位
  // ═══════════════════════════════════════════════════════════════════

  test('2. 活動-名稱：必填留空時建立鈕 disabled（前端擋控）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/marketing/campaigns');
    await page.getByRole('button', { name: '新增活動' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('button', { name: '建立', exact: true }),
      '名稱留空時建立按鈕應 disabled',
    ).toBeDisabled();
    await dialog.getByRole('button', { name: '取消' }).click();
  });

  // 【已知 bug CM-W6-05】name 的 z.string().min(1) 不 trim，純空白/全形空白可建出無名活動
  test('2b. 活動-名稱：純空白 / 全形空白應被擋【已知 bug CM-W6-05】', async ({ page }) => {
    test.fail(); // 預期失敗：記錄已知 bug；修復後會變 unexpected pass，提醒移除此標記
    await gotoAndCheck(page, '/dashboard/marketing/campaigns');
    const openDialog = async () => {
      await page.getByRole('button', { name: '新增活動' }).click();
      return page.getByRole('dialog');
    };
    const urlRe = /\/marketing\/campaigns$/;

    // 純空白：前端 `!formData.name` 判定為「有值」→ 按鈕可點，後端 min(1) 不 trim 也放行
    let dialog = await openDialog();
    await dialog.getByPlaceholder('活動名稱').fill(FieldSamples.whitespace);
    const whitespaceResult = await submitAndObserve(
      page,
      () => dialog.getByRole('button', { name: '建立', exact: true }).click(),
      urlRe,
    );
    if (whitespaceResult.status === 201) {
      trash.campaigns.push((whitespaceResult.body as any)?.data?.id);
    }

    // 全形空白：同上
    dialog = page.getByRole('dialog');
    if (!(await dialog.isVisible().catch(() => false))) dialog = await openDialog();
    await dialog.getByPlaceholder('活動名稱').fill(FieldSamples.fullwidthSpace);
    const fullwidthResult = await submitAndObserve(
      page,
      () => dialog.getByRole('button', { name: '建立', exact: true }).click(),
      urlRe,
    );
    if (fullwidthResult.status === 201) {
      trash.campaigns.push((fullwidthResult.body as any)?.data?.id);
    }

    expectRejected(whitespaceResult, '活動名稱=純空白（trim 後為空，應視為未填）');
    expectRejected(fullwidthResult, '活動名稱=全形空白');
  });

  test('3. 活動-名稱/描述：max 三點邊界（後端直測）', async () => {
    const nameB = boundarySamples(200);
    const descB = boundarySamples(500);

    const under = await createAndTrack('marketing/campaigns', { name: `${E2E_PREFIX}${nameB.under}` .slice(0, 200) }, 'campaigns');
    expect(under.status, 'name 199 字應被接受').toBe(201);

    const exact = await createAndTrack('marketing/campaigns', { name: strOfLength(200) }, 'campaigns');
    expect(exact.status, 'name 剛好 200 字應被接受').toBe(201);

    await apiFieldCheck(api, {
      path: 'marketing/campaigns',
      payload: { name: nameB.over },
      expect: 'reject',
      context: '活動 name 201 字（超過 max(200)）',
    });

    const descOk = await createAndTrack(
      'marketing/campaigns',
      { name: nameOf('描述邊界'), description: descB.exact },
      'campaigns',
    );
    expect(descOk.status, 'description 剛好 500 字應被接受').toBe(201);

    await apiFieldCheck(api, {
      path: 'marketing/campaigns',
      payload: { name: nameOf('描述超長'), description: descB.over },
      expect: 'reject',
      context: '活動 description 501 字（超過 max(500)）',
    });
  });

  // 【已知 bug CM-W6-01】前後端皆無 endDate > startDate 跨欄位驗證
  test('4. 活動-日期：結束早於開始應被擋【已知 bug CM-W6-01】', async ({ page }) => {
    test.fail(); // 預期失敗：記錄已知 bug；修復後會變 unexpected pass，提醒移除此標記
    await gotoAndCheck(page, '/dashboard/marketing/campaigns');
    await page.getByRole('button', { name: '新增活動' }).click();
    const dialog = page.getByRole('dialog');

    await dialog.getByPlaceholder('活動名稱').fill(nameOf('反向日期'));
    const dateInputs = dialog.locator('input[type="date"]');
    await dateInputs.nth(0).fill('2026-12-31'); // 開始
    await dateInputs.nth(1).fill('2026-01-01'); // 結束（早於開始）

    const result = await submitAndObserve(
      page,
      () => dialog.getByRole('button', { name: '建立', exact: true }).click(),
      /\/marketing\/campaigns$/,
    );
    if (result.status === 201) trash.campaigns.push((result.body as any)?.data?.id);

    // 預期行為：應被擋下。實際：201 建立成功（前後端皆無跨欄位驗證）
    expectRejected(result, '活動結束日期早於開始日期');
  });

  test('5. 活動-日期：非法日期字串不應 500', async () => {
    // startDate 是 z.string() 無格式驗證 → new Date('garbage') = Invalid Date → Prisma 報錯
    // 驗證全域 error handler 有把它轉成 4xx，而非裸奔 500
    await apiFieldCheck(api, {
      path: 'marketing/campaigns',
      payload: { name: nameOf('垃圾日期'), startDate: 'not-a-date' },
      expect: 'reject',
      context: '活動 startDate=垃圾字串（應 4xx 不應 5xx）',
    });
  });

  test('6. 活動-狀態：非法 enum 應被擋（後端直測）', async () => {
    const created = await createAndTrack('marketing/campaigns', { name: nameOf('狀態測試') }, 'campaigns');
    expect(created.status).toBe(201);

    await apiFieldCheck(api, {
      path: `marketing/campaigns/${created.id}`,
      method: 'patch',
      payload: { status: 'bogus_status' },
      expect: 'reject',
      context: '活動 status 非法 enum',
    });

    // 狀態機：draft → completed 為非法轉換，應 400
    await apiFieldCheck(api, {
      path: `marketing/campaigns/${created.id}`,
      method: 'patch',
      payload: { status: 'completed' },
      expect: 'reject',
      context: '活動狀態機 draft → completed（非法轉換）',
    });
  });

  test('7. 活動-名稱：XSS / HTML / SQL 樣本存入後為純文字', async ({ page }) => {
    const xssName = `${E2E_PREFIX} ${FieldSamples.xss} ${runId}`;
    const created = await createAndTrack('marketing/campaigns', { name: xssName }, 'campaigns');
    expect(created.status, 'XSS 字串應可存入（當純文字）').toBe(201);

    // SQL 注入樣本：Prisma 參數化，應正常存入不報錯
    const sqlCreated = await createAndTrack(
      'marketing/campaigns',
      { name: `${E2E_PREFIX} ${FieldSamples.sqlish} ${runId}` },
      'campaigns',
    );
    expect(sqlCreated.status, 'SQL 樣式字串應被當一般文字存入').toBe(201);

    // 列表頁渲染後，script 不應被執行
    await gotoAndCheck(page, '/dashboard/marketing/campaigns');
    await expect(page.getByText(xssName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expectNoXssExecuted(page);

    // HTML 標籤不應被解析成元素
    const htmlName = `${E2E_PREFIX} ${FieldSamples.html} ${runId}`;
    const htmlCreated = await createAndTrack('marketing/campaigns', { name: htmlName }, 'campaigns');
    expect(htmlCreated.status).toBe(201);
    await page.reload({ waitUntil: 'networkidle' });
    const boldCount = await page
      .locator('b', { hasText: '粗體' })
      .count();
    expect(boldCount, 'HTML 標籤被解析成真的 <b> 元素—存在 HTML 注入').toBe(0);
  });

  test('8. 活動-名稱：padded / emoji / newline 往返', async () => {
    // padded：後端無 trim（min(1) 不 trim），存什麼應讀回什麼
    const padded = `${E2E_PREFIX}${FieldSamples.padded}${runId}`;
    const p = await createAndTrack('marketing/campaigns', { name: padded }, 'campaigns');
    expect(p.status).toBe(201);
    const pRead = await (await api.get(`marketing/campaigns/${p.id}`)).json();
    expect(pRead?.data?.name, '前後空白的名稱往返後不一致').toBe(padded);

    // emoji（含 ZWJ 組合字）
    const emojiName = `${E2E_PREFIX} ${FieldSamples.emoji} ${runId}`;
    const e = await createAndTrack('marketing/campaigns', { name: emojiName }, 'campaigns');
    expect(e.status).toBe(201);
    const eRead = await (await api.get(`marketing/campaigns/${e.id}`)).json();
    expect(eRead?.data?.name, 'emoji 往返後不一致（編碼或截斷問題）').toBe(emojiName);

    // newline：單行欄位存入換行
    const nlName = `${E2E_PREFIX} ${FieldSamples.newline} ${runId}`;
    const n = await createAndTrack('marketing/campaigns', { name: nlName }, 'campaigns');
    expect(n.status).toBe(201);
    const nRead = await (await api.get(`marketing/campaigns/${n.id}`)).json();
    expect(nRead?.data?.name, '換行字元往返後不一致').toBe(nlName);
  });

  test.skip('9. 活動-預算欄位：系統不存在此欄位（skip）', async () => {
    // 任務描述提到「預算數字欄位」，但讀碼確認：
    //   後端 createCampaignSchema 只有 name/description/startDate/endDate
    //   前端 CampaignTab 也只渲染這 4 個欄位
    // Campaign model 無 budget 欄位 → 無可測對象，標記 skip
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. 受眾分群（Segment）欄位
  // ═══════════════════════════════════════════════════════════════════

  test('10. 分群-名稱/描述：必填與長度邊界', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/marketing/segments');
    await page.getByRole('button', { name: '新增分群' }).click();
    const dialog = page.getByRole('dialog');

    // 必填：留空時建立按鈕 disabled
    await expect(
      dialog.getByRole('button', { name: '建立', exact: true }),
      '分群名稱留空時建立按鈕應 disabled',
    ).toBeDisabled();

    await dialog.getByRole('button', { name: '取消', exact: true }).click();

    // 後端長度邊界
    const nb = boundarySamples(200);
    const ok = await createAndTrack(
      'marketing/segments',
      { name: strOfLength(200), rules: { conditions: [], logic: 'AND' } },
      'segments',
    );
    expect(ok.status, '分群 name 剛好 200 字應被接受').toBe(201);

    await apiFieldCheck(api, {
      path: 'marketing/segments',
      payload: { name: nb.over, rules: { conditions: [], logic: 'AND' } },
      expect: 'reject',
      context: '分群 name 201 字',
    });

    await apiFieldCheck(api, {
      path: 'marketing/segments',
      payload: {
        name: nameOf('描述超長'),
        description: boundarySamples(500).over,
        rules: { conditions: [], logic: 'AND' },
      },
      expect: 'reject',
      context: '分群 description 501 字',
    });
  });

  test('10b. 分群-名稱：純空白應被擋【已知 bug CM-W6-05】', async ({ page }) => {
    test.fail(); // 預期失敗：記錄已知 bug；修復後會變 unexpected pass，提醒移除此標記
    // 與活動名稱同一個根因：z.string().min(1) 不 trim
    await gotoAndCheck(page, '/dashboard/marketing/segments');
    await page.getByRole('button', { name: '新增分群' }).click();
    const dialog = page.getByRole('dialog');

    await dialog.getByPlaceholder('分群名稱').fill(FieldSamples.whitespace);
    const r = await submitAndObserve(
      page,
      () => dialog.getByRole('button', { name: '建立', exact: true }).click(),
      /\/marketing\/segments$/,
    );
    if (r.status === 201) trash.segments.push((r.body as any)?.data?.id);
    expectRejected(r, '分群名稱=純空白');
  });

  test('11. 分群-條件建構器：AND/OR + 各 field 的 value 欄位（UI）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/marketing/segments');
    await page.getByRole('button', { name: '新增分群' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('分群名稱').fill(nameOf('條件建構器'));

    // 條件邏輯 select（AND/OR）
    const logicSelect = dialog.locator('select').first();
    await logicSelect.selectOption('OR');
    expect(await logicSelect.inputValue()).toBe('OR');
    await logicSelect.selectOption('AND');

    // 第一條條件：預設 field=channelType → value 是 select（含 WEBCHAT，與素材 channelType 無關）
    const fieldSelect = dialog.locator('select').nth(1);
    expect(await fieldSelect.inputValue(), '第一條條件預設應為 channelType').toBe('channelType');
    const valueSelect = dialog.locator('select').nth(2);
    await valueSelect.selectOption('WEBCHAT');
    expect(await valueSelect.inputValue()).toBe('WEBCHAT');

    // 切換 field=tag → value 變成標籤 select，且 value 被清空
    // （驗證 onChange 連續兩次 updateCondition 是否互相覆蓋）
    await fieldSelect.selectOption('tag');
    expect(await fieldSelect.inputValue(), 'field 切換後未生效—兩次 updateCondition 互相覆蓋').toBe('tag');
    const tagSelect = dialog.locator('select').nth(2);
    expect(await tagSelect.inputValue(), '切換 field 後 value 應被清空').toBe('');
    // 選一個既有標籤
    await tagSelect.selectOption({ index: 1 });

    // 切換 field=createdAfter → value 變成 date input
    await fieldSelect.selectOption('createdAfter');
    expect(await fieldSelect.inputValue()).toBe('createdAfter');
    await expect(
      dialog.locator('input[type="date"]'),
      'field=createdAfter 時 value 應為 date input',
    ).toHaveCount(1);
    await dialog.locator('input[type="date"]').fill('2020-01-01');

    // 新增第二條條件
    await dialog.getByRole('button', { name: '新增條件' }).click();
    const rows = dialog.locator('select');
    // logic(1) + 第一條 field(1) + 第二條 field/value(2) = 至少 4 個 select
    expect(await rows.count(), '新增條件後 select 數量應增加').toBeGreaterThanOrEqual(4);

    // 預覽人數（唯讀查詢，安全）
    const previewResult = await submitAndObserve(
      page,
      () => dialog.getByRole('button', { name: '預覽人數' }).click(),
      /\/marketing\/segments\/preview$/,
    );
    expectAccepted(previewResult, '分群預覽人數');
    await expect(dialog.getByText('符合人數：')).toBeVisible();

    // 建立
    const created = await submitAndObserve(
      page,
      () => dialog.getByRole('button', { name: '建立', exact: true }).click(),
      /\/marketing\/segments$/,
    );
    expectAccepted(created, '分群建立（合法條件）');
    if ((created.body as any)?.data?.id) trash.segments.push((created.body as any).data.id);
  });

  test('12. 分群-條件：非法 field / logic enum 應被擋（後端直測）', async () => {
    await apiFieldCheck(api, {
      path: 'marketing/segments/preview',
      payload: { conditions: [{ field: 'bogusField', operator: 'eq', value: 'x' }], logic: 'AND' },
      expect: 'reject',
      context: '分群條件 field 非法 enum',
    });

    await apiFieldCheck(api, {
      path: 'marketing/segments/preview',
      payload: { conditions: [], logic: 'XOR' },
      expect: 'reject',
      context: '分群 logic 非法 enum',
    });

    // conditions[].value 是 z.unknown() 完全不驗證：
    // tag 條件餵非 UUID 會一路送到 Prisma。驗證有被轉成 4xx 而非 500
    await apiFieldCheck(api, {
      path: 'marketing/segments/preview',
      payload: { conditions: [{ field: 'tag', operator: 'eq', value: 'not-a-uuid' }], logic: 'AND' },
      expect: 'reject',
      context: '分群 tag 條件 value 非 UUID（應 4xx 不應 5xx）',
    });

    await apiFieldCheck(api, {
      path: 'marketing/segments/preview',
      payload: { conditions: [{ field: 'createdAfter', operator: 'eq', value: 'garbage' }], logic: 'AND' },
      expect: 'reject',
      context: '分群 createdAfter 條件 value 為垃圾日期（應 4xx 不應 5xx）',
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. 廣播（Broadcast）欄位
  // ═══════════════════════════════════════════════════════════════════

  test('13. 廣播-必填：名稱/渠道/素材缺一則建立鈕 disabled', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/marketing/broadcasts');
    await page.getByRole('button', { name: '建立廣播' }).click();
    const dialog = page.getByRole('dialog');
    const createBtn = dialog.getByRole('button', { name: '建立', exact: true });

    await expect(createBtn, '全空時建立鈕應 disabled').toBeDisabled();

    // 只填名稱 → 仍 disabled
    await dialog.getByPlaceholder('廣播名稱').fill(nameOf('必填測試'));
    await expect(createBtn, '缺渠道與素材時建立鈕應 disabled').toBeDisabled();

    // 選渠道（FB）→ 素材 select 解除 disabled，但仍缺素材
    const channelSelect = dialog.locator('select').first();
    await channelSelect.selectOption(FB_CHANNEL_ID);
    await expect(createBtn, '缺素材時建立鈕應 disabled').toBeDisabled();

    // 素材 select 在未選渠道前應 disabled（此時已選渠道，應可用）
    const materialSelect = dialog.locator('select').nth(1);
    await expect(materialSelect, '已選渠道後素材下拉應可用').toBeEnabled();

    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  });

  // 【已知 bug CM-W6-02】scheduledAt 無「須為未來」驗證
  test('14. 廣播-建立草稿 + 排程時間（過去時間應被擋）【已知 bug CM-W6-02】', async ({ page }) => {
    test.fail(); // 預期失敗：記錄已知 bug；修復後會變 unexpected pass，提醒移除此標記
    await gotoAndCheck(page, '/dashboard/marketing/broadcasts');
    await page.getByRole('button', { name: '建立廣播' }).click();
    const dialog = page.getByRole('dialog');

    await dialog.getByPlaceholder('廣播名稱').fill(nameOf('過去排程'));
    await dialog.locator('select').first().selectOption(FB_CHANNEL_ID);
    await dialog.locator('select').nth(1).selectOption(FB_MATERIAL_ID);
    // 排程到過去（2020 年）
    await dialog.locator('input[type="datetime-local"]').fill('2020-01-01T00:00');

    const result = await submitAndObserve(
      page,
      () => dialog.getByRole('button', { name: '建立', exact: true }).click(),
      /\/marketing\/broadcasts$/,
    );
    if ((result.body as any)?.data?.id) trash.broadcasts.push((result.body as any).data.id);

    // 預期：排程到過去應被擋。實際：201 且 status=scheduled（無未來性檢查）
    expectRejected(result, '廣播排程時間=過去時間（2020-01-01）');
  });

  test('15. 廣播-建立草稿：合法值應被接受（安全路徑，只建草稿不發送）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/marketing/broadcasts');
    await page.getByRole('button', { name: '建立廣播' }).click();
    const dialog = page.getByRole('dialog');

    const bcName = nameOf('草稿');
    await dialog.getByPlaceholder('廣播名稱').fill(bcName);
    await dialog.locator('select').first().selectOption(FB_CHANNEL_ID);
    await dialog.locator('select').nth(1).selectOption(FB_MATERIAL_ID);
    // 不填排程時間 → status=draft

    const result = await submitAndObserve(
      page,
      () => dialog.getByRole('button', { name: '建立', exact: true }).click(),
      /\/marketing\/broadcasts$/,
    );
    expectAccepted(result, '廣播建立（合法值，草稿）');
    const id = (result.body as any)?.data?.id;
    expect(id, '建立回應應含 id').toBeTruthy();
    trash.broadcasts.push(id);
    expect((result.body as any)?.data?.status, '未填排程時間應為 draft').toBe('draft');

    // 無 toast，用列表出現斷言
    await expect(page.getByText(bcName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('16. 廣播-「立即發送」：確認框出現即取消（絕不確認送出）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/marketing/broadcasts');

    // 找測試 15 建立的草稿列（只有 draft/scheduled 才有操作按鈕）
    const row = page.getByRole('row').filter({ hasText: nameOf('草稿') }).first();
    await expect(row, '找不到測試 15 建立的草稿廣播列').toBeVisible({ timeout: 15_000 });

    // ⚠️ 紅線：dismissNextDialog（取消），絕不 accept
    const dialogPromise = dismissNextDialog(page);
    let sendCalled = false;
    page.on('request', (req) => {
      if (/\/marketing\/broadcasts\/[^/]+\/send$/.test(req.url())) sendCalled = true;
    });

    await row.getByTitle('立即發送').click();
    const msg = await dialogPromise;
    expect(msg, 'confirm 訊息不符預期').toContain('確定要立即發送嗎');

    // 取消後絕不可打出 send 端點
    await page.waitForTimeout(1500);
    expect(sendCalled, '⚠️ 取消確認框後仍呼叫了 send 端點—會真的發訊息給用戶！').toBe(false);
  });

  test('17. 廣播-欄位格式：uuid / enum / materialId-templateId 互斥（後端直測）', async () => {
    const base = {
      name: nameOf('API'),
      channelId: FB_CHANNEL_ID,
      materialId: FB_MATERIAL_ID,
      targetType: 'all',
    };

    // channelId 非 UUID
    await apiFieldCheck(api, {
      path: 'marketing/broadcasts',
      payload: { ...base, channelId: FieldSamples.badUuid },
      expect: 'reject',
      context: '廣播 channelId 非法 UUID',
    });

    // targetType 非法 enum
    await apiFieldCheck(api, {
      path: 'marketing/broadcasts',
      payload: { ...base, targetType: 'bogus' },
      expect: 'reject',
      context: '廣播 targetType 非法 enum',
    });

    // materialId 與 templateId 同時給 → refine 應擋
    await apiFieldCheck(api, {
      path: 'marketing/broadcasts',
      payload: { ...base, templateId: randomUUID() },
      expect: 'reject',
      context: '廣播同時給 materialId 與 templateId（refine 互斥）',
    });

    // 兩者都不給 → refine 應擋
    const { materialId, ...noSource } = base;
    await apiFieldCheck(api, {
      path: 'marketing/broadcasts',
      payload: noSource,
      expect: 'reject',
      context: '廣播 materialId/templateId 都不給',
    });

    // name 201 字
    await apiFieldCheck(api, {
      path: 'marketing/broadcasts',
      payload: { ...base, name: boundarySamples(200).over },
      expect: 'reject',
      context: '廣播 name 201 字',
    });

    // 不存在的 channelId（合法 UUID 但非本租戶）→ 404
    await apiFieldCheck(api, {
      path: 'marketing/broadcasts',
      payload: { ...base, channelId: randomUUID() },
      expect: 'reject',
      context: '廣播 channelId 為不存在的 UUID（租戶隔離）',
    });

    // 不存在的 materialId → 404
    await apiFieldCheck(api, {
      path: 'marketing/broadcasts',
      payload: { ...base, materialId: randomUUID() },
      expect: 'reject',
      context: '廣播 materialId 為不存在的 UUID',
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. LINE Quick Reply 預設組欄位
  // ═══════════════════════════════════════════════════════════════════

  test('18. QuickReply-組名 + 按鈕上限 13（UI 前端擋控）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/line/quick-replies');
    await page.getByRole('button', { name: '建立預設組' }).click();

    // 組名 maxLength：前端用 slice(0,100)，非 HTML maxLength
    const nameInput = page.getByPlaceholder('例：滿意度調查、預約時段、是否同意條款');
    await nameInput.fill(strOfLength(150));
    expect(
      (await nameInput.inputValue()).length,
      '組名前端應截到 100 字（slice(0,100)）',
    ).toBe(100);
    await nameInput.fill(nameOf('QR'));

    // 按鈕 label maxLength=20（slice）
    const labelInput = page.getByPlaceholder('例：同意');
    await labelInput.fill(strOfLength(30));
    expect(
      (await labelInput.inputValue()).length,
      '按鈕 label 前端應截到 20 字（對齊 LINE 官方上限）',
    ).toBe(20);

    // 加到 13 顆，驗證第 14 顆加不進去（新增列會消失）
    const addBtn = page.getByRole('button', { name: '加入' });
    for (let i = 0; i < 13; i++) {
      await labelInput.fill(`按鈕${i}`);
      await addBtn.click();
    }
    await expect(page.getByText('13/13')).toBeVisible();
    // 達上限後整個「新增按鈕」列不再渲染
    await expect(
      page.getByPlaceholder('例：同意'),
      '達 13 顆上限後新增列應消失（LINE 官方每則訊息上限 13）',
    ).toHaveCount(0);

    // 儲存（13 顆合法）
    const result = await submitAndObserve(
      page,
      () => page.getByRole('button', { name: '儲存' }).click(),
      /\/line\/quick-reply-presets$/,
    );
    expectAccepted(result, 'QuickReply 預設組 13 顆按鈕');
    if ((result.body as any)?.data?.id) trash.presets.push((result.body as any).data.id);
  });

  test('19. QuickReply-後端邊界：name / items / label / text', async () => {
    // items 14 顆（超過 max(13)）
    await apiFieldCheck(api, {
      path: 'line/quick-reply-presets',
      payload: {
        name: nameOf('QR14'),
        items: Array.from({ length: 14 }, (_, i) => ({ label: `b${i}` })),
      },
      expect: 'reject',
      context: 'QuickReply items 14 顆（超過 LINE 上限 13）',
    });

    // items 13 顆（剛好上限）應接受
    const ok = await createAndTrack(
      'line/quick-reply-presets',
      { name: nameOf('QR13'), items: Array.from({ length: 13 }, (_, i) => ({ label: `b${i}` })) },
      'presets',
    );
    expect(ok.status, 'items 剛好 13 顆應被接受').toBe(201);

    // items 0 顆
    await apiFieldCheck(api, {
      path: 'line/quick-reply-presets',
      payload: { name: nameOf('QR0'), items: [] },
      expect: 'reject',
      context: 'QuickReply items 0 顆（min(1)）',
    });

    // label 21 字（超過 LINE 上限 20）
    await apiFieldCheck(api, {
      path: 'line/quick-reply-presets',
      payload: { name: nameOf('QRlabel'), items: [{ label: strOfLength(21) }] },
      expect: 'reject',
      context: 'QuickReply label 21 字（超過 LINE 上限 20）',
    });

    // label 剛好 20 字應接受
    const label20 = await createAndTrack(
      'line/quick-reply-presets',
      { name: nameOf('QRlabel20'), items: [{ label: strOfLength(20) }] },
      'presets',
    );
    expect(label20.status, 'label 剛好 20 字應被接受').toBe(201);

    // text 301 字
    await apiFieldCheck(api, {
      path: 'line/quick-reply-presets',
      payload: { name: nameOf('QRtext'), items: [{ label: 'ok', text: strOfLength(301) }] },
      expect: 'reject',
      context: 'QuickReply text 301 字（超過 max(300)）',
    });

    // name 101 字
    await apiFieldCheck(api, {
      path: 'line/quick-reply-presets',
      payload: { name: strOfLength(101), items: [{ label: 'ok' }] },
      expect: 'reject',
      context: 'QuickReply name 101 字',
    });

    // name 純空白 → service 層有 trim 檢查
    await apiFieldCheck(api, {
      path: 'line/quick-reply-presets',
      payload: { name: FieldSamples.whitespace, items: [{ label: 'ok' }] },
      expect: 'reject',
      context: 'QuickReply name 純空白（service 應 trim 後擋）',
    });
  });

  test('20. QuickReply-往返：emoji label 存讀一致', async () => {
    const items = [{ label: FieldSamples.emoji.slice(0, 10), text: '送出文字' }];
    const created = await createAndTrack(
      'line/quick-reply-presets',
      { name: nameOf('QRemoji'), items },
      'presets',
    );
    expect(created.status).toBe(201);

    const list = await (await api.get('line/quick-reply-presets')).json();
    const found = (list.data ?? []).find((p: any) => p.id === created.id);
    expect(found?.items?.[0]?.label, 'emoji label 往返後不一致').toBe(items[0].label);
    expect(found?.items?.[0]?.text, 'text 往返後不一致').toBe(items[0].text);
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. LINE Rich Menu 欄位
  // ═══════════════════════════════════════════════════════════════════

  test('21. RichMenu-chatBarText：14 字邊界（UI 前端擋控 + 計數器）', async ({ page }) => {
    await gotoAndCheck(page, `/dashboard/line/rich-menus/new?channelId=${LINE_CHANNEL_ID}`);
    await page.getByText('2 × 2（四等分）').first().click();
    await expect(page.getByText('基本資訊')).toBeVisible();

    // chatBarText 有 HTML maxLength=14
    const chatBar = page.locator('input[maxlength="14"]').first();
    await chatBar.fill(strOfLength(20));
    expect(
      (await chatBar.inputValue()).length,
      'chatBarText 前端 maxLength 應為 14（對齊 LINE 官方上限）',
    ).toBe(14);
    await expect(page.getByText('14 / 14'), '字數計數器應顯示 14 / 14').toBeVisible();

    // 名稱 maxLength=200
    const nameInput = page.getByPlaceholder('如：主選單 v1');
    await nameInput.fill(strOfLength(250));
    expect((await nameInput.inputValue()).length, '名稱前端 maxLength 應為 200').toBe(200);

    // 前端必填擋控：清空 chatBarText 後儲存應顯示錯誤且不發 API
    await chatBar.fill('');
    await nameInput.fill(nameOf('RM'));
    const result = await submitAndObserve(
      page,
      () => page.getByRole('button', { name: '儲存草稿' }).click(),
      /\/line\/rich-menus$/,
      'POST',
      3000,
    );
    expect(result.requested, 'chatBarText 留空時不應發出建立請求').toBe(false);
    // 缺背景圖也會被擋，錯誤訊息二選一
    await expect(
      page.getByText(/請輸入底部按鈕文字|請上傳背景圖/),
    ).toBeVisible();
  });

  test('22. RichMenu-後端邊界：chatBarText / name / areas / imageUrl', async () => {
    // chatBarText 15 字
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: richMenuPayload({ chatBarText: strOfLength(15) }),
      expect: 'reject',
      context: 'RichMenu chatBarText 15 字（超過 LINE 上限 14）',
    });

    // chatBarText 剛好 14 字應接受
    const cb14 = await createAndTrack(
      'line/rich-menus',
      richMenuPayload({ chatBarText: strOfLength(14), name: nameOf('RM-cb14') }),
      'richMenus',
    );
    expect(cb14.status, 'chatBarText 剛好 14 字應被接受').toBe(201);

    // imageUrl 非 URL
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: richMenuPayload({ imageUrl: 'notaurl' }),
      expect: 'reject',
      context: 'RichMenu imageUrl 非合法 URL',
    });

    // areas 0 個
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: richMenuPayload({ areas: [] }),
      expect: 'reject',
      context: 'RichMenu areas 0 個（min(1)）',
    });

    // areas 21 個（超過 max(20)）
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: richMenuPayload({
        areas: Array.from({ length: 21 }, () => VALID_AREA),
      }),
      expect: 'reject',
      context: 'RichMenu areas 21 個（超過 LINE 上限 20）',
    });

    // bounds 超出圖片尺寸（service 層 validateAreas）
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: richMenuPayload({
        areas: [{ bounds: { x: 0, y: 0, width: 9999, height: 9999 }, action: { type: 'postback', data: 'x' } }],
      }),
      expect: 'reject',
      context: 'RichMenu 區域 bounds 超出圖片尺寸',
    });

    // name 201 字
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: richMenuPayload({ name: boundarySamples(200).over }),
      expect: 'reject',
      context: 'RichMenu name 201 字',
    });

    // 不存在的 channelId（租戶隔離）
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: richMenuPayload({ channelId: randomUUID() }),
      expect: 'reject',
      context: 'RichMenu channelId 為不存在的 UUID（租戶隔離）',
    });
  });

  test('22b. RichMenu-chatBarText：純空白應被擋【已知 bug CM-W6-05】', async () => {
    test.fail(); // 預期失敗：記錄已知 bug；修復後會變 unexpected pass，提醒移除此標記
    // chatBarText 是「使用者在 LINE 上真的看得到」的按鈕文字，
    // 純空白會在 LINE 選單列顯示成一塊空白按鈕。
    // service 層 validateChatBarText 只檢查 length===0，不 trim。
    const cbBlank = await createAndTrack(
      'line/rich-menus',
      richMenuPayload({ chatBarText: FieldSamples.whitespace, name: nameOf('RM-blank') }),
      'richMenus',
    );
    expect(
      cbBlank.status,
      `RichMenu chatBarText=純空白應被擋，實際 ${cbBlank.status}（LINE 上會顯示空白按鈕）`,
    ).toBeGreaterThanOrEqual(400);
  });

  test('23. RichMenu-各 action 型別的必填參數（後端直測）', async () => {
    const withAction = (action: Record<string, unknown>) =>
      richMenuPayload({ areas: [{ bounds: VALID_AREA.bounds, action }], name: nameOf('RM-act') });

    // postback 缺 data
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: withAction({ type: 'postback', data: '' }),
      expect: 'reject',
      context: 'postback action 缺 data',
    });

    // postback data 301 字
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: withAction({ type: 'postback', data: strOfLength(301) }),
      expect: 'reject',
      context: 'postback data 301 字（超過 max(300)）',
    });

    // action.label 21 字
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: withAction({ type: 'postback', data: 'ok', label: strOfLength(21) }),
      expect: 'reject',
      context: 'action label 21 字（超過 LINE 上限 20）',
    });

    // message 缺 text
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: withAction({ type: 'message' }),
      expect: 'reject',
      context: 'message action 缺 text',
    });

    // message text 301 字
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: withAction({ type: 'message', text: strOfLength(301) }),
      expect: 'reject',
      context: 'message text 301 字',
    });

    // uri 缺 uri
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: withAction({ type: 'uri' }),
      expect: 'reject',
      context: 'uri action 缺 uri',
    });

    // datetimepicker 缺 mode
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: withAction({ type: 'datetimepicker', data: 'd=1' }),
      expect: 'reject',
      context: 'datetimepicker 缺 mode',
    });

    // datetimepicker mode 非法
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: withAction({ type: 'datetimepicker', data: 'd=1', mode: 'bogus' }),
      expect: 'reject',
      context: 'datetimepicker mode 非法 enum',
    });

    // richmenuswitch 缺 richMenuAliasId
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: withAction({ type: 'richmenuswitch', data: 'd=1' }),
      expect: 'reject',
      context: 'richmenuswitch 缺 richMenuAliasId',
    });

    // action.type 非法 enum
    await apiFieldCheck(api, {
      path: 'line/rich-menus',
      payload: withAction({ type: 'bogus_type', data: 'x' }),
      expect: 'reject',
      context: 'action type 非法 enum',
    });
  });

  // 【已知 bug CM-W6-03】uri action 無 scheme 白名單（LINE 只允許 http/https/line/tel）
  test('24. RichMenu-uri action：危險 scheme 應被擋【已知 bug CM-W6-03】', async () => {
    test.fail(); // 預期失敗：記錄已知 bug；修復後會變 unexpected pass，提醒移除此標記
    // LINE 官方（reference/messaging-api：URI action）只允許 http / https / line / tel，
    // 其他 scheme LINE 會回 400 Bad Request。
    // 後端 actionSchema.uri 只有 z.string()（無 .url()），service validateAction 也只檢查非空。
    const result = await createAndTrack(
      'line/rich-menus',
      richMenuPayload({
        name: nameOf('RM-jsuri'),
        areas: [{ bounds: VALID_AREA.bounds, action: { type: 'uri', uri: 'javascript:alert(1)' } }],
      }),
      'richMenus',
    );
    expect(
      result.status,
      `uri action 給 javascript: scheme 應被擋，實際 ${result.status}（LINE 官方只允許 http/https/line/tel，發布時才會失敗）`,
    ).toBeGreaterThanOrEqual(400);
  });

  test('25. RichMenu-published 狀態鎖定：不可刪除', async () => {
    const list = await (await api.get(`line/rich-menus?channelId=${LINE_CHANNEL_ID}`)).json();
    const published = (list.data ?? []).find((m: any) => m.status === 'published');
    test.skip(!published, 'UAT 目前沒有 published 狀態的 Rich Menu，跳過鎖定驗證');

    // ⚠️ 這是既有非 [E2E] 資料，只測「刪除被擋」不會真的刪掉
    const res = await api.delete(`line/rich-menus/${published.id}`);
    expect(
      res.status(),
      'published 狀態的 Rich Menu 應禁止刪除（須先取消發布）',
    ).toBeGreaterThanOrEqual(400);

    // 確認確實還在
    const after = await api.get(`line/rich-menus/${published.id}`);
    expect(after.status(), 'published Rich Menu 不應被刪除').toBe(200);
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. LINE 關鍵字回覆欄位（底層 = automation rule）
  // ═══════════════════════════════════════════════════════════════════

  test('26. 關鍵字回覆-UI 必填擋控：名稱 / 關鍵字 / 素材', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/line/keyword-replies');
    await page.getByRole('button', { name: '建立關鍵字回覆' }).click();

    const saveBtn = page.getByRole('button', { name: '儲存' });
    const rulesUrl = /\/automation\/rules$/;

    // 全空 → 前端擋，顯示「請輸入規則名稱」
    let r = await submitAndObserve(page, () => saveBtn.click(), rulesUrl, 'POST', 2500);
    expect(r.requested, '名稱留空時不應發出請求').toBe(false);
    await expect(page.getByText('請輸入規則名稱')).toBeVisible();

    // 填名稱、無關鍵字 → 擋
    await page.getByPlaceholder('例：詢問營業時間、預約諮詢、產品 DM').fill(nameOf('關鍵字'));
    r = await submitAndObserve(page, () => saveBtn.click(), rulesUrl, 'POST', 2500);
    expect(r.requested, '無關鍵字時不應發出請求').toBe(false);
    await expect(page.getByText('至少要 1 個關鍵字')).toBeVisible();

    // 加關鍵字、無素材 → 擋
    const kwInput = page.getByPlaceholder('輸入關鍵字後按 Enter 或點「加入」');
    await kwInput.fill('營業時間');
    await kwInput.press('Enter');
    r = await submitAndObserve(page, () => saveBtn.click(), rulesUrl, 'POST', 2500);
    expect(r.requested, '未選素材時不應發出請求').toBe(false);
    await expect(page.getByText('請選擇要回覆的素材')).toBeVisible();

    // 前端去重：加入重複關鍵字應無效（handleAddKeyword 的 includes 檢查）
    await kwInput.fill('營業時間');
    await kwInput.press('Enter');
    const chips = page.locator('span', { hasText: '營業時間' });
    // 只計算 chip（含移除按鈕的 span）
    expect(
      await page.locator('span:has(button) >> text=營業時間').count(),
      '前端應擋下重複關鍵字',
    ).toBe(1);

    // 純空白關鍵字：trim 後為空，前端應不加入
    await kwInput.fill('   ');
    await kwInput.press('Enter');
    expect(await kwInput.inputValue(), '純空白關鍵字不應被加入（輸入框內容應保留）').toBe('   ');

    // 選素材後應可送出
    await kwInput.fill('');
    await page.locator('select').last().selectOption(LINE_MATERIAL_ID);
    const ok = await submitAndObserve(page, () => saveBtn.click(), rulesUrl);
    expectAccepted(ok, '關鍵字回覆建立（合法值）');
    if ((ok.body as any)?.data?.id) trash.rules.push((ok.body as any).data.id);
  });

  // 【已知 bug CM-W6-04】automation trigger 是 .passthrough()，keywords/match_mode 完全不驗
  test('27. 關鍵字回覆-後端驗證缺口【已知 bug CM-W6-04】', async () => {
    test.fail(); // 預期失敗：記錄已知 bug；修復後會變 unexpected pass，提醒移除此標記
    // automation.routes.ts 的 trigger 是 z.object({type}).passthrough()，
    // keywords / match_mode 完全不驗證 → 以下全部應被擋但實際可能被接受
    const cases: Array<{ label: string; payload: Record<string, unknown> }> = [
      {
        label: 'keywords 空陣列（等同無關鍵字，規則永不觸發）',
        payload: keywordReplyPayload({
          trigger: { type: 'keyword.matched', keywords: [], match_mode: 'any' },
        }),
      },
      {
        label: 'keywords 含空字串（空字串會比對到所有訊息）',
        payload: keywordReplyPayload({
          trigger: { type: 'keyword.matched', keywords: [''], match_mode: 'any' },
        }),
      },
      {
        label: 'keywords 含純空白',
        payload: keywordReplyPayload({
          trigger: { type: 'keyword.matched', keywords: ['   '], match_mode: 'any' },
        }),
      },
      {
        label: 'keywords 單字 5000 字（無長度上限）',
        payload: keywordReplyPayload({
          trigger: { type: 'keyword.matched', keywords: [strOfLength(5000)], match_mode: 'any' },
        }),
      },
      {
        label: 'match_mode 非法值（非 any/all）',
        payload: keywordReplyPayload({
          trigger: { type: 'keyword.matched', keywords: ['x'], match_mode: 'BOGUS_MODE' },
        }),
      },
      {
        label: 'materialId 非 UUID 格式',
        payload: keywordReplyPayload({
          actions: [{ type: 'send_material', params: { materialId: 'not-a-uuid' } }],
        }),
      },
      {
        label: 'materialId 為不存在的 UUID（規則建起來但發不出訊息）',
        payload: keywordReplyPayload({
          actions: [{ type: 'send_material', params: { materialId: randomUUID() } }],
        }),
      },
    ];

    const leaked: string[] = [];
    for (const c of cases) {
      const res = await api.post('automation/rules', { data: c.payload });
      const body = await res.json().catch(() => null);
      const id = body?.data?.id;
      if (id) trash.rules.push(id);
      if (res.status() < 400) leaked.push(`${c.label} → ${res.status()}`);
    }

    expect(
      leaked,
      `關鍵字回覆有 ${leaked.length} 項無效值被接受（應為 4xx）：\n  ${leaked.join('\n  ')}`,
    ).toEqual([]);
  });

  test('28. 關鍵字回覆-後端有擋的部分（回歸保護）', async () => {
    // 這些是後端確實有擋的，鎖住避免日後退化
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: keywordReplyPayload({ actions: [{ type: 'send_material', params: {} }] }),
      expect: 'reject',
      context: '關鍵字回覆缺 materialId（contract 驗證）',
    });

    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: keywordReplyPayload({ actions: [] }),
      expect: 'reject',
      context: '關鍵字回覆 actions 0 個（min(1)）',
    });

    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: keywordReplyPayload({ name: '' }),
      expect: 'reject',
      context: '關鍵字回覆 name 空字串',
    });

    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: keywordReplyPayload({ name: boundarySamples(200).over }),
      expect: 'reject',
      context: '關鍵字回覆 name 201 字',
    });
  });

  test('29. 關鍵字回覆-往返：關鍵字陣列 / matchMode 存讀一致', async () => {
    const keywords = ['營業時間', '幾點開門', FieldSamples.emoji.slice(0, 6)];
    const created = await createAndTrack(
      'automation/rules',
      keywordReplyPayload({
        name: nameOf('往返'),
        trigger: { type: 'keyword.matched', keywords, match_mode: 'all' },
      }),
      'rules',
    );
    expect(created.status).toBe(201);

    const detail = await (await api.get(`automation/rules/${created.id}`)).json();
    expect(detail?.data?.trigger?.keywords, '關鍵字陣列往返後不一致').toEqual(keywords);
    expect(detail?.data?.trigger?.match_mode, 'match_mode 往返後不一致').toBe('all');
    expect(
      detail?.data?.actions?.[0]?.params?.materialId,
      'materialId 往返後不一致',
    ).toBe(LINE_MATERIAL_ID);
  });

  // 【已知 bug CM-170】刪除為軟刪（isActive=false）且列表未過濾
  test('30. 關鍵字回覆-刪除是軟刪且列表未過濾【已知 bug CM-170】', async () => {
    test.fail(); // 預期失敗：記錄已知 bug；修復後會變 unexpected pass，提醒移除此標記
    const created = await createAndTrack(
      'automation/rules',
      keywordReplyPayload({ name: nameOf('軟刪驗證') }),
      'rules',
    );
    expect(created.status).toBe(201);

    const del = await api.delete(`automation/rules/${created.id}`);
    expect(del.status(), '刪除應回 200').toBe(200);

    // CM-170：刪除其實是 isActive=false 軟刪，且列表未過濾掉
    const list = await (await api.get('automation/rules?trigger=keyword.matched&limit=100')).json();
    const stillListed = (list.data ?? []).find((r: any) => r.id === created.id);

    expect(
      stillListed,
      '已刪除的關鍵字回覆仍出現在列表中（CM-170：軟刪 + 列表未過濾 isActive）',
    ).toBeUndefined();
  });
});
