/**
 * Wave 6 欄位級測試共用基建。
 *
 * 與 helpers.ts 的分工：
 *   helpers.ts     → 流程層（開頁、種對話、API context、dialog/toast）
 *   field-helpers  → 欄位層（必填擋控、長度邊界、格式驗證、前後端一致性、持久化往返）
 *
 * 設計原則（來自 Wave 1-5 踩坑）：
 *   1. 專案多處沒有 toast，成功/失敗一律以「API 回應碼」為主要斷言，UI 變化為輔
 *   2. 前端擋控與後端擋控要分開測：前端擋住不代表後端有擋（反之亦然）
 *   3. 欄位持久化必須 reload 後重讀，只看送出當下的 UI 會漏掉「存了但沒存對」
 */
import { APIRequestContext, Locator, Page, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// 測試資料產生器
// ---------------------------------------------------------------------------

/** 各類邊界字串。用於長度/格式/注入類欄位測試。 */
export const FieldSamples = {
  /** 空白字元組成的字串：測「trim 後應視為空」的必填擋控 */
  whitespace: '   ',
  /** 前後帶空白：測後端是否 trim */
  padded: '  邊界測試  ',
  /** 常見 XSS payload：斷言被當純文字顯示，不應執行 */
  xss: '<script>window.__E2E_XSS__=1</script>',
  /** HTML 標籤：斷言不被解析成元素 */
  html: '<b>粗體</b>',
  /** SQL 注入樣式字串：斷言被當一般文字（Prisma 參數化，不應報錯） */
  sqlish: "'; DROP TABLE agents;--",
  /** emoji + 組合字：測多位元組字元的長度計算是否用 code point */
  emoji: '測試🙂👨‍👩‍👧‍👦',
  /** 全形空白：常見的「看起來有填其實沒填」 */
  fullwidthSpace: '　',
  /** 換行：測單行欄位是否吃到換行 */
  newline: '第一行\n第二行',
  /** 前導零數字字串 */
  leadingZero: '007',
  /** 超大數字 */
  hugeNumber: '999999999999999999999',
  /** 負數 */
  negative: '-1',
  /** 小數 */
  decimal: '1.5',
  /** 非法 email 樣本 */
  badEmails: ['plain', 'a@', '@b.com', 'a b@c.com', 'a@b', 'a@@b.com'],
  /** 合法 email 樣本 */
  goodEmails: ['user@example.com', 'first.last+tag@sub.example.co.uk'],
  /** 非法 URL 樣本 */
  badUrls: ['notaurl', 'http://', 'ftp:/x', 'example.com'],
  /** 合法 URL 樣本 */
  goodUrls: ['https://example.com', 'https://example.com/path?q=1'],
  /** 非法 UUID */
  badUuid: 'g0000000-0000-0000-0000-000000000000',
} as const;

/** 產生指定長度的字串（用於 max 邊界：len-1 / len / len+1 三點測試） */
export function strOfLength(n: number, fill = 'a'): string {
  return fill.repeat(Math.max(0, n));
}

/** 產生 max 邊界三點樣本：剛好上限、超過上限一個字、上限減一 */
export function boundarySamples(max: number): { under: string; exact: string; over: string } {
  return {
    under: strOfLength(Math.max(1, max - 1)),
    exact: strOfLength(max),
    over: strOfLength(max + 1),
  };
}

// ---------------------------------------------------------------------------
// 欄位定位
// ---------------------------------------------------------------------------

/**
 * 以 label 文字定位其相鄰輸入元素。
 * 專案多處 input 無 htmlFor 綁定（Wave 3 踩過），因此採「label 容器內找 input」
 * 再退回「label 之後最近的 input」兩段策略。
 */
export async function fieldByLabel(
  page: Page,
  labelText: string | RegExp,
  kind: 'input' | 'textarea' | 'select' = 'input',
): Promise<Locator> {
  // 策略 1：原生關聯（label[for] / aria-label）
  const byRole = page.getByLabel(labelText);
  if (await byRole.count()) return byRole.first();

  // 策略 2：label 所在容器內的輸入元素
  const label = page.locator('label', { hasText: labelText }).first();
  if (await label.count()) {
    const container = label.locator('xpath=..');
    const inside = container.locator(kind);
    if (await inside.count()) return inside.first();
    // 策略 3：label 之後的第一個同類元素
    const after = label.locator(`xpath=following::${kind}[1]`);
    if (await after.count()) return after.first();
  }

  throw new Error(`找不到 label「${labelText}」對應的 ${kind}`);
}

/** 清空並填入（React 受控元件：先 fill('') 觸發 onChange，再填值） */
export async function setField(field: Locator, value: string): Promise<void> {
  await field.fill('');
  await field.fill(value);
}

// ---------------------------------------------------------------------------
// 斷言：前端擋控
// ---------------------------------------------------------------------------

export interface SubmitResult {
  /** 送出後是否有 API 請求發出（前端擋住 = false） */
  requested: boolean;
  /** API 回應碼（未發出為 null） */
  status: number | null;
  /** API 回應 body（未發出為 null） */
  body: unknown;
}

/**
 * 點送出並觀察：前端是否擋下（沒發 API），或後端回什麼碼。
 * 這是欄位測試的核心工具——區分「前端擋控」與「後端擋控」。
 *
 * @param urlPattern 目標 API 的 URL 比對（如 /\/cases$/）
 * @param method     HTTP method（預設 POST）
 * @param waitMs     等待 API 發出的時間，逾時視為前端擋下
 */
export async function submitAndObserve(
  page: Page,
  submit: () => Promise<void>,
  urlPattern: RegExp,
  method = 'POST',
  waitMs = 5_000,
): Promise<SubmitResult> {
  // 用陣列收集而非 let 變數：TS 的控制流分析會把「宣告為 null、只在 callback
  // 內賦值」的變數窄化成 never，讀取其屬性會報 TS2339。陣列沒有這個問題。
  type Captured = { status: number; body: unknown };
  const captures: Captured[] = [];

  const handler = async (response: import('@playwright/test').Response) => {
    if (captures.length) return;
    const req = response.request();
    if (req.method() !== method) return;
    if (!urlPattern.test(response.url())) return;
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = await response.text().catch(() => null);
    }
    captures.push({ status: response.status(), body });
  };

  page.on('response', handler);
  try {
    await submit();
    const deadline = Date.now() + waitMs;
    while (!captures.length && Date.now() < deadline) {
      await page.waitForTimeout(150);
    }
  } finally {
    page.off('response', handler);
  }

  const captured = captures[0];
  if (!captured) return { requested: false, status: null, body: null };
  return { requested: true, status: captured.status, body: captured.body };
}

/**
 * 斷言「此欄位的無效值有被擋下」——前端擋住或後端回 4xx 都算通過。
 * 若請求成功落庫（2xx）代表驗證缺口，這正是要抓的 bug。
 */
export function expectRejected(result: SubmitResult, context: string): void {
  if (!result.requested) return; // 前端擋下，合格
  expect(
    result.status,
    `${context}：無效值應被擋下，但後端回 ${result.status}（資料已寫入＝驗證缺口）`,
  ).toBeGreaterThanOrEqual(400);
  expect(result.status, `${context}：預期 4xx 用戶端錯誤，卻回 5xx（後端未正確處理）`).toBeLessThan(500);
}

/** 斷言「此值應被接受」 */
export function expectAccepted(result: SubmitResult, context: string): void {
  expect(result.requested, `${context}：合法值卻被前端擋下`).toBe(true);
  expect(result.status, `${context}：合法值應被接受，卻回 ${result.status}`).toBeLessThan(400);
}

// ---------------------------------------------------------------------------
// 斷言：後端直測（繞過 UI，驗證 API 層驗證規則）
// ---------------------------------------------------------------------------

/**
 * 直接打 API 驗證欄位規則。用於「UI 沒有暴露但 API 接受」的欄位，
 * 以及驗證前端擋控被繞過時後端是否仍守得住（安全性重點）。
 */
export async function apiFieldCheck(
  api: APIRequestContext,
  opts: {
    path: string;
    method?: 'post' | 'patch' | 'put';
    payload: Record<string, unknown>;
    /** 預期結果：'reject' 應回 4xx；'accept' 應回 2xx */
    expect: 'reject' | 'accept';
    context: string;
  },
): Promise<{ status: number; body: unknown }> {
  const method = opts.method ?? 'post';
  const res = await api[method](opts.path, { data: opts.payload });
  const status = res.status();
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (opts.expect === 'reject') {
    expect(status, `${opts.context}：應回 4xx，實際 ${status} — ${JSON.stringify(body)}`).toBeGreaterThanOrEqual(400);
    expect(status, `${opts.context}：應回 4xx 而非 5xx（未處理例外）— ${JSON.stringify(body)}`).toBeLessThan(500);
  } else {
    expect(status, `${opts.context}：應被接受，實際 ${status} — ${JSON.stringify(body)}`).toBeLessThan(400);
  }
  return { status, body };
}

// ---------------------------------------------------------------------------
// 斷言：持久化往返
// ---------------------------------------------------------------------------

/**
 * 欄位往返驗證：填值 → 儲存 → reload → 值應完好保留。
 * 抓的是「存了但沒存對」（trim 掉不該 trim 的、截斷、編碼壞掉、存進去讀不回來）。
 */
export async function expectRoundTrip(
  page: Page,
  opts: {
    fill: () => Promise<void>;
    save: () => Promise<void>;
    reload: () => Promise<void>;
    read: () => Promise<string>;
    expected: string;
    context: string;
  },
): Promise<void> {
  await opts.fill();
  await opts.save();
  await opts.reload();
  const actual = await opts.read();
  expect(actual, `${opts.context}：儲存後重讀的值與輸入不一致`).toBe(opts.expected);
}

/** 斷言 XSS payload 被當純文字（沒有真的執行 script） */
export async function expectNoXssExecuted(page: Page): Promise<void> {
  const executed = await page.evaluate(() => (window as unknown as Record<string, unknown>).__E2E_XSS__);
  expect(executed, 'XSS payload 被實際執行——存在跨站腳本漏洞').toBeUndefined();
}

// ---------------------------------------------------------------------------
// 欄位盤點：自動掃描頁面上所有輸入元素
// ---------------------------------------------------------------------------

export interface FieldInfo {
  tag: string;
  type: string | null;
  name: string | null;
  placeholder: string | null;
  label: string | null;
  required: boolean;
  maxLength: number | null;
  disabled: boolean;
  readOnly: boolean;
}

/**
 * 掃描目前頁面（或指定容器）內所有可見輸入元素，回傳結構化清單。
 * 用途：①產出欄位覆蓋報告 ②比對前端 maxLength 與後端 zod max 是否一致
 */
export async function inventoryFields(page: Page, scope = 'body'): Promise<FieldInfo[]> {
  return page.$$eval(`${scope} input, ${scope} select, ${scope} textarea`, (els) =>
    els
      .filter((el) => {
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
      })
      .map((el) => {
        const e = el as HTMLInputElement;
        // 找關聯 label：for 綁定 → 祖先 label → aria-label
        let label: string | null = e.getAttribute('aria-label');
        if (!label && e.id) {
          label = document.querySelector(`label[for="${e.id}"]`)?.textContent?.trim() ?? null;
        }
        if (!label) label = e.closest('label')?.textContent?.trim() ?? null;
        return {
          tag: e.tagName.toLowerCase(),
          type: e.getAttribute('type'),
          name: e.getAttribute('name'),
          placeholder: e.getAttribute('placeholder'),
          label,
          required: e.hasAttribute('required') || e.getAttribute('aria-required') === 'true',
          maxLength: e.maxLength > 0 ? e.maxLength : null,
          disabled: e.disabled,
          readOnly: e.readOnly,
        };
      }),
  );
}

/** 把欄位盤點結果印成可讀表格（測試報告用） */
export function formatFieldInventory(fields: FieldInfo[], title: string): string {
  const lines = [`\n── 欄位盤點：${title}（${fields.length} 個）──`];
  for (const f of fields) {
    const id = f.label || f.placeholder || f.name || '(無標示)';
    const attrs = [
      f.type && `type=${f.type}`,
      f.required && 'required',
      f.maxLength && `maxLength=${f.maxLength}`,
      f.disabled && 'disabled',
      f.readOnly && 'readonly',
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`  ${f.tag.padEnd(8)} ${id}${attrs ? `  [${attrs}]` : ''}`);
  }
  return lines.join('\n');
}
