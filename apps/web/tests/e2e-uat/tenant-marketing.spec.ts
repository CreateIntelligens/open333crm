import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import {
  E2E_PREFIX,
  newApiContext,
  gotoAndCheck,
  acceptNextDialog,
  dismissNextDialog,
} from './helpers';

/**
 * 行銷（/dashboard/marketing）功能層測試：行銷活動 / 廣播 / 受眾分群三個 tab。
 *
 * ⚠️ 絕對紅線：廣播「立即發送」（Play 按鈕，觸發 `confirm('確定要立即發送嗎？')`）
 * 全程不點擊、不 acceptNextDialog。已讀碼確認：
 *   - `POST /marketing/broadcasts`（表單「建立」按鈕）只建立記錄，狀態為 draft/scheduled，
 *     **不會**呼叫任何渠道 API（apps/api/src/modules/marketing/marketing.service.ts createBroadcast）。
 *   - 真正發送只發生在 `POST /marketing/broadcasts/:id/send`（executeBroadcast），
 *     此端點只被 BroadcastTab 的 Play 圖示按鈕呼叫，且該按鈕點擊前必經
 *     `confirm('確定要立即發送嗎？')`。本檔完全不觸碰這顆按鈕。
 *   - 因此測試 7「建立廣播」可以安全點擊「建立」（等同建草稿，非發送）。
 *
 * 讀碼盤點（與任務描述不同處，以實際程式碼為準）：
 * - 行銷活動/廣播/受眾分群三個 tab 都在同一個 client component
 *   （src/app/dashboard/marketing/page.tsx 的 CampaignTab / BroadcastTab / SegmentTab），
 *   非分散在 src/components/marketing/ 下的獨立元件（該目錄只有 MarketingTabs.tsx 這個 tab 列）。
 * - 素材（Material）的 channelType 只支援 `'line' | 'fb'`
 *   （apps/api/src/modules/marketing/material.routes.ts CHANNEL_TYPE_VALUES），
 *   **沒有 WEBCHAT 素材類型**。故廣播測試無法照任務描述用 WEBCHAT 渠道 + WEBCHAT 素材，
 *   改用 FB（渠道 + FB 純文字素材），做法比照 tenant-materials.spec.ts 驗證過的路徑。
 *   受眾分群的 channelType 條件（Contact.channelIdentities.channelType）是另一個獨立的
 *   渠道類型枚舉（含 WEBCHAT），與素材的 channelType 無關，測試 5 仍可用 WEBCHAT 條件。
 * - 全站無 toast 元件用在行銷頁：CampaignTab / BroadcastTab / SegmentTab 的成功路徑一律
 *   「靜默關閉 dialog + SWR mutate() 重新整理列表」，失敗路徑一律 `alert()`。
 *   故本檔一律用「dialog 關閉」「列表出現/消失」「API response」斷言，不用 expectToast。
 * - 三個 tab 切換是同頁 client state（CustomEvent 'marketing-tab-change'），非換路由；
 *   只有素材庫 tab 才會 router.push 到 /dashboard/marketing/materials。
 * - Dialog 是原生 `<dialog>`（src/components/ui/dialog.tsx），Playwright 的
 *   `getByRole('dialog')` 可直接抓到（原生 dialog 天生有 dialog role）。
 * - 活動狀態機（campaign.service.ts updateCampaign）：
 *   draft → active | cancelled；active → completed | cancelled；completed/cancelled 為終態。
 *   刪除活動（deleteCampaign）只允許 status === 'draft'，否則 403「Only draft campaigns
 *   can be deleted」。故測試 9（刪除活動）必須另建一個「全程停留在 draft」的活動，
 *   不能沿用測試 2 建立、測試 3 已轉成 active 的那個。
 * - 受眾分群刪除（segment.service.ts deleteSegment）是硬刪（`prisma.segment.delete`），
 *   Segment model 無 isActive/deletedAt 欄位，刪除後 API 查詢直接 404。
 * - 廣播取消（cancelBroadcast）只允許 status 為 draft 或 scheduled，成功後狀態變 cancelled；
 *   BroadcastTab 只在 `['draft','scheduled']` 狀態才會渲染「取消」按鈕。
 * - 受眾分群條件欄位下拉在 UI 上文案是「渠道類型」「標籤」「建立日期（之後）」
 *   「建立日期（之前）」，value 分別是 channelType/tag/createdAfter/createdBefore；
 *   渠道類型選項值為大寫 LINE/FB/WEBCHAT/WHATSAPP（對應 ChannelIdentity.channelType）。
 */
test.describe.configure({ mode: 'serial' });

test.describe('@marketing 行銷功能層', () => {
  let api: APIRequestContext;

  const runId = randomUUID().slice(0, 6);
  const campaignName = `${E2E_PREFIX} 活動 ${runId}`;
  const campaignDraftOnlyName = `${E2E_PREFIX} 活動草稿 ${runId}`;
  const segmentName = `${E2E_PREFIX} 分群 ${runId}`;
  const segmentToDeleteName = `${E2E_PREFIX} 分群待刪 ${runId}`;
  const fbMaterialName = `${E2E_PREFIX} 廣播素材 ${runId}`;
  const broadcastName = `${E2E_PREFIX} 廣播 ${runId}`;

  /** 建立過程中蒐集的 id，afterAll 依序清理（try/catch 不炸測試） */
  let campaignId = '';
  let campaignDraftOnlyId = '';
  let segmentId = '';
  let segmentToDeleteId = '';
  let fbMaterialId = '';
  let fbChannelId = '';
  let broadcastId = '';

  test.beforeAll(async () => {
    api = await newApiContext();

    // 找一個可用的 active FB 渠道（廣播測試用；材料 channelType 只支援 line/fb，見檔頭讀碼盤點）
    const chRes = await api.get('channels');
    if (chRes.ok()) {
      const chBody = await chRes.json();
      const channels: Array<Record<string, unknown>> = chBody?.data ?? [];
      const fb = channels.find(
        (c) => c.channelType === 'FB' && c.isActive === true,
      );
      fbChannelId = fb ? String(fb.id) : '';
    }
  });

  test.afterAll(async () => {
    if (!api) return;
    // 廣播需先取消/留著即可（不刪除 API，broadcast 無 DELETE 端點），只清理其餘自建資料。
    if (segmentToDeleteId) {
      try {
        await api.delete(`marketing/segments/${segmentToDeleteId}`);
      } catch {
        // 已在測試流程刪除，失敗略過
      }
    }
    if (segmentId) {
      try {
        await api.delete(`marketing/segments/${segmentId}`);
      } catch {
        // 清理失敗僅略過
      }
    }
    if (fbMaterialId) {
      try {
        await api.delete(`marketing/materials/${fbMaterialId}`);
      } catch {
        // 清理失敗僅略過
      }
    }
    // draft 活動可刪；非 draft（如測試 3 轉 active 的那個）刪不掉，略過即可
    for (const id of [campaignDraftOnlyId, campaignId]) {
      if (!id) continue;
      try {
        await api.delete(`marketing/campaigns/${id}`);
      } catch {
        // 非 draft 狀態刪不掉是預期行為，略過
      }
    }
    await api.dispose();
  });

  async function gotoMarketing(page: Page, tab?: 'campaigns' | 'broadcasts' | 'segments') {
    await gotoAndCheck(page, tab ? `/dashboard/marketing?tab=${tab}` : '/dashboard/marketing');
  }

  // ── 1. 頁面載入：三個 tab 都能切換且各自渲染 ──────────────────────────
  test('@marketing 頁面載入：行銷活動/廣播/受眾分群三個 tab 皆可切換並渲染', async ({ page }) => {
    await gotoMarketing(page);
    await expect(page.getByRole('heading', { name: '行銷活動' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '新增活動' })).toBeVisible();

    // 注意：MarketingTabs 的 TabsTrigger 實際渲染為 <button>（tabs.tsx 未加 role="tab"），
    // 非 ARIA tab role，故用 getByRole('button', { exact: true }) 定位，避免誤中同頁其他
    // 含「廣播」/「分群」字樣的按鈕（如「建立廣播」「新增分群」）。
    await page.getByRole('button', { name: '廣播', exact: true }).click();
    await expect(page.getByRole('heading', { name: '廣播歷史' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: '建立廣播' })).toBeVisible();

    await page.getByRole('button', { name: '受眾分群', exact: true }).click();
    await expect(page.getByRole('heading', { name: '受眾分群' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: '新增分群' })).toBeVisible();

    // 切回行銷活動確認可逆
    await page.getByRole('button', { name: '行銷活動', exact: true }).click();
    await expect(page.getByRole('heading', { name: '行銷活動' })).toBeVisible({ timeout: 10_000 });
  });

  // ── 2. 建立行銷活動 ────────────────────────────────────────────────────
  test('@marketing 建立行銷活動：[E2E] 名稱 + 開始/結束日期 → 儲存成功，卡片出現', async ({ page }) => {
    await gotoMarketing(page);
    await page.getByRole('button', { name: '新增活動' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('新增行銷活動')).toBeVisible();

    await dialog.getByPlaceholder('活動名稱').fill(campaignName);
    await dialog.getByPlaceholder('活動描述').fill(`${E2E_PREFIX} 測試描述 ${runId}`);
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    await dialog.locator('input[type="date"]').first().fill(today);
    await dialog.locator('input[type="date"]').last().fill(future);

    const createRes = page.waitForResponse(
      (res) => res.url().includes('/marketing/campaigns') && res.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '建立' }).click();
    const res = await createRes;
    expect(res.ok(), `建立行銷活動失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    campaignId = body?.data?.id;
    expect(campaignId, '建立回應應含活動 id').toBeTruthy();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(campaignName, { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // ── 3. 活動詳情：draft → active ───────────────────────────────────────
  test('@marketing 活動詳情：draft 轉 active（confirm）→ 狀態更新', async ({ page }) => {
    expect(campaignId, '前置測試 2 應已建立 campaignId').toBeTruthy();
    await gotoAndCheck(page, `/dashboard/marketing/campaigns/${campaignId}`);
    await expect(page.getByRole('heading', { name: campaignName })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('草稿', { exact: true })).toBeVisible();

    const dialogPromise = acceptNextDialog(page);
    const patchRes = page.waitForResponse(
      (res) => res.url().includes(`/marketing/campaigns/${campaignId}`) && res.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '啟動' }).click();
    const msg = await dialogPromise;
    expect(msg).toContain('啟動');
    const res = await patchRes;
    expect(res.ok(), `啟動活動失敗：${await res.text()}`).toBeTruthy();

    await expect(page.getByText('進行中', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // ── 4. 活動詳情：active → cancelled ───────────────────────────────────
  test('@marketing 活動詳情：active 轉 cancelled（confirm）→ 狀態更新', async ({ page }) => {
    expect(campaignId, '前置測試 3 應已把活動轉為 active').toBeTruthy();
    await gotoAndCheck(page, `/dashboard/marketing/campaigns/${campaignId}`);
    await expect(page.getByText('進行中', { exact: true })).toBeVisible({ timeout: 15_000 });

    const dialogPromise = acceptNextDialog(page);
    const patchRes = page.waitForResponse(
      (res) => res.url().includes(`/marketing/campaigns/${campaignId}`) && res.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '取消', exact: true }).click();
    const msg = await dialogPromise;
    expect(msg).toContain('取消');
    const res = await patchRes;
    expect(res.ok(), `取消活動失敗：${await res.text()}`).toBeTruthy();

    await expect(page.getByText('已取消', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // ── 5. 建立受眾分群：名稱 + 條件（渠道類型=WEBCHAT）→ 預覽 → 儲存 ──────
  test('@marketing 建立受眾分群：[E2E] 名稱 + 渠道類型條件 → 預覽人數有回應 → 儲存成功', async ({ page }) => {
    await gotoMarketing(page, 'segments');
    await page.getByRole('button', { name: '新增分群' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('新增受眾分群')).toBeVisible();

    await dialog.getByPlaceholder('分群名稱').fill(segmentName);
    await dialog.getByPlaceholder('分群描述').fill(`${E2E_PREFIX} 測試描述 ${runId}`);

    // 條件欄位預設就是「渠道類型」，選 WEBCHAT 值
    const conditionRow = dialog.locator('div.mb-2.flex.items-center.gap-2').first();
    await conditionRow.locator('select').nth(1).selectOption('WEBCHAT');

    const previewRes = page.waitForResponse(
      (res) => res.url().includes('/marketing/segments/preview') && res.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '預覽人數' }).click();
    const pRes = await previewRes;
    expect(pRes.ok(), `預覽人數失敗：${await pRes.text()}`).toBeTruthy();
    await expect(dialog.getByText('符合人數：')).toBeVisible({ timeout: 10_000 });

    const createRes = page.waitForResponse(
      (res) => res.url().includes('/marketing/segments') && res.request().method() === 'POST' && !res.url().includes('preview'),
    );
    await dialog.getByRole('button', { name: '建立' }).click();
    const res = await createRes;
    expect(res.ok(), `建立受眾分群失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    segmentId = body?.data?.id;
    expect(segmentId, '建立回應應含分群 id').toBeTruthy();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(segmentName, { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // ── 6. 刪除受眾分群（硬刪）──────────────────────────────────────────────
  test('@marketing 刪除受眾分群：確認後從列表消失，API 查詢應 404（硬刪）', async ({ page }) => {
    // 另建一個專門用來刪除的分群，避免刪掉測試 7 廣播要用的 segmentId
    await gotoMarketing(page, 'segments');
    await page.getByRole('button', { name: '新增分群' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('新增受眾分群')).toBeVisible();
    await dialog.getByPlaceholder('分群名稱').fill(segmentToDeleteName);
    const createRes = page.waitForResponse(
      (res) => res.url().includes('/marketing/segments') && res.request().method() === 'POST' && !res.url().includes('preview'),
    );
    await dialog.getByRole('button', { name: '建立' }).click();
    const cRes = await createRes;
    expect(cRes.ok(), `建立待刪分群失敗：${await cRes.text()}`).toBeTruthy();
    segmentToDeleteId = (await cRes.json())?.data?.id;
    expect(segmentToDeleteId).toBeTruthy();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(segmentToDeleteName, { exact: true })).toBeVisible({ timeout: 10_000 });

    const row = page.locator('tbody tr', { hasText: segmentToDeleteName }).first();
    const dialogPromise = acceptNextDialog(page);
    const deleteRes = page.waitForResponse(
      (res) => res.url().includes(`/marketing/segments/${segmentToDeleteId}`) && res.request().method() === 'DELETE',
    );
    await row.getByRole('button').click();
    const msg = await dialogPromise;
    expect(msg).toContain('確定要刪除這個分群嗎');
    const res = await deleteRes;
    expect(res.ok(), `刪除分群失敗：${await res.text()}`).toBeTruthy();

    await expect(page.getByText(segmentToDeleteName, { exact: true })).toBeHidden({ timeout: 10_000 });

    const checkRes = await api.get(`marketing/segments/${segmentToDeleteId}`);
    expect(checkRes.status(), '硬刪後 API 應查不到（404）').toBe(404);
    segmentToDeleteId = ''; // 已刪除，afterAll 不必再清理
  });

  // ── 7. 建立廣播（只走到表單建立，絕不點擊「立即發送」）────────────────
  test('@marketing 建立廣播：選 FB 渠道與素材 → 受眾選分群 → 建立成功（草稿，非發送）', async ({ page }) => {
    test.skip(!fbChannelId, '目前租戶沒有 active 的 FB 渠道，無法建立廣播（環境限制，非本測試可控）');

    // 先用 API 建一則 FB 純文字素材（材料 channelType 只支援 line/fb，見檔頭讀碼盤點）
    const matRes = await api.post('marketing/materials', {
      data: {
        name: fbMaterialName,
        channelType: 'fb',
        contentType: 'fb_text',
        body: { text: `${E2E_PREFIX} 廣播測試內容 ${runId}` },
      },
    });
    expect(matRes.ok(), `API 建立 FB 素材失敗：${await matRes.text()}`).toBeTruthy();
    fbMaterialId = (await matRes.json())?.data?.id;
    expect(fbMaterialId, 'API 建立回應應含素材 id').toBeTruthy();

    await gotoMarketing(page, 'broadcasts');
    await page.getByRole('button', { name: '建立廣播' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('建立廣播')).toBeVisible();

    await dialog.getByPlaceholder('廣播名稱').fill(broadcastName);
    await dialog.locator('select').first().selectOption(fbChannelId);
    // 選渠道後素材下拉才會出現對應素材；用 label 尋找剛建立的素材選項
    const materialSelect = dialog.locator('select').nth(1);
    await expect(materialSelect.locator(`option:has-text("${fbMaterialName}")`)).toHaveCount(1, {
      timeout: 10_000,
    });
    await materialSelect.selectOption({ label: `${fbMaterialName}（fb_text）` });
    // 素材預覽區塊應出現（驗證 MaterialPreview 有渲染）
    await expect(dialog.getByText('素材預覽')).toBeVisible({ timeout: 10_000 });

    // 受眾類型改選「受眾分群」，選測試 5 建立的分群
    const targetTypeSelect = dialog.locator('select').nth(3);
    await targetTypeSelect.selectOption('segment');
    const segmentSelect = dialog.locator('select').nth(4);
    await expect(segmentSelect.locator(`option:has-text("${segmentName}")`)).toHaveCount(1, {
      timeout: 10_000,
    });
    await segmentSelect.selectOption(segmentId);

    // ⚠️ 不填排程時間（留空 = 建為 draft），且全程不觸碰「立即發送」
    // 「建立」按鈕只呼叫 POST /marketing/broadcasts（見檔頭讀碼盤點），不會發送
    const createRes = page.waitForResponse(
      (res) => res.url().includes('/marketing/broadcasts') && res.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '建立' }).click();
    const res = await createRes;
    expect(res.ok(), `建立廣播失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    broadcastId = body?.data?.id;
    expect(broadcastId, '建立回應應含廣播 id').toBeTruthy();
    expect(body?.data?.status, '未填排程時間，建立後狀態應為 draft').toBe('draft');

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(broadcastName, { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // ── 8. 取消廣播 ────────────────────────────────────────────────────────
  test('@marketing 取消廣播：draft 狀態下點「取消」（confirm）→ 狀態變 cancelled', async ({ page }) => {
    test.skip(!broadcastId, '前置測試 7 未建立廣播（環境無 FB 渠道），略過');

    await gotoMarketing(page, 'broadcasts');
    const row = page.locator('tbody tr', { hasText: broadcastName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText('草稿', { exact: true })).toBeVisible();

    const dialogPromise = acceptNextDialog(page);
    const cancelRes = page.waitForResponse(
      (res) => res.url().includes(`/marketing/broadcasts/${broadcastId}/cancel`) && res.request().method() === 'POST',
    );
    // 「取消」按鈕的 title 屬性為「取消」，圖示 XCircle；用 title 定位避免跟「建立廣播」按鈕混淆
    await row.getByTitle('取消').click();
    const msg = await dialogPromise;
    expect(msg).toContain('確定要取消嗎');
    const res = await cancelRes;
    expect(res.ok(), `取消廣播失敗：${await res.text()}`).toBeTruthy();

    await expect(row.getByText('已取消', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // ── 9. 刪除行銷活動（僅 draft 可刪，另建一個全程 draft 的活動測試）────
  test('@marketing 刪除行銷活動：另建一個 draft 活動，刪除後從列表消失', async ({ page }) => {
    await gotoMarketing(page, 'campaigns');
    await page.getByRole('button', { name: '新增活動' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('新增行銷活動')).toBeVisible();
    await dialog.getByPlaceholder('活動名稱').fill(campaignDraftOnlyName);
    const createRes = page.waitForResponse(
      (res) => res.url().includes('/marketing/campaigns') && res.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '建立' }).click();
    const cRes = await createRes;
    expect(cRes.ok(), `建立待刪活動失敗：${await cRes.text()}`).toBeTruthy();
    campaignDraftOnlyId = (await cRes.json())?.data?.id;
    expect(campaignDraftOnlyId).toBeTruthy();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(campaignDraftOnlyName, { exact: true })).toBeVisible({ timeout: 10_000 });

    // draft 卡片右下角才有刪除（Trash2）按鈕（CampaignTab.tsx：c.status === 'draft' 才渲染）
    const card = page.locator('div.rounded-lg.border', { hasText: campaignDraftOnlyName }).first();
    const dialogPromise = acceptNextDialog(page);
    const deleteRes = page.waitForResponse(
      (res) => res.url().includes(`/marketing/campaigns/${campaignDraftOnlyId}`) && res.request().method() === 'DELETE',
    );
    await card.getByRole('button').click();
    const msg = await dialogPromise;
    expect(msg).toContain('確定要刪除這個行銷活動嗎');
    const res = await deleteRes;
    expect(res.ok(), `刪除活動失敗：${await res.text()}`).toBeTruthy();

    await expect(page.getByText(campaignDraftOnlyName, { exact: true })).toBeHidden({ timeout: 10_000 });
    campaignDraftOnlyId = ''; // 已刪除，afterAll 不必再清理
  });

  // ── 附加：確認「取消」分支（dismiss）不會誤觸發實際操作 ────────────────
  test('@marketing 取消分支：活動狀態變更 dialog 按取消不送出 PATCH', async ({ page }) => {
    // 用一個全新的 draft 活動驗證 dismiss 分支，避免干擾其他測試已建立的資料狀態
    await gotoMarketing(page, 'campaigns');
    await page.getByRole('button', { name: '新增活動' }).click();
    const dialog = page.getByRole('dialog');
    const tmpName = `${E2E_PREFIX} 活動dismiss測試 ${runId}`;
    await dialog.getByPlaceholder('活動名稱').fill(tmpName);
    const createRes = page.waitForResponse(
      (res) => res.url().includes('/marketing/campaigns') && res.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '建立' }).click();
    const cRes = await createRes;
    const tmpId = (await cRes.json())?.data?.id;
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    try {
      await gotoAndCheck(page, `/dashboard/marketing/campaigns/${tmpId}`);
      await expect(page.getByRole('button', { name: '啟動' })).toBeVisible({ timeout: 15_000 });

      let patchFired = false;
      page.on('request', (req) => {
        if (req.url().includes(`/marketing/campaigns/${tmpId}`) && req.method() === 'PATCH') {
          patchFired = true;
        }
      });
      const dialogPromise = dismissNextDialog(page);
      await page.getByRole('button', { name: '啟動' }).click();
      await dialogPromise;
      await page.waitForTimeout(1000);
      expect(patchFired, 'dismiss confirm 後不應送出 PATCH').toBeFalsy();
      await expect(page.getByText('草稿', { exact: true })).toBeVisible();
    } finally {
      // 清理：無論如何都刪掉這個暫時活動（此時應仍是 draft，可刪）
      try {
        await api.delete(`marketing/campaigns/${tmpId}`);
      } catch {
        // 清理失敗僅略過
      }
    }
  });
});
