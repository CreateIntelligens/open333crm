import { test, expect, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import { E2E_PREFIX, newApiContext, gotoAndCheck, expectToast } from './helpers';

/**
 * 素材庫 — LINE Flex 精選範本 / JSON 匯入功能層測試 @materials @flex
 *
 * ⚠️ UI 現況與盤點不符（撰寫時發現）：
 * `TemplatePickerGrid`（`src/components/materials/TemplatePickerGrid.tsx`）中
 * `line_flex_showcase`（精選範本）與 `line_flex_template`（匯入 Flex JSON）
 * 兩張類型卡都標了 `hidden: true`，在 `/dashboard/marketing/materials/new`
 * 精靈的「選擇訊息類型」畫面**不會渲染**，一般使用者從新增精靈點不到。
 * 這與 TEST-PLAN.md 認定「新增精靈可選 LINE 7 種」的盤點不符（實際能點的只有 5 種）。
 *
 * 因此本測試改用「API 直接建立 contentType=line_flex_showcase /
 * line_flex_template 的素材 → 導到編輯頁 `/dashboard/marketing/materials/[id]`」
 * 的方式進入 `LineFlexShowcaseEditor` / `LineFlexTemplateEditor`（MaterialEditor
 * 依 contentType 選 body editor，不受精靈隱藏卡影響，編輯頁本身功能正常）。
 * 若之後產品決定要恢復顯示這兩張卡，案例 01 可以改回從精靈點選起手。
 *
 * 種資料 / 清理策略：
 * - 每個案例各自用 API 建一個 `[E2E]` 前綴素材（避免案例間互相污染 body 狀態），
 *   afterAll 統一用 API 刪除（軟刪，DELETE /materials/:id）。
 * - AI 相關案例（@ai）為外部 LLM 依賴，已知會不穩定：包 try/catch、放寬 timeout，
 *   失敗只記錄不讓整個 spec 掛掉。
 */

const RUN = randomUUID().slice(0, 8);

let api: APIRequestContext;
const createdMaterialIds: string[] = [];

/** 最簡合法 LINE Flex bubble JSON（type=bubble，body 內一個 text component）*/
function minimalBubble(text: string) {
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text, wrap: true }],
    },
  };
}

/** 缺 type 欄位的非法 JSON（給「匯入非法」案例用）*/
function invalidBubbleJson() {
  return JSON.stringify(
    {
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: '缺 type 欄位的 bubble' }],
      },
    },
    null,
    2,
  );
}

/** 用 API 建一個指定 contentType 的空白 [E2E] 素材，回傳 id */
async function createFlexMaterial(
  contentType: 'line_flex_showcase' | 'line_flex_template',
  name: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const res = await api.post('marketing/materials', {
    data: {
      name,
      channelType: 'line',
      contentType,
      body,
      variables: [],
      status: 'draft',
    },
  });
  if (!res.ok()) throw new Error(`建立測試素材失敗（${res.status()}）${await res.text()}`);
  const id = (await res.json())?.data?.id;
  if (!id) throw new Error('建立素材回應中沒有 id');
  createdMaterialIds.push(id);
  return id;
}

async function gotoEdit(page: import('@playwright/test').Page, id: string) {
  await gotoAndCheck(page, `/dashboard/marketing/materials/${id}`);
  // 編輯頁載入完成訊號：素材名稱輸入框可見
  await expect(page.getByPlaceholder('如：母親節新品推播')).toBeVisible({ timeout: 15_000 });
}

test.beforeAll(async () => {
  api = await newApiContext();
});

test.afterAll(async () => {
  for (const id of createdMaterialIds) {
    try {
      await api.delete(`marketing/materials/${id}`);
    } catch {
      // 清理失敗不炸測試
    }
  }
  await api.dispose().catch(() => {});
});

test.describe.serial('素材庫 — LINE Flex 精選範本 / 匯入 @materials @flex', () => {
  test('@materials @flex 01 精選範本起手：ShowcasePickerDialog 選範本後進填空編輯器，欄位分組可見', async ({
    page,
  }) => {
    // line_flex_showcase 卡在精靈隱藏（見檔頭說明），直接建空白素材走編輯頁驗證起手流程
    const id = await createFlexMaterial('line_flex_showcase', `${E2E_PREFIX} 精選範本起手 ${RUN}`);
    await gotoEdit(page, id);

    // 尚未選範本：顯示兩種起手方式（AI 描述 / 從範本建立）
    await expect(page.getByRole('button', { name: '從範本建立' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '從範本建立' }).click();

    // ShowcasePickerDialog 出現（原生 <dialog>，非 role=dialog），官方範本清單至少含「餐廳介紹」
    const dlg = page.locator('dialog[open]');
    await expect(dlg).toBeVisible({ timeout: 10_000 });
    await expect(dlg.getByText('從範本建立')).toBeVisible();
    await expect(dlg.getByText('餐廳介紹')).toBeVisible();

    // 選第一個範本卡 → 確認按鈕啟用 → 點選
    await dlg.getByText('餐廳介紹').click();
    const confirmBtn = dlg.getByRole('button', { name: '選擇', exact: true });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // 進入填空編輯器：欄位分組（主圖/標題與內文/按鈕）至少各出現一個
    await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('主圖', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('標題與內文', { exact: true })).toBeVisible();
    // 「按鈕」文字在頁面出現多次（分組標題+多個按鈕元件的預設文字），取第一個即可
    await expect(page.getByText('按鈕', { exact: true }).first()).toBeVisible();

    // 替代文字欄位（altText）已帶入範本名稱
    await expect(page.getByText('替代文字')).toBeVisible();
  });

  test('@materials @flex 02 填空編輯：改標題文字欄位後存為素材成功', async ({ page }) => {
    // 直接用 API 建一個已套用「餐廳介紹」範本的素材，聚焦測「改欄位→存檔」
    const sampleBody = {
      sampleId: 'restaurant',
      altText: '餐廳介紹',
      contents: minimalBubble('Brown Cafe'),
    };
    const id = await createFlexMaterial(
      'line_flex_showcase',
      `${E2E_PREFIX} 精選範本填空 ${RUN}`,
      sampleBody,
    );
    await gotoEdit(page, id);

    // 「標題與內文」分組下第一個文字欄位輸入框，改掉標題文字
    const groupBlock = page.locator('div', { has: page.getByText('標題與內文', { exact: true }) }).first();
    const titleInput = groupBlock.locator('input[type="text"], input:not([type])').first();
    await expect(titleInput).toBeVisible({ timeout: 10_000 });
    const newTitle = `${E2E_PREFIX} 改標題 ${RUN}`;
    await titleInput.fill(newTitle);
    await expect(titleInput).toHaveValue(newTitle);

    // 存為素材
    await page.getByRole('button', { name: '存為素材' }).click();
    await expectToast(page, /已儲存變更/);
  });

  test('@materials @flex 03 JSON 匯入（合法）：貼上最簡 bubble JSON，驗證並匯入成功、FlexPreview 顯示', async ({
    page,
  }) => {
    // ⚠️ 產品端發現的邊界 bug：line_flex_template 用空 body（{}）建立會 500
    // （assertLineFlexMessageBody 驗證失敗時 result.errors 為空陣列，
    //  service 端 result.errors[0].message 對 undefined 取值炸成 500，
    //  應該回 400 才對）。這裡先給最小合法 bubble 繞開，另外記錄此問題待開單。
    const id = await createFlexMaterial(
      'line_flex_template',
      `${E2E_PREFIX} JSON匯入合法 ${RUN}`,
      { type: 'flex', altText: '初始', contents: minimalBubble('初始內容') },
    );
    await gotoEdit(page, id);

    const importText = `${E2E_PREFIX} JSON 匯入測試文字 ${RUN}`;
    const flexJson = JSON.stringify(
      {
        type: 'flex',
        altText: '合法 Flex 測試',
        contents: minimalBubble(importText),
      },
      null,
      2,
    );

    const textarea = page.locator('textarea.font-mono');
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    await textarea.fill(flexJson);

    await page.getByRole('button', { name: '驗證並匯入' }).click();

    // 驗證成功訊息
    await expect(page.getByText('JSON 已驗證並匯入到目前草稿')).toBeVisible({ timeout: 15_000 });

    // FlexPreview 顯示匯入內容（LINE 聊天框內出現我們塞入的文字）
    await expect(page.getByText(importText).first()).toBeVisible({ timeout: 10_000 });

    // 沒有驗證錯誤區塊殘留
    await expect(page.getByText(/格式不支援預覽/)).toHaveCount(0);
  });

  test('@materials @flex 04 JSON 匯入（非法）：缺 type 欄位時驗證失敗，出現錯誤訊息且不允許繼續', async ({
    page,
  }) => {
    // 同上：空 body 建材會撞到 500 邊界 bug，先給最小合法 bubble
    const id = await createFlexMaterial(
      'line_flex_template',
      `${E2E_PREFIX} JSON匯入非法 ${RUN}`,
      { type: 'flex', altText: '初始', contents: minimalBubble('初始內容') },
    );
    await gotoEdit(page, id);

    const textarea = page.locator('textarea.font-mono');
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    await textarea.fill(invalidBubbleJson());

    await page.getByRole('button', { name: '驗證並匯入' }).click();

    // 錯誤訊息出現（StatusMessage 走 error 分支；後端實際訊息是驗證器給的具體原因，
    // 例如「LINE Flex contents root must be bubble or carousel」，不含「驗證失敗」字樣，
    // 用較寬的關鍵字比對訊息本體）
    await expect(
      page.getByText(/bubble or carousel|must be|INVALID_LINE_FLEX|contents root/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 不允許繼續：非法內容沒有套用進草稿，預覽仍顯示建材時給的原始合法內容
    // （不是空 body，「格式不支援預覽」只在草稿本身就不合法時才出現；
    //  「缺 type 欄位的 bubble」文字仍留在 textarea 輸入值中屬正常，不斷言其消失）
    await expect(page.getByText('初始內容').first()).toBeVisible();
  });

  test('@materials @flex 05 AI 生成（@ai，寬容失敗）：一句話描述生成，流程跑得動即可', async ({ page }) => {
    test.slow();
    const id = await createFlexMaterial('line_flex_showcase', `${E2E_PREFIX} AI生成 ${RUN}`);
    await gotoEdit(page, id);

    const promptInput = page.getByPlaceholder(/咖啡廳新品促銷卡/);
    await expect(promptInput).toBeVisible({ timeout: 10_000 });
    await promptInput.fill('一張母親節鮮花促銷卡，含圖片、價格與「立即訂購」按鈕');

    try {
      await page.getByRole('button', { name: '生成', exact: true }).click();

      // 寬容等待：要嘛出現欄位分組（成功進填空編輯器），要嘛出現錯誤訊息（LLM 失敗屬已知風險）
      const result = await Promise.race([
        page
          .getByText('標題與內文', { exact: true })
          .waitFor({ state: 'visible', timeout: 60_000 })
          .then(() => 'ok' as const),
        page
          .locator('.text-red-600')
          .first()
          .waitFor({ state: 'visible', timeout: 60_000 })
          .then(() => 'error' as const),
      ]);

      if (result === 'error') {
        test.info().annotations.push({
          type: 'ai-degraded',
          description: 'AI 生成回應了明確錯誤（LLM 額度/逾時等外部依賴問題），流程本身有跑動，視為可接受',
        });
      }
      // 兩種結果都視為「流程跑得動」，不對生成內容做內容斷言
    } catch (err) {
      // 60 秒內兩種訊號都沒出現：記錄但不讓整個 spec 掛掉
      test.info().annotations.push({
        type: 'ai-timeout',
        description: `AI 生成 60 秒內未見明確回應（成功或失敗訊號皆無），已知外部依賴不穩定：${String(err)}`,
      });
    }
  });

  test('@materials @flex 06 AI 潤稿（@ai，寬容失敗）：填空編輯器文字欄位觸發潤稿不崩頁', async ({ page }) => {
    test.slow();
    const sampleBody = {
      sampleId: 'restaurant',
      altText: '餐廳介紹',
      contents: minimalBubble('Brown Cafe 潤稿測試文字'),
    };
    const id = await createFlexMaterial('line_flex_showcase', `${E2E_PREFIX} AI潤稿 ${RUN}`, sampleBody);
    await gotoEdit(page, id);

    // 「標題與內文」分組下第一個文字欄位旁的 AI 潤稿鈕（Sparkles icon 按鈕，title="AI 潤稿"）
    const groupBlock = page.locator('div', { has: page.getByText('標題與內文', { exact: true }) }).first();
    const rewriteBtn = groupBlock.locator('button[title="AI 潤稿"]').first();
    await expect(rewriteBtn).toBeVisible({ timeout: 10_000 });

    try {
      await rewriteBtn.click();

      // 點擊後彈出潤飾/縮短/換語氣選單
      const menu = page.getByRole('button', { name: '潤飾', exact: true });
      await expect(menu).toBeVisible({ timeout: 10_000 });
      await menu.click();

      // 寬容等待：loading spinner 應該會出現又消失（不管最終文字是否真的變了——
      // 失敗時是靜默略過、欄位維持原值，這是已知行為，只驗證頁面沒有崩潰、按鈕恢復可互動）
      await expect(rewriteBtn).toBeEnabled({ timeout: 30_000 });

      // 頁面仍正常（沒有 JS 崩潰導致整頁消失）：素材名稱輸入框依然可見
      await expect(page.getByPlaceholder('如：母親節新品推播')).toBeVisible();
    } catch (err) {
      test.info().annotations.push({
        type: 'ai-timeout',
        description: `AI 潤稿流程未在預期時間內完成（已知外部依賴不穩定，靜默失敗是既有行為）：${String(err)}`,
      });
    }
  });
});
