/**
 * Wave 6 欄位級測試 — 渠道設定 / 粉絲門戶 / 短連結 / 分析 / 通知
 *
 * 範圍與策略
 *  - 渠道：**只新建 [E2E] WEBCHAT 渠道**，絕不觸碰既有 LINE/FB/THREADS（動了 UAT 會收不到真實訊息）。
 *    webhookBaseUrl 一律不送（影響全渠道）。金鑰欄位一律填假值。
 *  - 門戶/短連結：CM-171 / CM-172 的 admin API 在 UAT 已修復（本檔開頭有現況驗證案例），
 *    故照常做欄位測試；但短連結**公開轉址** `/s/:slug` 仍用未綁租戶的 app.prisma，
 *    被 RLS 擋下 → 全數 404（見 CM-171-REDIRECT 案例，P0）。
 *  - 分析/通知：欄位少，聚焦日期區間邏輯與分頁參數驗證。
 *
 * 已知既有 bug 以 `test.fail()` 或明確註解標記，讓套件維持全綠且不掩蓋問題。
 */
import { test, expect, APIRequestContext } from '@playwright/test';
import { request as pwRequest } from '@playwright/test';
import {
  gotoAndCheck,
  newApiContext,
  E2E_PREFIX,
  BASE_URL,
} from './helpers';
import {
  FieldSamples,
  inventoryFields,
  formatFieldInventory,
  apiFieldCheck,
  strOfLength,
  expectNoXssExecuted,
} from './field-helpers';

let api: APIRequestContext;
/** 測試期間建立的資源，統一於 afterAll 清除 */
const trash = { shortlinks: [] as string[], activities: [] as string[], channels: [] as string[] };

test.beforeAll(async () => {
  api = await newApiContext();
});

test.afterAll(async () => {
  for (const id of trash.shortlinks) await api.delete(`shortlinks/${id}`).catch(() => {});
  for (const id of trash.activities) await api.delete(`portal/activities/${id}`).catch(() => {});
  for (const id of trash.channels) await api.delete(`channels/${id}`).catch(() => {});
  await api.dispose();
});

/** 建短連結並登記待清除，回傳 { status, id, body } */
async function createLink(data: Record<string, unknown>) {
  const res = await api.post('shortlinks', { data });
  const status = res.status();
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const id: string | undefined = body?.data?.id;
  if (id) trash.shortlinks.push(id);
  return { status, id, body };
}

/** 建門戶活動並登記待清除 */
async function createActivity(data: Record<string, unknown>) {
  const res = await api.post('portal/activities', { data });
  const status = res.status();
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const id: string | undefined = body?.data?.id;
  if (id) trash.activities.push(id);
  return { status, id, body };
}

// ═══════════════════════════════════════════════════════════════════════════
// 0. 已知 bug 現況驗證（CM-171 / CM-172）
// ═══════════════════════════════════════════════════════════════════════════

test.describe('CM-171 / CM-172 UAT 現況驗證', () => {
  test('CM-172 門戶 admin API 已修復：列表與建立皆正常（非 RLS 空白/500）', async () => {
    const list = await api.get('portal/activities');
    expect(list.status(), 'GET portal/activities 應為 200').toBe(200);

    const created = await createActivity({ type: 'POLL', title: `${E2E_PREFIX} CM-172 驗證` });
    expect(created.status, 'POST portal/activities 應成功（RLS 已不再擋下）').toBe(200);
    expect(created.id, '建立後應回傳 id').toBeTruthy();

    // 建立後應能在列表讀回 → 證明寫入與讀取都在同一租戶上下文
    const again = await api.get('portal/activities', { params: { limit: '100' } });
    const body = await again.json();
    const hit = (body.data || []).some((a: any) => a.id === created.id);
    expect(hit, '新建活動應出現在列表（不應靜默回空）').toBe(true);
  });

  test('CM-171 短連結 admin API 已修復：建立後列表讀得回', async () => {
    const created = await createLink({
      targetUrl: 'https://example.com/cm171',
      title: `${E2E_PREFIX} CM-171 驗證`,
    });
    expect(created.status, 'POST shortlinks 應成功（非 500）').toBe(200);

    const list = await api.get('shortlinks', { params: { limit: '200' } });
    const body = await list.json();
    const hit = (body.data || []).some((l: any) => l.id === created.id);
    expect(hit, '新建短連結應出現在列表（不應靜默回空）').toBe(true);
  });

  /**
   * ⚠️ P0 — CM-171 只修了 admin routes，公開轉址仍壞。
   * shortlink-redirect.routes.ts 的 getLinkForRedirect(app.prisma, slug) 用的是
   * **未綁租戶的 app.prisma**，RLS 下查不到任何 link → 一律走 renderExpiredPage() 回 404。
   * 結果：所有已發出去的短連結全部失效，點擊數也記不到（/s/track 回 410）。
   */
  test.fail(
    '[已知 P0 bug] 公開轉址 /s/:slug 應能解析有效短連結（實際被 RLS 擋下回 404）',
    async () => {
      const created = await createLink({
        targetUrl: 'https://example.com/redirect-check',
        title: `${E2E_PREFIX} redirect`,
      });
      const slug = created.body?.data?.slug as string;
      expect(slug).toBeTruthy();

      const pub = await pwRequest.newContext({ ignoreHTTPSErrors: true });
      try {
        const res = await pub.get(`${BASE_URL}/s/${slug}`, {
          headers: {
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        // 路由有被打到（X-Shortlink-Source 有值），但查不到 link → 404
        expect(res.status(), '有效短連結的公開轉址應回 200 轉址頁').toBe(200);
      } finally {
        await pub.dispose();
      }
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. 短連結欄位
// ═══════════════════════════════════════════════════════════════════════════

test.describe('短連結 /dashboard/shortlinks 欄位', () => {
  test('欄位盤點：列表頁 + 建立對話框', async ({ page }) => {
    const errors = await gotoAndCheck(page, '/dashboard/shortlinks');
    const listFields = await inventoryFields(page);
    console.log(formatFieldInventory(listFields, '短連結 — 列表頁'));

    // 開建立對話框（按鈕文字含「建立」）
    const createBtn = page.getByRole('button', { name: /建立|新增/ }).first();
    await createBtn.click();
    await expect(page.getByRole('heading', { name: '建立短連結' })).toBeVisible({ timeout: 10_000 });

    // 展開 details（UTM / OG 預設收合，收合內的欄位掃不到）
    for (const s of await page.locator('summary').all()) await s.click().catch(() => {});
    const formFields = await inventoryFields(page);
    console.log(formatFieldInventory(formFields, '短連結 — 建立對話框'));

    // 盤點應涵蓋 targetUrl/title/slug/5 個 UTM/到期/3 個 OG + 2 個 select
    expect(formFields.length, '建立對話框應掃到至少 12 個輸入元素').toBeGreaterThanOrEqual(12);
    expect(errors, `頁面 console 應無錯誤：${errors.join(' | ')}`).toHaveLength(0);
  });

  test('目標 URL 必填：留空時送出鈕為 disabled，填值後解鎖', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/shortlinks');
    await page.getByRole('button', { name: /建立|新增/ }).first().click();
    await expect(page.getByRole('heading', { name: '建立短連結' })).toBeVisible({ timeout: 10_000 });

    const submit = page.getByRole('button', { name: '建立', exact: true }).last();
    await expect(submit, '目標 URL 留空時建立鈕應為 disabled').toBeDisabled();

    // 填入合法 URL 後應解鎖（證明 disabled 綁的是 targetUrl 而非永遠鎖死）
    await page.getByPlaceholder('https://example.com/page').fill('https://example.com/unlock');
    await expect(submit, '填入目標 URL 後建立鈕應解鎖').toBeEnabled();
  });

  /**
   * ⚠️ P3 — 前端只用 `!targetUrl`（非空即可）判斷，純空白字串會讓按鈕解鎖並成功送出，
   * 後端又無驗證（見下方 P1），最終存入一筆 targetUrl="   " 的死連結。
   */
  test.fail('[已知 P3 bug] 純空白目標 URL 應被前端擋下（實際可送出）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/shortlinks');
    await page.getByRole('button', { name: /建立|新增/ }).first().click();
    await expect(page.getByRole('heading', { name: '建立短連結' })).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder('https://example.com/page').fill(FieldSamples.whitespace);
    const submit = page.getByRole('button', { name: '建立', exact: true }).last();
    await expect(submit, '純空白目標 URL 時建立鈕應維持 disabled').toBeDisabled();
  });

  /**
   * ⚠️ P1 — 後端對 targetUrl 完全沒有格式驗證。
   * shortlink.routes.ts 直接 `body as ...` 轉型丟進 service，沒有任何 zod schema。
   * 前端也只有 `if (!targetUrl) return`（非空即可）。
   */
  test.fail(
    '[已知 P1 bug] 目標 URL 應驗證格式（實際 notaurl / example.com 等皆可存入）',
    async () => {
      for (const bad of FieldSamples.badUrls) {
        const r = await createLink({ targetUrl: bad, title: `${E2E_PREFIX} badurl` });
        expect(r.status, `targetUrl="${bad}" 應被擋下`).toBeGreaterThanOrEqual(400);
      }
    },
  );

  /**
   * ⚠️ P1（安全性）— javascript: scheme 可存入。
   * 轉址頁把 targetUrl 丟進 window.location.replace(target) 與 <noscript> 的 href，
   * 兩者都是 javascript: 的執行 sink。HTML/JS 跳脫本身有做（render-utils.ts 正確），
   * 但沒有 scheme 白名單 → 具 shortlink 建立權限者可做成點擊即執行腳本的連結。
   * 目前因轉址頁被 RLS 擋下（上方 P0）而無法實際觸發，一旦 P0 修好即成為可利用漏洞。
   */
  test.fail('[已知 P1 bug] 目標 URL 應限制 http/https scheme（實際接受 javascript:）', async () => {
    const r = await createLink({
      targetUrl: 'javascript:alert(1)',
      title: `${E2E_PREFIX} jsscheme`,
    });
    expect(r.status, 'javascript: scheme 應被拒絕').toBeGreaterThanOrEqual(400);
  });

  test('目標 URL：合法 https URL 應被接受並正確往返', async () => {
    for (const good of FieldSamples.goodUrls) {
      const r = await createLink({ targetUrl: good, title: `${E2E_PREFIX} goodurl` });
      expect(r.status, `合法 URL "${good}" 應被接受`).toBe(200);
      expect(r.body?.data?.targetUrl, 'targetUrl 應原樣存回').toBe(good);
    }
  });

  /**
   * ⚠️ P1 — slug 沒有任何字元集/長度驗證。
   * 含 `/` 的 slug 會讓公開路由 /s/:slug 永遠配不到（單段參數吃不到斜線），
   * 等於建出一條永遠打不開的死連結；500 字 slug 也照收。
   */
  test.fail('[已知 P1 bug] 自訂 slug 應限制字元集（實際接受 a/b/c 這種含斜線值）', async () => {
    const r = await createLink({
      targetUrl: 'https://example.com',
      slug: 'a/b/c',
      title: `${E2E_PREFIX} slugslash`,
    });
    expect(r.status, '含 / 的 slug 應被拒絕（會產生打不開的連結）').toBeGreaterThanOrEqual(400);
  });

  test.fail('[已知 P1 bug] 自訂 slug 應限制長度（實際接受 500 字）', async () => {
    const r = await createLink({
      targetUrl: 'https://example.com',
      slug: strOfLength(500, 'z'),
      title: `${E2E_PREFIX} sluglong`,
    });
    expect(r.status, '500 字 slug 應被拒絕').toBeGreaterThanOrEqual(400);
  });

  test('自訂 slug：重複值應被擋下（唯一性檢查有效）', async () => {
    const slug = `e2e${Date.now().toString(36)}`;
    const first = await createLink({
      targetUrl: 'https://example.com',
      slug,
      title: `${E2E_PREFIX} dup1`,
    });
    expect(first.status, '第一次使用該 slug 應成功').toBe(200);

    const second = await createLink({
      targetUrl: 'https://example.com',
      slug,
      title: `${E2E_PREFIX} dup2`,
    });
    expect(second.status, '重複 slug 應被擋下').toBe(400);
    // 訊息已中文化（前端會原封不動顯示給使用者），這裡只斷言語意不綁死字串
    expect(JSON.stringify(second.body)).toContain('自訂代碼已經被使用');
  });

  /** ⚠️ P1 — targetUrl 空字串可存入（前端擋住但後端沒擋，API 可直接繞過） */
  test.fail('[已知 P1 bug] 後端應擋下空字串 targetUrl（前端擋控可被繞過）', async () => {
    const r = await createLink({ targetUrl: '', title: `${E2E_PREFIX} emptyurl` });
    expect(r.status, '空字串 targetUrl 應被後端擋下').toBeGreaterThanOrEqual(400);
  });

  test.fail('[已知 P1 bug] 後端應擋下純空白 targetUrl', async () => {
    const r = await createLink({ targetUrl: '   ', title: `${E2E_PREFIX} wsurl` });
    expect(r.status, '純空白 targetUrl 應被後端擋下').toBeGreaterThanOrEqual(400);
  });

  /**
   * ⚠️ P2 — 缺必填欄位時回傳的錯誤訊息把 Prisma 內部呼叫細節整段吐出來
   * （"Invalid `prisma.shortLink.create()` invocation: { data: { tenantId: ... } }"），
   * 洩漏 schema 結構與內部欄位名，且對使用者毫無意義。
   */
  test.fail('[已知 P2 bug] 錯誤訊息不應洩漏 Prisma 內部細節', async () => {
    const res = await api.post('shortlinks', { data: { title: `${E2E_PREFIX} nourl` } });
    const text = await res.text();
    expect(res.status(), '缺 targetUrl 應回 4xx').toBe(400);
    expect(text, '錯誤訊息不應包含 prisma 呼叫細節').not.toContain('prisma.');
  });

  test('標題：XSS payload 應以純文字儲存且不在列表頁執行', async ({ page }) => {
    const created = await createLink({
      targetUrl: 'https://example.com/xss',
      title: `${E2E_PREFIX} ${FieldSamples.xss}`,
    });
    expect(created.status).toBe(200);
    // 後端原樣儲存（正確：儲存不編碼，輸出時才跳脫）
    expect(created.body?.data?.title).toContain('<script>');

    await gotoAndCheck(page, '/dashboard/shortlinks');
    await page.waitForTimeout(1500);
    await expectNoXssExecuted(page);
  });

  test('標題：emoji / 前後空白 / 換行應原樣往返', async () => {
    for (const sample of [FieldSamples.emoji, FieldSamples.padded, FieldSamples.newline]) {
      const created = await createLink({
        targetUrl: 'https://example.com/roundtrip',
        title: `${E2E_PREFIX}${sample}`,
      });
      expect(created.status).toBe(200);

      const read = await api.get(`shortlinks/${created.id}`);
      const body = await read.json();
      expect(body?.data?.title, `標題 "${sample}" 應原樣讀回（未被 trim/截斷/編碼壞掉）`).toBe(
        `${E2E_PREFIX}${sample}`,
      );
    }
  });

  test('lineChannelId：非 UUID 應被擋（不應 500）', async () => {
    const res = await api.post('shortlinks', {
      data: {
        targetUrl: 'https://example.com',
        title: `${E2E_PREFIX} baduuid`,
        lineChannelId: 'not-a-uuid',
      },
    });
    expect(res.status(), '非法 UUID 應回 4xx 而非 5xx').toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('expiresAt：非法日期字串應被擋（不應 500）', async () => {
    const res = await api.post('shortlinks', {
      data: { targetUrl: 'https://example.com', title: `${E2E_PREFIX} baddate`, expiresAt: 'not-a-date' },
    });
    expect(res.status(), '非法日期應回 4xx').toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('QR 下載端點：對自建短連結應回傳 data URI', async () => {
    const created = await createLink({
      targetUrl: 'https://example.com/qr',
      title: `${E2E_PREFIX} qr`,
    });
    const res = await api.get(`shortlinks/${created.id}/qrcode`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body?.data?.qrcode, 'QR 應為 png data URI').toContain('data:image/png;base64,');
    expect(body?.data?.url, '短網址應指向 /s/{slug}').toContain('/s/');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. 粉絲門戶欄位
// ═══════════════════════════════════════════════════════════════════════════

test.describe('粉絲門戶 /dashboard/portal 欄位', () => {
  test('欄位盤點：活動列表頁 + 建立對話框', async ({ page }) => {
    const errors = await gotoAndCheck(page, '/dashboard/portal');
    console.log(formatFieldInventory(await inventoryFields(page), '粉絲門戶 — 列表頁'));

    await page.getByRole('button', { name: /建立|新增/ }).first().click();
    await expect(page.getByRole('heading', { name: '建立活動' })).toBeVisible({ timeout: 10_000 });
    const formFields = await inventoryFields(page);
    console.log(formatFieldInventory(formFields, '粉絲門戶 — 建立活動對話框（POLL）'));

    // POLL 版面：類型 select、標題、描述、起訖時間、積分、至少一個選項
    expect(formFields.length, '建立對話框應掃到至少 6 個輸入元素').toBeGreaterThanOrEqual(6);
    expect(errors, `頁面 console 應無錯誤：${errors.join(' | ')}`).toHaveLength(0);
  });

  test('標題必填：留空時前端不送出請求（建立鈕 disabled）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/portal');
    await page.getByRole('button', { name: /建立|新增/ }).first().click();
    await expect(page.getByRole('heading', { name: '建立活動' })).toBeVisible({ timeout: 10_000 });

    const submit = page.getByRole('button', { name: '建立', exact: true }).last();
    await expect(submit, '標題留空時建立鈕應為 disabled').toBeDisabled();
  });

  test('類型 enum：非法值應被擋下（後端直測）', async () => {
    await apiFieldCheck(api, {
      path: 'portal/activities',
      payload: { type: 'HACKED', title: `${E2E_PREFIX} enum` },
      expect: 'reject',
      context: '活動類型非法 enum',
    });
  });

  test('類型 enum：POLL / FORM / QUIZ 三種皆應被接受', async () => {
    for (const type of ['POLL', 'FORM', 'QUIZ']) {
      const r = await createActivity({ type, title: `${E2E_PREFIX} ${type}` });
      expect(r.status, `${type} 應被接受`).toBe(200);
      expect(r.body?.data?.type).toBe(type);
    }
  });

  test('缺 title 欄位：應回 4xx 而非 5xx', async () => {
    await apiFieldCheck(api, {
      path: 'portal/activities',
      payload: { type: 'POLL' },
      expect: 'reject',
      context: '活動缺 title',
    });
  });

  /** ⚠️ P1 — 後端無 zod，空字串/純空白標題照存，門戶會出現無標題活動 */
  test.fail('[已知 P1 bug] 空字串標題應被後端擋下（前端擋控可被繞過）', async () => {
    const r = await createActivity({ type: 'POLL', title: '' });
    expect(r.status, '空標題應被擋下').toBeGreaterThanOrEqual(400);
  });

  test.fail('[已知 P1 bug] 純空白 / 全形空白標題應被後端擋下', async () => {
    for (const blank of [FieldSamples.whitespace, FieldSamples.fullwidthSpace]) {
      const r = await createActivity({ type: 'POLL', title: blank });
      expect(r.status, `空白標題 "${blank}" 應被擋下`).toBeGreaterThanOrEqual(400);
    }
  });

  /** ⚠️ P2 — 標題無長度上限，10000 字照存，列表頁會被單一活動撐爆 */
  test.fail('[已知 P2 bug] 標題應有長度上限（實際 10000 字可存入）', async () => {
    const r = await createActivity({ type: 'POLL', title: `${E2E_PREFIX}${strOfLength(10000)}` });
    expect(r.status, '超長標題應被擋下').toBeGreaterThanOrEqual(400);
  });

  /** ⚠️ P2 — 起訖時間沒有先後檢查，可建立「結束早於開始」的活動 */
  test.fail('[已知 P2 bug] 結束時間早於開始時間應被擋下', async () => {
    const r = await createActivity({
      type: 'POLL',
      title: `${E2E_PREFIX} 日期顛倒`,
      startsAt: '2026-12-31T00:00:00.000Z',
      endsAt: '2020-01-01T00:00:00.000Z',
    });
    expect(r.status, '結束早於開始應被擋下').toBeGreaterThanOrEqual(400);
  });

  test('標題：emoji / 前後空白應原樣往返', async () => {
    for (const sample of [FieldSamples.emoji, FieldSamples.padded]) {
      const created = await createActivity({ type: 'POLL', title: `${E2E_PREFIX}${sample}` });
      expect(created.status).toBe(200);
      const read = await api.get(`portal/activities/${created.id}`);
      const body = await read.json();
      expect(body?.data?.title, `標題 "${sample}" 應原樣讀回`).toBe(`${E2E_PREFIX}${sample}`);
    }
  });

  test('標題 XSS：應以純文字儲存且不在列表頁執行', async ({ page }) => {
    const created = await createActivity({
      type: 'POLL',
      title: `${E2E_PREFIX} ${FieldSamples.xss}`,
    });
    expect(created.status).toBe(200);

    await gotoAndCheck(page, '/dashboard/portal');
    await page.waitForTimeout(1500);
    await expectNoXssExecuted(page);
  });

  test('選項欄位：POLL 選項應正確存入並依 sortOrder 排序', async () => {
    const created = await createActivity({
      type: 'POLL',
      title: `${E2E_PREFIX} 選項測試`,
      options: [
        { label: '選項一', sortOrder: 0 },
        { label: `選項二 ${FieldSamples.emoji}`, sortOrder: 1 },
      ],
    });
    expect(created.status).toBe(200);
    const opts = created.body?.data?.options || [];
    expect(opts.length, '應存入 2 個選項').toBe(2);
    expect(opts[0].label).toBe('選項一');
    expect(opts[1].label, 'emoji 選項應原樣保存').toBe(`選項二 ${FieldSamples.emoji}`);
  });

  test('FORM 欄位定義：fieldKey / label / fieldType 應正確存入', async () => {
    const created = await createActivity({
      type: 'FORM',
      title: `${E2E_PREFIX} 表單欄位`,
      fields: [{ fieldKey: 'email', label: '電子郵件', fieldType: 'email', isRequired: true }],
    });
    expect(created.status).toBe(200);
    const fields = created.body?.data?.fields || [];
    expect(fields.length).toBe(1);
    expect(fields[0].fieldKey).toBe('email');
    expect(fields[0].isRequired).toBe(true);
  });

  /**
   * 狀態機：DRAFT → PUBLISHED → ENDED，且僅 DRAFT 可編輯/刪除。
   *
   * ⚠️ 清理限制：一旦發布就再也無法透過 API 刪除（僅 DRAFT 可刪），
   * 因此本案例會**重複利用**既有的 `[E2E] 狀態機` 活動，不每跑一次就留下一筆垃圾。
   * 若環境中沒有可重用的，才新建一筆（這筆將永久留存，需由 DBA 清理）。
   */
  test('狀態機：DRAFT→PUBLISHED→ENDED，且非 DRAFT 不可刪除 / 不可重複發布', async () => {
    const STATE_TITLE = `${E2E_PREFIX} 狀態機`;

    // 先找既有可重用的 DRAFT 狀態機活動
    const list = await (await api.get('portal/activities', { params: { limit: '200' } })).json();
    const reusable = (list.data || []).find(
      (a: any) => a.title === STATE_TITLE && a.status === 'DRAFT',
    );

    let id: string;
    if (reusable) {
      id = reusable.id;
    } else {
      const created = await createActivity({ type: 'POLL', title: STATE_TITLE });
      id = created.id!;
      // 已發布者無法刪除 → 從待清單移除，避免 afterAll 反覆嘗試刪除失敗
      trash.activities = trash.activities.filter((x) => x !== id);
    }

    const pub = await api.post(`portal/activities/${id}/publish`);
    expect(pub.status(), '草稿應可發布').toBe(200);

    const pubAgain = await api.post(`portal/activities/${id}/publish`);
    expect(pubAgain.status(), '已發布活動重複發布應被擋下').toBeGreaterThanOrEqual(400);

    const del = await api.delete(`portal/activities/${id}`);
    expect(del.status(), '非草稿活動不應可刪除').toBeGreaterThanOrEqual(400);

    const patch = await api.patch(`portal/activities/${id}`, { data: { title: '不該改得動' } });
    expect(patch.status(), '非草稿活動不應可編輯').toBeGreaterThanOrEqual(400);

    const end = await api.post(`portal/activities/${id}/end`);
    expect(end.status(), '已發布活動應可結束').toBe(200);

    const endAgain = await api.post(`portal/activities/${id}/end`);
    expect(endAgain.status(), '已結束活動重複結束應被擋下').toBeGreaterThanOrEqual(400);

    // 這筆已 ENDED、刪不掉。留一筆新的 DRAFT 供下次跑時重用，
    // 讓「不可刪除的殘留」維持固定一筆，不隨執行次數累積。
    const seed = await api.post('portal/activities', {
      data: { type: 'POLL', title: STATE_TITLE },
    });
    const seedId = (await seed.json())?.data?.id;
    expect(seedId, '應能預先建立下次可重用的 DRAFT').toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. 積分調整欄位
// ═══════════════════════════════════════════════════════════════════════════

test.describe('粉絲門戶 — 積分調整欄位', () => {
  /** 取一個既有聯繫人做積分測試；每次調整後都回沖，維持餘額不變 */
  async function pickContact(): Promise<string> {
    const res = await api.get('contacts', { params: { limit: '1' } });
    const body = await res.json();
    const items = body?.data?.items ?? body?.data ?? [];
    const id = items[0]?.id;
    expect(id, '需要至少一個聯繫人才能測積分').toBeTruthy();
    return id as string;
  }

  test('必填：缺 contactId 或 amount 應回 400', async () => {
    await apiFieldCheck(api, {
      path: 'portal/points/adjust',
      payload: { amount: 10 },
      expect: 'reject',
      context: '積分調整缺 contactId',
    });
    const contactId = await pickContact();
    await apiFieldCheck(api, {
      path: 'portal/points/adjust',
      payload: { contactId },
      expect: 'reject',
      context: '積分調整缺 amount',
    });
  });

  test('contactId 非 UUID：應回 4xx 而非 5xx', async () => {
    const res = await api.post('portal/points/adjust', {
      data: { contactId: FieldSamples.badUuid, amount: 1 },
    });
    expect(res.status(), '非法 UUID 應回 4xx').toBeGreaterThanOrEqual(400);
    expect(res.status(), '非法 UUID 不應造成 5xx').toBeLessThan(500);
  });

  test('amount 非數字字串：應被擋下', async () => {
    const contactId = await pickContact();
    await apiFieldCheck(api, {
      path: 'portal/points/adjust',
      payload: { contactId, amount: 'abc' },
      expect: 'reject',
      context: '積分 amount 非數字',
    });
  });

  test('amount 正負值：加分/扣分皆應生效且餘額正確（測後回沖）', async () => {
    const contactId = await pickContact();
    const before = (await (await api.get(`portal/points/balance/${contactId}`)).json())?.data?.balance ?? 0;

    const add = await api.post('portal/points/adjust', {
      data: { contactId, amount: 50, note: `${E2E_PREFIX} 加分` },
    });
    expect(add.status(), '加分應成功').toBe(200);
    let bal = (await (await api.get(`portal/points/balance/${contactId}`)).json())?.data?.balance;
    expect(bal, '加 50 後餘額應 +50').toBe(before + 50);

    const sub = await api.post('portal/points/adjust', {
      data: { contactId, amount: -50, note: `${E2E_PREFIX} 扣分回沖` },
    });
    expect(sub.status(), '扣分應成功').toBe(200);
    bal = (await (await api.get(`portal/points/balance/${contactId}`)).json())?.data?.balance;
    expect(bal, '回沖後餘額應回到原值').toBe(before);
  });

  test('amount 為 0：邊界值應被接受且餘額不變', async () => {
    const contactId = await pickContact();
    const before = (await (await api.get(`portal/points/balance/${contactId}`)).json())?.data?.balance ?? 0;
    const res = await api.post('portal/points/adjust', {
      data: { contactId, amount: 0, note: `${E2E_PREFIX} 零值` },
    });
    expect(res.status(), 'amount=0 應被接受（非必填擋控）').toBe(200);
    const after = (await (await api.get(`portal/points/balance/${contactId}`)).json())?.data?.balance;
    expect(after, '零值調整不應改變餘額').toBe(before);
  });

  /**
   * ⚠️ P1 — 超出 Int32 的 amount 造成 500（未處理例外）。
   * 後端無 zod，數值直接進 Prisma Int 欄位 → 溢位炸成 INTERNAL_ERROR。
   */
  test.fail('[已知 P1 bug] 超大 amount 應回 4xx（實際回 500）', async () => {
    const contactId = await pickContact();
    const res = await api.post('portal/points/adjust', {
      data: { contactId, amount: 999999999999999, note: `${E2E_PREFIX} 溢位` },
    });
    expect(res.status(), '超大數值應回 4xx 而非 5xx').toBeLessThan(500);
  });

  /**
   * ⚠️ P2 — 小數 amount 被靜默無條件捨去（1.5 → 1），
   * 使用者以為加了 1.5 分實際只加 1 分，且無任何提示。
   */
  test.fail('[已知 P2 bug] 小數 amount 應被拒絕（實際靜默截斷為整數）', async () => {
    const contactId = await pickContact();
    const before = (await (await api.get(`portal/points/balance/${contactId}`)).json())?.data?.balance ?? 0;
    const res = await api.post('portal/points/adjust', {
      data: { contactId, amount: 1.5, note: `${E2E_PREFIX} 小數` },
    });
    if (res.status() === 200) {
      // 回沖以免污染餘額
      const after = (await (await api.get(`portal/points/balance/${contactId}`)).json())?.data?.balance ?? 0;
      await api.post('portal/points/adjust', {
        data: { contactId, amount: before - after, note: `${E2E_PREFIX} 小數回沖` },
      });
    }
    expect(res.status(), '小數積分應被擋下').toBeGreaterThanOrEqual(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. 渠道設定欄位（只建 [E2E] WEBCHAT，不動既有渠道）
// ═══════════════════════════════════════════════════════════════════════════

test.describe('渠道設定 — 欄位驗證', () => {
  test('欄位盤點：新增渠道對話框（四種渠道型別的金鑰欄位）', async ({ page }) => {
    const errors = await gotoAndCheck(page, '/dashboard/settings/channels');

    await page.getByRole('button', { name: '新增渠道' }).first().click();
    await page.waitForTimeout(1200);

    // 頁面同時掛著多個 dialog 節點，必須鎖定「可見」的那一個，否則會掃到隱藏表單的殘留欄位
    const dialog = page.locator('[role=dialog]:visible, dialog:visible').first();
    await expect(dialog.getByRole('heading', { name: '新增渠道' })).toBeVisible();

    const typeSelect = dialog.locator('select').first();

    /** 各渠道型別預期出現的金鑰欄位（WEBCHAT 沿用 Channel Secret/Token 當自訂金鑰，非 LINE 欄位殘留） */
    const expected: Record<string, string[]> = {
      LINE: ['Channel Secret', 'Channel Access Token'],
      FB: ['App ID', 'App Secret', 'Page Access Token', 'Page ID'],
      THREADS: ['App ID', 'App Secret', 'Page Access Token'],
      WEBCHAT: ['Channel Secret', 'Channel Access Token'],
    };

    for (const [type, labels] of Object.entries(expected)) {
      await typeSelect.selectOption(type);
      await page.waitForTimeout(700);

      const visibleLabels = (await dialog.locator('label:visible').allTextContents()).map((s) =>
        s.trim(),
      );
      console.log(`  ${type} 金鑰欄位：${JSON.stringify(visibleLabels)}`);

      for (const label of labels) {
        expect(visibleLabels, `${type} 應有「${label}」欄位`).toContain(label);
      }
      // 不應出現其他渠道型別專屬的欄位（避免切換型別後殘留）
      if (type === 'LINE' || type === 'WEBCHAT') {
        expect(visibleLabels, `${type} 不應出現 FB/IG 的 Page Access Token`).not.toContain(
          'Page Access Token',
        );
      }
      if (type === 'THREADS') {
        expect(visibleLabels, 'THREADS 不應出現 FB 專屬的 Page ID').not.toContain('Page ID');
      }
    }

    console.log(formatFieldInventory(await inventoryFields(page), '渠道設定 — 新增渠道對話框'));
    expect(errors, `頁面 console 應無錯誤：${errors.join(' | ')}`).toHaveLength(0);
  });

  test('渠道對話框：顯示名稱與金鑰皆為 required（原生必填擋控）', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/settings/channels');
    await page.getByRole('button', { name: '新增渠道' }).first().click();
    await page.waitForTimeout(1200);

    const dialog = page.locator('[role=dialog]:visible, dialog:visible').first();
    // inventoryFields 只用 CSS scope，頁面上多個隱藏 dialog 會讓 '[role=dialog]' 抓錯節點；
    // 這裡改用 :visible 限定，並以 dialog 內實際的 required 輸入元素計數為準。
    const requiredCount = await dialog.locator('input[required]').count();
    expect(requiredCount, '新增渠道表單應有必填欄位（顯示名稱 + 金鑰）').toBeGreaterThanOrEqual(3);

    // 全部留空送出 → HTML5 required 擋下，不應發出 POST /channels
    let posted = false;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/channels$/.test(r.url())) posted = true;
    });
    await dialog.getByRole('button', { name: '儲存' }).click();
    await page.waitForTimeout(1500);
    expect(posted, '必填欄位留空時不應送出建立請求').toBe(false);
  });

  test('displayName 必填 + 長度上限 100（三點邊界）', async () => {
    // 空字串 → 擋
    await apiFieldCheck(api, {
      path: 'channels',
      payload: { channelType: 'WEBCHAT', displayName: '', credentials: {} },
      expect: 'reject',
      context: '渠道名稱空字串',
    });

    // 100 字（剛好上限）→ 接受
    const exact = await api.post('channels', {
      data: { channelType: 'WEBCHAT', displayName: strOfLength(100), credentials: {} },
    });
    expect(exact.status(), '100 字（上限）應被接受').toBeLessThan(400);
    const exactId = (await exact.json())?.data?.id;
    if (exactId) trash.channels.push(exactId);

    // 101 字（超過上限）→ 擋
    await apiFieldCheck(api, {
      path: 'channels',
      payload: { channelType: 'WEBCHAT', displayName: strOfLength(101), credentials: {} },
      expect: 'reject',
      context: '渠道名稱 101 字（超過 max 100）',
    });
  });

  test('channelType enum：非法值應被擋下', async () => {
    await apiFieldCheck(api, {
      path: 'channels',
      payload: { channelType: 'TELEGRAM', displayName: `${E2E_PREFIX} enum`, credentials: {} },
      expect: 'reject',
      context: '渠道類型非法 enum',
    });
  });

  test('LINE 憑證必填：缺 channelSecret / channelAccessToken 應被擋下', async () => {
    // 只驗 schema 擋控，填假值且必定被拒 → 不會真的建出 LINE 渠道
    await apiFieldCheck(api, {
      path: 'channels',
      payload: { channelType: 'LINE', displayName: `${E2E_PREFIX} LINE`, credentials: {} },
      expect: 'reject',
      context: 'LINE 渠道缺憑證',
    });
    await apiFieldCheck(api, {
      path: 'channels',
      payload: {
        channelType: 'LINE',
        displayName: `${E2E_PREFIX} LINE`,
        credentials: { channelSecret: '', channelAccessToken: '' },
      },
      expect: 'reject',
      context: 'LINE 渠道憑證空字串',
    });
  });

  test('FB / THREADS 憑證必填：缺 appSecret / pageAccessToken 應被擋下', async () => {
    for (const channelType of ['FB', 'THREADS']) {
      await apiFieldCheck(api, {
        path: 'channels',
        payload: { channelType, displayName: `${E2E_PREFIX} ${channelType}`, credentials: {} },
        expect: 'reject',
        context: `${channelType} 渠道缺憑證`,
      });
    }
  });

  test('webhookBaseUrl：明顯非法的 URL 應被擋下（只在自建渠道上測，不動既有渠道）', async () => {
    // notaurl / http:// / example.com 會被 z.string().url() 擋下
    for (const bad of ['notaurl', 'http://', 'example.com']) {
      await apiFieldCheck(api, {
        path: 'channels',
        payload: {
          channelType: 'WEBCHAT',
          displayName: `${E2E_PREFIX} badhook`,
          credentials: {},
          webhookBaseUrl: bad,
        },
        expect: 'reject',
        context: `webhookBaseUrl="${bad}"`,
      });
    }
  });

  /**
   * ⚠️ P2 — zod 的 `z.string().url()` 只是包 `new URL()`，**不限制 scheme**，
   * 因此 `ftp:/x`、`javascript:...`、`mailto:...` 全部通過驗證。
   * webhookBaseUrl 會被直接串成渠道的 webhookUrl
   * （實測產出 `ftp:/x/api/v1/webhooks/webchat/<id>`），造成一條永遠收不到訊息的死 webhook。
   * 建議：改為 `.refine(u => /^https?:\/\//.test(u))`（下游 webhook 已有此把關，此處漏掉）。
   */
  test.fail('[已知 P2 bug] webhookBaseUrl 應限制 http/https scheme（實際 ftp:/x 可存入）', async () => {
    const res = await api.post('channels', {
      data: {
        channelType: 'WEBCHAT',
        displayName: `${E2E_PREFIX} ftphook`,
        credentials: {},
        webhookBaseUrl: 'ftp:/x',
      },
    });
    const id = (await res.json())?.data?.id;
    if (id) trash.channels.push(id);
    expect(res.status(), '非 http/https scheme 應被擋下').toBeGreaterThanOrEqual(400);
  });

  test('下游 Webhook：URL 必須為合法 https（http / 非法格式 / 非法 mode 皆應擋下）', async () => {
    const base = { channelType: 'WEBCHAT', displayName: `${E2E_PREFIX} dsw`, credentials: {} };
    const cases: Array<[string, unknown]> = [
      ['http 非 https', { enabled: true, url: 'http://example.com/hook', mode: 'immediate' }],
      ['非法 URL 格式', { enabled: true, url: 'notaurl', mode: 'immediate' }],
      ['非法 mode', { enabled: true, url: 'https://example.com/hook', mode: 'whenever' }],
      ['timeoutMs 超上限', { enabled: true, url: 'https://example.com/hook', mode: 'immediate', timeoutMs: 999999 }],
      ['timeoutMs 負數', { enabled: true, url: 'https://example.com/hook', mode: 'immediate', timeoutMs: -1 }],
    ];
    for (const [name, downstreamWebhook] of cases) {
      await apiFieldCheck(api, {
        path: 'channels',
        payload: { ...base, settings: { downstreamWebhook } },
        expect: 'reject',
        context: `下游 Webhook ${name}`,
      });
    }
  });

  test('下游 Webhook：合法 https 設定應被接受並正確往返', async () => {
    const downstreamWebhook = {
      enabled: true,
      url: 'https://example.com/e2e-hook',
      mode: 'immediate',
      timeoutMs: 3000,
    };
    const res = await api.post('channels', {
      data: {
        channelType: 'WEBCHAT',
        displayName: `${E2E_PREFIX} 下游 webhook`,
        credentials: {},
        settings: { downstreamWebhook },
      },
    });
    expect(res.status(), '合法下游 webhook 設定應被接受').toBeLessThan(400);
    const id = (await res.json())?.data?.id;
    if (id) trash.channels.push(id);

    const read = await api.get(`channels/${id}`);
    const body = await read.json();
    expect(body?.data?.settings?.downstreamWebhook?.url, '下游 webhook URL 應原樣讀回').toBe(
      downstreamWebhook.url,
    );
  });

  test('WEBCHAT 渠道建立 → 改名往返 → 刪除（完整生命週期）', async () => {
    const created = await api.post('channels', {
      data: { channelType: 'WEBCHAT', displayName: `${E2E_PREFIX} 生命週期`, credentials: {} },
    });
    expect(created.status(), '建立 WEBCHAT 渠道應成功').toBeLessThan(400);
    const id = (await created.json())?.data?.id;
    expect(id).toBeTruthy();

    const newName = `${E2E_PREFIX} 改名 ${FieldSamples.emoji}`;
    const patched = await api.patch(`channels/${id}`, { data: { displayName: newName } });
    expect(patched.status(), '改名應成功').toBeLessThan(400);

    const read = await api.get(`channels/${id}`);
    expect((await read.json())?.data?.displayName, '改名後應正確讀回（含 emoji）').toBe(newName);

    const del = await api.delete(`channels/${id}`);
    expect(del.status(), '自建渠道應可刪除').toBeLessThan(400);
  });

  test('chatbox 主題色：backgroundPosition / 顏色欄位長度上限應生效', async () => {
    // 建一個自己的 WEBCHAT 渠道來測主題（不碰既有 tatung 渠道）
    const created = await api.post('channels', {
      data: { channelType: 'WEBCHAT', displayName: `${E2E_PREFIX} 主題`, credentials: {} },
    });
    const id = (await created.json())?.data?.id;
    if (id) trash.channels.push(id);

    const res = await api.patch(`channels/${id}/chatbox-theme`, {
      data: { backgroundPosition: strOfLength(200), foregroundColor: '#ffffff' },
    });
    expect(res.status(), 'backgroundPosition 超過 max(80) 應被擋下').toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('chatbox 嵌入連結：domain 需為合法 URL', async () => {
    const created = await api.post('channels', {
      data: { channelType: 'WEBCHAT', displayName: `${E2E_PREFIX} 嵌入`, credentials: {} },
    });
    const id = (await created.json())?.data?.id;
    if (id) trash.channels.push(id);

    await apiFieldCheck(api, {
      path: `channels/${id}/chatbox-link`,
      payload: { domain: 'notaurl' },
      expect: 'reject',
      context: 'chatbox domain 非法 URL',
    });
    await apiFieldCheck(api, {
      path: `channels/${id}/chatbox-link`,
      payload: { domain: 'https://example.com' },
      expect: 'accept',
      context: 'chatbox domain 合法 URL',
    });
  });

  /**
   * ⚠️ P2 — settings 是 z.record(z.unknown())，除 downstreamWebhook 外全不驗證。
   * botConfig 的問候語/LIFF ID/轉接關鍵字可存入任意型別與任意長度。
   * 此處以 LIFF ID 為代表記錄（前端 placeholder 標示應為 "1660xxxxxx-xxxxxxxx" 格式）。
   */
  test.fail('[已知 P2 bug] botConfig.liffId 應驗證格式（實際任意字串皆可存入）', async () => {
    const created = await api.post('channels', {
      data: { channelType: 'WEBCHAT', displayName: `${E2E_PREFIX} botcfg`, credentials: {} },
    });
    const id = (await created.json())?.data?.id;
    if (id) trash.channels.push(id);

    const res = await api.patch(`channels/${id}`, {
      data: { settings: { botConfig: { liffId: '<script>alert(1)</script>' } } },
    });
    expect(res.status(), '非法 LIFF ID 應被擋下').toBeGreaterThanOrEqual(400);
  });

  test('botConfig 問候語：超長 / 換行 / emoji 應原樣往返（無長度上限，記錄現況）', async () => {
    const created = await api.post('channels', {
      data: { channelType: 'WEBCHAT', displayName: `${E2E_PREFIX} 問候語`, credentials: {} },
    });
    const id = (await created.json())?.data?.id;
    if (id) trash.channels.push(id);

    const greeting = `${FieldSamples.newline}${FieldSamples.emoji}`;
    const res = await api.patch(`channels/${id}`, {
      data: { settings: { botConfig: { greetingMessage: greeting } } },
    });
    expect(res.status()).toBeLessThan(400);

    const read = await api.get(`channels/${id}`);
    const body = await read.json();
    expect(
      body?.data?.settings?.botConfig?.greetingMessage,
      '問候語（含換行與 emoji）應原樣讀回',
    ).toBe(greeting);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. 分析頁 — 日期區間 + CSV 匯出
// ═══════════════════════════════════════════════════════════════════════════

test.describe('分析 /dashboard/analytics', () => {
  test('欄位盤點 + 日期區間元件渲染', async ({ page }) => {
    const errors = await gotoAndCheck(page, '/dashboard/analytics');
    const fields = await inventoryFields(page);
    console.log(formatFieldInventory(fields, '分析頁'));

    const dateInputs = fields.filter((f) => f.type === 'date');
    expect(dateInputs.length, '應有起訖兩個日期輸入').toBeGreaterThanOrEqual(2);
    expect(errors, `頁面 console 應無錯誤：${errors.join(' | ')}`).toHaveLength(0);
  });

  test('日期參數：非法日期字串應回 400 並指出欄位', async () => {
    const res = await api.get('analytics/overview', { params: { from: 'garbage', to: 'alsobad' } });
    expect(res.status(), '非法日期應回 400').toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body), '錯誤應指出 from/to 欄位').toContain('Invalid date');
  });

  /**
   * ⚠️ P2 — 起訖日顛倒（from > to）不被擋下，回傳全 0 的空報表，
   * 使用者看到「資料都是 0」而不知道是自己選錯區間。
   */
  test.fail('[已知 P2 bug] 起始日晚於結束日應被擋下（實際回全 0 空報表）', async () => {
    const res = await api.get('analytics/overview', {
      params: { from: '2026-12-31', to: '2020-01-01' },
    });
    expect(res.status(), 'from > to 應回 400').toBeGreaterThanOrEqual(400);
  });

  test('日期參數：合法區間應回 200 且結構完整', async () => {
    const res = await api.get('analytics/overview', {
      params: { from: '2026-09-01', to: '2026-09-22' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body?.data, '應回傳 overview 結構').toHaveProperty('totalMessages');
  });

  test('CSV 匯出：reportType 非法值應被擋下', async () => {
    await apiFieldCheck(api, {
      path: 'analytics/export',
      payload: { reportType: 'HACKED', from: '2026-09-01', to: '2026-09-22' },
      expect: 'reject',
      context: 'CSV 匯出 reportType 非法',
    });
  });

  test('CSV 匯出：UI 點擊應觸發下載且檔案為 CSV', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/analytics');
    // 匯出走 blob URL + 動態 <a download>，Chromium 仍會觸發 download 事件
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.getByRole('button', { name: /匯出|下載|CSV/ }).first().click(),
    ]);
    expect(download.suggestedFilename(), '下載檔名應為 .csv').toMatch(/\.csv$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. 通知 — 分頁參數 + 已讀操作
// ═══════════════════════════════════════════════════════════════════════════

test.describe('通知', () => {
  test('分頁參數驗證：page / limit 非法值應回 400', async () => {
    const cases: Array<[string, Record<string, string>]> = [
      ['page 為 0', { page: '0' }],
      ['page 為負數', { page: '-1' }],
      ['page 非數字', { page: 'abc' }],
      ['limit 超出上限', { limit: '99999' }],
    ];
    for (const [name, params] of cases) {
      const res = await api.get('notifications', { params });
      expect(res.status(), `${name} 應回 400`).toBe(400);
      expect(res.status(), `${name} 不應造成 5xx`).toBeLessThan(500);
    }
  });

  test('分頁參數：合法值應回 200 並帶 meta', async () => {
    const res = await api.get('notifications', { params: { page: '1', limit: '10' } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body?.data), '通知列表應為陣列').toBe(true);
  });

  test('已讀操作：不存在的通知 id 應回 4xx 而非 5xx', async () => {
    const res = await api.patch('notifications/00000000-0000-0000-0000-000000000000/read', {
      data: {},
    });
    expect(res.status(), '不存在的通知應回 4xx').toBeGreaterThanOrEqual(400);
    expect(res.status(), '不應造成 5xx').toBeLessThan(500);
  });

  test('已讀操作：非法 UUID 應回 4xx 而非 5xx', async () => {
    const res = await api.patch(`notifications/${FieldSamples.badUuid}/read`, { data: {} });
    expect(res.status(), '非法 UUID 應回 4xx').toBeGreaterThanOrEqual(400);
    expect(res.status(), '非法 UUID 不應造成 5xx').toBeLessThan(500);
  });
});
