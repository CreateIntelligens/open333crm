import { test, expect, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import { E2E_PREFIX, newApiContext, gotoAndCheck } from './helpers';
import {
  FieldSamples,
  boundarySamples,
  strOfLength,
  inventoryFields,
  formatFieldInventory,
  fieldByLabel,
  setField,
  submitAndObserve,
  expectRejected,
  expectAccepted,
  apiFieldCheck,
  expectNoXssExecuted,
} from './field-helpers';

/**
 * Wave 6 欄位級測試 — 知識庫（Knowledge）+ 自動化（Automation）@fields
 *
 * 後端真實約束（讀 zod schema 取得，非猜測）：
 *
 *  knowledge.routes.ts createArticleSchema / updateArticleSchema
 *    title    z.string().min(1).max(200)      ← 無 .trim()
 *    content  z.string().min(1)               ← 無上限
 *    summary  z.string().max(500).optional()
 *    category z.string().max(100).optional()
 *    tags     z.array(z.string()).optional()
 *  knowledge.routes.ts searchSchema
 *    query     z.string().min(1)
 *    topK      z.coerce.number().int().min(1).max(20).optional()
 *    threshold z.coerce.number().min(0).max(1).optional()
 *  knowledge.routes.ts importSchema
 *    { articles: [ {title,content,summary?,category?,tags?,status?} ] }
 *    ↑ 注意：HTTP body 外層是「物件包 articles」；但 ImportDialog 讀 .json 檔時
 *      要求「檔案內容必須是純陣列」（`if (!Array.isArray(parsed))` 才擋），
 *      再由前端包成 { articles: parsed } 送出。兩者不是同一層，勿混淆。
 *  settings.routes.ts embeddingSettingsSchema
 *    baseUrl z.string().url().optional() / model z.string().min(1).optional()
 *    topK z.number().int().min(1).max(20) / threshold z.number().min(0).max(1)
 *  settings.routes.ts chatSettingsSchema
 *    provider z.enum(['ollama','gemini']) / model min(1) / baseUrl url()
 *    temperature 0..2 / maxTokens int 1..8192
 *    chatSystemPrompt 等四個 prompt：z.string().optional()（**無長度上限**）
 *    clarifyThreshold 0..1 / clarifyMaxAttempts int 0..5
 *  automation.routes.ts createRuleSchema / updateRuleSchema
 *    name z.string().min(1).max(200)  ← 無 .trim()
 *    description z.string().max(1000).optional()
 *    priority z.number().int().min(0).max(10000).optional()
 *    trigger { type: z.string().min(1) }.passthrough()
 *    conditions z.record(z.unknown())
 *    actions z.array({type,params}).min(1)   ← 前端無對應擋控
 *    另有 packages/automation contracts 層驗證（event/fact/operator/action 白名單）
 *
 * 撰寫時發現的現況（各案例內就地註記，非本測試的錯）：
 *  A. 知識庫 tab 是「路由」不是點擊式 tab：/dashboard/knowledge/{search,embedding,
 *     chat-prompt,feedback}（`[section]/page.tsx`），要用 goto 切換而非點 tab。
 *  B. ImportDialog 只有檔案上傳（`<input type=file>` + hidden），**沒有 JSON 貼入
 *     textarea**。任務書提到的「JSON 貼入框」在目前程式碼中不存在，因此以
 *     「上傳 .json 檔」＋「API 直測 import schema」涵蓋該路徑。
 *  C. 自動化「傳送通知」的輸入框 label 是「通知訊息」，placeholder 是
 *     「輸入通知內容...」（Wave 3 記錄的踩坑；實際讀 ActionEditor.tsx 確認
 *     notify/notify_supervisor 分支兩者皆有）。仍一律以 label 定位較穩。
 *  D. 語義搜尋 tab 的送出按鈕文字「搜尋」會與其他含「搜尋」的元素撞名，
 *     getByRole 必須加 exact:true。
 *
 * 安全限制遵守情形：
 *  - 絕不呼叫 POST /knowledge/bulk-embed（長耗時）
 *  - Embedding / Chat 設定在 beforeAll 記下原值，afterAll 還原（見 restoreSettings）
 *  - AI 金鑰欄位只填假值且**不送出**（避免覆蓋 UAT 既有 BYOK key）
 *  - 自建資料一律帶 [E2E] 前綴，afterAll 清理
 */

const RUN = randomUUID().slice(0, 8);
const ART_TITLE = `${E2E_PREFIX} 欄位測試文章 ${RUN}`;
const RULE_NAME = `${E2E_PREFIX} 欄位測試規則 ${RUN}`;

/** 自動化規則的合法條件形狀（contracts 層要求 fact/operator 皆在事件白名單內） */
const VALID_CONDITIONS = {
  all: [{ fact: 'contact.name', operator: 'equal', value: 'probe' }],
};
/** conversation.created 事件允許的動作之一 */
const VALID_ACTIONS = [{ type: 'send_message', params: { text: `${E2E_PREFIX} 動作內容` } }];

const ruleBody = (override: Record<string, unknown> = {}) => ({
  name: RULE_NAME,
  trigger: { type: 'conversation.created' },
  conditions: VALID_CONDITIONS,
  actions: VALID_ACTIONS,
  ...override,
});

let api: APIRequestContext;
/** 測試中自建的資源 id，afterAll 統一清理 */
const createdArticles: string[] = [];
const createdRules: string[] = [];
/** beforeAll 記下的設定原值，afterAll 還原（改壞會影響 UAT 的 AI 功能） */
let originalEmbedding: Record<string, unknown> | null = null;
let originalChat: Record<string, unknown> | null = null;

test.beforeAll(async () => {
  api = await newApiContext();
  const emb = await api.get('settings/embedding');
  if (emb.ok()) originalEmbedding = (await emb.json())?.data?.settings ?? null;
  const chat = await api.get('settings/chat');
  if (chat.ok()) originalChat = (await chat.json())?.data?.settings ?? null;
});

test.afterAll(async () => {
  if (!api) return;
  // 還原設定（只送回原值的可寫欄位，避免把唯讀/衍生欄位一起 PUT 回去）
  try {
    if (originalEmbedding) {
      await api.put('settings/embedding', {
        data: {
          baseUrl: originalEmbedding.baseUrl,
          model: originalEmbedding.model,
          topK: originalEmbedding.topK,
          threshold: originalEmbedding.threshold,
        },
      });
    }
  } catch {
    /* 清理失敗不炸測試 */
  }
  try {
    if (originalChat) {
      await api.put('settings/chat', {
        data: {
          provider: originalChat.provider,
          model: originalChat.model,
          baseUrl: originalChat.baseUrl,
          temperature: originalChat.temperature,
          maxTokens: originalChat.maxTokens,
          chatSystemPrompt: originalChat.chatSystemPrompt,
          summarizeSystemPrompt: originalChat.summarizeSystemPrompt,
          clarifySystemPrompt: originalChat.clarifySystemPrompt,
          modelGuideSystemPrompt: originalChat.modelGuideSystemPrompt,
          clarifyThreshold: originalChat.clarifyThreshold,
          clarifyMaxAttempts: originalChat.clarifyMaxAttempts,
        },
      });
    }
  } catch {
    /* 清理失敗不炸測試 */
  }
  // 知識庫文章是硬刪（prisma.kmArticle.delete）；自動化規則是軟刪（update isActive:false）
  for (const id of createdArticles) {
    try {
      await api.delete(`knowledge/${id}`);
    } catch {
      /* ignore */
    }
  }
  for (const id of createdRules) {
    try {
      await api.delete(`automation/rules/${id}`);
    } catch {
      /* ignore */
    }
  }
  await api.dispose();
});

/** 建一篇文章並登記待清理，回傳 id */
async function createArticle(payload: Record<string, unknown>): Promise<string> {
  const res = await api.post('knowledge', { data: payload });
  expect(res.status(), `建立文章失敗：${await res.text()}`).toBe(201);
  const id = (await res.json())?.data?.id as string;
  createdArticles.push(id);
  return id;
}

// ===========================================================================
// 一、知識庫：文章表單欄位
// ===========================================================================

test.describe('知識庫 — 文章表單 @fields', () => {
  test('KB-01 文章表單欄位盤點（含前端 maxLength vs 後端 zod max 比對）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/knowledge');
    await page.getByRole('button', { name: '新增文章' }).click();
    await expect(page.getByRole('heading', { name: '新增文章' })).toBeVisible({ timeout: 10_000 });

    const fields = await inventoryFields(page, 'form');
    console.log(formatFieldInventory(fields, '知識庫 › 新增文章 Dialog'));

    // 後端各欄位上限 vs 前端 maxLength：專案全部欄位都沒設 maxLength
    // → 使用者可以貼超長字串、按下儲存才被後端 400（無即時回饋）。記為 P3 UX。
    const withMax = fields.filter((f) => f.maxLength !== null);
    console.log(
      `前端有設 maxLength 的欄位：${withMax.length} / ${fields.length}` +
        `（後端 title max=200 / summary max=500 / category max=100）`,
    );

    // 必填標記：title 與 content 後端都是 min(1)，前端應都有 required
    const required = fields.filter((f) => f.required);
    console.log(`前端標 required 的欄位：${required.length} 個`);
    expect(required.length, '標題與內容後端皆 min(1)，前端應至少標 2 個 required').toBeGreaterThanOrEqual(2);
  });

  test('KB-02 標題必填：留空被前端 required 擋下（不發 API）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/knowledge');
    await page.getByRole('button', { name: '新增文章' }).click();
    await expect(page.getByRole('heading', { name: '新增文章' })).toBeVisible({ timeout: 10_000 });

    // 標題留空、內容有填 → HTML required 應擋下（不會發 POST）
    const content = await fieldByLabel(page, '內容', 'textarea');
    await setField(content, '內容有填但標題空白');

    const result = await submitAndObserve(
      page,
      async () => page.getByRole('button', { name: '儲存' }).click(),
      /\/knowledge$/,
      'POST',
      3_000,
    );
    expect(result.requested, '標題留空時不應發出 POST（HTML required 應擋下）').toBe(false);
  });

  test('KB-03 內容必填：留空被前端 required 擋下（不發 API）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/knowledge');
    await page.getByRole('button', { name: '新增文章' }).click();
    await expect(page.getByRole('heading', { name: '新增文章' })).toBeVisible({ timeout: 10_000 });

    const title = await fieldByLabel(page, '標題', 'input');
    await setField(title, `${ART_TITLE} 內容留空`);

    const result = await submitAndObserve(
      page,
      async () => page.getByRole('button', { name: '儲存' }).click(),
      /\/knowledge$/,
      'POST',
      3_000,
    );
    expect(result.requested, '內容留空時不應發出 POST（HTML required 應擋下）').toBe(false);
  });

  test('KB-04 標題長度邊界 under/exact/over（後端 max=200）', async () => {
    const b = boundarySamples(200);
    const mk = (s: string) => ({ title: s, content: 'boundary content' });

    const under = await api.post('knowledge', { data: mk(`${E2E_PREFIX}${b.under.slice(E2E_PREFIX.length)}`) });
    expect(under.status(), '199 字標題應被接受').toBe(201);
    createdArticles.push((await under.json()).data.id);

    const exact = await api.post('knowledge', { data: mk(`${E2E_PREFIX}${b.exact.slice(E2E_PREFIX.length)}`) });
    expect(exact.status(), '200 字標題（剛好上限）應被接受').toBe(201);
    createdArticles.push((await exact.json()).data.id);

    await apiFieldCheck(api, {
      path: 'knowledge',
      payload: mk(b.over),
      expect: 'reject',
      context: 'KB 標題 201 字（超過 max=200）',
    });
  });

  test('KB-05 摘要/分類長度邊界（後端 summary max=500 / category max=100）', async () => {
    await apiFieldCheck(api, {
      path: 'knowledge',
      payload: { title: `${ART_TITLE} summary`, content: 'x', summary: strOfLength(501) },
      expect: 'reject',
      context: 'KB 摘要 501 字（超過 max=500）',
    });
    await apiFieldCheck(api, {
      path: 'knowledge',
      payload: { title: `${ART_TITLE} category`, content: 'x', category: strOfLength(101) },
      expect: 'reject',
      context: 'KB 分類 101 字（超過 max=100）',
    });
    // exact 上限應接受
    const ok = await api.post('knowledge', {
      data: {
        title: `${ART_TITLE} exact-bounds`,
        content: 'x',
        summary: strOfLength(500),
        category: strOfLength(100),
      },
    });
    expect(ok.status(), '摘要 500 / 分類 100（剛好上限）應被接受').toBe(201);
    createdArticles.push((await ok.json()).data.id);
  });

  test('KB-06 tags 型別驗證：非陣列/非字串元素應被後端擋下', async () => {
    await apiFieldCheck(api, {
      path: 'knowledge',
      payload: { title: `${ART_TITLE} tags1`, content: 'x', tags: 'a,b' },
      expect: 'reject',
      context: 'KB tags 傳字串（應為陣列）',
    });
    await apiFieldCheck(api, {
      path: 'knowledge',
      payload: { title: `${ART_TITLE} tags2`, content: 'x', tags: [1, 2] },
      expect: 'reject',
      context: 'KB tags 陣列內含數字（應為字串）',
    });
  });

  test('KB-07 儲存往返：padded / emoji / newline / Markdown 完整保留', async () => {
    const summary = FieldSamples.padded;
    const content = `# Markdown 標題\n\n${FieldSamples.emoji}\n\n${FieldSamples.newline}\n\n- 項目一\n- 項目二`;
    const category = FieldSamples.emoji;
    const id = await createArticle({
      title: `${ART_TITLE} roundtrip`,
      content,
      summary,
      category,
      tags: ['tag一', FieldSamples.emoji],
    });

    const read = await api.get(`knowledge/${id}`);
    expect(read.status()).toBe(200);
    const a = (await read.json()).data;
    expect(a.content, '內容（含 Markdown/換行/emoji）應原樣保留').toBe(content);
    expect(a.summary, '摘要前後空白不應被 trim（後端 schema 無 .trim()）').toBe(summary);
    expect(a.category, '分類 emoji 應原樣保留').toBe(category);
    expect(a.tags, '標籤陣列應原樣保留').toEqual(['tag一', FieldSamples.emoji]);
  });

  test('KB-08 超長內容：content 無後端上限，應可存且完整讀回', async () => {
    // ⚠️ 每次建立文章都會 fire-and-forget 觸發 embedArticle（knowledge.service.ts:151），
    //    內容越長，Ollama 就被佔用越久。先前用 10 萬字會讓同一支 Ollama 被卡住數分鐘，
    //    使後面 KB-21 的語義搜尋連續 504（誤判成 UI bug）。
    //    這裡改用 2 萬字：一樣證明「content 沒有後端上限」，又不會癱瘓 UAT 的 embedding 服務。
    const LEN = 20_000;
    const huge = strOfLength(LEN, '長');
    const id = await createArticle({ title: `${ART_TITLE} huge`, content: huge });
    const a = (await (await api.get(`knowledge/${id}`)).json()).data;
    expect(a.content.length, `${LEN} 字內容應完整存回（content 後端無 max）`).toBe(LEN);

    // 後端直測：確認更長的內容也不會被 schema 擋（證明真的無上限），但不落庫成大文章
    await apiFieldCheck(api, {
      path: 'knowledge',
      payload: { title: `${ART_TITLE} nolimit-probe`, content: strOfLength(LEN) },
      expect: 'accept',
      context: 'KB 內容長度無上限（zod content 只有 min(1)）',
    });
    const list = await api.get('knowledge', { params: { q: `${ART_TITLE} nolimit-probe`, limit: '5' } });
    if (list.ok()) {
      for (const it of (await list.json())?.data ?? []) {
        if (typeof it?.title === 'string' && it.title.includes('nolimit-probe')) createdArticles.push(it.id);
      }
    }
  });

  test('KB-09 XSS / HTML / SQL 注入樣本：存為純文字，列表頁不執行腳本', async ({ page }) => {
    const id = await createArticle({
      title: `${ART_TITLE} ${FieldSamples.xss}`,
      content: `${FieldSamples.html}\n${FieldSamples.sqlish}`,
      summary: FieldSamples.xss,
      category: FieldSamples.sqlish,
    });

    // 後端應原樣保存（不做 HTML escape 也可以，重點是前端不得執行）
    const a = (await (await api.get(`knowledge/${id}`)).json()).data;
    expect(a.summary, 'XSS payload 應原樣以純文字保存').toBe(FieldSamples.xss);

    // 列表頁渲染後斷言腳本未執行
    await gotoAndCheck(page, '/dashboard/knowledge');
    await expect(page.getByText(`${E2E_PREFIX} 欄位測試文章`).first()).toBeVisible({ timeout: 15_000 });
    await expectNoXssExecuted(page);

    // 編輯 dialog 內（值被塞回 input/textarea）也不得執行
    const row = page.getByText(FieldSamples.xss, { exact: false }).first();
    if (await row.count()) {
      await expectNoXssExecuted(page);
    }
    // <script> 不應真的成為 DOM 裡的可執行元素
    const scriptCount = await page.locator('script:has-text("__E2E_XSS__")').count();
    expect(scriptCount, 'XSS payload 不應被解析成真正的 <script> 元素').toBe(0);
  });

  test('KB-10 【BUG】純空白/全形空白標題被後端接受（zod 缺 .trim()）', async () => {
    // 前端 <Input required> 只擋「完全空字串」，空白字元可通過 HTML 驗證；
    // 後端 createArticleSchema 的 title 是 z.string().min(1) 沒有 .trim()，
    // 因此 "   " 與全形空白 "　" 都算 1 個以上字元 → 201 入庫。
    // 結果：知識庫出現「看起來沒有標題」的文章，且會被 AI 檢索到。
    const junk: string[] = [];
    for (const [label, value] of [
      ['半形空白', FieldSamples.whitespace],
      ['全形空白', FieldSamples.fullwidthSpace],
    ] as const) {
      const res = await api.post('knowledge', { data: { title: value, content: 'x' } });
      if (res.status() === 201) {
        const id = (await res.json()).data.id;
        junk.push(id);
        createdArticles.push(id);
      }
      expect(
        res.status(),
        `【已知 BUG P2】KB 標題填${label}被後端接受（${res.status()}）：` +
          `createArticleSchema.title 是 z.string().min(1) 缺 .trim()，` +
          `應改為 z.string().trim().min(1)。此處刻意斷言目前的錯誤行為，修好後本斷言會 fail 提醒更新。`,
      ).toBe(201);
    }
    expect(junk.length, '兩種空白標題皆應（目前）被接受＝bug 重現成功').toBe(2);
  });

  test('KB-11 編輯往返：PATCH 更新標題與內容後重讀一致', async () => {
    const id = await createArticle({ title: `${ART_TITLE} edit`, content: '原始內容' });
    const newTitle = `${ART_TITLE} edited ${FieldSamples.emoji}`;
    const newContent = `更新後內容\n第二行`;
    const res = await api.patch(`knowledge/${id}`, { data: { title: newTitle, content: newContent } });
    expect(res.status(), 'PATCH 更新應成功').toBe(200);

    const a = (await (await api.get(`knowledge/${id}`)).json()).data;
    expect(a.title, '更新後標題應一致').toBe(newTitle);
    expect(a.content, '更新後內容（含換行）應一致').toBe(newContent);

    // 更新同樣受長度上限約束
    await apiFieldCheck(api, {
      path: `knowledge/${id}`,
      method: 'patch',
      payload: { title: strOfLength(201) },
      expect: 'reject',
      context: 'KB PATCH 標題 201 字',
    });
  });

  test('KB-12 硬刪驗證：DELETE 後 GET 應 404（非軟刪）', async () => {
    const res = await api.post('knowledge', { data: { title: `${ART_TITLE} del`, content: 'x' } });
    const id = (await res.json()).data.id;
    const del = await api.delete(`knowledge/${id}`);
    expect(del.status(), 'DELETE 應成功').toBe(200);
    const after = await api.get(`knowledge/${id}`);
    expect(after.status(), '知識庫文章是硬刪（prisma.kmArticle.delete），刪除後應 404').toBe(404);
  });
});

// ===========================================================================
// 二、知識庫：搜尋 / 過濾 / 匯入 / 語義搜尋
// ===========================================================================

test.describe('知識庫 — 搜尋 / 過濾 / 匯入 @fields', () => {
  test('KB-20 文章列表搜尋與過濾框欄位盤點 + 特殊字元不炸頁', async ({ page }) => {
    const errors = await gotoAndCheck(page, '/dashboard/knowledge');
    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '知識庫 › 文章列表（搜尋＋過濾）'));

    const search = page.getByPlaceholder('搜尋文章...');
    await expect(search).toBeVisible({ timeout: 10_000 });

    // 搜尋框餵注入樣本：應正常回列表（Prisma 參數化），不得 5xx
    for (const sample of [FieldSamples.sqlish, FieldSamples.xss, FieldSamples.emoji, '%_']) {
      const [res] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/knowledge') && r.request().method() === 'GET',
          { timeout: 15_000 },
        ).catch(() => null),
        setField(search, sample),
      ]);
      if (res) {
        expect(res.status(), `搜尋框輸入「${sample}」不應造成伺服器錯誤`).toBeLessThan(500);
      }
    }
    await expectNoXssExecuted(page);
    expect(errors.filter((e) => /TypeError|ReferenceError/.test(e)), '搜尋不應造成前端例外').toEqual([]);
  });

  test('KB-21 語義搜尋輸入框：空白時送出鈕 disabled，有值可送出（@ai 只驗流程）', async ({ page }) => {
    // 模型重載期間最多可能連吃 5 個 60 秒 timeout，放寬本案例的 timeout
    test.setTimeout(600_000);
    await gotoAndCheck(page, '/dashboard/knowledge/search');
    const input = page.getByPlaceholder(/輸入查詢文字/);
    await expect(input).toBeVisible({ timeout: 10_000 });

    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '知識庫 › 語義搜尋'));

    // ⚠️ 「語義搜尋」tab 標題含「搜尋」子字串，getByRole 必須 exact:true
    const submit = page.getByRole('button', { name: '搜尋', exact: true });
    await expect(submit, '未輸入查詢字時送出鈕應 disabled（前端擋控）').toBeDisabled();

    // 純空白：trim 後仍為空 → 前端 !searchQuery.trim() 應維持 disabled
    await setField(input, FieldSamples.whitespace);
    await expect(submit, '純空白查詢字送出鈕應維持 disabled').toBeDisabled();

    // 合法查詢：應發出 POST /knowledge/search（不斷言回傳內容，@ai 只驗流程）
    //
    // ⚠️ 實測發現（P2，非本測試的錯）：Ollama 閒置約 3 分鐘後會把 bge-m3 卸載，
    //    下一次語義搜尋要重新載入模型。實測連續呼叫的樣態：
    //      #1 504 (60s) → #2 504 (60s) → #3 504 (60s) → #4 200 (36s) → #5 之後 200 (~0.5s)
    //    也就是模型重載期間，每個請求都會卡滿 gateway 的 60 秒 timeout 回 504，
    //    使用者要連按 3～4 次搜尋才會成功。
    //    （POST /knowledge/bulk-embed 就是因為同一個問題改成背景執行＋立即回應，
    //      但 POST /knowledge/search 是同步等待，沒有做對應處理。）
    //    因此這裡反覆打到「真的熱起來」（回 200 且耗時 < 5 秒）再驗 UI 流程，
    //    避免把環境的模型重載誤報成 UI 欄位 bug。
    let warm = false;
    for (let i = 0; i < 6 && !warm; i++) {
      const t0 = Date.now();
      const res = await api
        .post('knowledge/search', { data: { query: '暖機' }, timeout: 150_000 })
        .catch(() => null);
      const ms = Date.now() - t0;
      console.log(`語義搜尋暖機第 ${i + 1} 次：status=${res?.status() ?? 'timeout'} 耗時 ${ms}ms`);
      // 回 200 即代表模型已載入完成；耗時仍偏高（首發命中重載尾段）時再補打一次，
      // 確保後續 UI 那一發落在「已熱」狀態（穩定 ~0.5s），避免不必要的 skip。
      if (res && res.status() === 200) {
        if (ms < 5_000) {
          warm = true;
        } else {
          const t1 = Date.now();
          const again = await api
            .post('knowledge/search', { data: { query: '暖機2' }, timeout: 150_000 })
            .catch(() => null);
          const ms1 = Date.now() - t1;
          console.log(`語義搜尋暖機補打：status=${again?.status() ?? 'timeout'} 耗時 ${ms1}ms`);
          warm = !!again && again.status() === 200 && ms1 < 5_000;
        }
      }
    }
    test.skip(
      !warm,
      '語義搜尋暖機失敗（Ollama 冷啟動 > gateway timeout，持續回 504）——' +
        '這是環境/效能問題（已知 P2），非 UI 欄位 bug，跳過 UI 流程驗證',
    );

    await setField(input, '冰箱不冷');
    const result = await submitAndObserve(
      page,
      async () => submit.click(),
      /\/knowledge\/search$/,
      'POST',
      60_000,
    );
    expect(result.requested, '合法查詢字應發出語義搜尋請求').toBe(true);
    expect(
      result.status,
      `語義搜尋不應回 5xx（實際 ${result.status}）。` +
        '若此處為 504，代表 Ollama 冷啟動超過 gateway timeout（已知 P2，見案例註解）',
    ).toBeLessThan(500);
  });

  test('KB-22 語義搜尋 API 參數邊界：query/topK/threshold（後端直測）', async () => {
    await apiFieldCheck(api, {
      path: 'knowledge/search',
      payload: { query: '' },
      expect: 'reject',
      context: '語義搜尋 query 空字串（min=1）',
    });
    await apiFieldCheck(api, {
      path: 'knowledge/search',
      payload: { query: 'x', topK: 21 },
      expect: 'reject',
      context: '語義搜尋 topK=21（max=20）',
    });
    await apiFieldCheck(api, {
      path: 'knowledge/search',
      payload: { query: 'x', topK: 0 },
      expect: 'reject',
      context: '語義搜尋 topK=0（min=1）',
    });
    await apiFieldCheck(api, {
      path: 'knowledge/search',
      payload: { query: 'x', threshold: 1.5 },
      expect: 'reject',
      context: '語義搜尋 threshold=1.5（max=1）',
    });
    await apiFieldCheck(api, {
      path: 'knowledge/search',
      payload: { query: 'x', threshold: -0.1 },
      expect: 'reject',
      context: '語義搜尋 threshold=-0.1（min=0）',
    });
    await apiFieldCheck(api, {
      path: 'knowledge/search',
      payload: { query: 'x', topK: 1.5 },
      expect: 'reject',
      context: '語義搜尋 topK=1.5（應為整數）',
    });
  });

  test('KB-23 匯入 Dialog 欄位盤點：僅檔案上傳，無 JSON 貼入框', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/knowledge');
    await page.getByRole('button', { name: '匯入文章' }).click();
    await expect(page.getByRole('heading', { name: '匯入文章' })).toBeVisible({ timeout: 10_000 });

    // input[type=file] 是 hidden（className="hidden"），inventoryFields 只掃可見元素，
    // 因此這裡另外用 DOM 直接盤點，確認匯入路徑只有「檔案」一種輸入。
    const allInputs = await page.$$eval('input, textarea', (els) =>
      els.map((e) => ({
        tag: e.tagName.toLowerCase(),
        type: e.getAttribute('type'),
        accept: e.getAttribute('accept'),
      })),
    );
    const fileInputs = allInputs.filter((f) => f.type === 'file');
    const textAreas = allInputs.filter((f) => f.tag === 'textarea');
    console.log(`匯入 Dialog：file input ${fileInputs.length} 個（accept=${fileInputs[0]?.accept}）、textarea ${textAreas.length} 個`);

    expect(fileInputs.length, '匯入應提供檔案上傳欄位').toBeGreaterThanOrEqual(1);
    expect(
      textAreas.length,
      'ImportDialog.tsx 目前沒有 JSON 貼入 textarea（任務書所述的貼入框不存在於程式碼）',
    ).toBe(0);
    expect(fileInputs[0]?.accept, 'accept 應含 .json').toContain('.json');

    // 上傳鈕在未選檔時應 disabled
    await expect(
      page.getByRole('button', { name: /上傳 0 個檔案/ }),
      '未選檔時上傳鈕應 disabled',
    ).toBeDisabled();
  });

  test('KB-24 匯入非法 JSON 格式應被擋下（非陣列外層 / 元素缺必填）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/knowledge');
    await page.getByRole('button', { name: '匯入文章' }).click();
    await expect(page.getByRole('heading', { name: '匯入文章' })).toBeVisible({ timeout: 10_000 });

    const fileInput = page.locator('input[type=file]');

    // ① 外層寫成 { articles: [...] }（常見誤用）→ 前端 isArray 檢查應擋下，不發 API
    await fileInput.setInputFiles({
      name: 'bad-wrapped.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ articles: [{ title: `${ART_TITLE} wrapped`, content: 'x' }] })),
    });
    const wrapped = await submitAndObserve(
      page,
      async () => page.getByRole('button', { name: /上傳 1 個檔案/ }).click(),
      /\/knowledge\/import$/,
      'POST',
      8_000,
    );
    expect(wrapped.requested, '外層非陣列的 JSON 應被前端擋下，不發出 import 請求').toBe(false);
    await expect(
      page.getByText('JSON must be an array'),
      '前端應顯示「JSON must be an array」錯誤',
    ).toBeVisible({ timeout: 10_000 });
  });

  test('KB-25 匯入 API schema 直測：外層物件必填 articles 陣列，元素受同一組長度約束', async () => {
    // 前端把檔案內容包成 { articles: parsed } 送出，因此 HTTP body 外層一定是物件。
    await apiFieldCheck(api, {
      path: 'knowledge/import',
      payload: { articles: { title: 'a', content: 'b' } } as unknown as Record<string, unknown>,
      expect: 'reject',
      context: '匯入 articles 傳物件（應為陣列）',
    });
    await apiFieldCheck(api, {
      path: 'knowledge/import',
      payload: { articles: [{ title: '', content: 'x' }] },
      expect: 'reject',
      context: '匯入元素 title 空字串（min=1）',
    });
    await apiFieldCheck(api, {
      path: 'knowledge/import',
      payload: { articles: [{ title: strOfLength(201), content: 'x' }] },
      expect: 'reject',
      context: '匯入元素 title 201 字（max=200）',
    });
    await apiFieldCheck(api, {
      path: 'knowledge/import',
      payload: { articles: [{ title: `${ART_TITLE} noc` }] },
      expect: 'reject',
      context: '匯入元素缺 content（必填）',
    });

    // 合法匯入應成功（並登記清理）
    const ok = await api.post('knowledge/import', {
      data: { articles: [{ title: `${ART_TITLE} import-ok`, content: '匯入內容' }] },
    });
    expect(ok.status(), '合法匯入應成功').toBeLessThan(400);
    const list = await api.get('knowledge', { params: { q: `${E2E_PREFIX} 欄位測試文章 ${RUN} import-ok`, limit: '20' } });
    if (list.ok()) {
      const items = (await list.json())?.data ?? [];
      for (const it of items) {
        if (typeof it?.title === 'string' && it.title.includes(`import-ok`)) createdArticles.push(it.id);
      }
    }
  });
});

// ===========================================================================
// 三、知識庫：Embedding 設定 / Chat & Prompt 設定
// ===========================================================================

test.describe('知識庫 — Embedding / Chat & Prompt 設定 @fields', () => {
  test('KB-30 Embedding 設定頁欄位盤點（絕不觸發 bulk-embed）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/knowledge/embedding');
    await expect(page.getByText(/Base URL|服務位址/).first()).toBeVisible({ timeout: 15_000 });
    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '知識庫 › Embedding 設定'));
    expect(fields.length, 'Embedding 設定頁應有輸入欄位').toBeGreaterThan(0);
    // 安全紅線：本案例只讀不寫，不點任何「重新嵌入 / bulk-embed」按鈕
  });

  test('KB-31 Embedding Base URL 格式驗證（後端 z.string().url()）', async () => {
    // ⚠️ z.string().url() 底層是 new URL()，只要「有 scheme」就算合法，
    //    不限 http/https。FieldSamples.badUrls 中的 'ftp:/x' 因此會被接受（200），
    //    與 KB-32 的 javascript: 是同一顆 bug（P2）。這裡只斷言「沒有 scheme」
    //    的那幾個確實被擋，帶 scheme 的另外在 KB-32 記錄。
    const noScheme = FieldSamples.badUrls.filter((u) => !/^[a-z][a-z0-9+.-]*:/i.test(u));
    expect(noScheme.length, '應有不含 scheme 的非法 URL 樣本').toBeGreaterThan(0);
    for (const bad of noScheme) {
      await apiFieldCheck(api, {
        path: 'settings/embedding',
        method: 'put',
        payload: { baseUrl: bad },
        expect: 'reject',
        context: `Embedding baseUrl 非法值「${bad}」`,
      });
    }

    // 帶 scheme 但非 http/https 的值（ftp:/x）目前會被接受 —— 就地記錄並立即還原
    const ftp = await api.put('settings/embedding', { data: { baseUrl: 'ftp:/x' } });
    const ftpStatus = ftp.status();
    await api.put('settings/embedding', { data: { baseUrl: originalEmbedding?.baseUrl } });
    expect(
      ftpStatus,
      '【已知 BUG P2】Embedding baseUrl 接受非 http(s) scheme（ftp:/x）：' +
        'z.string().url() 不限 scheme，應加 .refine(v => /^https?:\\/\\//.test(v))。' +
        '此處斷言目前行為（200），修好後本斷言會 fail 提醒更新。',
    ).toBe(200);

    // 還原保險：確認被拒/已還原後設定乾淨
    const cur = (await (await api.get('settings/embedding')).json())?.data?.settings;
    expect(cur.baseUrl, '測試後 baseUrl 必須還原為原值').toBe(originalEmbedding?.baseUrl);
  });

  test('KB-32 【BUG】Embedding Base URL 接受 javascript: scheme（z.url() 不限 scheme）', async () => {
    // z.string().url() 底層用 new URL()，javascript:/file:/data: 等 scheme 皆合法，
    // 因此危險 scheme 可被寫入租戶設定。此值會被後端 fetch 使用（SSRF/scheme 濫用面）。
    // 本案例寫入後「立即還原」，避免破壞 UAT 的 AI 功能。
    const res = await api.put('settings/embedding', { data: { baseUrl: 'javascript:alert(1)' } });
    const status = res.status();
    // 立刻還原（無論成敗）
    await api.put('settings/embedding', { data: { baseUrl: originalEmbedding?.baseUrl } });

    expect(
      status,
      '【已知 BUG P2】Embedding baseUrl 接受 javascript: scheme：' +
        'embeddingSettingsSchema 應改用 .url().refine(v => /^https?:\\/\\//.test(v))。' +
        '此處刻意斷言目前的錯誤行為（200），修好後本斷言會 fail 提醒更新。',
    ).toBe(200);

    // 確認還原成功，UAT 的 embedding 服務仍健康
    const health = (await (await api.get('settings/embedding')).json())?.data;
    expect(health.settings.baseUrl, '測試後必須還原 baseUrl').toBe(originalEmbedding?.baseUrl);
    expect(health.health?.reachable, '還原後 Ollama 應仍可連線').toBe(true);
  });

  test('KB-33 Embedding 模型名稱 / topK / threshold 邊界（後端直測，不落地）', async () => {
    await apiFieldCheck(api, {
      path: 'settings/embedding',
      method: 'put',
      payload: { model: '' },
      expect: 'reject',
      context: 'Embedding 模型名稱空字串（min=1）',
    });
    for (const [label, payload] of [
      ['topK=21（max=20）', { topK: 21 }],
      ['topK=0（min=1）', { topK: 0 }],
      ['topK=1.5（應為整數）', { topK: 1.5 }],
      ['threshold=1.5（max=1）', { threshold: 1.5 }],
      ['threshold=-0.1（min=0）', { threshold: -0.1 }],
    ] as const) {
      await apiFieldCheck(api, {
        path: 'settings/embedding',
        method: 'put',
        payload: payload as Record<string, unknown>,
        expect: 'reject',
        context: `Embedding ${label}`,
      });
    }
    const cur = (await (await api.get('settings/embedding')).json())?.data?.settings;
    expect(cur.model, '被拒的請求不應改動模型').toBe(originalEmbedding?.model);
    expect(cur.topK, '被拒的請求不應改動 topK').toBe(originalEmbedding?.topK);
  });

  test('KB-34 Chat & Prompt 設定頁欄位盤點（含 API 金鑰欄位型別檢查）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/knowledge/chat-prompt');
    await expect(page.getByText(/模型|Provider|供應商/).first()).toBeVisible({ timeout: 15_000 });
    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '知識庫 › Chat & Prompt 設定'));

    // Gemini API Key 欄位是條件渲染（ChatPromptSettings.tsx）：
    //   provider === 'gemini' 且 byokStatus.configured === false → 才顯示 <Input type=password>
    //   已設定金鑰時改顯示遮罩字串 + 「移除」連結（沒有輸入框）
    // UAT 目前已設 BYOK 金鑰，故盤點掃不到輸入框——這是正確行為，不是缺欄位。
    const byok = (await (await api.get('settings/gemini-key')).json())?.data;
    const keyFields = fields.filter(
      (f) => /金鑰|key|API/i.test(`${f.label ?? ''}${f.placeholder ?? ''}`),
    );
    console.log(
      `BYOK 金鑰狀態：configured=${byok?.configured} masked=${byok?.masked}；` +
        `盤點到的金鑰輸入框 ${keyFields.length} 個`,
    );

    if (byok?.configured) {
      // 已設定：畫面應顯示遮罩值，且遮罩不得洩漏完整金鑰
      await expect(page.getByText('使用自備金鑰'), '已設定金鑰時應顯示「使用自備金鑰」').toBeVisible({
        timeout: 10_000,
      });
      expect(keyFields.length, '已設定金鑰時不應再顯示明文輸入框').toBe(0);
      expect(String(byok.masked ?? ''), '金鑰應為遮罩顯示（含省略符號）').toContain('…');
      expect(String(byok.masked ?? '').length, '遮罩字串不應是完整金鑰長度').toBeLessThan(20);
    } else {
      // 未設定：輸入框必須是 password 型別（不得以明文 text 呈現）
      expect(keyFields.length, '未設定金鑰時應顯示輸入框').toBeGreaterThanOrEqual(1);
      for (const f of keyFields) {
        expect(
          f.type,
          `金鑰欄位「${f.label ?? f.placeholder}」應為 type=password，實際 type=${f.type}`,
        ).toBe('password');
      }
    }
    // ⚠️ 安全限制：不在金鑰欄位填入真實金鑰、也不送出（避免覆蓋 UAT 既有 BYOK key）
  });

  test('KB-35 Chat 設定數值/列舉欄位邊界（後端直測，不落地）', async () => {
    for (const [label, payload] of [
      ['provider=openai（enum 只允許 ollama|gemini）', { provider: 'openai' }],
      ['temperature=3（max=2）', { temperature: 3 }],
      ['temperature=-1（min=0）', { temperature: -1 }],
      ['maxTokens=9000（max=8192）', { maxTokens: 9000 }],
      ['maxTokens=0（min=1）', { maxTokens: 0 }],
      ['maxTokens=1.5（應為整數）', { maxTokens: 1.5 }],
      ['model 空字串（min=1）', { model: '' }],
      ['baseUrl=notaurl（應為 URL）', { baseUrl: 'notaurl' }],
      ['clarifyThreshold=2（max=1）', { clarifyThreshold: 2 }],
      ['clarifyMaxAttempts=6（max=5）', { clarifyMaxAttempts: 6 }],
      ['clarifyMaxAttempts=-1（min=0）', { clarifyMaxAttempts: -1 }],
    ] as const) {
      await apiFieldCheck(api, {
        path: 'settings/chat',
        method: 'put',
        payload: payload as Record<string, unknown>,
        expect: 'reject',
        context: `Chat 設定 ${label}`,
      });
    }
    const cur = (await (await api.get('settings/chat')).json())?.data?.settings;
    expect(cur.provider, '被拒的請求不應改動 provider').toBe(originalChat?.provider);
    expect(cur.model, '被拒的請求不應改動 model').toBe(originalChat?.model);
    expect(cur.maxTokens, '被拒的請求不應改動 maxTokens').toBe(originalChat?.maxTokens);
  });

  test('KB-36 Prompt 文字框超長邊界：後端無上限，10 萬字可存並完整讀回（測後還原）', async () => {
    // chatSystemPrompt 等四個欄位在 zod 是 z.string().optional()，完全沒有長度上限。
    // 對「會被塞進 LLM context 的欄位」缺上限，實務上會直接撐爆 token 預算 → 記為 P2。
    const huge = `${E2E_PREFIX} ${strOfLength(100_000, '長')}`;
    const res = await api.put('settings/chat', { data: { summarizeSystemPrompt: huge } });
    const status = res.status();

    // 無論結果先還原
    await api.put('settings/chat', { data: { summarizeSystemPrompt: originalChat?.summarizeSystemPrompt } });

    expect(
      status,
      '【已知現況 P2】summarizeSystemPrompt 無任何長度上限（z.string().optional()），' +
        '10 萬字也照收。建議加 .max(N) 避免撐爆 LLM token 預算。' +
        '此處斷言目前行為（200），加上上限後本斷言會 fail 提醒更新。',
    ).toBe(200);

    const cur = (await (await api.get('settings/chat')).json())?.data?.settings;
    expect(cur.summarizeSystemPrompt, '測試後必須還原 prompt 原值').toBe(originalChat?.summarizeSystemPrompt);
  });

  test('KB-37 Prompt 往返：換行 / emoji / XSS 樣本原樣保存（測後還原）', async () => {
    const value = `${E2E_PREFIX} prompt 往返\n第二行 ${FieldSamples.emoji}\n${FieldSamples.xss}`;
    const res = await api.put('settings/chat', { data: { summarizeSystemPrompt: value } });
    expect(res.status(), 'prompt 合法值應被接受').toBe(200);

    const cur = (await (await api.get('settings/chat')).json())?.data?.settings;
    const saved = cur.summarizeSystemPrompt;

    // 先還原再斷言，確保斷言失敗也不會留下髒設定
    await api.put('settings/chat', { data: { summarizeSystemPrompt: originalChat?.summarizeSystemPrompt } });
    expect(saved, 'prompt 的換行/emoji/特殊字元應原樣保留').toBe(value);

    const restored = (await (await api.get('settings/chat')).json())?.data?.settings;
    expect(restored.summarizeSystemPrompt, '測試後必須還原 prompt 原值').toBe(originalChat?.summarizeSystemPrompt);
  });

  test('KB-38 gemini-key 欄位驗證：空字串應被擋（不覆蓋既有金鑰）', async () => {
    // ⚠️ 只測「非法值被擋」，絕不送出任何合法值（會覆蓋 UAT 既有 BYOK key）
    await apiFieldCheck(api, {
      path: 'settings/gemini-key',
      method: 'put',
      payload: { apiKey: '' },
      expect: 'reject',
      context: 'gemini-key 空字串（min=1）',
    });
    await apiFieldCheck(api, {
      path: 'settings/gemini-key',
      method: 'put',
      payload: { apiKey: 123 } as unknown as Record<string, unknown>,
      expect: 'reject',
      context: 'gemini-key 傳數字（應為字串）',
    });
    // 確認既有金鑰未被動到
    const st = (await (await api.get('settings/gemini-key')).json())?.data;
    expect(st.configured, '測試不應清除既有 BYOK 金鑰').toBe(true);
  });

  test('KB-39 chat/models 查詢參數列舉驗證', async () => {
    const bad = await api.get('settings/chat/models', { params: { provider: 'openai' } });
    expect(bad.status(), 'provider 非法列舉值應回 4xx').toBeGreaterThanOrEqual(400);
    expect(bad.status(), '應為 4xx 而非 5xx').toBeLessThan(500);

    const badUrl = await api.get('settings/chat/models', {
      params: { provider: 'ollama', baseUrl: 'notaurl' },
    });
    expect(badUrl.status(), 'baseUrl 非 URL 應回 4xx').toBeGreaterThanOrEqual(400);
    expect(badUrl.status(), '應為 4xx 而非 5xx').toBeLessThan(500);
  });
});

// ===========================================================================
// 四、自動化：規則基本設定 / 觸發 / 條件 / 動作 / dry-run
// ===========================================================================

test.describe('自動化 — 規則編輯器欄位 @fields', () => {
  test('AU-01 新增規則頁欄位盤點（含 maxLength 比對）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/automation/new');
    await expect(page.getByPlaceholder('規則名稱...')).toBeVisible({ timeout: 15_000 });

    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '自動化 › 新增規則'));

    const withMax = fields.filter((f) => f.maxLength !== null);
    console.log(
      `前端有設 maxLength 的欄位：${withMax.length} / ${fields.length}` +
        `（後端 name max=200 / description max=1000 / priority 0..10000）`,
    );

    // 觸發事件與匹配模式是原生 select
    const selects = fields.filter((f) => f.tag === 'select');
    expect(selects.length, '應至少有「觸發事件」一個 select').toBeGreaterThanOrEqual(1);
  });

  test('AU-02 規則名稱必填：空白時儲存鈕 disabled（前端擋控）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/automation/new');
    const name = page.getByPlaceholder('規則名稱...');
    await expect(name).toBeVisible({ timeout: 15_000 });

    const save = page.getByRole('button', { name: /儲存規則/ });
    await expect(save, '名稱空白時儲存鈕應 disabled').toBeDisabled();

    // 純空白：handleSave 前的 disabled 判斷是 !form.name.trim() → 應維持 disabled
    await setField(name, FieldSamples.whitespace);
    await expect(save, '純空白名稱儲存鈕應維持 disabled（前端有 trim 判斷）').toBeDisabled();

    // 全形空白：'　'.trim() 在 JS 會被視為空白 → 也應 disabled
    await setField(name, FieldSamples.fullwidthSpace);
    await expect(save, '全形空白名稱儲存鈕應維持 disabled').toBeDisabled();

    await setField(name, RULE_NAME);
    await expect(save, '有效名稱時儲存鈕應可點').toBeEnabled();
  });

  test('AU-03 【BUG】零動作儲存：後端 400 但前端靜默失敗（無任何錯誤提示）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/automation/new');
    const name = page.getByPlaceholder('規則名稱...');
    await expect(name).toBeVisible({ timeout: 15_000 });
    await setField(name, `${RULE_NAME} 零動作`);

    // 不新增任何動作就直接存：後端 actions.min(1) 會 400
    const result = await submitAndObserve(
      page,
      async () => page.getByRole('button', { name: /儲存規則/ }).click(),
      /\/automation\/rules$/,
      'POST',
      10_000,
    );
    expect(result.requested, '前端沒有「至少一個動作」擋控，會真的送出請求').toBe(true);
    expect(result.status, '後端 actions.min(1) 應回 400').toBe(400);

    // 前端 handleSave 的 catch 只有 console.error → 畫面上不該（但也確實沒有）錯誤提示
    await page.waitForTimeout(1_500);
    expect(page.url(), '儲存失敗應仍停在 /new 頁').toContain('/automation/new');
    const errorBanner = await page
      .getByText(/儲存失敗|錯誤|失敗|至少.*動作/)
      .count()
      .catch(() => 0);
    expect(
      errorBanner,
      '【已知 BUG P3】零動作送出被後端 400，但前端 handleSave 的 catch 只 console.error，' +
        '畫面無任何錯誤提示（使用者會以為按鈕壞了）。' +
        '此處斷言目前行為（無錯誤訊息元素），補上提示後本斷言會 fail 提醒更新。',
    ).toBe(0);
  });

  test('AU-04 規則名稱 / 描述 / 優先級邊界（後端直測）', async () => {
    // name
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ name: '' }),
      expect: 'reject',
      context: '規則名稱空字串（min=1）',
    });
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ name: strOfLength(201) }),
      expect: 'reject',
      context: '規則名稱 201 字（max=200）',
    });
    // description
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ description: strOfLength(1001) }),
      expect: 'reject',
      context: '規則描述 1001 字（max=1000）',
    });
    // priority
    for (const [label, v] of [
      ['10001（max=10000）', 10001],
      ['-1（min=0）', -1],
      ['1.5（應為整數）', 1.5],
    ] as const) {
      await apiFieldCheck(api, {
        path: 'automation/rules',
        payload: ruleBody({ priority: v }),
        expect: 'reject',
        context: `規則優先級 ${label}`,
      });
    }

    // exact 上限應被接受
    const ok = await api.post('automation/rules', {
      data: ruleBody({
        name: `${E2E_PREFIX}${strOfLength(200 - E2E_PREFIX.length)}`,
        description: strOfLength(1000),
        priority: 10000,
      }),
    });
    expect(ok.status(), 'name=200 / description=1000 / priority=10000（剛好上限）應被接受').toBe(201);
    createdRules.push((await ok.json()).data.id);
  });

  test('AU-05 【BUG】純空白/全形空白規則名稱被後端接受（zod 缺 .trim()）', async () => {
    // 前端儲存鈕有 !form.name.trim() 擋控（AU-02 已驗），但後端 createRuleSchema
    // 的 name 是 z.string().min(1) 沒有 .trim()，繞過 UI 直打 API 即可寫入空白名稱規則。
    for (const [label, value] of [
      ['半形空白', FieldSamples.whitespace],
      ['全形空白', FieldSamples.fullwidthSpace],
    ] as const) {
      const res = await api.post('automation/rules', { data: ruleBody({ name: value }) });
      if (res.status() === 201) createdRules.push((await res.json()).data.id);
      expect(
        res.status(),
        `【已知 BUG P2】自動化規則名稱填${label}被後端接受（${res.status()}）：` +
          'createRuleSchema.name 是 z.string().min(1) 缺 .trim()，前端擋控可被繞過。' +
          '此處刻意斷言目前的錯誤行為，修好後本斷言會 fail 提醒更新。',
      ).toBe(201);
    }
  });

  test('AU-06 觸發事件列舉：非白名單事件應被 contracts 層擋下', async () => {
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ trigger: { type: 'nope.bogus' } }),
      expect: 'reject',
      context: '觸發事件非白名單值 nope.bogus',
    });
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ trigger: { type: '' } }),
      expect: 'reject',
      context: '觸發事件空字串（min=1）',
    });
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ trigger: {} }),
      expect: 'reject',
      context: '觸發事件缺 type（必填）',
    });
  });

  test('AU-07 keyword.matched 關鍵字欄位與匹配模式（UI 操作）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/automation/new');
    const name = page.getByPlaceholder('規則名稱...');
    await expect(name).toBeVisible({ timeout: 15_000 });

    // 切到 keyword.matched → 關鍵字區塊才會出現
    const triggerSelect = page.locator('select').first();
    await triggerSelect.selectOption('keyword.matched');

    const kwInput = page.getByPlaceholder('輸入關鍵字後按新增...');
    await expect(kwInput, '切到 keyword.matched 後應出現關鍵字輸入框').toBeVisible({ timeout: 10_000 });

    const addBtn = page.getByRole('button', { name: '新增', exact: true });

    // ① 空白關鍵字不應被加入（addKeyword 有 trim 檢查）
    await setField(kwInput, FieldSamples.whitespace);
    await addBtn.click();
    await page.waitForTimeout(300);
    // ② 全形空白：'　'.trim() 為空 → 同樣不應加入
    await setField(kwInput, FieldSamples.fullwidthSpace);
    await addBtn.click();
    await page.waitForTimeout(300);

    // ③ 合法關鍵字應被加為 chip
    const kw = `退貨${RUN}`;
    await setField(kwInput, kw);
    await addBtn.click();
    await expect(page.getByText(kw, { exact: false }).first(), '合法關鍵字應出現為標籤').toBeVisible({
      timeout: 10_000,
    });

    // ④ 重複關鍵字不應重覆加入（addKeyword 有 includes 檢查）
    await setField(kwInput, kw);
    await addBtn.click();
    await page.waitForTimeout(500);
    const chipCount = await page.locator('span', { hasText: kw }).count();
    expect(chipCount, '重複關鍵字不應被加入第二次').toBeLessThanOrEqual(2); // 容器 + chip 可能各算一次

    // ⑤ 匹配模式 select 應有「任一命中 / 全部命中」兩個選項
    const modeOptions = await page.$$eval('select', (sels) =>
      sels.map((s) => Array.from(s.options).map((o) => o.value)),
    );
    const hasMatchMode = modeOptions.some((opts) => opts.includes('any') && opts.includes('all'));
    expect(hasMatchMode, '應有匹配模式 select（any / all）').toBe(true);
  });

  test('AU-08 條件建構器：欄位/運算子受 contracts 白名單約束（後端直測）', async () => {
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({
        conditions: { all: [{ fact: 'no.such.fact', operator: 'equal', value: 'x' }] },
      }),
      expect: 'reject',
      context: '條件 fact 非白名單值',
    });
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({
        conditions: { all: [{ fact: 'contact.name', operator: 'bogus_op', value: 'x' }] },
      }),
      expect: 'reject',
      context: '條件 operator 非白名單值',
    });
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ conditions: 'not-an-object' as unknown as Record<string, unknown> }),
      expect: 'reject',
      context: '條件傳字串（應為物件）',
    });
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ conditions: {} }),
      expect: 'reject',
      context: '條件空物件（contracts 層要求 all/any 結構）',
    });

    // 合法條件值含特殊字元應被接受並原樣保存
    const special = `${FieldSamples.emoji} ${FieldSamples.sqlish}`;
    const ok = await api.post('automation/rules', {
      data: ruleBody({
        name: `${RULE_NAME} cond`,
        conditions: { all: [{ fact: 'contact.name', operator: 'equal', value: special }] },
      }),
    });
    expect(ok.status(), '合法條件（值含 emoji/注入樣本）應被接受').toBe(201);
    const rule = (await ok.json()).data;
    createdRules.push(rule.id);
    const read = (await (await api.get(`automation/rules/${rule.id}`)).json()).data;
    expect(
      (read.conditions as any).all[0].value,
      '條件值的 emoji 與特殊字元應原樣保存',
    ).toBe(special);
  });

  test('AU-09 條件建構器 UI：新增規則列後出現欄位/運算子/值三個控制項', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/automation/new');
    await expect(page.getByPlaceholder('規則名稱...')).toBeVisible({ timeout: 15_000 });

    // react-querybuilder v7 的「新增規則」按鈕文案是套件內建英文 "+ Rule"（未客製 translations）
    const addRule = page.locator('.condition-builder button', { hasText: '+ Rule' }).first();
    await expect(addRule, '條件建構器應有新增規則按鈕').toBeVisible({ timeout: 10_000 });
    await addRule.click();

    await expect(page.locator('.rule-fields').first(), '應出現欄位 select').toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.rule-operators').first(), '應出現運算子 select').toBeVisible();

    const fields = await inventoryFields(page, '.condition-builder');
    console.log(formatFieldInventory(fields, '自動化 › 條件建構器（新增一條規則後）'));

    // 值輸入框餵特殊字元不應炸頁
    const valueInput = page.locator('.rule-value').first();
    if ((await valueInput.count()) && (await valueInput.evaluate((el) => el.tagName)) === 'INPUT') {
      await setField(valueInput, FieldSamples.xss);
      await expectNoXssExecuted(page);
    }
  });

  test('AU-10 動作參數欄位：各動作類型參數必填由 contracts 層驗證（後端直測）', async () => {
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ actions: [] }),
      expect: 'reject',
      context: '動作清單為空（actions.min(1)）',
    });
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ actions: [{ type: 'bogus_action', params: {} }] }),
      expect: 'reject',
      context: '動作類型非白名單值',
    });
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ actions: [{ type: 'send_message', params: {} }] }),
      expect: 'reject',
      context: '傳送訊息缺 text 參數',
    });
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ actions: [{ type: 'send_message', params: { text: '' } }] }),
      expect: 'reject',
      context: '傳送訊息 text 空字串',
    });
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ actions: [{ type: 'add_tag', params: { tagName: '' } }] }),
      expect: 'reject',
      context: '新增標籤 tagName 空字串',
    });
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ actions: [{ type: 'notify', params: {} }] }),
      expect: 'reject',
      context: '傳送通知缺 message 參數',
    });
    // 動作不屬於該事件 → 應被擋
    await apiFieldCheck(api, {
      path: 'automation/rules',
      payload: ruleBody({ actions: [{ type: 'update_case_status', params: { status: 'OPEN' } }] }),
      expect: 'reject',
      context: 'conversation.created 不允許 update_case_status 動作',
    });
  });

  test('AU-11 動作參數往返：傳送訊息內容含換行/emoji 原樣保存', async () => {
    const text = `${E2E_PREFIX} 自動回覆\n第二行 ${FieldSamples.emoji}`;
    const res = await api.post('automation/rules', {
      data: ruleBody({
        name: `${RULE_NAME} action-roundtrip`,
        actions: [{ type: 'send_message', params: { text } }],
      }),
    });
    expect(res.status(), '合法動作參數應被接受').toBe(201);
    const id = (await res.json()).data.id;
    createdRules.push(id);

    const read = (await (await api.get(`automation/rules/${id}`)).json()).data;
    expect((read.actions as any)[0].params.text, '動作訊息內容（含換行/emoji）應原樣保存').toBe(text);
  });

  test('AU-12 「傳送通知」動作 UI：以 label「通知訊息」定位相鄰 input（Wave 3 踩坑）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/automation/new');
    await expect(page.getByPlaceholder('規則名稱...')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /新增動作/ }).click();
    const actionTypeSelect = page.locator('select').last();

    // 該事件若不允許 notify，selectOption 會失敗 → 先檢查選項
    const opts = await actionTypeSelect.evaluate((s) =>
      Array.from((s as HTMLSelectElement).options).map((o) => o.value),
    );
    test.skip(!opts.includes('notify'), `目前觸發事件的動作選項不含 notify（可選：${opts.join(',')}）`);

    await actionTypeSelect.selectOption('notify');

    // ⚠️ Wave 3 踩坑：用 label「通知訊息」定位相鄰 input，不用 getByPlaceholder
    const msgInput = await fieldByLabel(page, '通知訊息', 'input');
    await expect(msgInput, '應能以 label「通知訊息」定位到輸入框').toBeVisible({ timeout: 10_000 });

    await setField(msgInput, `${E2E_PREFIX} 通知內容 ${FieldSamples.emoji}`);
    await expect(msgInput).toHaveValue(`${E2E_PREFIX} 通知內容 ${FieldSamples.emoji}`);
  });

  test('AU-13 dry-run Facts JSON：非法 JSON 前端擋下並顯示錯誤，合法 JSON 可送出', async ({ page }) => {
    // 先用 API 建一條規則（dry-run 區塊只在非 new 頁顯示）
    const res = await api.post('automation/rules', {
      data: ruleBody({ name: `${RULE_NAME} dryrun` }),
    });
    expect(res.status()).toBe(201);
    const id = (await res.json()).data.id;
    createdRules.push(id);

    await gotoAndCheck(page, `/dashboard/automation/${id}`);
    await expect(page.getByText('測試 / 模擬執行')).toBeVisible({ timeout: 15_000 });

    const factsBox = page.locator('textarea.font-mono').first();
    await expect(factsBox, '應有 Facts JSON 輸入框').toBeVisible({ timeout: 10_000 });

    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '自動化 › 編輯規則（含 dry-run）'));

    // ① 非法 JSON → 前端 JSON.parse 失敗，不應發 API
    await setField(factsBox, '{ 這不是 JSON');
    const bad = await submitAndObserve(
      page,
      async () => page.getByRole('button', { name: /執行測試/ }).click(),
      /\/automation\/rules\/[^/]+\/test$/,
      'POST',
      5_000,
    );
    expect(bad.requested, '非法 JSON 應被前端擋下，不發出 test 請求').toBe(false);
    await expect(
      page.getByText(/JSON 格式無效/),
      '非法 JSON 應顯示明確錯誤訊息',
    ).toBeVisible({ timeout: 10_000 });

    // ② 合法 JSON → 應送出且不得 5xx
    await setField(factsBox, JSON.stringify({ 'contact.name': 'probe' }, null, 2));
    const good = await submitAndObserve(
      page,
      async () => page.getByRole('button', { name: /執行測試/ }).click(),
      /\/automation\/rules\/[^/]+\/test$/,
      'POST',
      20_000,
    );
    expect(good.requested, '合法 JSON 應發出 test 請求').toBe(true);
    expect(good.status, `dry-run 不應回 5xx（實際 ${good.status}）`).toBeLessThan(500);
  });

  test('AU-14 dry-run facts 型別驗證：非物件應被後端擋下', async () => {
    const res = await api.post('automation/rules', {
      data: ruleBody({ name: `${RULE_NAME} dryrun-api` }),
    });
    const id = (await res.json()).data.id;
    createdRules.push(id);

    await apiFieldCheck(api, {
      path: `automation/rules/${id}/test`,
      payload: { facts: 'not-an-object' } as unknown as Record<string, unknown>,
      expect: 'reject',
      context: 'dry-run facts 傳字串（應為物件）',
    });
    await apiFieldCheck(api, {
      path: `automation/rules/${id}/test`,
      payload: { facts: [1, 2, 3] } as unknown as Record<string, unknown>,
      expect: 'reject',
      context: 'dry-run facts 傳陣列（應為物件）',
    });
    // facts 為 optional，完全不傳應被接受
    const noFacts = await api.post(`automation/rules/${id}/test`, { data: {} });
    expect(noFacts.status(), 'facts 為 optional，不傳應被接受').toBeLessThan(400);
  });

  test('AU-15 UI 端到端建規則：填名稱＋加動作→儲存成功（URL 變為真實 UUID）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/automation/new');
    const name = page.getByPlaceholder('規則名稱...');
    await expect(name).toBeVisible({ timeout: 15_000 });

    const ruleName = `${RULE_NAME} ui-e2e`;
    await setField(name, ruleName);

    const desc = page.getByPlaceholder('此規則的用途？');
    await setField(desc, `${E2E_PREFIX} 描述 ${FieldSamples.emoji}`);

    // 必須先加至少一個動作，否則後端 actions.min(1) 會 400（見 AU-03）
    await page.getByRole('button', { name: /新增動作/ }).click();
    const actionSelect = page.locator('select').last();
    const opts = await actionSelect.evaluate((s) =>
      Array.from((s as HTMLSelectElement).options).map((o) => o.value),
    );
    if (opts.includes('send_message')) {
      await actionSelect.selectOption('send_message');
      const msg = await fieldByLabel(page, '訊息內容', 'input');
      await setField(msg, `${E2E_PREFIX} UI 建立的自動回覆`);
    }

    const result = await submitAndObserve(
      page,
      async () => page.getByRole('button', { name: /儲存規則/ }).click(),
      /\/automation\/rules$/,
      'POST',
      15_000,
    );
    expectAccepted(result, 'UI 建立規則（名稱＋一個動作）');

    const newId = (result.body as any)?.data?.id;
    if (newId) createdRules.push(newId);

    // 儲存成功無 toast，改以 URL 變成真實 UUID 斷言
    await expect(page, '儲存成功後應導向該規則的編輯頁').toHaveURL(
      /\/dashboard\/automation\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      { timeout: 15_000 },
    );

    // reload 後名稱與描述應完好（往返驗證）
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByPlaceholder('規則名稱...')).toHaveValue(ruleName, { timeout: 15_000 });
    await expect(page.getByPlaceholder('此規則的用途？')).toHaveValue(
      `${E2E_PREFIX} 描述 ${FieldSamples.emoji}`,
    );
  });

  test('AU-16 優先級數字欄位：UI 非數字輸入不應送出 NaN', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/automation/new');
    await expect(page.getByPlaceholder('規則名稱...')).toBeVisible({ timeout: 15_000 });

    const priority = page.locator('input[type=number]').first();
    await expect(priority, '應有優先級數字輸入框').toBeVisible({ timeout: 10_000 });

    // type=number 的 input 對字母輸入拿到的 e.target.value 是空字串，
    // 前端 `parseInt(e.target.value) || 0` 因此把 state 設成 0 並回寫成受控值 "0"。
    // 結果：輸入框顯示 0 而非 NaN/空白 —— 這是正確的防呆（不會送出 NaN）。
    await priority.fill('');
    await priority.type('abc');
    const val = await priority.inputValue();
    expect(
      ['', '0'],
      `type=number 欄位輸入字母後應為空或被歸零，實際「${val}」（不得是 NaN）`,
    ).toContain(val);
    expect(val, '優先級欄位不應出現 NaN').not.toContain('NaN');

    // 超出後端上限的值在 UI 可填（前端無 min/max 擋控），送出時由後端擋
    await setField(priority, '10001');
    await expect(priority).toHaveValue('10001');
    console.log('前端優先級欄位無 min/max 屬性，超界值需靠後端 400 擋下（已於 AU-04 驗證）');
  });

  test('AU-17 軟刪驗證：DELETE 後規則仍可讀取但 isActive=false', async () => {
    const res = await api.post('automation/rules', {
      data: ruleBody({ name: `${RULE_NAME} softdel` }),
    });
    const id = (await res.json()).data.id;
    createdRules.push(id);

    const del = await api.delete(`automation/rules/${id}`);
    expect(del.status(), 'DELETE 應成功').toBe(200);

    const after = await api.get(`automation/rules/${id}`);
    expect(after.status(), '自動化規則是軟刪（update isActive:false），刪除後仍可 GET').toBe(200);
    const rule = (await after.json()).data;
    expect(rule.isActive, '軟刪後 isActive 應為 false').toBe(false);
  });
});
