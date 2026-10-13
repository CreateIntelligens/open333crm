import { test, expect, type Page, type APIRequestContext, type Locator } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { E2E_PREFIX, newApiContext, gotoAndCheck } from './helpers';
import { submitAndObserve, strOfLength } from './field-helpers';

/**
 * 素材庫「每種可見型別各建一則」E2E（LINE 5 種 + FB 9 種）。
 *
 * 每個型別一個 test，內含兩段：
 *   1. 建立：從 /dashboard/marketing/materials/new 選型別 → 透過 UI 填值（含真上傳圖片／影片）
 *      → 存檔 → 用 API 讀回比對 → 列表搜得到 → 重開編輯頁欄位值一致 → 預覽有顯示。
 *   2. 欄位探測：在「剛建立的那一則」編輯頁逐一填入非法／邊界值並按存檔，
 *      記錄前端是否擋、後端回什麼、錯誤訊息是否顯示在畫面上；每次探測前用 API 還原合法內容，
 *      全部探測完再還原並驗證最終內容仍正確。
 *
 * 資料紀律（UAT 就是正式環境）：
 *   - 只建立名稱帶 [E2E] 的素材；探測只改「本測試剛建立的素材」，不碰既有資料。
 *   - 測試建立的素材「保留不刪」，讓使用者在畫面上檢查（任務要求）。
 *   - 不發送任何訊息：LINE 版型存檔時後端會呼叫 LINE 官方 validate/push（只驗不送），
 *     那是產品既有的存檔流程，本測試不呼叫任何發送／廣播端點。
 *
 * 探測結果不會讓測試失敗（它們是「觀察實際行為」），只有 5xx 用 expect.soft 標紅；
 * 每筆結果寫進 JSON Lines 檔（E2E_FINDINGS_FILE，預設 os.tmpdir()）並印出 [REPORT] 行。
 */
test.describe.configure({ mode: 'default', retries: 0 });
test.setTimeout(6 * 60_000);

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const STAMP = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const FINDINGS_FILE =
  process.env.E2E_FINDINGS_FILE || path.join(os.tmpdir(), `materials-all-types-${STAMP}.jsonl`);

const MATERIALS_PATH = '/dashboard/marketing/materials';
const IMAGE_ACCEPT = 'input[type="file"][accept="image/jpeg,image/png,image/webp"]';
const VIDEO_ACCEPT = 'input[type="file"][accept="video/mp4"]';
const JS_URL = 'javascript:alert(1)';

let api: APIRequestContext;

test.beforeEach(async () => {
  // 每個 test 重新換 access token（15 分鐘過期，整輪可能超過）
  api = await newApiContext();
});
test.afterEach(async () => {
  await api?.dispose();
});

// ───────────────────────────────────────────────────────────────────────
// 共用工具
// ───────────────────────────────────────────────────────────────────────

function record(entry: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  fs.appendFileSync(FINDINGS_FILE, `${line}\n`);
  console.log(`[REPORT] ${line}`);
}

const nameInput = (p: Page) => p.getByPlaceholder('如：母親節新品推播');
const saveBtn = (p: Page) => p.getByRole('button', { name: /存為素材|儲存中/ });
const previewPane = (p: Page) => p.locator('aside').filter({ hasText: '即時預覽' });

/** label 文字之後的第一個輸入元素（編輯器多數 input 沒有 htmlFor 綁定） */
function byLabel(p: Page, label: string | RegExp, kind: 'input' | 'textarea' | 'select' = 'input'): Locator {
  return p.locator('label').filter({ hasText: label }).first().locator(`xpath=following::${kind}[1]`);
}

async function setVal(loc: Locator, value: string) {
  await loc.fill('');
  if (value) await loc.fill(value);
}

/** 用頁面 canvas 產生指定尺寸的 JPEG（不依賴外部檔案） */
async function makeJpeg(page: Page, w: number, h: number, text: string): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([w, h, text]) => {
      const c = document.createElement('canvas');
      c.width = w as number;
      c.height = h as number;
      const g = c.getContext('2d')!;
      g.fillStyle = '#2563eb';
      g.fillRect(0, 0, w as number, h as number);
      g.fillStyle = '#ffffff';
      g.font = 'bold 48px sans-serif';
      g.fillText(text as string, 40, (h as number) / 2);
      return c.toDataURL('image/jpeg', 0.85).split(',')[1];
    },
    [w, h, text] as const,
  );
  return Buffer.from(b64, 'base64');
}

/** 用 ffmpeg 產生 1 秒的小 mp4；本機沒有 ffmpeg 則回 null（呼叫端改記錄為限制） */
function makeMp4(): Buffer | null {
  const out = path.join(os.tmpdir(), `e2e-video-${STAMP}.mp4`);
  try {
    if (!fs.existsSync(out)) {
      execFileSync('ffmpeg', [
        '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
      ]);
    }
    return fs.readFileSync(out);
  } catch {
    return null;
  }
}

/**
 * 透過 UI 的隱藏 file input 上傳，回傳後端給的網址（/files/upload → data.url；
 * /files/imagemap-upload → data.baseUrl）。上傳失敗時回傳 status 與錯誤訊息，不用假網址掩蓋。
 */
async function uploadVia(
  page: Page,
  input: Locator,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<{ ok: boolean; url: string; status: number; message?: string }> {
  const resP = page.waitForResponse(
    (r) => /\/files\/(upload|imagemap-upload)$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await input.setInputFiles(file);
  const res = await resP;
  const body = await res.json().catch(() => ({}));
  const url = (body?.data?.baseUrl ?? body?.data?.url ?? '') as string;
  return { ok: res.ok(), url, status: res.status(), message: body?.error?.message };
}

async function pickType(page: Page, channel: 'line' | 'fb', typeLabel: string) {
  await gotoAndCheck(page, `${MATERIALS_PATH}/new`);
  await expect(page.getByRole('heading', { name: '選擇訊息類型' })).toBeVisible({ timeout: 15_000 });
  if (channel === 'fb') await page.getByRole('button', { name: /FB Messenger/ }).first().click();
  const card = page.locator('[role="button"]').filter({
    has: page.locator('div.text-sm.font-semibold', { hasText: new RegExp(`^${typeLabel}$`) }),
  });
  await card.first().click();
  await expect(page.getByRole('heading', { name: /編輯素材/ })).toBeVisible({ timeout: 15_000 });
}

async function setName(page: Page, name: string) {
  await setVal(nameInput(page), name);
}

/** 新建頁按存檔，回傳 POST 結果；成功則等跳轉到編輯頁 */
async function saveNew(page: Page) {
  const r = await submitAndObserve(page, () => saveBtn(page).click(), /\/marketing\/materials$/, 'POST', 45_000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = r.body as any;
  return { ...r, id: (body?.data?.id as string) ?? '', message: (body?.error?.message as string) ?? '' };
}

async function getMaterial(id: string) {
  const res = await api.get(`marketing/materials/${id}`);
  expect(res.status(), `GET 素材 ${id}`).toBe(200);
  return (await res.json()).data;
}

async function gotoEdit(page: Page, id: string, expectName?: string) {
  await gotoAndCheck(page, `${MATERIALS_PATH}/${id}`);
  await expect(page.getByRole('heading', { name: /編輯素材/ })).toBeVisible({ timeout: 20_000 });
  if (expectName) await expect(nameInput(page)).toHaveValue(expectName, { timeout: 15_000 });
}

async function expectInList(page: Page, name: string) {
  await gotoAndCheck(page, MATERIALS_PATH);
  await expect(page.getByRole('heading', { name: '訊息素材' })).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder('搜尋素材名稱').fill(name);
  await expect(page.locator('table').getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
}

interface Created {
  type: string;
  id: string;
  name: string;
  body: Record<string, unknown>;
}

/** 建立成功後的共同驗證 + 記錄（API 讀回、列表、編輯頁名稱） */
async function afterCreate(page: Page, type: string, name: string, id: string, expectedBody: Record<string, unknown>) {
  const m = await getMaterial(id);
  expect(m.name).toBe(name);
  expect(m.contentType).toBe(type);
  expect(m.body, `${type} 讀回 body 應與填入值一致`).toMatchObject(expectedBody);
  await expectInList(page, name);
  record({ kind: 'created', type, id, name, editUrl: `${MATERIALS_PATH}/${id}`, body: m.body });
  return m;
}

/**
 * 點存檔：先等 4 秒看有沒有發出請求（沒發＝前端擋下，立刻抓 toast 文字），
 * 有發出則等回應最多 45 秒（LINE validate 可能慢）。
 */
async function clickAndObserve(page: Page, btn: Locator, urlPattern: RegExp, method: string) {
  const reqP = page
    .waitForRequest((req) => req.method() === method && urlPattern.test(req.url()), { timeout: 4_000 })
    .catch(() => null);
  await btn.click();
  // toast 只停留 3 秒，必須在等請求的同時就抓，不能等 4 秒逾時後才抓
  const toastP = page.locator('div.fixed.top-4').first().textContent({ timeout: 2_000 }).catch(() => null);
  const [req, toast] = await Promise.all([reqP, toastP]);
  if (!req) {
    return { requested: false as const, toast, status: null, body: null };
  }
  const res = await req.response(); // 等到回應抵達（請求失敗則為 null）
  let body: unknown = null;
  try {
    body = await res?.json();
  } catch {
    body = null;
  }
  return { requested: true as const, toast: null, status: res?.status() ?? null, body };
}

type Mutate = (page: Page) => Promise<void>;

/**
 * 欄位探測：還原合法內容 → 開編輯頁 → mutate → 按存檔 → 記錄前後端行為。
 * persisted：若後端接受，從讀回的 body 取出該欄位實際存的值。
 */
async function probe(
  page: Page,
  c: Created,
  field: string,
  input: string,
  mutate: Mutate,
  opts: { expect: 'reject' | 'accept'; persisted?: (body: Record<string, unknown>, m: Record<string, unknown>) => unknown } = {
    expect: 'reject',
  },
) {
  const restore = await api.patch(`marketing/materials/${c.id}`, { data: { name: c.name, body: c.body } });
  expect(restore.status(), `探測前還原 ${c.type} 失敗：${await restore.text()}`).toBeLessThan(300);
  await gotoEdit(page, c.id, c.name);
  await mutate(page);
  await page.waitForTimeout(250);

  const base = { kind: 'probe', type: c.type, field, input, expected: opts.expect };
  const btn = saveBtn(page);
  if (await btn.isDisabled()) {
    const reason = await page.getByText(/^無法儲存：/).textContent().catch(() => null);
    record({ ...base, outcome: 'frontend-disabled', message: reason });
    return;
  }
  const r = await clickAndObserve(page, btn, new RegExp(`/marketing/materials/${c.id}$`), 'PATCH');
  if (!r.requested) {
    record({ ...base, outcome: 'frontend-blocked', message: r.toast });
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resBody = r.body as any;
  const status = r.status ?? 0;
  let uiShown: boolean | null = null;
  let persisted: unknown;
  if (status >= 400) {
    const msg = resBody?.error?.message as string | undefined;
    uiShown = msg ? await page.getByText(msg, { exact: false }).first().isVisible().catch(() => false) : false;
  } else if (opts.persisted) {
    const m = await getMaterial(c.id);
    persisted = opts.persisted(m.body, m);
  }
  record({
    ...base,
    outcome: status >= 400 ? 'backend-rejected' : 'accepted',
    status,
    code: resBody?.error?.code,
    message: resBody?.error?.message,
    uiShownMessage: uiShown,
    persisted,
  });
  expect.soft(status, `${c.type}.${field}=${input}：不該回 5xx — ${JSON.stringify(resBody)}`).toBeLessThan(500);
}

/** API 直打（繞過前端 maxLength 等擋控），看後端是否守得住 */
async function apiProbe(c: Created, field: string, input: string, patch: Record<string, unknown>) {
  const res = await api.patch(`marketing/materials/${c.id}`, { data: patch });
  const body = await res.json().catch(() => ({}));
  record({
    kind: 'api-probe',
    type: c.type,
    field,
    input,
    status: res.status(),
    code: body?.error?.code,
    message: typeof body?.error?.message === 'string' ? body.error.message.slice(0, 300) : undefined,
  });
  expect.soft(res.status(), `${c.type}.${field} API 探測不該 5xx`).toBeLessThan(500);
}

/** 探測結束：還原並驗證最終內容 */
async function finalRestore(c: Created) {
  const res = await api.patch(`marketing/materials/${c.id}`, { data: { name: c.name, body: c.body } });
  expect(res.status(), `最終還原 ${c.type} 失敗：${await res.text()}`).toBeLessThan(300);
  const m = await getMaterial(c.id);
  expect(m.name).toBe(c.name);
  expect(m.body).toMatchObject(c.body);
}

/** 名稱共同探測（只在 line_text 跑一次：前後端邏輯對所有型別相同） */
async function nameProbes(page: Page, c: Created) {
  await probe(page, c, 'name', '(空)', async (p) => setVal(nameInput(p), ''));
  await probe(page, c, 'name', '純空白 "   "', async (p) => setVal(nameInput(p), '   '));
  await probe(page, c, 'name', '201 字', async (p) => setVal(nameInput(p), `${E2E_PREFIX}${strOfLength(196, '名')}`));
  // 名稱欄 maxLength（前端）
  await gotoEdit(page, c.id, c.name);
  const ml = await nameInput(page).getAttribute('maxlength');
  record({ kind: 'attr', type: c.type, field: 'name', maxLength: ml });
}

// ───────────────────────────────────────────────────────────────────────
// LINE
// ───────────────────────────────────────────────────────────────────────

test.describe('@materials-all LINE 素材', () => {
  test('line_text 純文字：建立（含 emoji / 換行 / 快速回覆）+ 欄位探測', async ({ page }) => {
    const type = 'line_text';
    const name = `${E2E_PREFIX} LINE 純文字 🙂 ${STAMP}`;
    const text = `${E2E_PREFIX} LINE 純文字內容 ${STAMP}\n第二行 🙂👨‍👩‍👧‍👦 結尾`;

    await pickType(page, 'line', '純文字');
    await setName(page, name);
    await setVal(page.getByPlaceholder('輸入要發送的文字訊息'), text);
    await page.getByPlaceholder('例：同意').fill('好的');
    await page.getByPlaceholder(/例：我同意/).fill('我要了解更多');
    await page.getByRole('button', { name: '加入' }).click();

    // 預覽：文字出現；換行在預覽中是否保留
    const pv = previewPane(page);
    await expect(pv.getByText(`${E2E_PREFIX} LINE 純文字內容`, { exact: false })).toBeVisible();
    const pvText = await pv.locator('div.max-w-xs', { hasText: '第二行' }).last().innerText();
    record({ kind: 'preview', type, field: 'text', newlineKept: pvText.includes('\n'), previewText: pvText });

    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const expected = { text, quickReplies: [{ label: '好的', text: '我要了解更多' }] };
    await afterCreate(page, type, name, r.id, expected);

    await gotoEdit(page, r.id, name);
    await expect(page.getByPlaceholder('輸入要發送的文字訊息')).toHaveValue(text);
    await expect(page.getByText('我要了解更多', { exact: false }).first()).toBeVisible();

    const c: Created = { type, id: r.id, name, body: (await getMaterial(r.id)).body };
    await nameProbes(page, c);
    const textArea = (p: Page) => p.getByPlaceholder('輸入要發送的文字訊息');
    await probe(page, c, 'text', '(空)', async (p) => setVal(textArea(p), ''), {
      expect: 'reject', persisted: (b) => b.text,
    });
    await probe(page, c, 'text', '純空白', async (p) => setVal(textArea(p), '   '), {
      expect: 'reject', persisted: (b) => b.text,
    });
    // maxLength=5000：填 5001 字看前端是否截斷
    await gotoEdit(page, c.id, c.name);
    await setVal(textArea(page), strOfLength(5001, '字'));
    record({ kind: 'attr', type, field: 'text', maxLength: await textArea(page).getAttribute('maxlength'), lengthAfterFill5001: (await textArea(page).inputValue()).length });
    await apiProbe(c, 'text', '5001 字（API 直打）', { body: { text: strOfLength(5001, '字') } });
    await apiProbe(c, 'text', '數字型別 12345（API 直打）', { body: { text: 12345 } });
    await finalRestore(c);
  });

  test('line_image 單張圖片：建立（真上傳）+ 欄位探測', async ({ page }) => {
    const type = 'line_image';
    const name = `${E2E_PREFIX} LINE 單張圖片 ${STAMP}`;
    await pickType(page, 'line', '單張圖片');
    await setName(page, name);

    // 真實使用情境：只上傳主圖、縮圖保留預設 → 能否存檔？
    const img = await makeJpeg(page, 1024, 768, `E2E LINE image ${STAMP}`);
    const up = await uploadVia(page, page.locator(IMAGE_ACCEPT).nth(0), { name: 'e2e-line.jpg', mimeType: 'image/jpeg', buffer: img });
    record({ kind: 'upload', type, field: 'mediaUrl', ...up });
    expect(up.ok, `上傳失敗 ${up.status} ${up.message}`).toBeTruthy();
    await expect(page.getByPlaceholder('圖片網址').nth(0)).toHaveValue(up.url);
    const thumbDefault = await page.getByPlaceholder('圖片網址').nth(1).inputValue();

    const first = await saveNew(page);
    record({ kind: 'probe', type, field: 'previewUrl', input: `只換主圖、縮圖保留預設值 ${thumbDefault}`, expected: 'accept', outcome: first.status === 201 ? 'accepted' : 'backend-rejected', status: first.status, message: first.message });

    let id = first.id;
    if (first.status !== 201) {
      // 再上傳縮圖後重存
      const thumb = await makeJpeg(page, 240, 240, 'thumb');
      const up2 = await uploadVia(page, page.locator(IMAGE_ACCEPT).nth(1), { name: 'e2e-thumb.jpg', mimeType: 'image/jpeg', buffer: thumb });
      record({ kind: 'upload', type, field: 'previewUrl', ...up2 });
      const second = await saveNew(page);
      expect(second.status, `建立 ${type} 失敗：${second.message}`).toBe(201);
      id = second.id;
    }
    const m = await getMaterial(id);
    const expected = { mediaUrl: up.url, previewUrl: m.body.previewUrl };
    await afterCreate(page, type, name, id, expected);

    await gotoEdit(page, id, name);
    await expect(page.getByPlaceholder('圖片網址').nth(0)).toHaveValue(up.url);
    const pvImg = previewPane(page).locator('img').first();
    await expect(pvImg).toHaveAttribute('src', up.url);
    const loaded = await pvImg.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);
    record({ kind: 'preview', type, field: 'mediaUrl', imageLoaded: loaded });

    const c: Created = { type, id, name, body: (await getMaterial(id)).body };
    const urlBox = (p: Page) => p.getByPlaceholder('圖片網址').nth(0);
    await probe(page, c, 'mediaUrl', JS_URL, async (p) => setVal(urlBox(p), JS_URL), { expect: 'reject', persisted: (b) => b.mediaUrl });
    await probe(page, c, 'mediaUrl', 'http://example.com/a.jpg（非 HTTPS）', async (p) => setVal(urlBox(p), 'http://example.com/a.jpg'), { expect: 'reject', persisted: (b) => b.mediaUrl });
    await probe(page, c, 'mediaUrl', '(空)', async (p) => setVal(urlBox(p), ''), { expect: 'reject', persisted: (b) => b.mediaUrl });
    await probe(page, c, 'mediaUrl', 'notaurl', async (p) => setVal(urlBox(p), 'notaurl'), { expect: 'reject', persisted: (b) => b.mediaUrl });
    await finalRestore(c);
  });

  test('line_video 影片：建立（真上傳 mp4 + 縮圖）+ 欄位探測', async ({ page }) => {
    const type = 'line_video';
    const name = `${E2E_PREFIX} LINE 影片 ${STAMP}`;
    await pickType(page, 'line', '影片');
    await setName(page, name);

    const mp4 = makeMp4();
    let videoUrl = '';
    if (mp4) {
      const up = await uploadVia(page, page.locator(VIDEO_ACCEPT), { name: 'e2e-video.mp4', mimeType: 'video/mp4', buffer: mp4 });
      record({ kind: 'upload', type, field: 'videoUrl', ...up, size: mp4.length });
      expect(up.ok, `影片上傳失敗 ${up.status} ${up.message}`).toBeTruthy();
      videoUrl = up.url;
      await expect(page.getByPlaceholder('https://example.com/video.mp4')).toHaveValue(videoUrl);
    } else {
      record({ kind: 'limitation', type, note: '本機沒有 ffmpeg，無法產生 mp4，改不上傳' });
      test.skip(true, '無 ffmpeg');
    }
    const thumb = await makeJpeg(page, 640, 360, `E2E video thumb ${STAMP}`);
    const up2 = await uploadVia(page, page.locator(IMAGE_ACCEPT).nth(0), { name: 'e2e-video-thumb.jpg', mimeType: 'image/jpeg', buffer: thumb });
    record({ kind: 'upload', type, field: 'previewImageUrl', ...up2 });
    expect(up2.ok).toBeTruthy();

    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const expected = { videoUrl, previewImageUrl: up2.url };
    const m = await afterCreate(page, type, name, r.id, expected);
    // 結束畫面 UI 已移除，但預設 body 的 endCard 是否仍被偷偷存進去？
    record({ kind: 'observation', type, field: 'endCard', note: '結束畫面 UI 已移除；檢查預設 body 的 endCard 是否仍被存入', persisted: m.body.endCard ?? null });

    await gotoEdit(page, r.id, name);
    await expect(page.getByPlaceholder('https://example.com/video.mp4')).toHaveValue(videoUrl);
    await expect(page.getByPlaceholder('影片預覽圖（jpg / png）')).toHaveValue(up2.url);
    await expect(previewPane(page).locator('img').first()).toHaveAttribute('src', up2.url);

    const c: Created = { type, id: r.id, name, body: (await getMaterial(r.id)).body };
    const vBox = (p: Page) => p.getByPlaceholder('https://example.com/video.mp4');
    const tBox = (p: Page) => p.getByPlaceholder('影片預覽圖（jpg / png）');
    await probe(page, c, 'videoUrl', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', async (p) => setVal(vBox(p), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { expect: 'reject', persisted: (b) => b.videoUrl });
    await probe(page, c, 'videoUrl', '(空)', async (p) => setVal(vBox(p), ''), { expect: 'reject', persisted: (b) => b.videoUrl });
    await probe(page, c, 'videoUrl', JS_URL, async (p) => setVal(vBox(p), JS_URL), { expect: 'reject', persisted: (b) => b.videoUrl });
    await probe(page, c, 'videoUrl', 'http://example.com/a.mp4（非 HTTPS）', async (p) => setVal(vBox(p), 'http://example.com/a.mp4'), { expect: 'reject', persisted: (b) => b.videoUrl });
    await probe(page, c, 'previewImageUrl', '(空)', async (p) => setVal(tBox(p), ''), { expect: 'reject', persisted: (b) => b.previewImageUrl });
    await probe(page, c, 'previewImageUrl', JS_URL, async (p) => setVal(tBox(p), JS_URL), { expect: 'reject', persisted: (b) => b.previewImageUrl });
    await finalRestore(c);
  });

  test('line_carousel 卡片訊息：建立 2 頁（真上傳）+ 欄位探測', async ({ page }) => {
    const type = 'line_carousel';
    const name = `${E2E_PREFIX} LINE 卡片訊息 ${STAMP}`;
    await pickType(page, 'line', '卡片訊息');
    await setName(page, name);

    // 第 1 頁（預設商品頁）：改標題/說明/價格/動作 1，上傳圖片
    const t1 = 'E2E 商品一 🙂';
    const d1 = 'E2E 說明第一行\n第二行';
    const uri1 = `https://example.com/e2e/buy-1?run=${STAMP}`;
    await setVal(page.getByPlaceholder('輸入標題'), t1);
    await setVal(page.getByPlaceholder('輸入文字說明'), d1);
    await setVal(page.getByPlaceholder('00,000'), '1,990');
    await setVal(page.getByPlaceholder('輸入動作標籤').first(), '立即購買');
    await setVal(page.getByPlaceholder('https://... 或 tel:0912345678').first(), uri1);
    const img1 = await makeJpeg(page, 1024, 665, 'E2E card 1');
    const up1 = await uploadVia(page, page.locator(IMAGE_ACCEPT).nth(0), { name: 'e2e-card1.jpg', mimeType: 'image/jpeg', buffer: img1 });
    record({ kind: 'upload', type, field: 'pages[0].imageUrl', ...up1 });
    expect(up1.ok).toBeTruthy();

    // 第 2 頁：新增頁面 → 標題 + 動作 1 + 上傳圖片
    await page.getByRole('button', { name: '新增頁面' }).click();
    await expect(page.getByRole('button', { name: '第 2 頁' })).toBeVisible();
    const t2 = 'E2E 商品二';
    const uri2 = `https://example.com/e2e/buy-2?run=${STAMP}`;
    await setVal(page.getByPlaceholder('輸入標題'), t2);
    await setVal(page.getByPlaceholder('輸入動作標籤').first(), '看看');
    await setVal(page.getByPlaceholder('https://... 或 tel:0912345678').first(), uri2);
    const img2 = await makeJpeg(page, 1024, 665, 'E2E card 2');
    const up2 = await uploadVia(page, page.locator(IMAGE_ACCEPT).nth(0), { name: 'e2e-card2.jpg', mimeType: 'image/jpeg', buffer: img2 });
    expect(up2.ok).toBeTruthy();

    await expect(previewPane(page).getByText(t1).first()).toBeVisible();
    await expect(previewPane(page).getByText(t2).first()).toBeVisible();

    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const m0 = await getMaterial(r.id);
    expect(m0.body.pages, '卡片數量應為 2').toHaveLength(2);
    const expected = {
      pageType: 'product',
      pages: [
        { title: t1, description: d1, imageUrl: up1.url, price: { currency: 'NT$', amount: '1,990' }, action1: { type: 'uri', label: '立即購買', uri: uri1 } },
        { title: t2, imageUrl: up2.url, action1: { type: 'uri', label: '看看', uri: uri2 } },
      ],
    };
    await afterCreate(page, type, name, r.id, expected);

    await gotoEdit(page, r.id, name);
    await expect(page.getByPlaceholder('輸入標題')).toHaveValue(t1);
    await expect(page.getByPlaceholder('輸入文字說明')).toHaveValue(d1);
    await page.getByRole('button', { name: '第 2 頁' }).click();
    await expect(page.getByPlaceholder('輸入標題')).toHaveValue(t2);

    const c: Created = { type, id: r.id, name, body: m0.body };
    const a1Uri = (p: Page) => p.getByPlaceholder('https://... 或 tel:0912345678').first();
    const a1Label = (p: Page) => p.getByPlaceholder('輸入動作標籤').first();
    const pg0 = (b: Record<string, unknown>) => (b.pages as Array<Record<string, unknown>>)[0];
    await probe(page, c, 'pages[0].action1.uri', JS_URL, async (p) => setVal(a1Uri(p), JS_URL), { expect: 'reject', persisted: (b) => pg0(b).action1 });
    await probe(page, c, 'pages[0].action1.uri', '(空)', async (p) => setVal(a1Uri(p), ''), { expect: 'reject', persisted: (b) => pg0(b).action1 });
    await probe(page, c, 'pages[0].action1.uri', 'example.com（無 scheme）', async (p) => setVal(a1Uri(p), 'example.com'), { expect: 'reject', persisted: (b) => pg0(b).action1 });
    await probe(page, c, 'pages[0].action1.label', '(空)', async (p) => setVal(a1Label(p), ''), { expect: 'reject', persisted: (b) => pg0(b).action1 });
    await probe(page, c, 'pages[0].title', '(空)', async (p) => setVal(p.getByPlaceholder('輸入標題'), ''), { expect: 'accept', persisted: (b) => pg0(b).title });
    await probe(page, c, 'pages[0].imageUrl', JS_URL, async (p) => setVal(p.getByPlaceholder('圖片網址').first(), JS_URL), { expect: 'reject', persisted: (b) => pg0(b).imageUrl });
    // maxLength
    await gotoEdit(page, c.id, c.name);
    await setVal(page.getByPlaceholder('輸入標題'), strOfLength(21, '標'));
    await setVal(a1Label(page), strOfLength(16, '按'));
    record({
      kind: 'attr', type, field: 'pages[0].title / action1.label',
      titleLenAfter21: (await page.getByPlaceholder('輸入標題').inputValue()).length,
      labelLenAfter16: (await a1Label(page).inputValue()).length,
    });
    const tooLong = JSON.parse(JSON.stringify(c.body));
    tooLong.pages[0].title = strOfLength(60, '標');
    await apiProbe(c, 'pages[0].title', '60 字（API 直打，前端上限 20）', { body: tooLong });
    const eleven = JSON.parse(JSON.stringify(c.body));
    eleven.pages = Array.from({ length: 13 }, () => JSON.parse(JSON.stringify(c.body.pages as unknown[]))[0]);
    await apiProbe(c, 'pages', '13 頁（API 直打，前端上限 10、LINE 上限 12）', { body: eleven });
    if (eleven) {
      const m = await getMaterial(c.id);
      record({ kind: 'observation', type, field: 'pages', note: '13 頁 API 探測後讀回頁數', persisted: (m.body.pages as unknown[]).length });
    }
    await finalRestore(c);
  });

  test('line_imagemap 圖文訊息：建立（真上傳底圖）+ 欄位探測', async ({ page }) => {
    const type = 'line_imagemap';
    const name = `${E2E_PREFIX} LINE 圖文訊息 ${STAMP}`;
    await pickType(page, 'line', '圖文訊息');
    await setName(page, name);
    const baseBox = (p: Page) => p.getByPlaceholder(/寬 1040px × 高 700px/);

    // 比例不符的底圖：前端應擋下並顯示看得懂的訊息
    const wrong = await makeJpeg(page, 800, 800, 'wrong ratio');
    await page.locator(IMAGE_ACCEPT).nth(0).setInputFiles({ name: 'wrong.jpg', mimeType: 'image/jpeg', buffer: wrong });
    const ratioErr = page.getByText(/圖片比例與版型不符/);
    const ratioShown = await ratioErr.isVisible({ timeout: 5_000 }).catch(() => false);
    record({ kind: 'probe', type, field: 'baseImageUrl(upload)', input: '800×800 底圖（版型 1040×700）', expected: 'reject', outcome: ratioShown ? 'frontend-blocked' : 'not-blocked', message: ratioShown ? await ratioErr.textContent() : null });

    const img = await makeJpeg(page, 1040, 700, `E2E imagemap ${STAMP}`);
    const up = await uploadVia(page, page.locator(IMAGE_ACCEPT).nth(0), { name: 'e2e-imagemap.jpg', mimeType: 'image/jpeg', buffer: img });
    record({ kind: 'upload', type, field: 'baseImageUrl', ...up });
    expect(up.ok, `底圖上傳失敗 ${up.status} ${up.message}`).toBeTruthy();
    await expect(baseBox(page)).toHaveValue(up.url);

    const uriL = `https://example.com/e2e/left?run=${STAMP}`;
    await setVal(page.getByPlaceholder('輸入動作標籤').nth(0), '左邊');
    await setVal(page.getByPlaceholder('https://... 或 tel:0912345678').first(), uriL);
    await setVal(page.getByPlaceholder('輸入動作標籤').nth(1), '右邊');
    await setVal(page.getByPlaceholder('點擊後送出的文字').first(), 'E2E 我點了右邊 🙂');

    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const expected = {
      baseImageUrl: up.url, layoutId: 'lo_700_2v', width: 1040, height: 700,
      areas: [
        { x: 0, y: 0, width: 520, height: 700, action: { type: 'uri', label: '左邊', uri: uriL } },
        { x: 520, y: 0, width: 520, height: 700, action: { type: 'message', label: '右邊', text: 'E2E 我點了右邊 🙂' } },
      ],
    };
    await afterCreate(page, type, name, r.id, expected);

    await gotoEdit(page, r.id, name);
    await expect(baseBox(page)).toHaveValue(up.url);
    await expect(page.getByPlaceholder('https://... 或 tel:0912345678').first()).toHaveValue(uriL);
    // 預覽底圖：baseUrl 不含副檔名，瀏覽器是否載得出來？
    const pvImgs = previewPane(page).locator('img');
    const pvInfo = await pvImgs.evaluateAll((els) => els.map((e) => ({ src: (e as HTMLImageElement).src, ok: (e as HTMLImageElement).naturalWidth > 0, hidden: (e as HTMLElement).style.display === 'none' })));
    const editorImg = await page.locator(`img[src="${up.url}"]`).evaluateAll((els) => els.map((e) => ({ ok: (e as HTMLImageElement).naturalWidth > 0, hidden: (e as HTMLElement).style.display === 'none' })));
    record({ kind: 'preview', type, field: 'baseImageUrl', previewImgs: pvInfo, editorImgs: editorImg });

    const c: Created = { type, id: r.id, name, body: (await getMaterial(r.id)).body };
    await probe(page, c, 'areas[0].action.uri', JS_URL, async (p) => setVal(p.getByPlaceholder('https://... 或 tel:0912345678').first(), JS_URL), { expect: 'reject', persisted: (b) => (b.areas as Array<Record<string, unknown>>)[0].action });
    await probe(page, c, 'areas[0].action.uri', '(空)', async (p) => setVal(p.getByPlaceholder('https://... 或 tel:0912345678').first(), ''), { expect: 'reject', persisted: (b) => (b.areas as Array<Record<string, unknown>>)[0].action });
    await probe(page, c, 'areas[1].action.text', '(空)', async (p) => setVal(p.getByPlaceholder('點擊後送出的文字').first(), ''), { expect: 'reject', persisted: (b) => (b.areas as Array<Record<string, unknown>>)[1].action });
    await probe(page, c, 'baseImageUrl', '(空)', async (p) => { await setVal(baseBox(p), ''); }, { expect: 'reject', persisted: (b) => b.baseImageUrl });
    await probe(page, c, 'baseImageUrl', JS_URL, async (p) => { await setVal(baseBox(p), JS_URL); }, { expect: 'reject', persisted: (b) => b.baseImageUrl });
    await finalRestore(c);
  });
});

// ───────────────────────────────────────────────────────────────────────
// FB
// ───────────────────────────────────────────────────────────────────────

test.describe('@materials-all FB 素材', () => {
  test('fb_text 純文字：建立（emoji / 換行）+ 欄位探測', async ({ page }) => {
    const type = 'fb_text';
    const name = `${E2E_PREFIX} FB 純文字 ${STAMP}`;
    const text = `${E2E_PREFIX} FB 純文字內容 ${STAMP}\n第二行 🙂👍`;
    await pickType(page, 'fb', '純文字');
    await setName(page, name);
    const ta = (p: Page) => p.getByPlaceholder('輸入要發送的文字訊息');
    await setVal(ta(page), text);
    await expect(previewPane(page).getByText(`${E2E_PREFIX} FB 純文字內容`, { exact: false })).toBeVisible();
    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const expected = { text };
    await afterCreate(page, type, name, r.id, expected);
    await gotoEdit(page, r.id, name);
    await expect(ta(page)).toHaveValue(text);

    const c: Created = { type, id: r.id, name, body: (await getMaterial(r.id)).body };
    await probe(page, c, 'text', '(空)', async (p) => setVal(ta(p), ''), { expect: 'reject', persisted: (b) => b.text });
    await probe(page, c, 'text', '純空白', async (p) => setVal(ta(p), '   '), { expect: 'reject', persisted: (b) => b.text });
    await gotoEdit(page, c.id, c.name);
    await setVal(ta(page), strOfLength(2001, '字'));
    record({ kind: 'attr', type, field: 'text', maxLength: await ta(page).getAttribute('maxlength'), lengthAfterFill2001: (await ta(page).inputValue()).length });
    await apiProbe(c, 'text', '2001 字（API 直打）', { body: { text: strOfLength(2001, '字') } });
    await finalRestore(c);
  });

  test('fb_image 單張圖片：建立（真上傳）+ 欄位探測', async ({ page }) => {
    const type = 'fb_image';
    const name = `${E2E_PREFIX} FB 單張圖片 ${STAMP}`;
    await pickType(page, 'fb', '單張圖片');
    await setName(page, name);
    const img = await makeJpeg(page, 1024, 768, `E2E FB image ${STAMP}`);
    const up = await uploadVia(page, page.locator(IMAGE_ACCEPT).nth(0), { name: 'e2e-fb.jpg', mimeType: 'image/jpeg', buffer: img });
    record({ kind: 'upload', type, field: 'url', ...up });
    expect(up.ok).toBeTruthy();
    await expect(previewPane(page).locator('img').first()).toHaveAttribute('src', up.url);
    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const expected = { url: up.url };
    await afterCreate(page, type, name, r.id, expected);
    await gotoEdit(page, r.id, name);
    await expect(page.getByPlaceholder('圖片網址').first()).toHaveValue(up.url);

    const c: Created = { type, id: r.id, name, body: (await getMaterial(r.id)).body };
    const box = (p: Page) => p.getByPlaceholder('圖片網址').first();
    await probe(page, c, 'url', JS_URL, async (p) => setVal(box(p), JS_URL), { expect: 'reject', persisted: (b) => b.url });
    await probe(page, c, 'url', '(空)', async (p) => setVal(box(p), ''), { expect: 'reject', persisted: (b) => b.url });
    await probe(page, c, 'url', 'notaurl', async (p) => setVal(box(p), 'notaurl'), { expect: 'reject', persisted: (b) => b.url });
    await finalRestore(c);
  });

  test('fb_video 影片：建立（上傳 mp4 後貼網址）+ 欄位探測', async ({ page }) => {
    const type = 'fb_video';
    const name = `${E2E_PREFIX} FB 影片 ${STAMP}`;
    await pickType(page, 'fb', '影片');
    await setName(page, name);
    const box = (p: Page) => p.getByPlaceholder('https://...mp4');
    // FB 影片編輯器沒有上傳鈕（只能貼網址）→ 用 API 上傳一支 mp4 取得真實網址再貼上
    const mp4 = makeMp4();
    let url = 'https://example.com/e2e-sample.mp4';
    if (mp4) {
      const res = await api.post('files/upload', { multipart: { file: { name: 'e2e-fb-video.mp4', mimeType: 'video/mp4', buffer: mp4 } } });
      const b = await res.json().catch(() => ({}));
      record({ kind: 'upload', type, field: 'url（API 上傳，編輯器無上傳鈕）', ok: res.ok(), status: res.status(), url: b?.data?.url, message: b?.error?.message });
      if (res.ok()) url = b.data.url;
    }
    record({ kind: 'attr', type, field: 'url', hasUploadButton: (await page.locator(VIDEO_ACCEPT).count()) > 0 });
    await setVal(box(page), url);
    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const expected = { url };
    await afterCreate(page, type, name, r.id, expected);
    await gotoEdit(page, r.id, name);
    await expect(box(page)).toHaveValue(url);
    const pvImg = previewPane(page).locator('img').first();
    const pvInfo = (await pvImg.count())
      ? await pvImg.evaluate((e) => ({ src: (e as HTMLImageElement).src, ok: (e as HTMLImageElement).naturalWidth > 0 }))
      : null;
    record({ kind: 'preview', type, field: 'url', note: '預覽以 <img> 顯示影片網址', previewImg: pvInfo });

    const c: Created = { type, id: r.id, name, body: (await getMaterial(r.id)).body };
    await probe(page, c, 'url', JS_URL, async (p) => setVal(box(p), JS_URL), { expect: 'reject', persisted: (b) => b.url });
    await probe(page, c, 'url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', async (p) => setVal(box(p), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { expect: 'reject', persisted: (b) => b.url });
    await probe(page, c, 'url', '(空)', async (p) => setVal(box(p), ''), { expect: 'reject', persisted: (b) => b.url });
    await finalRestore(c);
  });

  test('fb_generic 商品輪播：建立 3 張卡（真上傳）+ 欄位探測', async ({ page }) => {
    const type = 'fb_generic';
    const name = `${E2E_PREFIX} FB 商品輪播 ${STAMP}`;
    await pickType(page, 'fb', '商品輪播');
    await setName(page, name);
    const titles = (p: Page) => p.getByPlaceholder('商品標題');
    const subs = (p: Page) => p.getByPlaceholder('副標題（選填）');

    await setVal(titles(page).nth(0), 'E2E 商品 A 🙂');
    await setVal(subs(page).nth(0), 'NT$ 100');
    await setVal(titles(page).nth(1), 'E2E 商品 B');
    await page.getByRole('button', { name: /新增卡片/ }).click();
    await expect(titles(page)).toHaveCount(3);
    await setVal(titles(page).nth(2), 'E2E 商品 C');
    await setVal(subs(page).nth(2), '第三張');
    const urls: string[] = [];
    for (let i = 0; i < 3; i++) {
      const img = await makeJpeg(page, 955, 500, `E2E FB card ${i + 1}`);
      const up = await uploadVia(page, page.locator(IMAGE_ACCEPT).nth(i), { name: `e2e-fbcard${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: img });
      expect(up.ok).toBeTruthy();
      urls.push(up.url);
    }
    record({ kind: 'attr', type, field: 'elements[].buttons', note: '編輯器是否提供按鈕欄位', buttonInputs: await page.getByPlaceholder(/按鈕/).count() });
    await expect(previewPane(page).getByText('E2E 商品 C').first()).toBeVisible();

    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const expected = {
      elements: [
        { title: 'E2E 商品 A 🙂', subtitle: 'NT$ 100', image_url: urls[0] },
        { title: 'E2E 商品 B', image_url: urls[1] },
        { title: 'E2E 商品 C', subtitle: '第三張', image_url: urls[2] },
      ],
    };
    const m = await afterCreate(page, type, name, r.id, expected);
    expect(m.body.elements).toHaveLength(3);
    await gotoEdit(page, r.id, name);
    await expect(titles(page)).toHaveCount(3);
    await expect(titles(page).nth(2)).toHaveValue('E2E 商品 C');

    const c: Created = { type, id: r.id, name, body: m.body };
    const el0 = (b: Record<string, unknown>) => (b.elements as Array<Record<string, unknown>>)[0];
    await probe(page, c, 'elements[0].title', '(空)', async (p) => setVal(titles(p).nth(0), ''), { expect: 'reject', persisted: (b) => el0(b).title });
    await probe(page, c, 'elements[0].image_url', JS_URL, async (p) => setVal(p.getByPlaceholder('圖片網址').nth(0), JS_URL), { expect: 'reject', persisted: (b) => el0(b).image_url });
    await probe(page, c, 'elements', '刪光所有卡片（0 張）', async (p) => {
      for (let i = 0; i < 3; i++) {
        await p.locator('div.rounded-md.border', { hasText: '卡片 1' }).getByRole('button').first().click();
      }
      await expect(titles(p)).toHaveCount(0);
    }, { expect: 'reject', persisted: (b) => (b.elements as unknown[]).length });
    await apiProbe(c, 'elements', '11 張（API 直打，前端上限 10）', { body: { elements: Array.from({ length: 11 }, (_, i) => ({ title: `E2E ${i}` })) } });
    await finalRestore(c);
  });

  test('fb_button 按鈕選單：建立 3 顆按鈕 + 欄位探測', async ({ page }) => {
    const type = 'fb_button';
    const name = `${E2E_PREFIX} FB 按鈕選單 ${STAMP}`;
    await pickType(page, 'fb', '按鈕選單');
    await setName(page, name);
    const mainText = (p: Page) => byLabel(p, '主要訊息', 'textarea');
    const btnTitles = (p: Page) => p.getByPlaceholder('按鈕文字');
    const text = `E2E 請問需要什麼協助？🙂\n第二行`;
    await setVal(mainText(page), text);
    await setVal(btnTitles(page).nth(0), 'E2E 查訂單');
    await setVal(page.getByPlaceholder('回傳資料', { exact: true }).nth(0), 'E2E_ORDER');
    await setVal(btnTitles(page).nth(2), 'E2E 官網');
    const site = `https://example.com/e2e?run=${STAMP}`;
    await setVal(page.getByPlaceholder('網址', { exact: true }).nth(0), site);
    await expect(previewPane(page).getByText('E2E 查訂單').first()).toBeVisible();

    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const expected = {
      text,
      buttons: [
        { type: 'postback', title: 'E2E 查訂單', payload: 'E2E_ORDER' },
        { type: 'postback', title: '查商品', payload: 'menu:product' },
        { type: 'web_url', title: 'E2E 官網', url: site },
      ],
    };
    await afterCreate(page, type, name, r.id, expected);
    await gotoEdit(page, r.id, name);
    await expect(mainText(page)).toHaveValue(text);
    await expect(page.getByPlaceholder('網址', { exact: true }).nth(0)).toHaveValue(site);

    const c: Created = { type, id: r.id, name, body: (await getMaterial(r.id)).body };
    await probe(page, c, 'text', '(空)', async (p) => setVal(mainText(p), ''), { expect: 'reject', persisted: (b) => b.text });
    await probe(page, c, 'buttons[2].url', JS_URL, async (p) => setVal(p.getByPlaceholder('網址', { exact: true }).nth(0), JS_URL), { expect: 'reject', persisted: (b) => (b.buttons as Array<Record<string, unknown>>)[2] });
    await probe(page, c, 'buttons[0].title', '(空)', async (p) => setVal(btnTitles(p).nth(0), ''), { expect: 'reject', persisted: (b) => (b.buttons as Array<Record<string, unknown>>)[0] });
    await probe(page, c, 'buttons', '刪光所有按鈕（0 顆）', async (p) => {
      for (let i = 0; i < 3; i++) {
        await btnTitles(p).first().locator('xpath=following::button[1]').click();
      }
      await expect(btnTitles(p)).toHaveCount(0);
    }, { expect: 'reject', persisted: (b) => (b.buttons as unknown[] | undefined)?.length });
    await gotoEdit(page, c.id, c.name);
    record({ kind: 'attr', type, field: 'text', maxLength: await mainText(page).getAttribute('maxlength') });
    await apiProbe(c, 'text', '700 字（API 直打；FB button template 上限 640）', { body: { ...c.body, text: strOfLength(700, '字') } });
    await finalRestore(c);
  });

  test('fb_media 大圖／影片廣告：建立（真上傳）+ 欄位探測', async ({ page }) => {
    const type = 'fb_media';
    const name = `${E2E_PREFIX} FB 大圖廣告 ${STAMP}`;
    await pickType(page, 'fb', '大圖／影片廣告');
    await setName(page, name);
    const mediaType = (p: Page) => p.getByPlaceholder('image / video');
    const attach = (p: Page) => byLabel(p, 'attachment_id');
    await setVal(mediaType(page), 'image');
    await setVal(attach(page), '1234567890');
    const img = await makeJpeg(page, 1200, 628, `E2E FB media ${STAMP}`);
    const up = await uploadVia(page, page.locator(IMAGE_ACCEPT).nth(0), { name: 'e2e-fbmedia.jpg', mimeType: 'image/jpeg', buffer: img });
    record({ kind: 'upload', type, field: 'url', ...up });
    expect(up.ok).toBeTruthy();
    await expect(previewPane(page).locator('img').first()).toHaveAttribute('src', up.url);
    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const expected = { media_type: 'image', attachment_id: '1234567890', url: up.url };
    await afterCreate(page, type, name, r.id, expected);
    await gotoEdit(page, r.id, name);
    await expect(attach(page)).toHaveValue('1234567890');
    await expect(page.getByPlaceholder('圖片網址').first()).toHaveValue(up.url);

    const c: Created = { type, id: r.id, name, body: (await getMaterial(r.id)).body };
    await probe(page, c, 'media_type', 'abc（非 image/video）', async (p) => setVal(mediaType(p), 'abc'), { expect: 'reject', persisted: (b) => b.media_type });
    await probe(page, c, 'media_type', '(空)', async (p) => setVal(mediaType(p), ''), { expect: 'reject', persisted: (b) => b.media_type });
    await probe(page, c, 'url', JS_URL, async (p) => setVal(p.getByPlaceholder('圖片網址').first(), JS_URL), { expect: 'reject', persisted: (b) => b.url });
    await probe(page, c, 'url + attachment_id', '兩者皆空', async (p) => {
      await setVal(p.getByPlaceholder('圖片網址').first(), '');
      await setVal(attach(p), '');
    }, { expect: 'reject', persisted: (b) => ({ url: b.url, attachment_id: b.attachment_id }) });
    await finalRestore(c);
  });

  test('fb_coupon 優惠券：建立（真上傳）+ 欄位探測', async ({ page }) => {
    const type = 'fb_coupon';
    const name = `${E2E_PREFIX} FB 優惠券 ${STAMP}`;
    await pickType(page, 'fb', '優惠券');
    await setName(page, name);
    const title = (p: Page) => byLabel(p, '優惠券標題');
    const subtitle = (p: Page) => byLabel(p, /^副標題/);
    const pre = (p: Page) => byLabel(p, '優惠券前訊息');
    const code = (p: Page) => byLabel(p, '折扣碼');
    const payload = (p: Page) => byLabel(p, 'webhook 回傳資料');
    await setVal(title(page), 'E2E 會員 9 折 🙂');
    await setVal(subtitle(page), 'E2E 限時');
    await setVal(pre(page), 'E2E 感謝支持');
    await code(page).fill('');
    await code(page).pressSequentially('E2E 9 0');
    const codeVal = await code(page).inputValue();
    record({ kind: 'probe', type, field: 'coupon_code', input: '輸入「E2E 9 0」（含空格）', expected: 'accept', outcome: 'frontend-normalized', persisted: codeVal });
    await setVal(payload(page), 'e2e_coupon_payload');
    const img = await makeJpeg(page, 1024, 558, `E2E coupon ${STAMP}`);
    const up = await uploadVia(page, page.locator(IMAGE_ACCEPT).nth(0), { name: 'e2e-coupon.jpg', mimeType: 'image/jpeg', buffer: img });
    expect(up.ok).toBeTruthy();
    await expect(previewPane(page).getByText('E2E 會員 9 折', { exact: false }).first()).toBeVisible();

    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const expected = {
      title: 'E2E 會員 9 折 🙂', subtitle: 'E2E 限時', coupon_pre_message: 'E2E 感謝支持',
      coupon_code: codeVal, image_url: up.url, payload: 'e2e_coupon_payload',
    };
    await afterCreate(page, type, name, r.id, expected);
    await gotoEdit(page, r.id, name);
    await expect(title(page)).toHaveValue('E2E 會員 9 折 🙂');
    await expect(code(page)).toHaveValue(codeVal);

    const c: Created = { type, id: r.id, name, body: (await getMaterial(r.id)).body };
    await probe(page, c, 'title', '(空)（標示為必填 *）', async (p) => setVal(title(p), ''), { expect: 'reject', persisted: (b) => b.title });
    await probe(page, c, 'image_url', JS_URL, async (p) => setVal(p.getByPlaceholder('圖片網址').first(), JS_URL), { expect: 'reject', persisted: (b) => b.image_url });
    await probe(page, c, 'coupon_code', '(空)', async (p) => setVal(code(p), ''), { expect: 'reject', persisted: (b) => b.coupon_code });
    await gotoEdit(page, c.id, c.name);
    await setVal(title(page), strOfLength(81, '券'));
    record({ kind: 'attr', type, field: 'title', maxLength: await title(page).getAttribute('maxlength'), lengthAfterFill81: (await title(page).inputValue()).length });
    await apiProbe(c, 'title', '81 字（API 直打）', { body: { ...c.body, title: strOfLength(81, '券') } });
    await apiProbe(c, 'coupon_code', '含空格「AB C」（API 直打）', { body: { ...c.body, coupon_code: 'AB C' } });
    await finalRestore(c);
  });

  test('fb_receipt 訂單收據：建立 + 欄位探測', async ({ page }) => {
    const type = 'fb_receipt';
    const name = `${E2E_PREFIX} FB 訂單收據 ${STAMP}`;
    await pickType(page, 'fb', '訂單收據');
    await setName(page, name);
    const recip = (p: Page) => byLabel(p, '收件人');
    const order = (p: Page) => byLabel(p, '訂單編號');
    const cur = (p: Page) => byLabel(p, '幣別');
    const pay = (p: Page) => byLabel(p, '付款方式');
    const merchant = (p: Page) => byLabel(p, '商家名稱');
    const total = (p: Page) => byLabel(p, '總金額');
    const orderNo = `E2E-${STAMP}`;
    await setVal(recip(page), 'E2E 王小明');
    await setVal(order(page), orderNo);
    await setVal(cur(page), 'TWD');
    await setVal(pay(page), 'Visa **4242');
    await setVal(merchant(page), 'E2E 測試商店');
    await setVal(total(page), '1234.5');
    await expect(previewPane(page).getByText(orderNo, { exact: false }).first()).toBeVisible();
    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const expected = {
      recipient_name: 'E2E 王小明', order_number: orderNo, currency: 'TWD',
      payment_method: 'Visa **4242', merchant_name: 'E2E 測試商店', summary: { total_cost: 1234.5 },
    };
    await afterCreate(page, type, name, r.id, expected);
    await gotoEdit(page, r.id, name);
    await expect(order(page)).toHaveValue(orderNo);
    await expect(total(page)).toHaveValue('1234.5');

    const c: Created = { type, id: r.id, name, body: (await getMaterial(r.id)).body };
    await probe(page, c, 'recipient_name', '(空)（標示為必填 *）', async (p) => setVal(recip(p), ''), { expect: 'reject', persisted: (b) => b.recipient_name });
    await probe(page, c, 'order_number', '(空)（標示為必填 *）', async (p) => setVal(order(p), ''), { expect: 'reject', persisted: (b) => b.order_number });
    await probe(page, c, 'summary.total_cost', '-999', async (p) => setVal(total(p), '-999'), { expect: 'reject', persisted: (b) => b.summary });
    await probe(page, c, 'summary.total_cost', '(清空)', async (p) => setVal(total(p), ''), { expect: 'reject', persisted: (b) => b.summary });
    await probe(page, c, 'currency', 'XYZ1（非 ISO 4217）', async (p) => setVal(cur(p), 'XYZ1'), { expect: 'reject', persisted: (b) => b.currency });
    await finalRestore(c);
  });

  test('fb_feedback 滿意度調查：建立（NPS）+ 欄位探測', async ({ page }) => {
    const type = 'fb_feedback';
    const name = `${E2E_PREFIX} FB 滿意度調查 ${STAMP}`;
    await pickType(page, 'fb', '滿意度調查');
    await setName(page, name);
    const title = (p: Page) => byLabel(p, /^標題$/);
    const subtitle = (p: Page) => byLabel(p, /^副標題$/);
    const qtype = (p: Page) => byLabel(p, '問題類型', 'select');
    const days = (p: Page) => byLabel(p, '有效天數');
    await setVal(title(page), 'E2E 您對本次服務滿意嗎？🙂');
    await setVal(subtitle(page), 'E2E 副標題');
    await qtype(page).selectOption('nps');
    await setVal(days(page), '14');
    await expect(previewPane(page).getByText('E2E 您對本次服務滿意嗎', { exact: false }).first()).toBeVisible();
    const r = await saveNew(page);
    expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
    const expected = { title: 'E2E 您對本次服務滿意嗎？🙂', subtitle: 'E2E 副標題', question_type: 'nps', expires_in_days: 14 };
    await afterCreate(page, type, name, r.id, expected);
    await gotoEdit(page, r.id, name);
    await expect(qtype(page)).toHaveValue('nps');
    await expect(days(page)).toHaveValue('14');

    const c: Created = { type, id: r.id, name, body: (await getMaterial(r.id)).body };
    await probe(page, c, 'title', '(空)', async (p) => setVal(title(p), ''), { expect: 'reject', persisted: (b) => b.title });
    await probe(page, c, 'expires_in_days', '-1', async (p) => setVal(days(p), '-1'), { expect: 'reject', persisted: (b) => b.expires_in_days });
    await probe(page, c, 'expires_in_days', '(清空)', async (p) => setVal(days(p), ''), { expect: 'reject', persisted: (b) => b.expires_in_days });
    await probe(page, c, 'expires_in_days', '9999', async (p) => setVal(days(p), '9999'), { expect: 'reject', persisted: (b) => b.expires_in_days });
    await gotoEdit(page, c.id, c.name);
    await setVal(title(page), strOfLength(100, '題'));
    record({ kind: 'attr', type, field: 'title', maxLength: await title(page).getAttribute('maxlength') });
    await finalRestore(c);
  });
});
