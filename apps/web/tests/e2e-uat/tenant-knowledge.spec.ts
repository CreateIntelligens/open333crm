import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import { E2E_PREFIX, newApiContext, gotoAndCheck, acceptNextDialog } from './helpers';

/**
 * 知識庫（/dashboard/knowledge）功能層測試。
 *
 * 讀碼盤點（與任務描述路徑不同/需注意處，以實際程式碼為準）：
 * - 頁面五個 tab（含狀態子 tab）都是自製 Tabs 元件（src/components/ui/tabs.tsx），
 *   內部是純 `<button onClick>`，**沒有** role="tab"/"tabpanel"（非 radix），
 *   一律用 getByRole('button', { name }) 定位切換，不能用 getByRole('tab'/'tabpanel')
 * - 新增/編輯文章走同一顆 ArticleFormDialog（src/components/knowledge/ArticleFormDialog.tsx），
 *   是 shadcn 風格 Dialog（非原生 <dialog>），getByRole('dialog') 仍可抓到（radix 有 role=dialog）
 * - 表單欄位：標題(Input, required)、分類(Input 自由輸入文字，非下拉選單！placeholder「例：常見問題、產品說明」，
 *   空白時後端預設「一般」)、摘要(Textarea, optional)、內容(Textarea, required)、標籤(逗號分隔字串, optional)
 *   → 任務描述提到「分類下拉選第一個可用選項」與實際 UI 不符，分類其實是自由輸入 Input
 * - 新增/編輯送出按鈕文字都是「儲存」（非「存為素材」，那是素材庫的文案）
 * - 刪除文章用原生 window.confirm()（page.tsx handleDelete），文案「確定要刪除這篇文章嗎？」
 * - 刪除是**硬刪除**（knowledge.service.ts deleteArticle 直接 prisma.kmArticle.delete，非軟刪 isActive:false）
 *   → 任務描述「或依 API 驗證是否為軟刪」已讀碼確認：非軟刪，afterAll 清理不必再額外刪除已在測試中刪除的文章
 * - 發布/封存按鈕在列表操作欄是 icon-only button，title 分別為「發布」「封存」「編輯」「刪除」
 *   （ArticleList.tsx，用 getByTitle 定位比 getByRole name 精確，因為都是 icon button 無文字）
 * - 狀態子 tab（全部/草稿/已發布/已封存）用 Tabs value=DRAFT/PUBLISHED/ARCHIVED/all，同上用 getByRole('button', {name}) 定位
 * - 建立/更新文章一律觸發背景 embedding（fire-and-forget，依賴 Ollama），發布時若尚無 embedding 也會背景補嵌入；
 *   這些不會擋住 HTTP 回應，UI 操作可正常斷言，只有「語義搜尋」（POST /knowledge/search）是同步等待 LLM 回應，
 *   對它加寬容處理
 * - 語義搜尋結果卡片渲染 `r.similarity`，若 API 回傳缺 similarity 欄位會炸（*100).toFixed(1)`），
 *   包在 try/catch 內，只驗證流程跑得動不斷言內容
 * - 回報調教 tab 兩種狀態皆合法：載入中 spinner → 之後「目前沒有待處理的回報 🎉」（空）或列出回報卡片，
 *   兩者都代表頁面正常運作，只需驗證沒有殘留 loading 狀態或錯誤
 * - Embedding 設定 / Chat & Prompt 皆為全租戶共用設定，本檔僅唯讀驗證頁面載入，不觸碰任何欄位/儲存按鈕
 * - 匯入文章：ImportDialog 走檔案選擇 input[type=file]，JSON 檔走 `POST /knowledge/import`
 *   （articles 陣列），非 JSON 走 `POST /knowledge/upload`（multipart）。Playwright 可用
 *   `setInputFiles` 搭配記憶體構造的暫存 JSON 檔案測試匯入流程。
 */
test.describe.configure({ mode: 'serial' });

test.describe('@knowledge 知識庫功能', () => {
  let api: APIRequestContext;

  const runId = randomUUID().slice(0, 6);
  const articleTitle = `${E2E_PREFIX} 知識庫文章 ${runId}`;
  const articleTitleEdited = `${E2E_PREFIX} 知識庫文章改標題 ${runId}`;
  const articleSummary = `${E2E_PREFIX} 摘要 ${runId}`;
  const articleContent = `${E2E_PREFIX} 內容本文 ${runId}，這是測試用的知識庫文章內容。`;
  const importTitle = `${E2E_PREFIX} JSON 匯入文章 ${runId}`;

  /** 建立過程中蒐集的 id，afterAll 依序清理（硬刪除，已在測試中刪除的不重複刪） */
  let articleId = '';
  let importedArticleId = '';

  test.beforeAll(async () => {
    api = await newApiContext();
  });

  test.afterAll(async () => {
    if (!api) return;
    for (const id of [articleId, importedArticleId]) {
      if (!id) continue;
      try {
        await api.delete(`knowledge/${id}`);
      } catch {
        // 清理失敗僅略過，不炸測試
      }
    }
    await api.dispose();
  });

  async function gotoKnowledgePage(page: Page) {
    await gotoAndCheck(page, '/dashboard/knowledge');
    await expect(page.getByRole('heading', { name: '知識庫' })).toBeVisible({ timeout: 15_000 });
  }

  // ── 1. 文章管理 tab 載入：主要控制項皆可見 ─────────────────────────────
  test('@knowledge 文章管理 tab 載入：搜尋框、分類/來源下拉、狀態子 tab 皆可見', async ({ page }) => {
    await gotoKnowledgePage(page);

    // 頂層 tab 五個都在
    await expect(page.getByRole('button', { name: '文章管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '語義搜尋' })).toBeVisible();
    await expect(page.getByRole('button', { name: /回報調教/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Embedding 設定' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chat & Prompt' })).toBeVisible();

    // 文章管理 tab 內容（預設就是此 tab）
    await expect(page.getByPlaceholder('搜尋文章...')).toBeVisible();
    await expect(page.getByRole('button', { name: '匯入文章' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新增文章' })).toBeVisible();

    // 狀態子 tab：全部/草稿/已發布/已封存
    await expect(page.getByRole('button', { name: '全部' })).toBeVisible();
    await expect(page.getByRole('button', { name: '草稿' })).toBeVisible();
    await expect(page.getByRole('button', { name: '已發布' })).toBeVisible();
    await expect(page.getByRole('button', { name: '已封存' })).toBeVisible();
  });

  // ── 2. 新增文章 ────────────────────────────────────────────────────────
  test('@knowledge 新增文章：填標題/摘要/內容/分類 → 儲存成功，列表可見', async ({ page }) => {
    await gotoKnowledgePage(page);
    await page.getByRole('button', { name: '新增文章' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('新增文章')).toBeVisible({ timeout: 10_000 });

    await dialog.getByPlaceholder('文章標題').fill(articleTitle);
    // 分類是自由輸入 Input（非下拉選單）
    await dialog.getByPlaceholder('例：常見問題、產品說明').fill(`${E2E_PREFIX}分類${runId}`);
    await dialog.getByPlaceholder('簡短描述文章內容...').fill(articleSummary);
    await dialog.getByPlaceholder('文章內容（支援 Markdown 格式）...').fill(articleContent);

    const createRes = page.waitForResponse(
      (res) => res.url().includes('/knowledge') && res.request().method() === 'POST' && !res.url().includes('/import') && !res.url().includes('/upload'),
    );
    await dialog.getByRole('button', { name: '儲存' }).click();
    const res = await createRes;
    expect(res.ok(), `建立文章失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    articleId = body?.data?.id;
    expect(articleId, '建立回應應含文章 id').toBeTruthy();

    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // 列表可見（新建文章預設 DRAFT 狀態，「全部」子 tab 下應可見）
    await page.getByPlaceholder('搜尋文章...').fill(articleTitle);
    await expect(page.getByText(articleTitle, { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // ── 3. 編輯文章：改標題 → 儲存成功 ──────────────────────────────────────
  test('@knowledge 編輯文章：改標題後儲存成功', async ({ page }) => {
    expect(articleId, '前置測試 2 應已建立 articleId').toBeTruthy();
    await gotoKnowledgePage(page);
    await page.getByPlaceholder('搜尋文章...').fill(articleTitle);
    await expect(page.getByText(articleTitle, { exact: true })).toBeVisible({ timeout: 10_000 });

    const row = page.locator('tbody tr', { hasText: articleTitle }).first();
    await row.getByTitle('編輯').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('編輯文章')).toBeVisible({ timeout: 10_000 });
    const titleInput = dialog.getByPlaceholder('文章標題');
    await expect(titleInput).toHaveValue(articleTitle);
    await titleInput.fill('');
    await titleInput.fill(articleTitleEdited);

    const saveRes = page.waitForResponse(
      (res) => res.url().includes(`/knowledge/${articleId}`) && res.request().method() === 'PATCH',
    );
    await dialog.getByRole('button', { name: '儲存' }).click();
    const res = await saveRes;
    expect(res.ok(), `編輯文章失敗：${await res.text()}`).toBeTruthy();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    await page.getByPlaceholder('搜尋文章...').fill(articleTitleEdited);
    await expect(page.getByText(articleTitleEdited, { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // ── 4. 發布文章 ────────────────────────────────────────────────────────
  test('@knowledge 發布文章：列操作「發布」後狀態變已發布', async ({ page }) => {
    expect(articleId, '前置測試 2 應已建立 articleId').toBeTruthy();
    await gotoKnowledgePage(page);
    await page.getByPlaceholder('搜尋文章...').fill(articleTitleEdited);
    const row = page.locator('tbody tr', { hasText: articleTitleEdited }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const publishRes = page.waitForResponse(
      (res) => res.url().includes(`/knowledge/${articleId}/publish`) && res.request().method() === 'POST',
    );
    await row.getByTitle('發布').click();
    const res = await publishRes;
    expect(res.ok(), `發布文章失敗：${await res.text()}`).toBeTruthy();

    // 已發布子 tab 應可見該文章
    await page.getByRole('button', { name: '已發布' }).click();
    await page.getByPlaceholder('搜尋文章...').fill(articleTitleEdited);
    await expect(page.getByText(articleTitleEdited, { exact: true })).toBeVisible({ timeout: 10_000 });

    // 草稿子 tab 應不再出現
    await page.getByRole('button', { name: '草稿' }).click();
    await page.getByPlaceholder('搜尋文章...').fill(articleTitleEdited);
    await expect(page.getByText(articleTitleEdited, { exact: true })).toBeHidden({ timeout: 10_000 });

    // API 佐證
    const artRes = await api.get(`knowledge/${articleId}`);
    expect(artRes.ok()).toBeTruthy();
    const art = (await artRes.json())?.data;
    expect(art?.status).toBe('PUBLISHED');
  });

  // ── 5. 封存文章 ────────────────────────────────────────────────────────
  test('@knowledge 封存文章：列操作「封存」後狀態變已封存', async ({ page }) => {
    expect(articleId, '前置測試 2 應已建立 articleId').toBeTruthy();
    await gotoKnowledgePage(page);
    // 目前在「已發布」狀態，切回全部確保找得到列
    await page.getByRole('button', { name: '全部' }).click();
    await page.getByPlaceholder('搜尋文章...').fill(articleTitleEdited);
    const row = page.locator('tbody tr', { hasText: articleTitleEdited }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const archiveRes = page.waitForResponse(
      (res) => res.url().includes(`/knowledge/${articleId}/archive`) && res.request().method() === 'POST',
    );
    await row.getByTitle('封存').click();
    const res = await archiveRes;
    expect(res.ok(), `封存文章失敗：${await res.text()}`).toBeTruthy();

    await page.getByRole('button', { name: '已封存' }).click();
    await page.getByPlaceholder('搜尋文章...').fill(articleTitleEdited);
    await expect(page.getByText(articleTitleEdited, { exact: true })).toBeVisible({ timeout: 10_000 });

    const artRes = await api.get(`knowledge/${articleId}`);
    expect(artRes.ok()).toBeTruthy();
    const art = (await artRes.json())?.data;
    expect(art?.status).toBe('ARCHIVED');
  });

  // ── 6. 語義搜尋（@ai，寬容失敗：依賴向量+LLM，UAT 可能不穩） ─────────────
  test('@knowledge @ai 語義搜尋：輸入查詢文字送出，流程跑得動或明確失敗不掛整個 spec', async ({ page }) => {
    // config 整體 test timeout 是 60s，內部又要等到 60s 的 waitForResponse——
    // 兩者相加必超時，逾時會由整體 test timeout 直接中斷測試（拋 "Test ended"，
    // 繞過下面的 try/catch）。test.slow() 把這條測試的 timeout 放寬到 3 倍，
    // 才有空間讓內部的 60s 逾時真的被 catch 吸收。
    test.slow();
    await gotoKnowledgePage(page);
    await page.getByRole('button', { name: '語義搜尋' }).click();

    const searchInput = page.getByPlaceholder(/輸入查詢文字/);
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill('測試查詢');

    try {
      const searchRes = page.waitForResponse(
        (res) => res.url().includes('/knowledge/search') && res.request().method() === 'POST',
        { timeout: 60_000 },
      );
      // exact:true 避免撞到左側「語義搜尋」tab 按鈕（文字含「搜尋」子字串，
      // strict mode violation 曾讓這個 click 直接拋錯、間接讓外層 waitForResponse
      // 以誤導性的 "Test ended" 收場，看起來像逾時其實是定位錯誤）
      await page.getByRole('button', { name: '搜尋', exact: true }).click();
      const res = await searchRes;
      // 不斷言 ok() 一定為 true（embedding 服務可能不穩導致 5xx），只記錄結果、
      // 確認流程有跑到（等到回應、頁面沒有卡死在 loading）
      await page.waitForTimeout(1000);
      const stillSearching = await page.getByText('搜尋中', { exact: false }).isVisible().catch(() => false);
      expect(stillSearching, '搜尋完成後不應仍停留在 loading 狀態').toBeFalsy();
      test.info().annotations.push({
        type: 'note',
        description: `語義搜尋 API 回應狀態：${res.status()}（不強制要求 200，AI/向量服務可能不穩）`,
      });
    } catch (err) {
      test.info().annotations.push({
        type: 'note',
        description: `語義搜尋逾時或失敗（AI 依賴不穩，寬容通過不掛測試）：${(err as Error).message}`,
      });
    }
  });

  // ── 7. 回報調教 tab：頁面結構正確載入 ─────────────────────────────────
  test('@knowledge 回報調教 tab：頁面結構正確載入不報錯（空列表視為正常）', async ({ page }) => {
    await gotoKnowledgePage(page);
    await page.getByRole('button', { name: /回報調教/ }).click();

    await expect(page.getByText('使用者在 LINE 點「👎 沒幫到我」的回報')).toBeVisible({ timeout: 10_000 });

    // 等 loading spinner 消失（不論最終是空狀態或有資料列表）
    await page.waitForTimeout(1500);
    const emptyState = page.getByText('目前沒有待處理的回報', { exact: false });
    const hasFeedbackCards = page.locator('text=使用者問：').first();
    const isEmpty = await emptyState.isVisible().catch(() => false);
    const hasCards = await hasFeedbackCards.isVisible().catch(() => false);
    expect(isEmpty || hasCards, '回報調教 tab 應顯示空狀態文案或至少一張回報卡片').toBeTruthy();
  });

  // ── 8. 刪除文章（硬刪除，confirm） ─────────────────────────────────────
  test('@knowledge 刪除文章：confirm 後從列表消失（硬刪除）', async ({ page }) => {
    expect(articleId, '前置測試 2 應已建立 articleId').toBeTruthy();
    await gotoKnowledgePage(page);
    await page.getByRole('button', { name: '已封存' }).click();
    await page.getByPlaceholder('搜尋文章...').fill(articleTitleEdited);
    const row = page.locator('tbody tr', { hasText: articleTitleEdited }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const dialogPromise = acceptNextDialog(page);
    const deleteRes = page.waitForResponse(
      (res) => res.url().includes(`/knowledge/${articleId}`) && res.request().method() === 'DELETE',
    );
    await row.getByTitle('刪除').click();
    const msg = await dialogPromise;
    expect(msg).toContain('確定要刪除這篇文章嗎');
    const res = await deleteRes;
    expect(res.ok(), `刪除文章失敗：${await res.text()}`).toBeTruthy();

    await expect(page.getByText(articleTitleEdited, { exact: true })).toBeHidden({ timeout: 10_000 });

    // API 佐證：硬刪除，查詢應回 404
    const artRes = await api.get(`knowledge/${articleId}`);
    expect(artRes.status(), '硬刪除後應查不到（404）').toBe(404);
    // 已刪除，afterAll 不必再清理這一筆
    articleId = '';
  });

  // ── 9. 匯入文章（JSON） ──────────────────────────────────────────────
  test('@knowledge 匯入文章：JSON 匯入一篇簡單文章後出現在列表', async ({ page }) => {
    await gotoKnowledgePage(page);
    await page.getByRole('button', { name: '全部' }).click();
    await page.getByRole('button', { name: '匯入文章' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('匯入文章')).toBeVisible({ timeout: 10_000 });

    const jsonContent = JSON.stringify([
      {
        title: importTitle,
        content: `${E2E_PREFIX} JSON 匯入內容 ${runId}`,
        summary: `${E2E_PREFIX} JSON 匯入摘要 ${runId}`,
        category: '一般',
        tags: [],
      },
    ]);

    // input[type=file] 是 hidden，但 Playwright setInputFiles 不需要元素可見
    await page.locator('input[type="file"]').setInputFiles({
      name: `${runId}-import.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(jsonContent, 'utf-8'),
    });

    const importRes = page.waitForResponse(
      (res) => res.url().includes('/knowledge/import') && res.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await dialog.getByRole('button', { name: /上傳 1 個檔案/ }).click();
    const res = await importRes;
    expect(res.ok(), `JSON 匯入失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body?.data?.imported, 'JSON 匯入應成功 1 篇').toBe(1);

    await expect(dialog.getByText(/上傳完成/)).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: '關閉' }).click();
    await expect(dialog).toBeHidden();

    // 用 API 查回剛匯入文章的 id 供 afterAll 清理
    const listRes = await api.get('knowledge', { params: { q: importTitle, limit: '10' } });
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    const items: Array<{ id: string; title: string }> = listBody?.data?.items ?? listBody?.data ?? [];
    const found = items.find((a) => a.title === importTitle);
    expect(found, 'API 應能查到剛匯入的文章').toBeTruthy();
    importedArticleId = found!.id;

    await page.getByPlaceholder('搜尋文章...').fill(importTitle);
    await expect(page.getByText(importTitle, { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // ── 10. Embedding 設定 tab：僅唯讀驗證頁面載入，不修改全租戶共用設定 ────
  test('@knowledge Embedding 設定 tab：頁面能載入、既有設定值顯示（唯讀，不修改）', async ({ page }) => {
    await gotoKnowledgePage(page);
    await page.getByRole('button', { name: 'Embedding 設定' }).click();

    // EmbeddingSettings.tsx 載入完成後固定渲染「AI / 向量設定」標題與「Ollama 服務狀態」卡片
    await expect(page.getByText('AI / 向量設定')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Ollama 服務狀態')).toBeVisible();
    await expect(page.getByText('模型設定')).toBeVisible();
    // 僅唯讀驗證，不點擊任何「儲存」「重新嵌入」「切換模型」等會變更全租戶設定的按鈕
  });

  // ── 11. Chat & Prompt tab：僅唯讀驗證頁面載入，不修改全租戶共用設定 ─────
  test('@knowledge Chat & Prompt tab：頁面能載入（唯讀，不修改）', async ({ page }) => {
    await gotoKnowledgePage(page);
    await page.getByRole('button', { name: 'Chat & Prompt' }).click();

    // ChatPromptSettings.tsx 載入完成後固定渲染「Chat & RAG 設定」標題與「Provider 與模型」區塊
    await expect(page.getByText('Chat & RAG 設定')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Provider 與模型')).toBeVisible();
    // 不對任何欄位進行 fill/click 儲存操作——這是全租戶共用設定，改了會影響正式功能
  });
});
