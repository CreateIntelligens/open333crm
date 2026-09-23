import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import {
  BASE_URL,
  E2E_PREFIX,
  WEBCHAT_CHANNEL_ID,
  newApiContext,
  seedWebchatConversation,
  gotoAndCheck,
  SeededConversation,
} from './helpers';
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
 * Wave 6 欄位級測試：工單（Cases）+ 聯繫人（Contacts）+ 收件匣（Inbox）
 *
 * ── 測試策略 ──────────────────────────────────────────────────────────────
 * 1. UI 層：對使用者真的看得到的欄位做「必填擋控 / 長度上限 / 往返 / XSS」，
 *    以 submitAndObserve 區分「前端擋下（沒發 API）」與「後端回應」。
 * 2. API 層：用 apiFieldCheck 繞過 UI 直測 zod，抓前端擋控被繞過時的驗證缺口。
 *    這是本輪抓到多數 bug 的路徑——前端多半有擋，後端沒有。
 * 3. 已確認的既有 bug 一律用 test.fail() 標記（測試斷言「應該被擋」，實際沒擋 →
 *    Playwright 記為 expected failure，全綠但缺口有留痕，不會被誤認為已修）。
 *
 * ── 種資料 / 清理 ─────────────────────────────────────────────────────────
 * - seedWebchatConversation 只在 beforeAll 呼叫「一次」（rate limit 10 次/分/IP），
 *   整份 spec 重複利用同一條對話與其訪客聯繫人。
 * - 所有自建工單一律 [E2E] 前綴，afterAll 以 API 刪除。
 * - 合併聯繫人：依安全限制「只對自種訪客做」，但單條 seed 無法產出第二個可犧牲
 *   的訪客（再 seed 會逼近 rate limit 且留下孤兒資料），因此合併「只測前兩步
 *   （選擇對象 + 預覽）與第三步的確認閘門欄位」，不按下最終不可逆的合併鍵。
 *
 * ── 已知環境事實（Wave 1-5 + 本輪確認）─────────────────────────────────────
 * - UI 用語：列表頁 Topbar 是「工單」，但建立 Modal 標題仍寫「建立案件」（未統一）。
 * - 詳情頁下拉結構為 <div><h4>標籤</h4><select/></div>，用 h4 兄弟節點定位。
 * - 列表排序固定 slaDueAt asc，自建工單常不在第 1 頁 → 一律用 API 建/驗，
 *   UI 只驗「表單欄位擋控」本身，不依賴列表翻頁。
 */

const RUN = randomUUID().slice(0, 8);

let api: APIRequestContext;
let seeded: SeededConversation;
/** 本輪自建工單 id，afterAll 清理 */
const createdCaseIds: string[] = [];
/** 可用的第一個 agent（指派/篩選用） */
let agentId = '';
let webchatChannelId = WEBCHAT_CHANNEL_ID;

// ---------------------------------------------------------------------------
// 後端 zod 約束（讀自 apps/api/src/modules/*，作為邊界測試的真實來源）
// ---------------------------------------------------------------------------
const LIMITS = {
  caseTitle: 100, // createCaseSchema/updateCaseSchema: z.string().min(1).max(100)
  caseDescription: 2000, // z.string().max(2000)
  escalateNote: 500, // escalateSchema.note: z.string().max(500)
  closeReason: 1000, // conversations/:id/close reason: z.string().max(1000)
  // 下列「無上限」是本輪要驗證的缺口：
  caseCategory: null, // createCaseSchema.category: z.string()（無 max、無 enum）
  caseNote: null, // addNoteSchema.content: z.string().min(1)（無 max）
  escalateReason: null, // escalateSchema.reason: z.string().min(1)（無 max）
  contactPhone: null, // updateContactSchema.phone: z.string().nullable()（無 max/格式）
  contactDisplayName: null, // z.string().min(1)（無 max）
} as const;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 詳情頁「<h4>標籤</h4> + <select>」結構定位 */
const detailSelect = (page: Page, label: string) =>
  page.locator(`h4:text-is("${label}")`).locator('xpath=following-sibling::select[1]');

/**
 * ⚠️ 專案的 Dialog 是原生 `<dialog>`（非 `[role="dialog"]`），且 Modal 開啟時
 * 背景頁面的元素仍留在 DOM 裡。因此所有 Modal 內的定位與欄位盤點都必須
 * 限縮在「目前開啟的那個 dialog」，否則會撈到背景頁的 textarea / checkbox。
 */
const DIALOG_SCOPE = 'dialog[open]';
const openDialog = (page: Page) => page.locator(DIALOG_SCOPE).first();

/** 用 API 建一個乾淨的 [E2E] 工單（UI 測試的載體），回傳 id */
async function createCase(title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await api.post('cases', {
    data: {
      contactId: seeded.contactId,
      channelId: webchatChannelId,
      title,
      category: '查詢',
      priority: 'MEDIUM',
      ...extra,
    },
  });
  expect(res.status(), `建立測試工單失敗：${await res.text()}`).toBe(201);
  const id = (await res.json())?.data?.id as string;
  createdCaseIds.push(id);
  return id;
}

/**
 * 開啟工單建立 Modal。
 * ⚠️ 實測發現：CaseCreateModal 只掛在 Inbox 的 ContactInfoPanel（「建立工單」鈕），
 *    /dashboard/cases 列表頁「沒有」任何建立入口（見 BUG-W6-11）。
 *    因此建立 Modal 的欄位測試一律從收件匣進入，且必然是 isFromInbox 模式
 *    （聯繫人欄位被 prefill 且 disabled，走 /cases/from-conversation/:id）。
 */
async function openCaseCreateModal(page: Page): Promise<void> {
  await gotoAndCheck(page, `/dashboard/inbox?conv=${seeded.conversationId}`);
  const btn = page.locator('button', { hasText: '建立工單' }).first();
  await expect(btn, '收件匣右側聯繫人面板應有「建立工單」鈕').toBeVisible({ timeout: 20_000 });
  await btn.click();
  await expect(page.getByText('建立案件').first()).toBeVisible({ timeout: 10_000 });
}

/**
 * 接管對話：seedWebchatConversation 種出來的對話狀態是 BOT_HANDLED，
 * 此時 MessageInput 的 textarea 是 disabled（placeholder 變成「Bot 處理中…」），
 * 必須先按「接管對話」把狀態推到 AGENT_HANDLED 才測得到訊息輸入欄位。
 */
async function takeoverConversation(page: Page): Promise<void> {
  const takeover = page.locator('button', { hasText: '接管對話' }).first();
  if (await takeover.isVisible().catch(() => false)) {
    await takeover.click();
  }
  await expect(
    page.getByPlaceholder('輸入訊息', { exact: false }),
    '接管後訊息輸入框應可用',
  ).toBeVisible({ timeout: 20_000 });
}

/** 開收件匣並確保訊息輸入框可用 */
async function gotoInboxReady(page: Page): Promise<void> {
  await gotoAndCheck(page, `/dashboard/inbox?conv=${seeded.conversationId}`);
  await takeoverConversation(page);
}

// ---------------------------------------------------------------------------
// setup / teardown
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  api = await newApiContext();

  // 取可用 agent（指派欄位用）
  const agentsRes = await api.get('agents');
  if (agentsRes.ok()) {
    agentId = (await agentsRes.json())?.data?.[0]?.id ?? '';
  }

  // 確認 WEBCHAT 渠道 id 仍有效（渠道可能被重建）
  const chRes = await api.get('channels');
  if (chRes.ok()) {
    const list = ((await chRes.json())?.data ?? []) as Array<{ id: string; channelType?: string }>;
    const wc = list.find((c) => c.channelType === 'WEBCHAT');
    if (wc) webchatChannelId = wc.id;
  }

  // 整份 spec 只種一條對話（rate limit），後續全部重複利用
  seeded = await seedWebchatConversation(api, `Wave6 欄位測試 ${RUN}`);
});

test.afterAll(async () => {
  for (const id of createdCaseIds) {
    await api.delete(`cases/${id}`).catch(() => {});
  }
  await api.dispose().catch(() => {});
});

// ===========================================================================
// 一、工單建立 Modal（UI 欄位擋控）
// ===========================================================================

test.describe('工單 — 建立 Modal 欄位', () => {
  test('欄位盤點：建立工單 Modal', async ({ page }) => {
    await openCaseCreateModal(page);
    const fields = await inventoryFields(page, DIALOG_SCOPE);
    console.log(formatFieldInventory(fields, '建立工單 Modal'));

    // 盤點必須涵蓋：聯繫人（唯讀）、標題、描述、優先級、分類、指派、團隊、SLA
    expect(fields.length, '建立 Modal 應掃到 ≥ 7 個輸入元素').toBeGreaterThanOrEqual(7);

    // inbox 模式下聯繫人欄位是 prefill + disabled（不可改綁別的聯繫人）
    const contactField = fields.find((f) => f.disabled && f.tag === 'input');
    expect(contactField, 'inbox 模式的聯繫人欄位應為 disabled 唯讀').toBeTruthy();

    // 前端 maxLength 與後端 zod max 一致性檢查
    const titleField = fields.find((f) => f.placeholder?.includes('案件標題'));
    expect(titleField, '找不到標題欄位').toBeTruthy();
    expect(
      titleField!.maxLength,
      `標題前端 maxLength 應等於後端 zod max(${LIMITS.caseTitle})`,
    ).toBe(LIMITS.caseTitle);

    const descField = fields.find((f) => f.placeholder?.includes('描述問題'));
    expect(descField, '找不到描述欄位').toBeTruthy();
    expect(
      descField!.maxLength,
      `描述前端 maxLength 應等於後端 zod max(${LIMITS.caseDescription})`,
    ).toBe(LIMITS.caseDescription);
  });

  test('標題必填：留空 / 純空白 / 全形空白皆不可送出', async ({ page }) => {
    await openCaseCreateModal(page);
    const dialog = openDialog(page);
    const submit = dialog.locator('button', { hasText: /建立案件|建立中/ }).last();

    // 1) 全部留空 → 送出鍵 disabled（isFormValid 需要 title+contact+category）
    await expect(submit, '空表單時送出鍵應 disabled').toBeDisabled();

    // 2) 只填純空白標題 → 仍 disabled（title.trim() 為空）
    const title = dialog.getByPlaceholder('案件標題...');
    await setField(title, FieldSamples.whitespace);
    await expect(submit, '純空白標題時送出鍵應 disabled').toBeDisabled();

    // 3) 全形空白 → 這是「看起來有填其實沒填」的經典破口。
    //    前端用 .trim()，JS 的 trim() 會把 U+3000 全形空白也去掉，故應同樣 disabled。
    await setField(title, FieldSamples.fullwidthSpace);
    await expect(submit, '全形空白標題時送出鍵應 disabled（trim 後為空）').toBeDisabled();
  });

  test('分類必填：已填標題但未選分類仍不可送出', async ({ page }) => {
    await openCaseCreateModal(page);
    const dialog = openDialog(page);
    const submit = dialog.locator('button', { hasText: /建立案件|建立中/ }).last();

    // inbox 模式聯繫人已 prefill，唯一還缺的必填就是分類
    await setField(dialog.getByPlaceholder('案件標題...'), `${E2E_PREFIX} 分類必填 ${RUN}`);
    await expect(submit, '填了標題但未選分類時送出鍵應 disabled').toBeDisabled();

    // 選了分類之後才解鎖
    const categorySelect = dialog
      .locator('select', { has: page.locator('option[value="維修"]') })
      .first();
    await categorySelect.selectOption('查詢');
    await expect(submit, '標題 + 分類都齊備後送出鍵應可用').toBeEnabled();
  });

  test('標題長度上限：前端 maxLength 硬截斷在 100 字', async ({ page }) => {
    await openCaseCreateModal(page);
    const dialog = openDialog(page);
    const title = dialog.getByPlaceholder('案件標題...');
    const b = boundarySamples(LIMITS.caseTitle);

    await setField(title, b.exact);
    expect(await title.inputValue(), '剛好 100 字應完整保留').toHaveLength(LIMITS.caseTitle);

    // maxLength=100，fill 超長值會被瀏覽器截斷 → 前端不可能送出超長標題
    await setField(title, b.over);
    expect(
      (await title.inputValue()).length,
      '超過 100 字應被 maxLength 截斷，不得超過上限',
    ).toBe(LIMITS.caseTitle);

    // 字數計數器應同步顯示 100/100
    await expect(dialog.getByText(`${LIMITS.caseTitle}/${LIMITS.caseTitle}`)).toBeVisible();
  });

  test('描述長度上限：前端 maxLength 硬截斷在 2000 字', async ({ page }) => {
    await openCaseCreateModal(page);
    const dialog = openDialog(page);
    const desc = dialog.getByPlaceholder('描述問題...');
    const b = boundarySamples(LIMITS.caseDescription);

    await setField(desc, b.over);
    expect(
      (await desc.inputValue()).length,
      '超過 2000 字應被 maxLength 截斷',
    ).toBe(LIMITS.caseDescription);
  });

  test('聯繫人欄位（inbox 模式）：prefill 為來源對話的聯繫人且不可編輯', async ({ page }) => {
    await openCaseCreateModal(page);
    const dialog = openDialog(page);

    // inbox 模式不提供聯繫人搜尋框，只有唯讀 input
    expect(
      await dialog.getByPlaceholder('搜尋聯繫人姓名...').count(),
      'inbox 模式不應出現聯繫人搜尋框（聯繫人由對話決定）',
    ).toBe(0);

    const readonly = dialog.locator('input[disabled]').first();
    await expect(readonly, '聯繫人欄位應存在且 disabled').toBeVisible();
    expect(
      await readonly.inputValue(),
      '聯繫人欄位應帶入來源對話的訪客名稱',
    ).toContain(seeded.contactName.slice(0, 10));
  });

  test('合法值可建立：完整填寫後成功送出並導向詳情頁', async ({ page }) => {
    // 一條對話只能綁一個工單（後端 409 CONFLICT），先把既有連結工單清掉，
    // 本案例才能重複執行。
    const conv = await api.get(`conversations/${seeded.conversationId}`);
    const linked = (await conv.json())?.data?.case?.id as string | undefined;
    if (linked) {
      await api.delete(`cases/${linked}`).catch(() => {});
      const idx = createdCaseIds.indexOf(linked);
      if (idx >= 0) createdCaseIds.splice(idx, 1);
    }

    await openCaseCreateModal(page);
    const dialog = openDialog(page);

    const title = `${E2E_PREFIX} UI建立 ${RUN}`;
    await setField(dialog.getByPlaceholder('案件標題...'), title);
    await setField(dialog.getByPlaceholder('描述問題...'), `${E2E_PREFIX} 描述`);
    const categorySelect = dialog
      .locator('select', { has: page.locator('option[value="維修"]') })
      .first();
    await categorySelect.selectOption('查詢');

    // inbox 模式走 POST /cases/from-conversation/:conversationId
    const result = await submitAndObserve(
      page,
      async () => {
        await dialog.locator('button', { hasText: /建立案件|建立中/ }).last().click();
      },
      /\/cases\/from-conversation\//,
      'POST',
      20_000,
    );
    expectAccepted(result, '完整合法表單建立工單（from-conversation）');

    const newId = (result.body as { data?: { id?: string } })?.data?.id;
    if (newId) createdCaseIds.push(newId);

    await expect(page).toHaveURL(/\/dashboard\/cases\/[0-9a-f-]{36}/, { timeout: 20_000 });
  });
});

// ===========================================================================
// 二、工單建立 — 後端直測（繞過 UI）
// ===========================================================================

test.describe('工單 — 建立 API 欄位驗證', () => {
  const base = () => ({
    contactId: seeded.contactId,
    channelId: webchatChannelId,
    category: '查詢',
  });

  test('title：空字串被擋、101 字被擋、100 字接受', async () => {
    await apiFieldCheck(api, {
      path: 'cases',
      payload: { ...base(), title: '' },
      expect: 'reject',
      context: 'POST /cases title 空字串',
    });
    await apiFieldCheck(api, {
      path: 'cases',
      payload: { ...base(), title: strOfLength(LIMITS.caseTitle + 1) },
      expect: 'reject',
      context: `POST /cases title ${LIMITS.caseTitle + 1} 字（超上限）`,
    });
    const ok = await apiFieldCheck(api, {
      path: 'cases',
      payload: { ...base(), title: `${E2E_PREFIX}${strOfLength(LIMITS.caseTitle - E2E_PREFIX.length)}` },
      expect: 'accept',
      context: `POST /cases title ${LIMITS.caseTitle} 字（剛好上限）`,
    });
    const id = (ok.body as { data?: { id?: string } })?.data?.id;
    if (id) createdCaseIds.push(id);
  });

  test('description：2001 字被擋、2000 字接受', async () => {
    await apiFieldCheck(api, {
      path: 'cases',
      payload: { ...base(), title: `${E2E_PREFIX}desc ${RUN}`, description: strOfLength(LIMITS.caseDescription + 1) },
      expect: 'reject',
      context: 'POST /cases description 2001 字',
    });
    const ok = await apiFieldCheck(api, {
      path: 'cases',
      payload: { ...base(), title: `${E2E_PREFIX}desc-ok ${RUN}`, description: strOfLength(LIMITS.caseDescription) },
      expect: 'accept',
      context: 'POST /cases description 2000 字',
    });
    const id = (ok.body as { data?: { id?: string } })?.data?.id;
    if (id) createdCaseIds.push(id);
  });

  test('列舉欄位 priority：非法 enum 被擋', async () => {
    await apiFieldCheck(api, {
      path: 'cases',
      payload: { ...base(), title: `${E2E_PREFIX}pri ${RUN}`, priority: 'SUPER_URGENT' },
      expect: 'reject',
      context: 'POST /cases priority 非法列舉值',
    });
  });

  test('uuid 欄位：contactId / channelId / assigneeId / teamId 非 uuid 被擋', async () => {
    for (const field of ['contactId', 'channelId', 'assigneeId', 'teamId'] as const) {
      await apiFieldCheck(api, {
        path: 'cases',
        payload: { ...base(), title: `${E2E_PREFIX}uuid ${RUN}`, [field]: FieldSamples.badUuid },
        expect: 'reject',
        context: `POST /cases ${field} 非法 uuid（含非 hex 字元 g）`,
      });
    }
  });

  test('注入字串：sqlish 標題被當純文字存入，不造成 5xx', async () => {
    const res = await apiFieldCheck(api, {
      path: 'cases',
      payload: { ...base(), title: `${E2E_PREFIX}${FieldSamples.sqlish}` },
      expect: 'accept',
      context: 'POST /cases title 含 SQL 注入樣式字串（Prisma 參數化應安全）',
    });
    const body = res.body as { data?: { id?: string; title?: string } };
    if (body?.data?.id) createdCaseIds.push(body.data.id);
    expect(body?.data?.title, 'SQL 樣式字串應原樣保存（未被吞或改寫）').toBe(
      `${E2E_PREFIX}${FieldSamples.sqlish}`,
    );
  });

  test('往返：emoji / newline / padded 標題存入後原樣讀回', async () => {
    for (const [name, value] of [
      ['emoji', `${E2E_PREFIX}${FieldSamples.emoji}`],
      ['newline', `${E2E_PREFIX}${FieldSamples.newline}`],
      ['padded', `  ${E2E_PREFIX}padded ${RUN}  `],
    ] as const) {
      const res = await api.post('cases', { data: { ...base(), title: value } });
      expect(res.status(), `建立 ${name} 標題工單失敗`).toBe(201);
      const id = (await res.json())?.data?.id as string;
      createdCaseIds.push(id);

      const read = await api.get(`cases/${id}`);
      expect(read.status()).toBe(200);
      const got = (await read.json())?.data?.title;
      expect(got, `${name} 標題往返後應完全一致（API 不 trim、不截斷、不改編碼）`).toBe(value);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 已知 bug：標記為 expected failure，修好後 Playwright 會報 "unexpected pass"
  // ─────────────────────────────────────────────────────────────────────────

  test.fail(
    '[BUG-W6-01] title 純空白 / 全形空白應被後端擋下（zod 只有 min(1)，未 trim）',
    async () => {
      // 前端有 .trim() 擋控，但後端 z.string().min(1) 對 "   " 判定為長度 3 → 放行。
      // 結果：工單標題實際存成空白，列表上顯示為空白列，無法搜尋也看不出是什麼工單。
      for (const blank of [FieldSamples.whitespace, FieldSamples.fullwidthSpace]) {
        await apiFieldCheck(api, {
          path: 'cases',
          payload: { ...base(), title: blank },
          expect: 'reject',
          context: `POST /cases title = ${JSON.stringify(blank)}（純空白）應被擋`,
        });
      }
    },
  );

  test.fail('[BUG-W6-02] category 應為列舉且有長度上限（目前 z.string() 全開）', async () => {
    // 前端只提供 維修/查詢/投訴/其他 四個選項，後端卻接受任意字串且無 max。
    // 影響：①分類篩選會被汙染 ②可塞入超長字串造成列表/報表版面爆開 ③可塞 HTML。
    await apiFieldCheck(api, {
      path: 'cases',
      payload: { ...base(), title: `${E2E_PREFIX}cat ${RUN}`, category: `不存在的分類${strOfLength(500)}` },
      expect: 'reject',
      context: 'POST /cases category 非列舉值 + 超長字串應被擋',
    });
  });
});

// ===========================================================================
// 三、工單詳情頁（內聯改標題 / 備註 / 下拉）
// ===========================================================================

test.describe('工單 — 詳情頁欄位', () => {
  let detailCaseId = '';

  test.beforeAll(async () => {
    detailCaseId = await createCase(`${E2E_PREFIX} 詳情頁欄位 ${RUN}`, {
      description: `${E2E_PREFIX} 原始描述`,
    });
  });

  test('欄位盤點：工單詳情頁', async ({ page }) => {
    await gotoAndCheck(page, `/dashboard/cases/${detailCaseId}`);
    await expect(page.getByText(`${E2E_PREFIX} 詳情頁欄位 ${RUN}`).first()).toBeVisible({
      timeout: 15_000,
    });
    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '工單詳情頁'));
    // 狀態/優先級/分類/負責人/團隊 5 個 select + 備註 textarea + 內部備註 checkbox
    expect(fields.filter((f) => f.tag === 'select').length, '詳情頁應有 ≥5 個下拉').toBeGreaterThanOrEqual(5);
    expect(fields.some((f) => f.tag === 'textarea'), '詳情頁應有備註 textarea').toBe(true);
  });

  test('內聯改標題：空標題被擋（還原原值，不發 PATCH）', async ({ page }) => {
    await gotoAndCheck(page, `/dashboard/cases/${detailCaseId}`);
    const original = `${E2E_PREFIX} 詳情頁欄位 ${RUN}`;
    const heading = page.getByText(original).first();
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await heading.click();

    const input = page.locator('input.text-xl').first();
    await expect(input, '點擊標題應切換為可編輯 input').toBeVisible();

    // 清空 → blur：handleTitleBlur 的 trimmed 為空 → 不 PATCH，還原原值
    const result = await submitAndObserve(
      page,
      async () => {
        await input.fill('');
        await input.blur();
      },
      new RegExp(`/cases/${detailCaseId}$`),
      'PATCH',
      3_000,
    );
    expect(result.requested, '空標題不應發出 PATCH（前端擋控）').toBe(false);
    await expect(page.getByText(original).first(), '空標題應還原為原標題').toBeVisible();
  });

  test('內聯改標題：合法值送出 PATCH 並落地', async ({ page }) => {
    await gotoAndCheck(page, `/dashboard/cases/${detailCaseId}`);
    const original = `${E2E_PREFIX} 詳情頁欄位 ${RUN}`;
    const renamed = `${E2E_PREFIX} 改名${FieldSamples.emoji} ${RUN}`;

    await page.getByText(original).first().click();
    const input = page.locator('input.text-xl').first();
    await expect(input).toBeVisible();

    const result = await submitAndObserve(
      page,
      async () => {
        await input.fill(renamed);
        await input.press('Enter');
      },
      new RegExp(`/cases/${detailCaseId}$`),
      'PATCH',
      10_000,
    );
    expectAccepted(result, '內聯改標題（含 emoji）');

    // 往返：reload 後標題應為新值（emoji 不得壞碼）
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText(renamed).first(), 'reload 後應顯示新標題且 emoji 完好').toBeVisible({
      timeout: 15_000,
    });

    // 還原，避免影響後續案例
    await api.patch(`cases/${detailCaseId}`, { data: { title: original } });
  });

  test('內聯改標題：maxLength=100 截斷（前端不可能送出超長）', async ({ page }) => {
    await gotoAndCheck(page, `/dashboard/cases/${detailCaseId}`);
    await page.getByText(`${E2E_PREFIX} 詳情頁欄位 ${RUN}`).first().click();
    const input = page.locator('input.text-xl').first();
    await expect(input).toBeVisible();
    await input.fill(strOfLength(LIMITS.caseTitle + 50));
    expect((await input.inputValue()).length, '內聯標題應被 maxLength 截在 100').toBe(LIMITS.caseTitle);
    await input.press('Escape');
  });

  test('備註：空白內容不可送出，合法內容成功新增', async ({ page }) => {
    await gotoAndCheck(page, `/dashboard/cases/${detailCaseId}`);
    const noteBox = page.getByPlaceholder('撰寫備註...');
    await expect(noteBox).toBeVisible({ timeout: 15_000 });
    const addBtn = page.locator('button', { hasText: /新增備註|新增中/ }).last();

    // 空 → disabled
    await expect(addBtn, '未輸入備註時「新增備註」應 disabled').toBeDisabled();
    // 純空白 → 仍 disabled（前端 noteContent.trim()）
    await setField(noteBox, FieldSamples.whitespace);
    await expect(addBtn, '純空白備註時「新增備註」應 disabled').toBeDisabled();
    // 全形空白 → JS trim 同樣吃掉 → disabled
    await setField(noteBox, FieldSamples.fullwidthSpace);
    await expect(addBtn, '全形空白備註時「新增備註」應 disabled').toBeDisabled();

    // 合法多行 + emoji 備註 → 應成功
    const content = `${E2E_PREFIX} 備註第一行${FieldSamples.emoji}\n第二行`;
    await setField(noteBox, content);
    const result = await submitAndObserve(
      page,
      async () => addBtn.click(),
      new RegExp(`/cases/${detailCaseId}/notes$`),
      'POST',
      10_000,
    );
    expectAccepted(result, '新增合法備註（多行 + emoji）');

    // 往返：reload 後備註內容仍在（換行與 emoji 皆保留）
    await page.reload({ waitUntil: 'networkidle' });
    await expect(
      page.getByText(`${E2E_PREFIX} 備註第一行`, { exact: false }).first(),
      'reload 後應能讀回備註內容',
    ).toBeVisible({ timeout: 15_000 });
  });

  test('備註 XSS：script payload 以純文字顯示，不被執行', async ({ page }) => {
    const xssCaseId = await createCase(`${E2E_PREFIX} 備註XSS ${RUN}`);
    // 直接由 API 塞入 XSS 備註（前端沒擋，正是要驗渲染端是否安全）
    const res = await api.post(`cases/${xssCaseId}/notes`, {
      data: { content: `${E2E_PREFIX}${FieldSamples.xss}${FieldSamples.html}` },
    });
    expect(res.status(), 'API 新增 XSS 備註應成功（內容本身合法）').toBeLessThan(400);

    await gotoAndCheck(page, `/dashboard/cases/${xssCaseId}`);
    await expect(page.getByText(`${E2E_PREFIX}<script>`, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
    // React 預設跳脫 → script 不應執行、<b> 不應成為元素
    await expectNoXssExecuted(page);
    expect(
      await page.locator('b', { hasText: '粗體' }).count(),
      'HTML 標籤應以純文字顯示，不得被解析成 <b> 元素',
    ).toBe(0);
  });

  test('狀態下拉：選項恰為 VALID_CASE_TRANSITIONS[OPEN] + 目前狀態', async ({ page }) => {
    const id = await createCase(`${E2E_PREFIX} 狀態流轉 ${RUN}`);
    await gotoAndCheck(page, `/dashboard/cases/${id}`);
    const sel = detailSelect(page, '狀態');
    await expect(sel).toBeVisible({ timeout: 15_000 });
    const values = await sel.locator('option').evaluateAll((os) =>
      os.map((o) => (o as HTMLOptionElement).value),
    );
    // packages/shared: OPEN: ['IN_PROGRESS', 'CLOSED']
    expect(values[0], '第一個 option 應為目前狀態').toBe('OPEN');
    expect(values.slice(1).sort(), 'OPEN 的後繼狀態應恰為 IN_PROGRESS / CLOSED').toEqual(
      ['CLOSED', 'IN_PROGRESS'],
    );
    // 不在轉換表內的狀態不得出現
    for (const forbidden of ['RESOLVED', 'ESCALATED', 'PENDING']) {
      expect(values, `OPEN 狀態不應可直接跳到 ${forbidden}`).not.toContain(forbidden);
    }
  });

  test('狀態列舉：後端擋下非法 status 值與非法流轉（繞過 UI 直測）', async () => {
    const id = await createCase(`${E2E_PREFIX} 非法狀態 ${RUN}`);
    await apiFieldCheck(api, {
      path: `cases/${id}`,
      method: 'patch',
      payload: { status: 'DELETED_BY_HACKER' },
      expect: 'reject',
      context: 'PATCH /cases/:id status 非法列舉值',
    });
    // 非法「流轉」：OPEN → RESOLVED 不在轉換表內，狀態機應擋下
    const res = await api.patch(`cases/${id}`, { data: { status: 'RESOLVED' } });
    expect(res.status(), 'OPEN → RESOLVED 為非法流轉，應回 4xx').toBeGreaterThanOrEqual(400);
    expect(res.status(), '非法流轉應回 4xx 而非 5xx').toBeLessThan(500);
  });

  test('[BUG-W6-12] 分類選項在三處不一致（建立 Modal / 詳情頁 / 列表篩選）', async ({ page }) => {
    // 這是「記錄型」案例：斷言目前的不一致現況，修好後此測試會失敗提醒更新。
    const id = await createCase(`${E2E_PREFIX} 分類不一致 ${RUN}`);
    await gotoAndCheck(page, `/dashboard/cases/${id}`);
    const sel = detailSelect(page, '分類');
    await expect(sel).toBeVisible({ timeout: 15_000 });
    const detailCats = (
      await sel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
    ).filter(Boolean);

    // 建立 Modal / 列表篩選用的是 維修/查詢/投訴/其他
    const createCats = ['維修', '查詢', '投訴', '其他'];
    console.log(
      `\n[分類清單不一致]\n  建立 Modal + 列表篩選：${createCats.join('、')}\n  工單詳情頁：${detailCats.join('、')}`,
    );
    expect(
      detailCats,
      '已知不一致：詳情頁分類清單與建立 Modal 不同（見 BUG-W6-12）',
    ).toContain('產品諮詢');
    expect(
      detailCats.includes('維修'),
      '已知不一致：建立時選的「維修」在詳情頁下拉中根本不存在（值會被顯示為空）',
    ).toBe(false);
  });

  test.fail('[BUG-W6-03] 備註 content 應有長度上限（目前 z.string().min(1) 無 max）', async () => {
    // 前端 Textarea 未設 maxLength，後端亦無 max → 可寫入任意長度字串。
    // 50000 字實測成功寫入；時間軸渲染整段內容，頁面會被撐爆。
    const id = await createCase(`${E2E_PREFIX} 備註長度 ${RUN}`);
    await apiFieldCheck(api, {
      path: `cases/${id}/notes`,
      payload: { content: `${E2E_PREFIX}${strOfLength(50_000)}` },
      expect: 'reject',
      context: 'POST /cases/:id/notes content 50000 字應被擋',
    });
  });

  test.fail('[BUG-W6-04] 備註 content 純空白應被後端擋下', async () => {
    // 前端有 trim 擋控，後端 min(1) 對 "   " 放行 → 時間軸出現空白備註列。
    const id = await createCase(`${E2E_PREFIX} 備註空白 ${RUN}`);
    await apiFieldCheck(api, {
      path: `cases/${id}/notes`,
      payload: { content: FieldSamples.whitespace },
      expect: 'reject',
      context: 'POST /cases/:id/notes content 純空白應被擋',
    });
  });
});

// ===========================================================================
// 四、升級 Modal（EscalationModal）
// ===========================================================================

test.describe('工單 — 升級 Modal 欄位', () => {
  let escCaseId = '';

  test.beforeAll(async () => {
    escCaseId = await createCase(`${E2E_PREFIX} 升級測試 ${RUN}`);
    // escalate 要求狀態可流轉到 ESCALATED；指派後會自動進 IN_PROGRESS
    if (agentId) {
      await api.post(`cases/${escCaseId}/assign`, { data: { assigneeId: agentId } }).catch(() => {});
    }
  });

  async function openEscalation(page: Page) {
    await gotoAndCheck(page, `/dashboard/cases/${escCaseId}`);
    await page.locator('button', { hasText: /升級/ }).first().click();
    await expect(page.getByText('案件升級').first()).toBeVisible({ timeout: 10_000 });
  }

  test('欄位盤點：升級 Modal', async ({ page }) => {
    await openEscalation(page);
    const fields = await inventoryFields(page, DIALOG_SCOPE);
    console.log(formatFieldInventory(fields, '工單升級 Modal'));
    // 原因 select + 補充說明 textarea + 優先級 select + 重指派 select + 3 個通知 checkbox
    expect(fields.filter((f) => f.type === 'checkbox').length, '應有 3 個通知對象 checkbox').toBe(3);
    const note = fields.find((f) => f.tag === 'textarea');
    expect(note, '找不到補充說明 textarea').toBeTruthy();
    expect(
      note!.maxLength,
      `補充說明前端 maxLength 應等於後端 zod max(${LIMITS.escalateNote})`,
    ).toBe(LIMITS.escalateNote);
  });

  test('升級原因必填：未選原因時送出被前端擋下並顯示錯誤', async ({ page }) => {
    await openEscalation(page);
    const dialog = openDialog(page);
    const confirm = dialog.locator('button', { hasText: /確認升級|升級中/ }).last();

    const result = await submitAndObserve(
      page,
      async () => confirm.click(),
      new RegExp(`/cases/${escCaseId}/escalate$`),
      'POST',
      3_000,
    );
    expect(result.requested, '未選升級原因時不應發出 escalate 請求').toBe(false);
    await expect(dialog.getByText('請選擇升級原因'), '應顯示必填錯誤訊息').toBeVisible();
  });

  test('補充說明長度：maxLength=500 截斷', async ({ page }) => {
    await openEscalation(page);
    const dialog = openDialog(page);
    const note = dialog.getByPlaceholder('描述升級原因...');
    await setField(note, strOfLength(LIMITS.escalateNote + 100));
    expect(
      (await note.inputValue()).length,
      '補充說明應被 maxLength 截在 500',
    ).toBe(LIMITS.escalateNote);
    await expect(dialog.getByText(`${LIMITS.escalateNote}/${LIMITS.escalateNote}`)).toBeVisible();
  });

  test('升級後優先級：只提供高於目前優先級的選項', async ({ page }) => {
    await openEscalation(page);
    const dialog = openDialog(page);
    // 目前 MEDIUM → 只應有 HIGH / URGENT
    const prioritySelect = dialog
      .locator('select', { has: page.locator('option[value="URGENT"]') })
      .first();
    const values = await prioritySelect.locator('option').evaluateAll((os) =>
      os.map((o) => (o as HTMLOptionElement).value),
    );
    expect(values, 'MEDIUM 工單升級時不應可選 LOW').not.toContain('LOW');
    expect(values, 'MEDIUM 工單升級時不應可選回 MEDIUM').not.toContain('MEDIUM');
    expect(values, '應可選 HIGH').toContain('HIGH');
  });

  test('升級成功：選原因 + 填說明 + 勾通知對象後送出', async ({ page }) => {
    // ⚠️ 本案例必須用「全新的 IN_PROGRESS 工單」：同 describe 前面的案例已把共用
    //    escCaseId 推到 ESCALATED，而 ESCALATED→ESCALATED 不在 VALID_CASE_TRANSITIONS
    //    內（後端回 422 INVALID_TRANSITION），不是欄位 bug 而是測試資料狀態問題。
    const freshId = await createCase(`${E2E_PREFIX} 升級成功 ${RUN}`);
    if (agentId) {
      await api.post(`cases/${freshId}/assign`, { data: { assigneeId: agentId } });
    }
    await gotoAndCheck(page, `/dashboard/cases/${freshId}`);
    await page.locator('button', { hasText: /升級/ }).first().click();
    await expect(page.getByText('案件升級').first()).toBeVisible({ timeout: 10_000 });
    const dialog = openDialog(page);

    // 用快選 chip 選原因
    await dialog.locator('button', { hasText: '客戶多次催促' }).first().click();
    await setField(dialog.getByPlaceholder('描述升級原因...'), `${E2E_PREFIX} 升級說明 ${RUN}`);
    // 勾第三個通知對象（團隊群組），三個皆選
    await dialog.locator('input[type="checkbox"]').nth(2).check();

    const result = await submitAndObserve(
      page,
      async () => dialog.locator('button', { hasText: /確認升級|升級中/ }).last().click(),
      new RegExp(`/cases/${freshId}/escalate$`),
      'POST',
      15_000,
    );
    expectAccepted(result, '完整填寫的升級表單');

    // 往返：狀態應變 ESCALATED、優先級應提升
    const read = await api.get(`cases/${freshId}`);
    const data = (await read.json())?.data;
    expect(data?.status, '升級後狀態應為 ESCALATED').toBe('ESCALATED');
    expect(data?.priority, '升級後優先級應為 HIGH').toBe('HIGH');
  });

  test('升級 API：note 501 字被擋、newPriority 非法列舉被擋', async () => {
    const id = await createCase(`${E2E_PREFIX} 升級API ${RUN}`);
    await apiFieldCheck(api, {
      path: `cases/${id}/escalate`,
      payload: { reason: `${E2E_PREFIX}r`, newPriority: 'HIGH', note: strOfLength(LIMITS.escalateNote + 1) },
      expect: 'reject',
      context: 'POST /cases/:id/escalate note 501 字',
    });
    await apiFieldCheck(api, {
      path: `cases/${id}/escalate`,
      payload: { reason: `${E2E_PREFIX}r`, newPriority: 'NUCLEAR' },
      expect: 'reject',
      context: 'POST /cases/:id/escalate newPriority 非法列舉值',
    });
    await apiFieldCheck(api, {
      path: `cases/${id}/escalate`,
      payload: { reason: '', newPriority: 'HIGH' },
      expect: 'reject',
      context: 'POST /cases/:id/escalate reason 空字串',
    });
  });

  test.fail('[BUG-W6-05] escalate reason 應有長度上限且拒絕純空白', async () => {
    // reason: z.string().min(1) — 無 max、未 trim。
    // 實測：reason="   " 成功升級，事件 metadata 存 reason:"   "，
    //       時間軸顯示空白升級原因；10000 字亦可寫入。
    const id = await createCase(`${E2E_PREFIX} 升級原因缺口 ${RUN}`);
    if (agentId) await api.post(`cases/${id}/assign`, { data: { assigneeId: agentId } });
    await apiFieldCheck(api, {
      path: `cases/${id}/escalate`,
      payload: { reason: FieldSamples.whitespace, newPriority: 'HIGH' },
      expect: 'reject',
      context: 'POST /cases/:id/escalate reason 純空白應被擋',
    });
  });

  test.fail('[BUG-W6-06] escalate notifyTargets 應為列舉，目前接受任意字串', async () => {
    // notifyTargets: z.array(z.string()) — 前端只會送 supervisor/original_assignee/team，
    // 後端卻接受任何字串陣列，通知路由端只能靠下游默默忽略。
    const id = await createCase(`${E2E_PREFIX} 通知對象缺口 ${RUN}`);
    if (agentId) await api.post(`cases/${id}/assign`, { data: { assigneeId: agentId } });
    await apiFieldCheck(api, {
      path: `cases/${id}/escalate`,
      payload: { reason: `${E2E_PREFIX}r`, newPriority: 'HIGH', notifyTargets: ['不存在的通知對象'] },
      expect: 'reject',
      context: 'POST /cases/:id/escalate notifyTargets 非列舉值應被擋',
    });
  });
});

// ===========================================================================
// 五、工單列表篩選欄位
// ===========================================================================

test.describe('工單 — 列表篩選欄位', () => {
  test('欄位盤點：工單列表頁', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/cases');
    await expect(page.getByPlaceholder('搜尋工單標題', { exact: false })).toBeVisible({
      timeout: 15_000,
    });
    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '工單列表頁'));
    // 搜尋框 + 4 個篩選下拉（負責人/優先級/分類/SLA）
    expect(fields.filter((f) => f.tag === 'select').length, '列表頁應有 4 個篩選下拉').toBe(4);
  });

  test('搜尋框：<2 字不過濾，≥2 字做標題/描述子字串比對', async ({ page }) => {
    const uniq = `w6srch${RUN}`;
    const id = await createCase(`${E2E_PREFIX} 搜尋 ${uniq}`);
    expect(id).toBeTruthy();

    await gotoAndCheck(page, '/dashboard/cases');
    const search = page.getByPlaceholder('搜尋工單標題', { exact: false });
    await expect(search).toBeVisible({ timeout: 15_000 });

    // 1 字 → 不過濾（列數不變）
    await setField(search, 'a');
    await page.waitForTimeout(800);
    const allRows = await page.locator('tbody tr').count();

    // 不可能命中的 ≥2 字關鍵字 → 應過濾成 0 列（或空狀態）
    await setField(search, `zz${RUN}zz`);
    await page.waitForTimeout(800);
    const noneRows = await page.locator('tbody tr').count();
    expect(noneRows, '不存在的關鍵字應過濾掉所有列').toBeLessThan(Math.max(1, allRows));

    // 搜尋框吃特殊字元不應炸頁（正規表達式字元類別）
    await setField(search, '[E2E]');
    await page.waitForTimeout(800);
    expect(await page.locator('tbody, [class*=empty]').count(), '含 [ ] 的關鍵字不應造成頁面崩潰')
      .toBeGreaterThan(0);
  });

  test('篩選下拉：優先級 / 分類 / SLA 選值後發出對應查詢參數', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/cases');
    const prioritySelect = page
      .locator('select', { has: page.locator('option[value="URGENT"]') })
      .first();
    await expect(prioritySelect).toBeVisible({ timeout: 15_000 });

    const result = await submitAndObserve(
      page,
      async () => { await prioritySelect.selectOption('URGENT'); },
      /\/cases\?.*priority=URGENT/,
      'GET',
      10_000,
    );
    expect(result.requested, '選擇優先級篩選應帶 priority=URGENT 重新查詢').toBe(true);
    expect(result.status, '篩選查詢應成功').toBe(200);

    // SLA 篩選
    const slaSelect = page.locator('select', { has: page.locator('option[value="breached"]') }).first();
    const sla = await submitAndObserve(
      page,
      async () => { await slaSelect.selectOption('breached'); },
      /\/cases\?.*slaStatus=breached/,
      'GET',
      10_000,
    );
    expect(sla.requested, '選擇 SLA 篩選應帶 slaStatus 重新查詢').toBe(true);
    expect(sla.status).toBe(200);
  });

  test('篩選參數 API 驗證：非法 slaStatus / priority / assigneeId 被擋', async () => {
    for (const [name, qs] of [
      ['slaStatus 非法', 'slaStatus=exploded'],
      ['priority 非法', 'priority=SUPER'],
      ['status 非法', 'status=DELETED'],
      ['assigneeId 非 uuid', `assigneeId=${FieldSamples.badUuid}`],
      ['limit 超過 100', 'limit=9999'],
      ['page 為 0', 'page=0'],
      ['page 為負數', 'page=-1'],
    ] as const) {
      const res = await api.get(`cases?${qs}`);
      expect(res.status(), `GET /cases?${qs}（${name}）應回 4xx`).toBeGreaterThanOrEqual(400);
      expect(res.status(), `GET /cases?${qs}（${name}）應回 4xx 而非 5xx`).toBeLessThan(500);
    }
  });
});

// ===========================================================================
// 六、聯繫人（Contacts）
// ===========================================================================

test.describe('聯繫人 — 欄位', () => {
  test('欄位盤點：聯繫人列表頁 + 詳情頁', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/contacts');
    const listFields = await inventoryFields(page);
    console.log(formatFieldInventory(listFields, '聯繫人列表頁'));
    expect(
      listFields.some((f) => f.placeholder?.includes('搜尋聯繫人')),
      '列表頁應有搜尋聯繫人輸入框',
    ).toBe(true);

    await gotoAndCheck(page, `/dashboard/contacts/${seeded.contactId}`);
    const detailFields = await inventoryFields(page);
    console.log(formatFieldInventory(detailFields, '聯繫人詳情頁'));
  });

  test('搜尋框：server-side 查詢，關鍵字進 q 參數', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/contacts');
    const search = page.getByPlaceholder('搜尋聯繫人', { exact: false });
    await expect(search).toBeVisible({ timeout: 15_000 });

    // ⚠️ 重要現況：聯繫人列表頁的 useContacts 寫死 `excludeChannelType: 'WEBCHAT'`
    //    （src/app/dashboard/contacts/page.tsx），因此自種的 Chatbox 訪客
    //    「永遠不會」出現在這個列表。搜尋斷言因此改用一個真的看得到的聯繫人。
    const visible = await api.get('contacts', {
      params: { excludeChannelType: 'WEBCHAT', limit: '5' },
    });
    const visibleList = ((await visible.json())?.data ?? []) as Array<{
      id: string;
      displayName?: string;
    }>;
    test.skip(visibleList.length === 0, '租戶沒有非 WEBCHAT 聯繫人，無法驗證列表搜尋');
    const target = visibleList[0];
    const keyword = (target.displayName || '').slice(0, 6);
    test.skip(keyword.trim().length < 2, '取樣到的聯繫人顯示名過短，無法當搜尋關鍵字');

    // 輸入關鍵字 → 應發出帶 q 的 server-side 查詢
    const result = await submitAndObserve(
      page,
      async () => setField(search, keyword),
      /\/contacts\?.*q=/,
      'GET',
      10_000,
    );
    expect(result.requested, '輸入關鍵字應發出帶 q 參數的 server-side 查詢').toBe(true);
    expect(result.status, '搜尋查詢應成功').toBe(200);

    // 回傳筆數應等於列表列數（證明是後端過濾，而非前端在完整列表上篩）
    const returned = ((result.body as { data?: unknown[] })?.data ?? []) as unknown[];
    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 15_000 })
      .toBe(returned.length);
    expect(returned.length, '以既有聯繫人名搜尋應至少命中 1 筆').toBeGreaterThan(0);

    // 不可能命中的關鍵字 → 應收斂為 0 列
    const none = await submitAndObserve(
      page,
      async () => setField(search, `zz${RUN}zz`),
      /\/contacts\?.*q=/,
      'GET',
      10_000,
    );
    expect(none.status, '無結果查詢仍應回 200').toBe(200);
    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 15_000 })
      .toBe(0);
  });

  test('搜尋框：特殊字元 / 超長關鍵字不造成 5xx', async () => {
    for (const q of [
      FieldSamples.sqlish,
      FieldSamples.xss,
      '%%%',
      '[E2E]',
      strOfLength(2_000),
    ]) {
      const res = await api.get('contacts', { params: { q, limit: '5' } });
      expect(
        res.status(),
        `GET /contacts?q=${JSON.stringify(q).slice(0, 40)} 不應回 5xx`,
      ).toBeLessThan(500);
    }
  });

  test('聯繫人標籤：新增後可讀回，移除後消失', async ({ page }) => {
    // 取一個 CONTACT scope 的既有標籤（不新建標籤，避免汙染 Settings 資料）
    const tagsRes = await api.get('tags');
    const tags = ((await tagsRes.json())?.data ?? []) as Array<{
      id: string;
      name: string;
      scope?: string;
    }>;
    const contactTag = tags.find(
      (t) => t.scope === 'CONTACT' && t.name.trim().length > 0 && t.name.length < 30,
    );
    test.skip(!contactTag, '租戶沒有可用的 CONTACT scope 標籤，跳過標籤增刪測試');

    // TagManager 的 availableTags 會濾掉「已掛在該聯繫人身上」的標籤，
    // 導致下拉沒有該選項。先確保乾淨起始狀態（移除後再測新增）。
    await api.delete(`contacts/${seeded.contactId}/tags/${contactTag!.id}`).catch(() => {});

    await gotoAndCheck(page, `/dashboard/contacts/${seeded.contactId}`);
    const tagSelect = page
      .locator('select', { has: page.locator(`option[value="${contactTag!.id}"]`) })
      .first();
    await expect(tagSelect, '詳情頁應有標籤下拉').toBeVisible({ timeout: 15_000 });

    // 新增
    await tagSelect.selectOption(contactTag!.id);
    const add = await submitAndObserve(
      page,
      async () => page.locator('button:has(.lucide-plus)').last().click(),
      new RegExp(`/contacts/${seeded.contactId}/tags$`),
      'POST',
      10_000,
    );
    expectAccepted(add, '新增聯繫人標籤');

    // 往返：reload 後標籤仍在
    await page.reload({ waitUntil: 'networkidle' });
    await expect(
      page.getByText(contactTag!.name, { exact: false }).first(),
      'reload 後標籤應仍掛在聯繫人上',
    ).toBeVisible({ timeout: 15_000 });

    // 移除（清理自己加的標籤）
    const del = await api.delete(`contacts/${seeded.contactId}/tags/${contactTag!.id}`);
    expect(del.status(), '移除標籤應成功').toBeLessThan(400);
  });

  test('標籤 API：tagId 非 uuid / 不存在的 uuid 被擋', async () => {
    await apiFieldCheck(api, {
      path: `contacts/${seeded.contactId}/tags`,
      payload: { tagId: FieldSamples.badUuid },
      expect: 'reject',
      context: 'POST /contacts/:id/tags tagId 非法 uuid',
    });
    const res = await api.post(`contacts/${seeded.contactId}/tags`, {
      data: { tagId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(res.status(), '不存在的 tagId 應回 4xx（不得 5xx 也不得靜默成功）')
      .toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('聯繫人 PATCH：displayName 空字串、email 格式、isBlocked 型別被擋', async () => {
    await apiFieldCheck(api, {
      path: `contacts/${seeded.contactId}`,
      method: 'patch',
      payload: { displayName: '' },
      expect: 'reject',
      context: 'PATCH /contacts/:id displayName 空字串',
    });
    for (const bad of FieldSamples.badEmails) {
      await apiFieldCheck(api, {
        path: `contacts/${seeded.contactId}`,
        method: 'patch',
        payload: { email: bad },
        expect: 'reject',
        context: `PATCH /contacts/:id email=${JSON.stringify(bad)}（非法格式）`,
      });
    }
    await apiFieldCheck(api, {
      path: `contacts/${seeded.contactId}`,
      method: 'patch',
      payload: { isBlocked: 'yes' },
      expect: 'reject',
      context: 'PATCH /contacts/:id isBlocked 非布林值',
    });
  });

  test('合併精靈：三步欄位可走到最終確認閘門（不執行不可逆合併）', async ({ page }) => {
    await gotoAndCheck(page, `/dashboard/contacts/${seeded.contactId}`);
    const mergeBtn = page.locator('button', { hasText: '合併聯繫人' }).first();
    await expect(mergeBtn).toBeVisible({ timeout: 15_000 });
    await mergeBtn.click();

    const dialog = openDialog(page);
    const fields = await inventoryFields(page, DIALOG_SCOPE);
    console.log(formatFieldInventory(fields, '合併聯繫人精靈 — 步驟 1'));

    // 步驟 1：未選合併對象時「下一步」應 disabled（必選擋控）
    const next = dialog.locator('button', { hasText: '下一步' }).first();
    await expect(next, '未選合併對象時「下一步」應 disabled').toBeDisabled();

    // 搜尋框 <2 字不查詢
    const search = dialog.locator('input').first();
    const short = await submitAndObserve(
      page,
      async () => {
        await setField(search, 'a');
        await page.waitForTimeout(800);
      },
      /\/contacts\?q=/,
      'GET',
      1_500,
    );
    expect(short.requested, '合併搜尋 <2 字時不應發出查詢').toBe(false);

    // ⚠️ 安全紅線：合併不可逆，且本輪只種得出一個可犧牲的訪客，
    //    因此到此為止——不選對象、不走完三步、不按最終合併鍵。
    await dialog.locator('button', { hasText: /取消|關閉/ }).first().click().catch(() => {});
  });

  test('合併 API：非法 / 相同 uuid 被擋（不觸發真實合併）', async () => {
    await apiFieldCheck(api, {
      path: 'contacts/merge',
      payload: { primaryContactId: FieldSamples.badUuid, secondaryContactId: seeded.contactId },
      expect: 'reject',
      context: 'POST /contacts/merge primaryContactId 非法 uuid',
    });
    // 主次同一人：應被擋（否則等同自我封存）
    const same = await api.post('contacts/merge', {
      data: { primaryContactId: seeded.contactId, secondaryContactId: seeded.contactId },
    });
    expect(same.status(), '主次為同一聯繫人時應回 4xx').toBeGreaterThanOrEqual(400);
    expect(same.status(), '主次為同一聯繫人時應回 4xx 而非 5xx').toBeLessThan(500);
  });

  test.fail('[BUG-W6-07] 聯繫人 displayName 應有長度上限且拒絕純空白', async () => {
    // updateContactSchema.displayName: z.string().min(1) — 無 max、未 trim。
    // 實測：純空白成功寫入（聯繫人在列表變成空白列）、10000 字亦成功寫入。
    await apiFieldCheck(api, {
      path: `contacts/${seeded.contactId}`,
      method: 'patch',
      payload: { displayName: FieldSamples.whitespace },
      expect: 'reject',
      context: 'PATCH /contacts/:id displayName 純空白應被擋',
    });
  });

  test.fail('[BUG-W6-08] 聯繫人 phone 應有格式與長度驗證（目前 z.string() 全開）', async () => {
    // phone: z.string().nullable().optional() — 任何字串都收，包含 5000 字與 <script>。
    await apiFieldCheck(api, {
      path: `contacts/${seeded.contactId}`,
      method: 'patch',
      payload: { phone: strOfLength(5_000) },
      expect: 'reject',
      context: 'PATCH /contacts/:id phone 5000 字應被擋',
    });
  });

  test.afterAll(async () => {
    // 還原自種訪客欄位（避免 test.fail 案例寫髒資料留下）
    await api
      .patch(`contacts/${seeded.contactId}`, {
        data: { displayName: seeded.contactName, phone: null, language: 'zh-TW' },
      })
      .catch(() => {});
  });
});

// ===========================================================================
// 七、收件匣（Inbox）
// ===========================================================================

test.describe('收件匣 — 欄位', () => {
  const inboxUrl = () => `/dashboard/inbox?conv=${seeded.conversationId}`;

  test('欄位盤點：收件匣（列表 + 對話視窗）', async ({ page }) => {
    await gotoInboxReady(page);
    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '收件匣（含對話視窗）'));
    expect(
      fields.some((f) => f.placeholder?.includes('搜尋對話')),
      '應有搜尋對話輸入框',
    ).toBe(true);
    expect(
      fields.some((f) => f.tag === 'textarea'),
      '應有訊息輸入 textarea',
    ).toBe(true);
  });

  test('訊息輸入框：空 / 純空白 / 全形空白皆不送出', async ({ page }) => {
    await gotoInboxReady(page);
    const input = page.getByPlaceholder('輸入訊息', { exact: false });

    for (const [name, value] of [
      ['空字串', ''],
      ['純空白', FieldSamples.whitespace],
      ['全形空白', FieldSamples.fullwidthSpace],
    ] as const) {
      const result = await submitAndObserve(
        page,
        async () => {
          await setField(input, value);
          await input.press('Enter');
        },
        new RegExp(`/conversations/${seeded.conversationId}/messages$`),
        'POST',
        2_500,
      );
      expect(result.requested, `訊息=${name} 時不應送出（前端 trim 擋控）`).toBe(false);
    }
  });

  test('訊息輸入框：Shift+Enter 換行不送出，Enter 才送出', async ({ page }) => {
    await gotoInboxReady(page);
    const input = page.getByPlaceholder('輸入訊息', { exact: false });

    // Shift+Enter → 只換行，不發 API
    const shift = await submitAndObserve(
      page,
      async () => {
        await setField(input, `${E2E_PREFIX} 第一行`);
        await input.press('Shift+Enter');
        await input.type('第二行');
      },
      new RegExp(`/conversations/${seeded.conversationId}/messages$`),
      'POST',
      2_500,
    );
    expect(shift.requested, 'Shift+Enter 應只換行不送出').toBe(false);
    expect(await input.inputValue(), 'Shift+Enter 後輸入框應含換行').toContain('\n');

    // Enter → 送出（多行內容）
    const send = await submitAndObserve(
      page,
      async () => input.press('Enter'),
      new RegExp(`/conversations/${seeded.conversationId}/messages$`),
      'POST',
      20_000,
    );
    expectAccepted(send, 'Enter 送出多行訊息');
    // 送出後輸入框應清空
    await expect
      .poll(async () => input.inputValue(), { timeout: 10_000 })
      .toBe('');
  });

  test('訊息 XSS：script payload 以純文字呈現，不被執行', async ({ page }) => {
    await gotoInboxReady(page);
    const input = page.getByPlaceholder('輸入訊息', { exact: false });

    const payload = `${E2E_PREFIX}${FieldSamples.xss}${FieldSamples.html}`;
    const send = await submitAndObserve(
      page,
      async () => {
        await setField(input, payload);
        await input.press('Enter');
      },
      new RegExp(`/conversations/${seeded.conversationId}/messages$`),
      'POST',
      20_000,
    );
    expectAccepted(send, '送出含 XSS payload 的訊息');

    await expect(page.getByText('<script>', { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expectNoXssExecuted(page);
    expect(
      await page.locator('b', { hasText: '粗體' }).count(),
      '訊息中的 HTML 標籤應以純文字顯示',
    ).toBe(0);
  });

  test('訊息超長邊界：10000 字訊息可送出且往返完整（WEBCHAT 無渠道長度限制）', async () => {
    // 走 API（UI fill 超長字串過慢），驗證後端與資料庫不截斷
    const long = `${E2E_PREFIX}${strOfLength(10_000)}`;
    const res = await api.post(`conversations/${seeded.conversationId}/messages`, {
      data: { contentType: 'text', content: { text: long } },
    });
    expect(res.status(), '10000 字訊息應被接受或明確擋下，不得 5xx').toBeLessThan(500);
    if (res.status() < 400) {
      const list = await api.get(`conversations/${seeded.conversationId}/messages`, {
        params: { limit: '5', order: 'desc' },
      });
      const body = await list.json();
      const items = (body?.data?.items ?? body?.data ?? []) as Array<{
        content?: { text?: string };
      }>;
      const hit = items.find((m) => m.content?.text?.startsWith(E2E_PREFIX));
      expect(hit?.content?.text, '超長訊息往返後應完整無截斷').toHaveLength(long.length);
    }
  });

  test('搜尋對話框：關鍵字過濾為 client-side，特殊字元不炸頁', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/inbox');
    const search = page.getByPlaceholder('搜尋對話', { exact: false });
    await expect(search).toBeVisible({ timeout: 20_000 });

    for (const q of ['[E2E]', FieldSamples.sqlish, FieldSamples.xss, strOfLength(500)]) {
      await setField(search, q);
      await page.waitForTimeout(500);
      await expectNoXssExecuted(page);
    }
    // 頁面仍可用（搜尋框仍在）
    await expect(search, '特殊字元搜尋後頁面不應崩潰').toBeVisible();
  });

  test('進階篩選抽屜：狀態 / 渠道 / 指派欄位可勾選並套用', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/inbox');
    // 開抽屜（篩選鈕）
    const filterBtn = page.locator('button:has(.lucide-sliders-horizontal), button:has(.lucide-filter)').first();
    await expect(filterBtn).toBeVisible({ timeout: 20_000 });
    await filterBtn.click();
    await expect(page.getByText('進階篩選').first()).toBeVisible({ timeout: 10_000 });

    const drawerFields = await inventoryFields(page, 'div.fixed.left-0.top-0');
    console.log(formatFieldInventory(drawerFields, '收件匣 — 進階篩選抽屜'));
    // 4 個狀態 checkbox + N 個渠道 checkbox + 指派 radio/選項
    expect(
      drawerFields.filter((f) => f.type === 'checkbox').length,
      '抽屜應有 ≥4 個 checkbox（4 種對話狀態）',
    ).toBeGreaterThanOrEqual(4);

    // 勾「已關閉」並套用
    await page.locator('label', { hasText: '已關閉' }).locator('input[type=checkbox]').check();
    // ⚠️ 抽屜以 CSS translate 移出畫面（-translate-x-full），元素不會被卸載，
    //    因此不能用 toBeHidden；改以「套用後發出帶篩選條件的查詢」為斷言依據。
    const applied = await submitAndObserve(
      page,
      async () => page.locator('button', { hasText: '套用篩選' }).first().click(),
      /\/conversations\?/,
      'GET',
      10_000,
    );
    expect(applied.requested, '套用篩選應觸發對話列表重新查詢').toBe(true);
    expect(applied.status, '套用篩選的查詢應成功').toBe(200);

    // 清除篩選還原（避免影響後續案例）
    await filterBtn.click();
    await page.locator('button', { hasText: '清除全部' }).first().click();
    await page.waitForTimeout(1_000);
  });

  test('結案 Dialog：結案原因欄位為選填，前端未設 maxLength（與後端 1000 不一致）', async ({
    page,
  }) => {
    // ⚠️ 本案例必須排在「結案原因 API 邊界」之前：那個案例的 1000 字合法值會真的
    //    把對話結案，之後 UI 就沒有結案鈕、也沒有訊息輸入框可用。
    //    本案例只開 Dialog 檢查欄位屬性，最後按「取消」不真的結案。
    await gotoInboxReady(page);
    const closeBtn = page.locator('button[title="結案此對話"]').first();
    const visible = await closeBtn.isVisible().catch(() => false);
    test.skip(!visible, '此對話已結案，無結案鈕可點');

    await closeBtn.click();
    await expect(page.getByText('結案此對話').first()).toBeVisible({ timeout: 10_000 });
    const reasonBox = page.getByPlaceholder('例：問題已解決', { exact: false });
    await expect(reasonBox).toBeVisible();

    const maxLen = await reasonBox.getAttribute('maxlength');
    console.log(
      `\n[前後端一致性] 結案原因 前端 maxLength=${maxLen ?? '未設'} / 後端 zod max=${LIMITS.closeReason}`,
    );
    // 前端沒有 maxLength 是 P2 級不一致（使用者打超過 1000 字要等送出才知道被拒）
    expect(maxLen, '已知不一致：結案原因前端未設 maxLength（見 BUG-W6-10）').toBeNull();

    // 取消，不真的結案
    await page.locator('button', { hasText: '取消' }).first().click();
  });

  test('模板選擇器：變數輸入欄位填入後回填到訊息框', async ({ page }) => {
    // 必須先接管對話，否則模板鈕是 disabled（Bot 處理中）
    await gotoInboxReady(page);
    const tplBtn = page.locator('button[title="模板"]').first();
    const usable =
      (await tplBtn.isVisible().catch(() => false)) && (await tplBtn.isEnabled().catch(() => false));
    test.skip(!usable, '模板按鈕不可用（此渠道不支援或對話未接管）');

    await tplBtn.click();
    const tplSearch = page.getByPlaceholder('搜尋模板...');
    await expect(tplSearch).toBeVisible({ timeout: 10_000 });

    const tplFields = await inventoryFields(page, DIALOG_SCOPE);
    console.log(formatFieldInventory(tplFields, '模板選擇器 — 階段 1（清單）'));

    // 搜尋框過濾：不可能命中的字串應無結果
    await setField(tplSearch, `zz${RUN}zz`);
    await page.waitForTimeout(500);

    // 找一個有變數的模板（含 {{）；沒有就 skip 變數填入驗證
    await setField(tplSearch, '');
    await page.waitForTimeout(500);
    const tplItems = openDialog(page).locator('button').filter({
      hasNotText: /取消|關閉|搜尋/,
    });
    const count = await tplItems.count();
    test.skip(count === 0, '租戶沒有可用訊息模板，跳過變數填入測試');

    // 點第一個模板；若進入變數輸入階段就驗證欄位，否則直接回填
    await tplItems.first().click();
    const varStage = page.getByText('填入變數', { exact: false }).first();
    const hasVars = await varStage.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasVars) {
      // 無變數模板 → 應直接回填訊息框
      await expect
        .poll(async () => (await page.getByPlaceholder('輸入訊息', { exact: false }).inputValue()).length, {
          timeout: 10_000,
        })
        .toBeGreaterThan(0);
      return;
    }

    const varFields = await inventoryFields(page, DIALOG_SCOPE);
    console.log(formatFieldInventory(varFields, '模板選擇器 — 階段 2（變數輸入）'));
    const firstVar = openDialog(page).locator('input').first();
    await setField(firstVar, `${E2E_PREFIX}變數值`);
    await page.locator('button', { hasText: /插入|確定|套用/ }).first().click();
    await expect
      .poll(
        async () => page.getByPlaceholder('輸入訊息', { exact: false }).inputValue(),
        { timeout: 10_000 },
      )
      .toContain(`${E2E_PREFIX}變數值`);
  });

  test('結案原因欄位：選填（可空）、1000 字為上限', async () => {
    // 邊界走 API。⚠️ 合法值會真的把 seeded 對話結案，因此本案例排在所有需要
    // 「對話仍開著」的 UI 案例之後。
    await apiFieldCheck(api, {
      path: `conversations/${seeded.conversationId}/close`,
      payload: { reason: strOfLength(LIMITS.closeReason + 1) },
      expect: 'reject',
      context: 'POST /conversations/:id/close reason 1001 字',
    });
    await apiFieldCheck(api, {
      path: `conversations/${seeded.conversationId}/close`,
      payload: { reason: `${E2E_PREFIX}${strOfLength(LIMITS.closeReason - E2E_PREFIX.length)}` },
      expect: 'accept',
      context: 'POST /conversations/:id/close reason 1000 字（剛好上限）',
    });
  });

  test('對話標籤欄位：新增/移除走 API 驗證（tagId 列舉與存在性）', async () => {
    await apiFieldCheck(api, {
      path: `conversations/${seeded.conversationId}/tags`,
      payload: { tagId: FieldSamples.badUuid },
      expect: 'reject',
      context: 'POST /conversations/:id/tags tagId 非法 uuid',
    });

    const tagsRes = await api.get('tags');
    const tags = ((await tagsRes.json())?.data ?? []) as Array<{
      id: string;
      name: string;
      scope?: string;
    }>;
    const convTag = tags.find((t) => t.scope === 'CONVERSATION');
    test.skip(!convTag, '租戶沒有 CONVERSATION scope 標籤，跳過對話標籤增刪');

    const add = await api.post(`conversations/${seeded.conversationId}/tags`, {
      data: { tagId: convTag!.id },
    });
    expect(add.status(), '新增對話標籤應成功').toBeLessThan(400);
    const del = await api.delete(`conversations/${seeded.conversationId}/tags/${convTag!.id}`);
    expect(del.status(), '移除對話標籤應成功').toBeLessThan(400);
  });

  test('對話 PATCH：status 非法列舉 / assignedToId 非 uuid 被擋', async () => {
    await apiFieldCheck(api, {
      path: `conversations/${seeded.conversationId}`,
      method: 'patch',
      payload: { status: 'DELETED' },
      expect: 'reject',
      context: 'PATCH /conversations/:id status 非法列舉值',
    });
    await apiFieldCheck(api, {
      path: `conversations/${seeded.conversationId}`,
      method: 'patch',
      payload: { assignedToId: FieldSamples.badUuid },
      expect: 'reject',
      context: 'PATCH /conversations/:id assignedToId 非法 uuid',
    });
  });

  test('列表查詢參數：limit 超過 100 / page 為 0 被擋', async () => {
    for (const qs of ['limit=9999', 'page=0', 'page=-1', 'limit=0']) {
      const res = await api.get(`conversations?${qs}`);
      expect(res.status(), `GET /conversations?${qs} 應回 4xx`).toBeGreaterThanOrEqual(400);
      expect(res.status(), `GET /conversations?${qs} 應回 4xx 而非 5xx`).toBeLessThan(500);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 已知 bug
  // ─────────────────────────────────────────────────────────────────────────

  test.fail(
    '[BUG-W6-09] 送出訊息 content 完全未驗證：空物件 / 空字串 / 缺 text 皆可寫入',
    async () => {
      // sendMessageSchema: { contentType: z.string().default('text'), content: z.record(z.unknown()) }
      // content 只要是物件就通過 —— 沒有要求 text 存在、非空、有長度上限。
      // 實測：{}、{text:""}、{text:"   "}、{foo:"bar"} 全部回 201 並以 OUTBOUND 存入對話。
      // 影響：客服端可產生空泡泡訊息；若走真實渠道（LINE/FB）將送出無效 payload。
      await apiFieldCheck(api, {
        path: `conversations/${seeded.conversationId}/messages`,
        payload: { contentType: 'text', content: {} },
        expect: 'reject',
        context: 'POST /conversations/:id/messages content 空物件應被擋',
      });
    },
  );

  test.fail('[BUG-W6-09b] contentType 應為列舉，目前接受任意字串', async () => {
    // contentType: z.string().default('text') —— 實測 contentType:"wut" 回 201 並存入，
    // 前端 MessageBubble 對未知型別無對應渲染分支。
    await apiFieldCheck(api, {
      path: `conversations/${seeded.conversationId}/messages`,
      payload: { contentType: 'definitely_not_a_type', content: { text: `${E2E_PREFIX}ct` } },
      expect: 'reject',
      context: 'POST /conversations/:id/messages contentType 非列舉值應被擋',
    });
  });
});
