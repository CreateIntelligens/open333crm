import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import { E2E_PREFIX, newApiContext, gotoAndCheck } from './helpers';
import {
  FieldSamples,
  boundarySamples,
  strOfLength,
  inventoryFields,
  formatFieldInventory,
  setField,
  submitAndObserve,
  expectRejected,
  expectAccepted,
  apiFieldCheck,
  expectNoXssExecuted,
} from './field-helpers';

/**
 * Wave 6 欄位級測試 — 素材庫（Materials）
 *
 * 讀碼取得的真實約束（../api/src/modules/marketing/material.routes.ts + material.service.ts）：
 *   createMaterialSchema  name 1-200｜description ≤500｜category ≤100｜categoryId uuid|null
 *                         tags array ≤20，每個 1-40｜status enum draft|approved
 *                         channelType enum line|fb｜contentType enum（LINE 7 + FB 9）
 *                         previewImageUrl 必須是合法 url
 *   createCategorySchema  name 1-100｜parentId uuid|null｜sortOrder int
 *   lineFlexValidate/Import  altText ≤400｜payload 必須是 bubble/carousel 物件
 *                            JSON 總長 ≤120,000（MAX_FLEX_TEMPLATE_JSON_LENGTH）
 *   lineFlexAiGenerate    prompt 1-500
 *
 * ⚠️ 關鍵架構事實：`validateLineMaterialWithLineApi`（material.service.ts:251）會在存檔前
 * 用 buildLineMessage 組出 LINE 訊息，再真的打 LINE 官方 /v2/bot/message/validate/push。
 * 因此 LINE 版型的欄位約束（文字 ≤5000、圖片須 HTTPS…）**不是本專案 zod 擋的，是 LINE 擋的**，
 * 錯誤碼一律 LINE_MATERIAL_VALIDATE_FAILED。這條路徑對 line_flex_showcase / line_flex_template
 * 直接 return（不驗），是本檔案找到數個驗證缺口的根因。
 *
 * ⚠️ 環境紅線遵守：全程不觸發任何真正的對外發送（LINE validate/push 是官方提供的
 * 「只驗不送」端點，由後端既有儲存流程自行呼叫，非本測試主動發訊）。
 *
 * 已知踩坑（Wave 2）複查結果：
 *   - line_flex_showcase / line_flex_template 在精靈仍是 hidden:true → 本檔用 API 直建再走編輯頁
 *   - 「line_flex_template 空 body 回 500」**已修復**，現在回 400 INVALID_LINE_FLEX_PAYLOAD（見案例 F1）
 *   - `[E2E]` 含正規表達式字元類別語法，本檔一律用字串子字串比對，不塞 new RegExp()
 */

// 不使用 serial：單一案例失敗不應讓後續 50 個案例 skip（欄位測試彼此獨立，各自種/清資料）
test.describe.configure({ mode: 'default', retries: 0 });

const RUN = randomUUID().slice(0, 6);
const MATERIALS_PATH = '/dashboard/marketing/materials';

/** 合法且能通過 LINE validate 的最小 body（圖片必須 HTTPS，LINE 強制） */
const OK_IMAGE = 'https://example.com/e2e-sample.jpg';

let api: APIRequestContext;
const createdMaterialIds: string[] = [];
const createdCategoryIds: string[] = [];

/** 用 API 建素材並登記待清理，回傳 id */
async function createMaterial(payload: Record<string, unknown>): Promise<string> {
  const res = await api.post('marketing/materials', { data: payload });
  const body = await res.json();
  expect(res.status(), `種素材失敗：${JSON.stringify(body)}`).toBeLessThan(300);
  const id = body.data.id as string;
  createdMaterialIds.push(id);
  return id;
}

/** 最小合法 flex bubble */
function bubble(text: string) {
  return {
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text, wrap: true }] },
  };
}


/**
 * 新增精靈選型：TemplatePickerGrid 是「先選平台、再點類型卡」的兩步驟 master-detail。
 * 類型卡 label 是短名（「純文字」而非「LINE 純文字」），且卡片是 role=button 的 div。
 * 平台預設為 LINE，選 FB 要先點平台卡。
 */
async function pickType(page: Page, channel: 'line' | 'fb', typeLabel: string): Promise<void> {
  await expect(page.getByRole('heading', { name: '選擇訊息類型' })).toBeVisible({ timeout: 15_000 });
  if (channel === 'fb') {
    await page.getByRole('button', { name: /FB Messenger/ }).first().click();
  }
  // 類型卡：role=button 且標題文字完全等於 typeLabel
  const card = page.locator('[role="button"]').filter({
    has: page.locator('div.text-sm.font-semibold', { hasText: new RegExp(`^${typeLabel}$`) }),
  });
  await card.first().click();
  await expect(page.getByText('素材名稱')).toBeVisible({ timeout: 15_000 });
}

/** 精靈內目前可見的類型卡標題清單 */
async function visibleTypeLabels(page: Page): Promise<string[]> {
  return page.locator('[role="button"] div.text-sm.font-semibold').allTextContents();
}

test.beforeAll(async () => {
  api = await newApiContext();
});

test.afterAll(async () => {
  if (!api) return;
  for (const id of createdMaterialIds) {
    try { await api.delete(`marketing/materials/${id}`); } catch { /* 清理失敗略過 */ }
  }
  for (const id of createdCategoryIds) {
    try { await api.delete(`marketing/materials/categories/${id}`); } catch { /* 清理失敗略過 */ }
  }
  await api.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// A. 列表頁欄位：搜尋 / 分類 / 標籤 / 排序
// ───────────────────────────────────────────────────────────────────────

test.describe('@fields @materials A. 列表頁篩選欄位', () => {
  test('A0 欄位盤點：列表頁所有輸入元素', async ({ page }) => {
    await gotoAndCheck(page, MATERIALS_PATH);
    await expect(page.getByRole('heading', { name: '訊息素材' })).toBeVisible({ timeout: 15_000 });
    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '素材庫列表頁'));
    // 至少要有搜尋框與排序下拉
    expect(fields.some((f) => f.placeholder === '搜尋素材名稱'), '搜尋框應存在').toBe(true);
    expect(fields.some((f) => f.tag === 'select' && f.label === '排序方式'), '排序下拉應存在').toBe(true);
  });

  test('A1 搜尋框：特殊字元不炸、XSS 不執行、空查詢回全部', async ({ page }) => {
    await gotoAndCheck(page, MATERIALS_PATH);
    const search = page.getByPlaceholder('搜尋素材名稱');
    await expect(search).toBeVisible({ timeout: 15_000 });

    // 逐一餵入危險/邊界字串，每次都要求 GET /materials 回 2xx（不能 500）
    const payloads = [FieldSamples.sqlish, FieldSamples.xss, FieldSamples.emoji, '%', '_', FieldSamples.fullwidthSpace];
    for (const value of payloads) {
      const result = await submitAndObserve(
        page,
        async () => { await setField(search, value); },
        /\/marketing\/materials\?/,
        'GET',
        6_000,
      );
      if (result.requested) {
        expect(result.status, `搜尋「${value}」：查詢不該回 ${result.status}`).toBeLessThan(400);
      }
    }
    await expectNoXssExecuted(page);
    // 清空後仍正常
    await setField(search, '');
    await expect(page.getByRole('heading', { name: '訊息素材' })).toBeVisible();
  });

  test('A2 搜尋框：超長字串（1000 字）不應 5xx', async ({ page }) => {
    await gotoAndCheck(page, MATERIALS_PATH);
    const search = page.getByPlaceholder('搜尋素材名稱');
    const result = await submitAndObserve(
      page,
      async () => { await setField(search, strOfLength(1000)); },
      /\/marketing\/materials\?/,
      'GET',
      8_000,
    );
    if (result.requested) {
      expect(result.status, '1000 字搜尋不該讓後端掛掉').toBeLessThan(500);
    }
  });

  test('A3 排序下拉：四個合法值皆可送出；非法 sort 值後端應安全忽略（不 5xx）', async ({ page }) => {
    await gotoAndCheck(page, MATERIALS_PATH);
    const sortSelect = page.getByLabel('排序方式');
    for (const value of ['recent_used', 'most_used', 'updated', 'name']) {
      const result = await submitAndObserve(
        page,
        async () => { await sortSelect.selectOption(value); },
        /\/marketing\/materials\?/,
        'GET',
        8_000,
      );
      if (result.requested) expectAccepted(result, `排序=${value}`);
    }
    // 後端直測非法 sort：route 用白名單過濾（SORT_VALUES.includes），預期 fallback 不報錯
    const res = await api.get('marketing/materials?sort=__bogus__&limit=1');
    expect(res.status(), '非法 sort 應被安全忽略而非 5xx').toBeLessThan(500);
  });

  test('A4 [BUG P1] 列表 page=0 / page=-1 造成 500 INTERNAL_ERROR', async () => {
    // 根因：material.service.ts listMaterials 的 `skip: (page - 1) * limit` 沒有下限夾制，
    // page=0 → skip=-50、page=-1 → skip=-100，Prisma 拒收負數 skip，例外冒泡成 500。
    // route 只做 `q.page ? Number(q.page) : 1`，沒有 zod schema 也沒有 clamp。
    const offenders: string[] = [];
    for (const qs of ['page=0', 'page=-1', 'page=-999']) {
      const res = await api.get(`marketing/materials?${qs}`);
      if (res.status() >= 500) offenders.push(`${qs}→${res.status()}`);
    }
    if (offenders.length) {
      console.log(
        `⚠️ BUG(P1) 列表查詢參數未夾制造成 5xx：${offenders.join('、')}。` +
        '重現：GET /api/v1/marketing/materials?page=0（任何登入身分皆可觸發）。' +
        '修法：route 層對 page/limit 加 zod coerce + min(1)，或 service 內 Math.max(1, page)。',
      );
    }
    expect(offenders, '記錄目前缺陷（修好後此陣列應為空，本斷言需反向調整）').not.toHaveLength(0);
  });

  test('A5 列表其餘查詢參數：非法值不得 5xx', async () => {
    const bad: string[] = [];
    for (const qs of [
      'page=abc', 'page=999999999999999999999',
      'limit=-5', 'limit=0', 'limit=abc', 'limit=100000',
      'isActive=notabool', 'tags=,,,', 'status=__bogus__', 'q=%', 'sort=__bogus__',
    ]) {
      const res = await api.get(`marketing/materials?${qs}`);
      if (res.status() >= 500) bad.push(`${qs}→${res.status()}`);
    }
    expect(bad, `以下查詢參數造成 5xx：${bad.join('、')}`).toHaveLength(0);
  });

  test('A6 列表 categoryId 非法 uuid：回 400 但錯誤訊息外洩 Prisma 內部細節（P3）', async () => {
    const res = await api.get('marketing/materials?categoryId=notauuid');
    expect(res.status(), '非法 categoryId 應 4xx 不得 5xx').toBeLessThan(500);
    const text = await res.text();
    if (text.includes('prisma.material.findMany')) {
      console.log(
        '⚠️ BUG(P3) GET /materials?categoryId=notauuid 的錯誤訊息把 Prisma 查詢語句原文回給前端：' +
        '「Invalid `prisma.material.findMany()` invocation: Inconsistent column data…」，' +
        '洩漏 ORM 與資料表結構細節。應在 route 層先用 zod uuid 驗 categoryId。',
      );
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// B. 分類管理欄位：名稱長度邊界 / 重複名稱 / 父分類
// ───────────────────────────────────────────────────────────────────────

test.describe('@fields @materials B. 分類管理欄位', () => {
  test('B0 欄位盤點：分類管理 dialog', async ({ page }) => {
    await gotoAndCheck(page, MATERIALS_PATH);
    await page.getByRole('button', { name: '管理' }).first().click();
    await expect(page.getByText('管理分類')).toBeVisible({ timeout: 10_000 });
    const fields = await inventoryFields(page, 'dialog');
    console.log(formatFieldInventory(fields, '分類管理 dialog'));
    expect(fields.some((f) => f.placeholder === '新增分類名稱…'), '新增分類名稱輸入框應存在').toBe(true);
    expect(fields.some((f) => f.label === '上層分類'), '上層分類下拉應存在').toBe(true);
    // 前端未對分類名稱設 maxLength（後端 zod 是 100）——記錄前後端一致性
    const nameField = fields.find((f) => f.placeholder === '新增分類名稱…');
    console.log(`  分類名稱 maxLength（前端）= ${nameField?.maxLength ?? '未設定'}；後端 zod max = 100`);
  });

  test('B1 分類名稱必填：空白 / 全形空白的擋控行為', async ({ page }) => {
    await gotoAndCheck(page, MATERIALS_PATH);
    await page.getByRole('button', { name: '管理' }).first().click();
    const nameInput = page.getByPlaceholder('新增分類名稱…');
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    const addBtn = page.getByRole('button', { name: '新增' });

    // 空值：前端 disabled（!newName.trim()）→ 按鈕不可點
    await expect(addBtn, '空名稱時新增按鈕應 disabled').toBeDisabled();

    // 純半形空白：handleCreate 有 trim() 檢查 → 仍應 disabled
    await setField(nameInput, FieldSamples.whitespace);
    await expect(addBtn, '純空白名稱時新增按鈕應 disabled（trim 後為空）').toBeDisabled();

    // 全形空白：String.trim() 會吃掉 U+3000，因此前端也應擋下
    await setField(nameInput, FieldSamples.fullwidthSpace);
    await expect(addBtn, '全形空白名稱時新增按鈕應 disabled').toBeDisabled();
  });

  test('B2 分類名稱長度邊界：99 / 100 接受，101 應被擋（後端 zod max 100）', async () => {
    const { under, exact, over } = boundarySamples(100);
    for (const [label, value] of [['under(99)', under], ['exact(100)', exact]] as const) {
      const res = await api.post('marketing/materials/categories', { data: { name: value } });
      expect(res.status(), `分類名稱 ${label} 應被接受`).toBeLessThan(300);
      const b = await res.json();
      createdCategoryIds.push(b.data.id);
    }
    await apiFieldCheck(api, {
      path: 'marketing/materials/categories',
      payload: { name: over },
      expect: 'reject',
      context: '分類名稱 over(101)',
    });
  });

  test('B3 分類名稱：後端未 trim，純空白可直接繞過前端寫入（P2 驗證缺口）', async () => {
    // 前端 B1 已證明按鈕會 disabled，但後端 zod 只有 min(1) 沒有 trim → 直打 API 可寫入
    const res = await api.post('marketing/materials/categories', { data: { name: FieldSamples.whitespace } });
    const body = await res.json();
    if (res.status() < 300) {
      createdCategoryIds.push(body.data.id);
      console.log(
        '⚠️ BUG(P2) 分類名稱純空白「   」可經 API 寫入（zod 僅 min(1) 未 trim），' +
        `前端 disabled 擋控可被繞過。實際存入 name=${JSON.stringify(body.data.name)}`,
      );
      expect(body.data.name, '記錄：後端原樣保存未 trim 的空白名稱').toBe(FieldSamples.whitespace);
    } else {
      // 若之後修掉了，這裡會走到——改為斷言已擋下
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
  });

  test('B4 分類重複名稱：目前允許同名並存（無唯一約束，記錄為 P3）', async () => {
    const dupName = `${E2E_PREFIX} 重複分類 ${RUN}`;
    const ids: string[] = [];
    for (const n of [1, 2]) {
      const res = await api.post('marketing/materials/categories', { data: { name: dupName } });
      expect(res.status(), `第 ${n} 次建立同名分類`).toBeLessThan(300);
      const b = await res.json();
      ids.push(b.data.id);
      createdCategoryIds.push(b.data.id);
    }
    expect(ids[0]).not.toBe(ids[1]);
    console.log(
      `⚠️ 行為記錄(P3)：同名分類「${dupName}」可重複建立（DB 無 unique 約束），` +
      'UI 分類樹會出現兩個字面完全相同的項目，使用者無法分辨。',
    );
  });

  test('B5 分類欄位格式：parentId 非法 uuid / 不存在 / 自我循環 / sortOrder 小數', async () => {
    const parent = await api.post('marketing/materials/categories', { data: { name: `${E2E_PREFIX} 父 ${RUN}` } });
    const parentBody = await parent.json();
    const parentId = parentBody.data.id as string;
    createdCategoryIds.push(parentId);

    await apiFieldCheck(api, {
      path: 'marketing/materials/categories',
      payload: { name: `${E2E_PREFIX} badparent`, parentId: FieldSamples.badUuid },
      expect: 'reject',
      context: 'parentId 非法 uuid',
    });
    await apiFieldCheck(api, {
      path: 'marketing/materials/categories',
      payload: { name: `${E2E_PREFIX} nosuchparent`, parentId: '11111111-2222-3333-4444-555555555555' },
      expect: 'reject',
      context: 'parentId 不存在（應 404）',
    });
    await apiFieldCheck(api, {
      path: 'marketing/materials/categories',
      payload: { name: `${E2E_PREFIX} floatsort`, sortOrder: 1.5 },
      expect: 'reject',
      context: 'sortOrder 小數（zod int）',
    });
    // 自我循環：把自己設成自己的父
    await apiFieldCheck(api, {
      path: `marketing/materials/categories/${parentId}`,
      method: 'patch',
      payload: { parentId },
      expect: 'reject',
      context: '分類自我循環（CATEGORY_CYCLE）',
    });
  });

  test('B6 分類改名：UI 改名往返 + XSS 存為純文字', async ({ page }) => {
    const origName = `${E2E_PREFIX} 待改名 ${RUN}`;
    const res = await api.post('marketing/materials/categories', { data: { name: origName } });
    const created = await res.json();
    const catId = created.data.id as string;
    createdCategoryIds.push(catId);

    await gotoAndCheck(page, MATERIALS_PATH);
    await page.getByRole('button', { name: '管理' }).first().click();
    const dialog = page.getByRole('dialog');
    // dialog 內該分類的名稱 span（同名字串也出現在左側分類樹與 <option>，故限定 dialog 範圍且 exact）
    const nameSpan = dialog.getByText(origName, { exact: true });
    await expect(nameSpan).toBeVisible({ timeout: 10_000 });

    // 該分類列 = 名稱 span 的祖父容器；列內兩顆 button 依序是「改名(鉛筆)」「刪除(垃圾桶)」
    const row = nameSpan.locator('xpath=ancestor::div[contains(@class,"justify-between")][1]');
    await row.locator('button').first().click();

    // 點下鉛筆後該列整個換成編輯模式（名稱 span 被卸載），原 row locator 失效 →
    // 改抓 dialog 內「帶 autoFocus 的編輯 input」：它是 dialog 內唯一 h-7 的 input
    const xssName = `${E2E_PREFIX}改名${FieldSamples.xss}`;
    const editInput = dialog.locator('input.h-7').first();
    await expect(editInput, '點鉛筆後應出現行內改名輸入框').toBeVisible({ timeout: 10_000 });
    const result = await submitAndObserve(
      page,
      async () => {
        await setField(editInput, xssName);
        await editInput.press('Enter');
      },
      /\/marketing\/materials\/categories\//,
      'PATCH',
      8_000,
    );
    expectAccepted(result, '分類改名（含 XSS 字串）');

    // XSS 不應執行，且值應原樣存回
    await page.reload({ waitUntil: 'networkidle' });
    await expectNoXssExecuted(page);
    const after = await api.get('marketing/materials/category-tree');
    const tree = await after.json();
    const found = (tree.data as Array<{ id: string; name: string }>).find((c) => c.id === catId);
    expect(found?.name, '分類改名往返：含 <script> 的名稱應原樣保存為純文字').toBe(xssName);
  });
});

// ───────────────────────────────────────────────────────────────────────
// C. 新增精靈：類型選擇 + 基本資訊欄位（名稱 / 分類 / 描述）
// ───────────────────────────────────────────────────────────────────────

test.describe('@fields @materials C. 新增精靈基本資訊欄位', () => {
  test('C0 欄位盤點：類型選擇畫面 + LINE 純文字編輯器', async ({ page }) => {
    await gotoAndCheck(page, `${MATERIALS_PATH}/new`);
    await expect(page.getByRole('heading', { name: '選擇訊息類型' })).toBeVisible({ timeout: 15_000 });

    // 精靈實際可點的 LINE 類型卡（驗證 flex 兩張仍被 hidden:true）
    const lineLabels = await visibleTypeLabels(page);
    console.log(`  LINE 平台可見類型卡（${lineLabels.length}）：${lineLabels.join('、')}`);
    expect(lineLabels, 'line_flex_showcase 在精靈仍隱藏（已知現況）').not.toContain('精選範本');
    expect(lineLabels, 'line_flex_template 在精靈仍隱藏（已知現況）').not.toContain('匯入 Flex JSON');
    expect(lineLabels.length, 'LINE 實際可選 5 種（7 種定義 - 2 種 hidden）').toBe(5);

    // 切到 FB 看可見類型卡
    await page.getByRole('button', { name: /FB Messenger/ }).first().click();
    const fbLabels = await visibleTypeLabels(page);
    console.log(`  FB 平台可見類型卡（${fbLabels.length}）：${fbLabels.join('、')}`);
    expect(fbLabels.length, 'FB 9 種全部可選').toBe(9);

    await gotoAndCheck(page, `${MATERIALS_PATH}/new`);
    await pickType(page, 'line', '純文字');
    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '新增精靈 — LINE 純文字'));
    const textarea = fields.find((f) => f.tag === 'textarea' && f.maxLength === 5000);
    expect(textarea, 'LINE 文字內容 textarea 應有 maxLength=5000（對齊 LINE 上限）').toBeTruthy();
  });

  test('C1 素材名稱必填：清空後按存檔應被前端擋下且不發 API', async ({ page }) => {
    await gotoAndCheck(page, `${MATERIALS_PATH}/new`);
    await pickType(page, 'line', '純文字');

    const nameInput = page.getByPlaceholder('如：母親節新品推播');
    await setField(nameInput, '');

    // ⚠️ 「素材名稱必填」toast 4 秒後自動淡出（new/page.tsx useEffect），
    // 若等 submitAndObserve 跑完再斷言就已消失 → 在同一個 submit 內先驗 toast。
    let toastSeen = false;
    const result = await submitAndObserve(
      page,
      async () => {
        await page.getByRole('button', { name: '存為素材' }).click();
        toastSeen = await page.getByText('素材名稱必填')
          .isVisible({ timeout: 3_000 })
          .catch(() => false);
      },
      /\/marketing\/materials$/,
      'POST',
      4_000,
    );
    expectRejected(result, '素材名稱留空');
    expect(result.requested, '名稱留空時前端應擋下不發 API').toBe(false);
    expect(toastSeen, '名稱留空應顯示「素材名稱必填」提示').toBe(true);
  });

  test('C2 素材名稱：純空白 / 全形空白的前後端一致性', async ({ page }) => {
    await gotoAndCheck(page, `${MATERIALS_PATH}/new`);
    await pickType(page, 'line', '純文字');
    const nameInput = page.getByPlaceholder('如：母親節新品推播');

    for (const [label, value] of [['純空白', FieldSamples.whitespace], ['全形空白', FieldSamples.fullwidthSpace]] as const) {
      await setField(nameInput, value);
      const result = await submitAndObserve(
        page,
        async () => { await page.getByRole('button', { name: '存為素材' }).click(); },
        /\/marketing\/materials$/,
        'POST',
        4_000,
      );
      // 前端 draft.name.trim() 檢查會擋下（trim 也吃全形空白）
      expect(result.requested, `素材名稱「${label}」前端應擋下`).toBe(false);
    }

    // 後端直測：zod 只有 min(1) 無 trim → 純空白可繞過寫入（驗證缺口）
    const res = await api.post('marketing/materials', {
      data: { name: FieldSamples.whitespace, channelType: 'fb', contentType: 'fb_text', body: { text: 'x' } },
    });
    const body = await res.json();
    if (res.status() < 300) {
      createdMaterialIds.push(body.data.id);
      console.log(
        '⚠️ BUG(P2) 素材名稱純空白可經 API 繞過寫入（zod name 僅 min(1) 未 trim），' +
        '列表頁會出現看似無名的素材列。',
      );
    }
    expect(res.status(), '記錄目前行為（未 trim → 2xx）').toBeLessThan(500);
  });

  test('C3 素材名稱長度邊界：199 / 200 接受、201 擋下（後端 zod max 200）', async () => {
    const { under, exact, over } = boundarySamples(200);
    for (const [label, value] of [['under(199)', under], ['exact(200)', exact]] as const) {
      const id = await createMaterial({
        name: value, channelType: 'fb', contentType: 'fb_text', body: { text: 'x' },
      });
      expect(id, `素材名稱 ${label} 應可建立`).toBeTruthy();
    }
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { name: over, channelType: 'fb', contentType: 'fb_text', body: { text: 'x' } },
      expect: 'reject',
      context: '素材名稱 over(201)',
    });
  });

  test('C4 描述 / 分類字串欄位邊界：description ≤500、category ≤100', async () => {
    const base = { channelType: 'fb', contentType: 'fb_text', body: { text: 'x' } };
    // description 500 接受、501 擋
    const okId = await createMaterial({ ...base, name: `${E2E_PREFIX} desc500 ${RUN}`, description: strOfLength(500) });
    expect(okId).toBeTruthy();
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, name: `${E2E_PREFIX} desc501`, description: strOfLength(501) },
      expect: 'reject',
      context: 'description over(501)',
    });
    // category 100 接受、101 擋
    const okCat = await createMaterial({ ...base, name: `${E2E_PREFIX} cat100 ${RUN}`, category: strOfLength(100) });
    expect(okCat).toBeTruthy();
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, name: `${E2E_PREFIX} cat101`, category: strOfLength(101) },
      expect: 'reject',
      context: 'category over(101)',
    });
  });

  test('C5 列舉欄位後端直測：channelType / contentType / status 非法值應 4xx', async () => {
    const base = { name: `${E2E_PREFIX} enum ${RUN}`, body: { text: 'x' } };
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, channelType: 'webchat', contentType: 'line_text' },
      expect: 'reject',
      context: 'channelType=webchat（素材只支援 line|fb）',
    });
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, channelType: 'line', contentType: 'line_bogus' },
      expect: 'reject',
      context: 'contentType 非法 enum',
    });
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, channelType: 'fb', contentType: 'fb_text', status: 'published' },
      expect: 'reject',
      context: 'status 非法 enum（僅 draft|approved）',
    });
    // channelType 與 contentType 交叉不一致
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, channelType: 'fb', contentType: 'line_text' },
      expect: 'reject',
      context: 'channel/content 不一致（line_text + fb）',
    });
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, channelType: 'line', contentType: 'fb_text' },
      expect: 'reject',
      context: 'channel/content 不一致（fb_text + line）',
    });
  });

  test('C6 previewImageUrl / categoryId 格式驗證', async () => {
    const base = { name: `${E2E_PREFIX} fmt ${RUN}`, channelType: 'fb', contentType: 'fb_text', body: { text: 'x' } };
    // zod 的 .url() 用 `new URL()` 判定，只要能 parse 就算合法 → 任意 scheme 都會過。
    // 真正被擋的只有「完全不像 URL」的字串。
    for (const bad of ['notaurl', 'example.com', '   ']) {
      await apiFieldCheck(api, {
        path: 'marketing/materials',
        payload: { ...base, previewImageUrl: bad },
        expect: 'reject',
        context: `previewImageUrl 非法「${bad}」`,
      });
    }
    // 非 http(s) scheme 的「URL」目前全部放行——含 javascript: 這種可注入 scheme
    const leaked: string[] = [];
    for (const scheme of ['ftp:/x', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd']) {
      const res = await api.post('marketing/materials', {
        data: { ...base, name: `${E2E_PREFIX} scheme ${RUN}`, previewImageUrl: scheme },
      });
      const b = await res.json();
      if (res.status() < 300) { createdMaterialIds.push(b.data.id); leaked.push(scheme); }
      expect(res.status(), `previewImageUrl「${scheme}」不得 5xx`).toBeLessThan(500);
    }
    if (leaked.length) {
      console.log(
        `⚠️ BUG(P2) previewImageUrl 接受非 http(s) scheme：${leaked.join('、')}。` +
        'zod `.string().url()` 只做 `new URL()` 可解析性檢查，不限制 protocol，' +
        '因此 javascript: / data: / file: 都能寫入。該欄位的值會被前端當圖片網址渲染（素材卡縮圖），' +
        '建議改為 `.url().refine(s => /^https?:/i.test(s))`，與 routes.ts 既有的 URI_SCHEME_RE 一致。',
      );
    }
    const goodId = await createMaterial({ ...base, name: `${E2E_PREFIX} url ok ${RUN}`, previewImageUrl: FieldSamples.goodUrls[0] });
    expect(goodId).toBeTruthy();

    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, categoryId: FieldSamples.badUuid },
      expect: 'reject',
      context: 'categoryId 非法 uuid',
    });
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, categoryId: '11111111-2222-3333-4444-555555555555' },
      expect: 'reject',
      context: 'categoryId 不存在 / 不屬於本租戶（應 404，跨租戶隔離）',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────
// D. 內容欄位：LINE 文字 5000 邊界 / 圖片 URL / FB 文字
// ───────────────────────────────────────────────────────────────────────

test.describe('@fields @materials D. 版型內容欄位', () => {
  test('D1 LINE 文字：前端 maxLength=5000 實際擋不住超長貼上？（前端行為）', async ({ page }) => {
    await gotoAndCheck(page, `${MATERIALS_PATH}/new`);
    await pickType(page, 'line', '純文字');
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 10_000 });

    // fill() 會繞過 maxLength（等同 paste 行為的極端情況），檢查實際落值長度
    await textarea.fill(strOfLength(6000));
    const actualLen = await textarea.inputValue().then((v) => v.length);
    console.log(`  LINE 文字 textarea 填入 6000 字後實際長度 = ${actualLen}（maxLength 屬性 = 5000）`);
    expect(actualLen, '前端 maxLength=5000 應把 6000 字截到 5000（與 LINE 上限一致）').toBe(5000);
  });

  test('D2 LINE 文字長度邊界：5000 接受、5001 被 LINE validate 擋下', async () => {
    const base = { channelType: 'line', contentType: 'line_text' };
    // exact 5000：LINE 官方上限
    const okId = await createMaterial({ ...base, name: `${E2E_PREFIX} text5000 ${RUN}`, body: { text: strOfLength(5000) } });
    expect(okId, 'LINE 文字 5000 字應被接受').toBeTruthy();
    // over 5001
    const res = await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, name: `${E2E_PREFIX} text5001`, body: { text: strOfLength(5001) } },
      expect: 'reject',
      context: 'LINE 文字 5001 字',
    });
    expect(JSON.stringify(res.body), '錯誤應來自 LINE validate API（證明真的有打）')
      .toContain('LINE_MATERIAL_VALIDATE_FAILED');
  });

  test('D3 LINE 文字必填：空字串 / 純空白應被擋下', async () => {
    const base = { channelType: 'line', contentType: 'line_text' };
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, name: `${E2E_PREFIX} emptytext`, body: { text: '' } },
      expect: 'reject',
      context: 'LINE 文字空字串（LINE: May not be empty）',
    });
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, name: `${E2E_PREFIX} nobody`, body: {} },
      expect: 'reject',
      context: 'LINE 文字 body 缺 text',
    });
  });

  test('D4 LINE 文字往返：padded / emoji / newline / XSS 原樣保存', async () => {
    const base = { channelType: 'line', contentType: 'line_text' };
    const cases: Array<[string, string]> = [
      ['padded', FieldSamples.padded],
      ['emoji', FieldSamples.emoji],
      ['newline', FieldSamples.newline],
      ['xss', FieldSamples.xss],
      ['sqlish', FieldSamples.sqlish],
    ];
    for (const [label, value] of cases) {
      const id = await createMaterial({ ...base, name: `${E2E_PREFIX} rt ${label} ${RUN}`, body: { text: value } });
      const res = await api.get(`marketing/materials/${id}`);
      const body = await res.json();
      expect(
        (body.data.body as { text: string }).text,
        `LINE 文字往返（${label}）：存回的值應與輸入完全一致（不得被 trim / 轉義 / 截斷）`,
      ).toBe(value);
    }
  });

  test('D5 LINE 文字 XSS：編輯頁顯示為純文字不執行', async ({ page }) => {
    const id = await createMaterial({
      name: `${E2E_PREFIX} xss view ${RUN}`,
      channelType: 'line', contentType: 'line_text',
      body: { text: FieldSamples.xss },
    });
    await gotoAndCheck(page, `${MATERIALS_PATH}/${id}`);
    await expect(page.getByText('素材名稱')).toBeVisible({ timeout: 15_000 });
    await expectNoXssExecuted(page);
    // textarea 內應原樣呈現字串
    const textarea = page.locator('textarea').first();
    expect(await textarea.inputValue()).toBe(FieldSamples.xss);
  });

  test('D6 LINE 圖片 URL：非 HTTPS / 相對路徑 / 非法 URL 一律被 LINE validate 擋下', async () => {
    const base = { channelType: 'line', contentType: 'line_image' };
    const badUrls = [
      ['非法字串', 'notaurl'],
      ['http 非加密', 'http://example.com/a.jpg'],
      ['相對路徑（前端預設樣圖）', '/material-samples/cafe.jpeg'],
      ['空字串', ''],
    ] as const;
    for (const [label, url] of badUrls) {
      await apiFieldCheck(api, {
        path: 'marketing/materials',
        payload: { ...base, name: `${E2E_PREFIX} img ${label}`, body: { mediaUrl: url, previewUrl: url } },
        expect: 'reject',
        context: `LINE 圖片 mediaUrl「${label}」`,
      });
    }
    // 合法 HTTPS 接受
    const okId = await createMaterial({
      ...base, name: `${E2E_PREFIX} img ok ${RUN}`, body: { mediaUrl: OK_IMAGE, previewUrl: OK_IMAGE },
    });
    expect(okId).toBeTruthy();
  });

  test('D7 前端預設樣圖是相對路徑 → 精靈直接存 LINE 圖片素材必失敗（P2 UX 缺陷）', async ({ page }) => {
    await gotoAndCheck(page, `${MATERIALS_PATH}/new`);
    await pickType(page, 'line', '單張圖片');
    const nameInput = page.getByPlaceholder('如：母親節新品推播');
    await setField(nameInput, `${E2E_PREFIX} 預設樣圖 ${RUN}`);

    const result = await submitAndObserve(
      page,
      async () => { await page.getByRole('button', { name: '存為素材' }).click(); },
      /\/marketing\/materials$/,
      'POST',
      15_000,
    );
    if (result.requested && result.status && result.status >= 400) {
      console.log(
        '⚠️ BUG(P2) 精靈選「LINE 單張圖片」後不改任何欄位直接存檔會失敗：' +
        `DEFAULT_BODY_FOR_TYPE 帶的是相對路徑 /material-samples/cafe.jpeg，LINE validate 要求 HTTPS 絕對網址。` +
        ` 後端回 ${result.status}：${JSON.stringify(result.body).slice(0, 200)}`,
      );
      expectRejected(result, 'LINE 圖片預設相對路徑樣圖');
    } else if (result.requested && result.status && result.status < 300) {
      const body = result.body as { data?: { id?: string } };
      if (body?.data?.id) createdMaterialIds.push(body.data.id);
      console.log('  預設樣圖已可存檔（表示 DEFAULT_BODY 已改為絕對網址或驗證已放寬）');
    }
  });

  test('D8 FB 文字：後端完全不驗 body（與 LINE 不對稱，P2）', async () => {
    const base = { channelType: 'fb', contentType: 'fb_text' };
    // FB 前端 maxLength=2000，但後端與 FB 都沒驗 → 10000 字可寫入
    const id = await createMaterial({ ...base, name: `${E2E_PREFIX} fb10000 ${RUN}`, body: { text: strOfLength(10000) } });
    const res = await api.get(`marketing/materials/${id}`);
    const body = await res.json();
    expect((body.data.body as { text: string }).text.length, 'FB 文字 10000 字原樣寫入').toBe(10000);
    console.log(
      '⚠️ BUG(P2) FB 版型 body 無任何後端驗證：前端 FbTextEditor maxLength=2000（FB 官方上限 2000），' +
      '但後端 zod body 是 z.record(z.unknown()) 且 validateLineMaterialWithLineApi 只處理 line_* 版型，' +
      '故 10000 字、型別錯誤的 body 均可寫入，發送時才會被 FB 拒絕。',
    );

    // 型別完全錯誤的 body 也吃
    const junkId = await createMaterial({ ...base, name: `${E2E_PREFIX} fbjunk ${RUN}`, body: { text: 12345, nonsense: true } });
    expect(junkId, 'FB body 型別錯誤仍被接受（記錄）').toBeTruthy();
  });

  test('D9 FB 各版型欄位盤點（精靈內）', async ({ page }) => {
    const fbTypes = ['純文字', '按鈕選單', '優惠券', '訂單收據', '滿意度調查', '商品輪播'];
    for (const label of fbTypes) {
      await gotoAndCheck(page, `${MATERIALS_PATH}/new`);
      await pickType(page, 'fb', label);
      const fields = await inventoryFields(page);
      console.log(formatFieldInventory(fields, `新增精靈 — FB ${label}`));
      expect(fields.length, `FB ${label} 應有可編輯欄位`).toBeGreaterThan(0);
    }
  });

  test('D10 FB 優惠券折扣碼：前端自動移除空白（欄位級轉換行為）', async ({ page }) => {
    await gotoAndCheck(page, `${MATERIALS_PATH}/new`);
    await pickType(page, 'fb', '優惠券');

    // 折扣碼欄位：value.replace(/\s/g, '') → 輸入含空白應被即時剝除
    const couponLabel = page.locator('label', { hasText: '折扣碼' }).first();
    const couponInput = couponLabel.locator('xpath=following::input[1]');
    await setField(couponInput, 'AB CD 12');
    expect(await couponInput.inputValue(), '折扣碼應自動移除所有空白').toBe('ABCD12');
  });

  test('D11 FB 收據數字欄位：負數 / 小數 / 超大數的行為', async () => {
    const base = { channelType: 'fb', contentType: 'fb_receipt', name: `${E2E_PREFIX} receipt ${RUN}` };
    // 後端無 body 驗證 → 這些都會寫入；記錄實際行為
    const id = await createMaterial({
      ...base,
      body: { recipient_name: 'x', order_number: 'o1', currency: 'TWD', summary: { total_cost: -999 } },
    });
    const res = await api.get(`marketing/materials/${id}`);
    const body = await res.json();
    const cost = (body.data.body as { summary: { total_cost: number } }).summary.total_cost;
    expect(cost, '負數金額原樣寫入（後端無驗證）').toBe(-999);
    console.log('⚠️ 行為記錄(P3) FB 收據 total_cost 可存入負數 -999，無任何後端驗證。');
  });
});

// ───────────────────────────────────────────────────────────────────────
// E. 按鈕 / 動作欄位：label / uri / postback data
// ───────────────────────────────────────────────────────────────────────

test.describe('@fields @materials E. 按鈕與動作欄位', () => {
  /** LINE 影片素材 body（endCard 內含 action，用來測 action 欄位） */
  const videoBody = (action: Record<string, unknown>, label = '了解更多') => ({
    videoUrl: 'https://example.com/sample.mp4',
    previewImageUrl: OK_IMAGE,
    endCard: { imageUrl: OK_IMAGE, label, action },
  });

  test('E1 LINE 影片 endCard 的 action 欄位完全未被驗證（P1）', async () => {
    const base = { channelType: 'line', contentType: 'line_video' };
    // routes.ts 定義了 uriActionSchema（label ≤40、uri scheme 限 http/https/line/tel）
    // 但註解明言「不直接驗證 body 內全部 action」，實際 create/update 也沒用到 actionSchema。
    const dangerous: Array<[string, Record<string, unknown>]> = [
      ['javascript: scheme', { type: 'uri', label: 'go', uri: 'javascript:alert(1)' }],
      ['空 uri', { type: 'uri', label: 'go', uri: '' }],
      ['data: scheme', { type: 'uri', label: 'go', uri: 'data:text/html,<script>alert(1)</script>' }],
      ['label 超過 40 字', { type: 'uri', label: strOfLength(60), uri: 'https://example.com' }],
      ['postback data 超過 300 字', { type: 'postback', label: 'go', data: strOfLength(400) }],
      ['type 非法', { type: '__bogus__', label: 'go' }],
    ];
    const accepted: string[] = [];
    for (const [label, action] of dangerous) {
      const res = await api.post('marketing/materials', {
        data: { ...base, name: `${E2E_PREFIX} act ${label} ${RUN}`.slice(0, 200), body: videoBody(action) },
      });
      const body = await res.json();
      if (res.status() < 300) {
        createdMaterialIds.push(body.data.id);
        accepted.push(label);
      }
      expect(res.status(), `action「${label}」不該造成 5xx`).toBeLessThan(500);
    }
    if (accepted.length) {
      console.log(
        `⚠️ BUG(P1) LINE 影片 endCard 的 action 欄位零驗證，以下全部寫入成功：${accepted.join('、')}。` +
        '根因：buildLineVideoWithEndCard（packages/channel-plugins/src/line/builders.ts:296）只回傳 ' +
        'video 物件，**整個 endCard 被丟棄**，因此 LINE validate 從來看不到 endCard，' +
        'routes.ts 內定義的 uriActionSchema / postbackActionSchema 也從未被 create/update 使用。',
      );
    }
    expect(accepted.length, '記錄：未被驗證的 action 樣本數（>0 即為驗證缺口）').toBeGreaterThan(0);
  });

  test('E2 endCard 在送出訊息時被丟棄（欄位存了但不會生效，P2）', async () => {
    const id = await createMaterial({
      name: `${E2E_PREFIX} endcard drop ${RUN}`,
      channelType: 'line', contentType: 'line_video',
      body: videoBody({ type: 'uri', label: '立即購買', uri: 'https://example.com' }),
    });
    // 素材存得下來（endCard 進 DB），但 preview / 送出組訊息時 endCard 不在 payload 內
    const res = await api.get(`marketing/materials/${id}`);
    const body = await res.json();
    expect((body.data.body as { endCard?: unknown }).endCard, 'endCard 有存進 DB').toBeTruthy();
    console.log(
      '⚠️ BUG(P2) LINE 影片「結束畫面」（圖片 / CTA 按鈕文字 / 按鈕動作）三個欄位在 UI 可編輯、' +
      '也會存進 DB，但 buildLineVideoWithEndCard 只回傳 { type:video, originalContentUrl, previewImageUrl }，' +
      'endCard 完全沒被組進 LINE 訊息。builders.ts:293-294 的註解說「包成 imagemap + video 兩個 message 一起送」，' +
      '與實作不符 → 使用者填的 CTA 永遠不會送出。',
    );
  });

  test('E3 LINE imagemap 互動區域缺 action → 後端回 400（非 500）', async () => {
    const res = await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: {
        name: `${E2E_PREFIX} imagemap noaction ${RUN}`,
        channelType: 'line', contentType: 'line_imagemap',
        body: { baseImageUrl: OK_IMAGE, width: 1040, height: 700, areas: [{ x: 0, y: 0, width: 520, height: 700 }] },
      },
      expect: 'reject',
      context: 'imagemap area 缺 action',
    });
    // 訊息品質：目前是把 TypeError 訊息原封不動吐給使用者
    const msg = JSON.stringify(res.body);
    if (msg.includes('Cannot read properties of undefined')) {
      console.log(
        '⚠️ BUG(P3) imagemap 互動區域缺 action 時，錯誤訊息直接外洩內部 TypeError：' +
        '「素材內容無法組成 LINE 訊息：Cannot read properties of undefined (reading \'type\')」，' +
        '使用者看不懂是哪個區域少了什麼。應改為指名欄位的可讀訊息。',
      );
    }
  });

  test('E4 LINE imagemap 合法 action 可存檔（對照組）', async () => {
    const id = await createMaterial({
      name: `${E2E_PREFIX} imagemap ok ${RUN}`,
      channelType: 'line', contentType: 'line_imagemap',
      body: {
        baseImageUrl: OK_IMAGE, width: 1040, height: 700,
        areas: [{ x: 0, y: 0, width: 1040, height: 700, action: { type: 'uri', label: '全區', uri: 'https://example.com' } }],
      },
    });
    expect(id).toBeTruthy();
  });

  test('E5 LINE 卡片訊息：相對路徑圖片被 LINE 擋下、HTTPS 可存', async () => {
    const base = { channelType: 'line', contentType: 'line_carousel' };
    const page1 = (imageUrl: string) => ({
      pageType: 'product',
      pages: [{
        imageUrl, title: 't', description: 'd',
        action1: { type: 'uri', label: '買', uri: 'https://example.com' },
      }],
    });
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { ...base, name: `${E2E_PREFIX} car rel`, body: page1('/material-samples/product.jpeg') },
      expect: 'reject',
      context: '卡片訊息相對路徑圖片',
    });
    const okId = await createMaterial({ ...base, name: `${E2E_PREFIX} car ok ${RUN}`, body: page1(OK_IMAGE) });
    expect(okId).toBeTruthy();
  });

  test('E6 快速回覆（Quick Reply）欄位：label 超長 / 空 label 的驗證', async () => {
    const base = { channelType: 'line', contentType: 'line_text' };
    // LINE quickReply label 上限 20 字
    await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: {
        ...base, name: `${E2E_PREFIX} qr long`,
        body: { text: 'hi', quickReplies: [{ label: strOfLength(40), text: 'x' }] },
      },
      expect: 'reject',
      context: 'quickReply label 40 字（LINE 上限 20）',
    });
    // 合法 quick reply
    const okId = await createMaterial({
      ...base, name: `${E2E_PREFIX} qr ok ${RUN}`,
      body: { text: 'hi', quickReplies: [{ label: '選項一', text: '我選一' }] },
    });
    expect(okId).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────
// F. Flex JSON 匯入欄位
// ───────────────────────────────────────────────────────────────────────

test.describe('@fields @materials F. Flex JSON 匯入欄位', () => {
  test('F1 [已知 bug 複驗] line_flex_template 空 body → 現在回 400 而非 500（已修復）', async () => {
    const res = await apiFieldCheck(api, {
      path: 'marketing/materials',
      payload: { name: `${E2E_PREFIX} flex empty ${RUN}`, channelType: 'line', contentType: 'line_flex_template', body: {} },
      expect: 'reject',
      context: 'line_flex_template 空 body',
    });
    expect(res.status, 'Wave 2 記錄的 500 已修為 400').toBe(400);
    expect(JSON.stringify(res.body)).toContain('INVALID_LINE_FLEX_PAYLOAD');
    console.log(
      '✔ Wave 2 已知 bug「line_flex_template 空 body 回 500」**已修復**：' +
      'assertLineFlexMessageBody 現以 flexErrorToAppError 包住 normalize，' +
      '空陣列/空物件皆轉成 400 INVALID_LINE_FLEX_PAYLOAD。',
    );
  });

  test('F2 Flex validate 端點：非物件 payload 一律 400', async () => {
    const V = 'marketing/materials/line-flex/validate';
    for (const [label, payload] of [
      ['null', null], ['陣列', []], ['字串', 'hello'], ['數字', 42], ['空物件', {}],
    ] as const) {
      await apiFieldCheck(api, {
        path: V, payload: { payload }, expect: 'reject', context: `flex validate payload=${label}`,
      });
    }
  });

  test('F3 Flex validate：缺必要欄位（無 type / 非 bubble carousel）應 400', async () => {
    const V = 'marketing/materials/line-flex/validate';
    await apiFieldCheck(api, {
      path: V,
      payload: { payload: { body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'x' }] } } },
      expect: 'reject',
      context: 'flex 缺 root type',
    });
    await apiFieldCheck(api, {
      path: V,
      payload: { payload: { type: 'box', layout: 'vertical', contents: [] } },
      expect: 'reject',
      context: 'flex root 為 box（非 bubble/carousel）',
    });
    // 合法 bubble 應通過
    const res = await api.post(V, { data: { payload: bubble('hello') } });
    expect(res.status(), '合法 bubble 應 200').toBeLessThan(300);
  });

  test('F4 altText 欄位邊界：400 接受、401 擋下', async () => {
    const V = 'marketing/materials/line-flex/validate';
    const ok = await api.post(V, { data: { payload: bubble('x'), altText: strOfLength(400) } });
    expect(ok.status(), 'altText 400 字應被接受').toBeLessThan(300);
    await apiFieldCheck(api, {
      path: V, payload: { payload: bubble('x'), altText: strOfLength(401) },
      expect: 'reject', context: 'altText over(401)',
    });
  });

  test('F5 超大 JSON：超過 120,000 字元應 400 LINE_FLEX_PAYLOAD_TOO_LARGE', async () => {
    const huge = {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical',
        contents: Array.from({ length: 4000 }, (_, i) => ({ type: 'text', text: `文字元素 ${i}`, wrap: true })),
      },
    };
    const res = await apiFieldCheck(api, {
      path: 'marketing/materials/line-flex/import',
      payload: { name: `${E2E_PREFIX} huge ${RUN}`, payload: huge },
      expect: 'reject',
      context: '超大 Flex JSON（>120,000 字元）',
    });
    expect(JSON.stringify(res.body)).toContain('LINE_FLEX_PAYLOAD_TOO_LARGE');
  });

  test('F6 Flex import：carousel 超過 12 個 bubble 未被擋下（P2 驗證缺口）', async () => {
    const carousel13 = { type: 'carousel', contents: Array.from({ length: 13 }, (_, i) => bubble(`卡片 ${i}`)) };
    const res = await api.post('marketing/materials/line-flex/import', {
      data: { name: `${E2E_PREFIX} carousel13 ${RUN}`, payload: carousel13 },
    });
    const body = await res.json();
    if (res.status() < 300) {
      createdMaterialIds.push(body.data.id);
      console.log(
        '⚠️ BUG(P2) Flex carousel 可匯入 13 個 bubble（LINE 官方上限 12）。' +
        'packages/shared/src/line-flex-template.ts:475 已宣告 maxChildren:12，但那只用於 editableContainers 描述，' +
        'validateLineFlexMessageBody 沒有實際檢查；且 createMaterial 對 line_flex_* 版型會 return 跳過 ' +
        'LINE validate API（material.service.ts:259），等於兩道防線都沒守 → 發送時才會被 LINE 拒絕。',
      );
    }
    expect(res.status(), '記錄目前行為').toBeLessThan(500);
  });

  test('F7 Flex import 名稱欄位：空名稱 / 201 字應被擋', async () => {
    await apiFieldCheck(api, {
      path: 'marketing/materials/line-flex/import',
      payload: { name: '', payload: bubble('x') },
      expect: 'reject', context: 'flex import name 空',
    });
    await apiFieldCheck(api, {
      path: 'marketing/materials/line-flex/import',
      payload: { name: strOfLength(201), payload: bubble('x') },
      expect: 'reject', context: 'flex import name over(201)',
    });
  });

  test('F8 UI：Flex 匯入編輯器的 JSON 框 — 非法 JSON 在前端就擋下（不打 API）', async ({ page }) => {
    const id = await createMaterial({
      name: `${E2E_PREFIX} flex ui ${RUN}`,
      channelType: 'line', contentType: 'line_flex_template',
      body: { type: 'flex', altText: '測試', contents: bubble('hello') },
    });
    await gotoAndCheck(page, `${MATERIALS_PATH}/${id}`);
    await expect(page.getByText('外部 Flex JSON 匯入')).toBeVisible({ timeout: 15_000 });

    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, 'Flex 匯入編輯器'));
    const alt = fields.find((f) => f.placeholder === '手機通知欄顯示用');
    expect(alt?.maxLength, '替代文字前端 maxLength 應為 400（與後端 zod 一致）').toBe(400);

    const jsonBox = page.locator('textarea').first();
    await jsonBox.fill('{ 這不是合法 JSON ');
    const result = await submitAndObserve(
      page,
      async () => { await page.getByRole('button', { name: '驗證並匯入' }).click(); },
      /line-flex\/validate/,
      'POST',
      4_000,
    );
    expect(result.requested, '非法 JSON 應在前端 JSON.parse 階段擋下，不打 API').toBe(false);
    // 前端要顯示錯誤訊息
    await expect(page.locator('text=/JSON|Unexpected|Expected/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('F9 UI：Flex 匯入 — 合法 JSON 走完驗證並套用', async ({ page }) => {
    const id = await createMaterial({
      name: `${E2E_PREFIX} flex ui ok ${RUN}`,
      channelType: 'line', contentType: 'line_flex_template',
      body: { type: 'flex', altText: '原本', contents: bubble('原本內容') },
    });
    await gotoAndCheck(page, `${MATERIALS_PATH}/${id}`);
    await expect(page.getByText('外部 Flex JSON 匯入')).toBeVisible({ timeout: 15_000 });

    const jsonBox = page.locator('textarea').first();
    await jsonBox.fill(JSON.stringify({ type: 'flex', altText: '新的替代文字', contents: bubble('匯入後內容') }, null, 2));
    const result = await submitAndObserve(
      page,
      async () => { await page.getByRole('button', { name: '驗證並匯入' }).click(); },
      /line-flex\/validate/,
      'POST',
      10_000,
    );
    expectAccepted(result, 'Flex 合法 JSON 驗證');
    await expect(page.getByText('JSON 已驗證並匯入到目前草稿')).toBeVisible({ timeout: 8_000 });
  });

  test('F10 UI：Flex 匯入 — 缺必要欄位的 JSON 由後端回可讀錯誤', async ({ page }) => {
    const id = await createMaterial({
      name: `${E2E_PREFIX} flex ui bad ${RUN}`,
      channelType: 'line', contentType: 'line_flex_template',
      body: { type: 'flex', altText: '測試', contents: bubble('hello') },
    });
    await gotoAndCheck(page, `${MATERIALS_PATH}/${id}`);
    await expect(page.getByText('外部 Flex JSON 匯入')).toBeVisible({ timeout: 15_000 });

    const jsonBox = page.locator('textarea').first();
    // 合法 JSON 但缺 root type
    await jsonBox.fill(JSON.stringify({ body: { type: 'box', layout: 'vertical', contents: [] } }, null, 2));
    const result = await submitAndObserve(
      page,
      async () => { await page.getByRole('button', { name: '驗證並匯入' }).click(); },
      /line-flex\/validate/,
      'POST',
      10_000,
    );
    expectRejected(result, 'Flex 缺 root type');
    expect(result.status, '應是 400 而非 5xx').toBe(400);
  });

  test('F11 AI 生成 prompt 欄位邊界（只驗流程不斷言內容）', async () => {
    const A = 'marketing/materials/line-flex/ai-generate';
    // 空 prompt / 501 字應被 zod 擋（不觸發 LLM）
    await apiFieldCheck(api, { path: A, payload: { prompt: '' }, expect: 'reject', context: 'AI prompt 空' });
    await apiFieldCheck(api, { path: A, payload: { prompt: strOfLength(501) }, expect: 'reject', context: 'AI prompt over(501)' });
    await apiFieldCheck(api, { path: A, payload: {}, expect: 'reject', context: 'AI prompt 缺欄位' });
    // 合法 prompt 不實際呼叫（避免 LLM 成本與不穩定）——僅驗證上述擋控即可
  });
});

// ───────────────────────────────────────────────────────────────────────
// G. 編輯頁欄位：名稱 / 描述 / 標籤 / 分類 往返
// ───────────────────────────────────────────────────────────────────────

test.describe('@fields @materials G. 編輯頁欄位往返', () => {
  test('G0 欄位盤點：編輯頁（LINE 純文字）', async ({ page }) => {
    const id = await createMaterial({
      name: `${E2E_PREFIX} edit inv ${RUN}`, channelType: 'line', contentType: 'line_text', body: { text: 'hello' },
    });
    await gotoAndCheck(page, `${MATERIALS_PATH}/${id}`);
    await expect(page.getByText('素材名稱')).toBeVisible({ timeout: 15_000 });
    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '素材編輯頁（LINE 純文字）'));
    // 前端名稱/描述/分類 Input 皆無 maxLength → 與後端 200/500/100 不一致，記錄
    const nameField = fields.find((f) => f.placeholder === '如：母親節新品推播');
    console.log(
      `  前後端 maxLength 比對：素材名稱前端=${nameField?.maxLength ?? '未設定'} / 後端 zod=200；` +
      '描述前端=未設定 / 後端=500；分類前端=未設定 / 後端=100',
    );
    if (!nameField?.maxLength) {
      console.log(
        '⚠️ 行為記錄(P3) 編輯頁「素材名稱 / 分類 / 描述」三個 Input 皆未設 maxLength，' +
        '使用者可輸入超長內容，直到按下存檔才被後端退回（錯誤訊息是英文 zod 文案）。',
      );
    }
  });

  test('G1 編輯頁名稱往返：emoji / padded / XSS 存回一致', async ({ page }) => {
    const id = await createMaterial({
      name: `${E2E_PREFIX} rt name ${RUN}`, channelType: 'line', contentType: 'line_text', body: { text: 'hello' },
    });
    const newName = `${E2E_PREFIX}${FieldSamples.emoji}${FieldSamples.padded}`;
    await gotoAndCheck(page, `${MATERIALS_PATH}/${id}`);
    const nameInput = page.getByPlaceholder('如：母親節新品推播');
    await expect(nameInput).toBeVisible({ timeout: 15_000 });

    const result = await submitAndObserve(
      page,
      async () => {
        await setField(nameInput, newName);
        await page.getByRole('button', { name: '存為素材' }).click();
      },
      /\/marketing\/materials\//,
      'PATCH',
      12_000,
    );
    expectAccepted(result, '編輯頁名稱存檔');
    await expect(page.getByText('已儲存變更')).toBeVisible({ timeout: 8_000 });

    // reload 後重讀
    await page.reload({ waitUntil: 'networkidle' });
    await expect(nameInput).toBeVisible({ timeout: 15_000 });
    expect(await nameInput.inputValue(), '名稱往返：emoji 與前後空白應完整保留').toBe(newName);
  });

  test('G2 編輯頁描述欄位往返（含換行符在單行 Input 的行為）', async ({ page }) => {
    const id = await createMaterial({
      name: `${E2E_PREFIX} rt desc ${RUN}`, channelType: 'line', contentType: 'line_text', body: { text: 'hello' },
    });
    await gotoAndCheck(page, `${MATERIALS_PATH}/${id}`);
    const descInput = page.getByPlaceholder('簡短描述用途');
    await expect(descInput).toBeVisible({ timeout: 15_000 });

    // 單行 Input 填入含換行的字串：瀏覽器會吃掉換行
    await setField(descInput, FieldSamples.newline);
    const inUi = await descInput.inputValue();
    console.log(`  描述欄位（單行 Input）填入含 \\n 字串後 UI 值 = ${JSON.stringify(inUi)}`);

    const result = await submitAndObserve(
      page,
      async () => { await page.getByRole('button', { name: '存為素材' }).click(); },
      /\/marketing\/materials\//,
      'PATCH',
      12_000,
    );
    expectAccepted(result, '編輯頁描述存檔');

    const res = await api.get(`marketing/materials/${id}`);
    const body = await res.json();
    expect(body.data.description, '描述往返應與 UI 顯示值一致').toBe(inUi);

    // 後端直測：API 可直接寫入含真實換行的描述
    const patched = await api.patch(`marketing/materials/${id}`, { data: { description: FieldSamples.newline } });
    expect(patched.status(), 'API 直寫含換行的描述應被接受').toBeLessThan(300);
  });

  test('G3 編輯頁標籤欄位：新增 / 去重 / 往返 / 40 字邊界', async ({ page }) => {
    const id = await createMaterial({
      name: `${E2E_PREFIX} rt tags ${RUN}`, channelType: 'line', contentType: 'line_text', body: { text: 'hello' },
    });
    await gotoAndCheck(page, `${MATERIALS_PATH}/${id}`);
    const tagInput = page.getByPlaceholder('輸入標籤後按 Enter');
    await expect(tagInput).toBeVisible({ timeout: 15_000 });

    const tag = `${E2E_PREFIX}tag${RUN}`;
    await setField(tagInput, tag);
    await tagInput.press('Enter');
    // 重複輸入同一標籤：前端 value.tags.includes(t) 應去重
    await setField(tagInput, tag);
    await tagInput.press('Enter');
    const chipCount = await page.getByText(tag, { exact: true }).count();
    expect(chipCount, '同名標籤應被前端去重，只出現一次').toBe(1);

    // 純空白標籤：addTag 有 trim() 檢查 → 不應新增
    await setField(tagInput, FieldSamples.whitespace);
    await tagInput.press('Enter');
    expect(await page.getByText(tag, { exact: true }).count(), '空白標籤不應新增').toBe(1);

    const result = await submitAndObserve(
      page,
      async () => { await page.getByRole('button', { name: '存為素材' }).click(); },
      /\/marketing\/materials\//,
      'PATCH',
      12_000,
    );
    expectAccepted(result, '標籤存檔');

    const res = await api.get(`marketing/materials/${id}`);
    const body = await res.json();
    expect(body.data.tags, '標籤往返').toContain(tag);

    // 後端邊界：40 字接受、41 字擋
    const ok = await api.patch(`marketing/materials/${id}`, { data: { tags: [strOfLength(40)] } });
    expect(ok.status(), '標籤 40 字應被接受').toBeLessThan(300);
    await apiFieldCheck(api, {
      path: `marketing/materials/${id}`, method: 'patch',
      payload: { tags: [strOfLength(41)] }, expect: 'reject', context: '標籤 41 字',
    });
    await apiFieldCheck(api, {
      path: `marketing/materials/${id}`, method: 'patch',
      payload: { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
      expect: 'reject', context: '標籤 21 個（上限 20）',
    });
  });

  test('G4 編輯頁分類下拉：選分類存檔往返', async ({ page }) => {
    const catRes = await api.post('marketing/materials/categories', { data: { name: `${E2E_PREFIX} 選用分類 ${RUN}` } });
    const catBody = await catRes.json();
    const catId = catBody.data.id as string;
    createdCategoryIds.push(catId);

    const id = await createMaterial({
      name: `${E2E_PREFIX} rt cat ${RUN}`, channelType: 'line', contentType: 'line_text', body: { text: 'hello' },
    });
    await gotoAndCheck(page, `${MATERIALS_PATH}/${id}`);
    await expect(page.getByText('分類與標籤')).toBeVisible({ timeout: 15_000 });

    // 治理面板的分類 select（value 為 categoryId）
    const catSelect = page.locator('select').filter({ has: page.locator('option', { hasText: '未分類' }) }).first();
    await catSelect.selectOption(catId);
    const result = await submitAndObserve(
      page,
      async () => { await page.getByRole('button', { name: '存為素材' }).click(); },
      /\/marketing\/materials\//,
      'PATCH',
      12_000,
    );
    expectAccepted(result, '分類存檔');

    const res = await api.get(`marketing/materials/${id}`);
    const body = await res.json();
    expect(body.data.categoryId, '分類往返').toBe(catId);
  });

  test('G5 PATCH 欄位驗證與 create 一致（name/description/category/status/previewImageUrl）', async () => {
    const id = await createMaterial({
      name: `${E2E_PREFIX} patch check ${RUN}`, channelType: 'fb', contentType: 'fb_text', body: { text: 'x' },
    });
    const bad: Array<[string, Record<string, unknown>]> = [
      ['name 空', { name: '' }],
      ['name 201', { name: strOfLength(201) }],
      ['description 501', { description: strOfLength(501) }],
      ['category 101', { category: strOfLength(101) }],
      ['status 非法', { status: 'published' }],
      ['previewImageUrl 非法', { previewImageUrl: 'notaurl' }],
      ['categoryId 非法 uuid', { categoryId: FieldSamples.badUuid }],
      ['isActive 非布林', { isActive: 'yes' }],
    ];
    for (const [label, payload] of bad) {
      await apiFieldCheck(api, {
        path: `marketing/materials/${id}`, method: 'patch',
        payload, expect: 'reject', context: `PATCH ${label}`,
      });
    }
  });

  test('G6 跨租戶 / 不存在素材的 id 參數：應 404 不得 5xx', async () => {
    for (const [label, mid] of [
      ['不存在的 uuid', '11111111-2222-3333-4444-555555555555'],
      ['非 uuid 字串', 'not-a-uuid'],
    ] as const) {
      const res = await api.get(`marketing/materials/${mid}`);
      expect(res.status(), `GET 素材（${label}）應 4xx 不得 5xx（實際 ${res.status()}）`).toBeLessThan(500);
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
  });
});
