import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { E2E_PREFIX, newApiContext } from './helpers';
import { apiFieldCheck, expectRejected, strOfLength, submitAndObserve, type SubmitResult } from './field-helpers';
import {
  RUN_TAG,
  createMaterialViaApi,
  deleteMaterials,
  fbCard,
  field,
  getMaterial,
  gotoEdit,
  makeJpeg,
  nameInput,
  nameRequiredToast,
  saveBtn,
  section,
  setVal,
  type MaterialRecord,
} from './material-helpers';

/**
 * 素材庫欄位探測（LINE 5 種 + FB 9 種）——只在手動時跑，不進一般回歸。
 *
 * ── 執行方式 ──────────────────────────────────────────────────────────
 *   cd apps/web
 *   npx tsx tests/e2e-uat/capture-auth-api.ts all          # 先刷新 auth-state.json
 *   RUN_MATERIAL_PROBES=1 npx playwright test --config playwright.uat.config.ts --project=manual
 *   # 只跑某型別：再加 --grep fb_receipt
 *
 * 為什麼要兩道開關：檔名不以 tenant-／platform-／cross- 開頭，三個常設 project 的 testMatch
 * 都不會選到它；`manual` project 只在 RUN_MATERIAL_PROBES=1 時才加入 config。
 * 檔案內也再判斷一次環境變數（換別的 config 直接指定檔名時一樣會 skip）。
 * ⚠️ UAT 是 rotating token，不要和其他 UAT 測試同時跑。
 *
 * ── 每則探測 ──────────────────────────────────────────────────────────
 *   開編輯頁 → 把一個欄位改成非法值 → 按存檔 → 判斷前端擋下或後端回 4xx；
 *   改值到判斷整段包在 try/finally，結束一律用 API 還原成建立時的合法內容（還原失敗會列出 id）。
 *
 *   三種結果：
 *   - 強制斷言被擋：LINE 5 種的非法網址／空值／javascript:／非 HTTPS、素材名稱空白——後端已確認會擋。
 *   - FB 9 種：後端內容檢查已上線（openspec change validate-fb-material-content，#266），
 *     必填、網址、數值與列舉一律強制斷言被擋。knownGap 參數保留給之後新發現、尚未修正的缺口。
 *   - 觀察（標題含「觀察」）：沒有確定規格的行為，只記錄結果（[REPORT] 行＋JSON Lines 檔
 *     E2E_FINDINGS_FILE，預設 os.tmpdir()），只有 5xx 用 expect.soft 標紅。
 *
 * ── 資料紀律（UAT 就是正式環境）─────────────────────────────────────
 *   - 每個型別用 API 建一則名稱帶 [E2E] 的探測素材，只改這一則；檔案結束時刪除全部探測素材。
 *   - 探測素材的圖片／影片網址用 https://example.com/…（只存不送，不需要真的可下載）。
 *   - 不發送任何訊息；LINE 版型存檔時後端會呼叫 LINE validate/push（只驗不送）。
 */
test.skip(process.env.RUN_MATERIAL_PROBES !== '1', '欄位探測只在手動時跑：設 RUN_MATERIAL_PROBES=1');
test.describe.configure({ mode: 'default', retries: 0 });
test.setTimeout(2 * 60_000);

const FINDINGS_FILE =
  process.env.E2E_FINDINGS_FILE || path.join(os.tmpdir(), `material-field-probes-${RUN_TAG}.jsonl`);
const JS_URL = 'javascript:alert(1)';
// 沒有網域的網址：瀏覽器會把 http:///path 正規化成網域 path，後端要先檢查原字串（PR #267）
const HOSTLESS_URLS = [['沒有網域 http:///', 'http:///e2e-probe.jpg'], ['只有 https://?', 'https://?']] as const;
const IMG = 'https://example.com/e2e-probe.jpg';

let api: APIRequestContext;
const createdIds: string[] = [];

test.beforeEach(async () => {
  api = await newApiContext();
});
test.afterEach(async () => {
  await api?.dispose();
});
test.afterAll(async () => {
  if (!createdIds.length) return;
  const cleanupApi = await newApiContext();
  try {
    await deleteMaterials(cleanupApi, createdIds);
  } finally {
    await cleanupApi.dispose();
  }
});

// ───────────────────────────────────────────────────────────────────────
// 共用工具
// ───────────────────────────────────────────────────────────────────────

function record(entry: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  fs.appendFileSync(FINDINGS_FILE, `${line}\n`);
  console.log(`[REPORT] ${line}`);
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
type Body = Record<string, unknown>;
type Mutate = (page: Page) => Promise<void>;

/** describe 內呼叫：beforeAll 以 API 建立該型別的探測素材，回傳取用函式 */
function useProbeMaterial(channelType: 'line' | 'fb', contentType: string, body: Body): () => MaterialRecord {
  let m: MaterialRecord | undefined;
  test.beforeAll(async () => {
    const a = await newApiContext();
    try {
      m = await createMaterialViaApi(a, {
        name: `${E2E_PREFIX} 欄位探測 ${contentType} ${RUN_TAG}`,
        channelType,
        contentType,
        body,
      });
      createdIds.push(m.id);
    } finally {
      await a.dispose();
    }
  });
  return () => {
    if (!m) throw new Error(`${contentType} 探測素材未建立`);
    return m;
  };
}

/**
 * 執行 fn，結束時（不論成敗）用 API 把素材還原成建立時的合法內容。
 * 還原失敗一定印出 id；fn 本身成功時再丟錯讓測試失敗。
 */
async function withRestore<T>(m: MaterialRecord, fn: () => Promise<T>): Promise<T> {
  let fnFailed = false;
  try {
    return await fn();
  } catch (err) {
    fnFailed = true;
    throw err;
  } finally {
    let problem = '';
    try {
      const res = await api.patch(`marketing/materials/${m.id}`, { data: { name: m.name, body: m.body } });
      if (!res.ok()) problem = `PATCH 回 ${res.status()}：${(await res.text()).slice(0, 300)}`;
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
    if (problem) {
      const msg = `[RESTORE] 探測素材 ${m.id}（${m.contentType}）還原失敗，請手動檢查：${problem}`;
      console.error(msg);
      if (!fnFailed) throw new Error(msg);
    }
  }
}

type SaveResult = SubmitResult & { blockedBy: 'disabled' | 'frontend' | null; message: string | null };

/** 編輯頁按存檔：按鈕被停用、前端提示擋下、或送出 PATCH 後的回應 */
async function saveOnEditPage(page: Page, m: MaterialRecord): Promise<SaveResult> {
  const btn = saveBtn(page);
  if (await btn.isDisabled()) {
    const reason = await page.getByText(/^無法儲存：/).textContent().catch(() => null);
    return { requested: false, status: null, body: null, blockedBy: 'disabled', message: reason };
  }
  const r = await submitAndObserve(
    page,
    () => btn.click(),
    new RegExp(`/marketing/materials/${m.id}$`),
    'PATCH',
    45_000, // LINE validate 可能慢；前端擋下時看到提示就立刻返回，不會等滿
    { blockedSignal: nameRequiredToast(page) },
  );
  if (!r.requested) {
    const shown = await nameRequiredToast(page).isVisible().catch(() => false);
    return { ...r, blockedBy: 'frontend', message: shown ? '素材名稱必填' : null };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message = ((r.body as any)?.error?.message as string | undefined) ?? null;
  return { ...r, blockedBy: null, message };
}

/**
 * 強制斷言非法值被擋（前端擋下或後端 4xx）；後端擋下時錯誤訊息須顯示在畫面上。
 * knownGap 有值時，在操作完成、判斷之前才標 test.fail()。
 */
async function probeRejected(page: Page, m: MaterialRecord, fieldName: string, mutate: Mutate, knownGap?: string) {
  const context = `${m.contentType}.${fieldName}`;
  await withRestore(m, async () => {
    await gotoEdit(page, m.id, m.name);
    await mutate(page);
    const r = await saveOnEditPage(page, m);
    record({ kind: 'probe', type: m.contentType, field: fieldName, requested: r.requested, blockedBy: r.blockedBy, status: r.status, message: r.message });
    if (knownGap) test.fail(true, knownGap);
    expectRejected(r, context);
    if (r.requested) {
      expect(r.message, `${context}：後端擋下時應回錯誤訊息`).toBeTruthy();
      await expect(page.getByText(r.message!, { exact: false }).first(), `${context}：錯誤訊息應顯示在畫面上`).toBeVisible();
    }
  });
}

/** 觀察：記錄行為，不斷言結果（只有 5xx 標紅）；後端接受時讀回實際存的值 */
async function probeObserve(page: Page, m: MaterialRecord, fieldName: string, mutate: Mutate, persisted?: (b: Body) => unknown) {
  await withRestore(m, async () => {
    await gotoEdit(page, m.id, m.name);
    await mutate(page);
    const r = await saveOnEditPage(page, m);
    let stored: unknown;
    if (r.status !== null && r.status < 400 && persisted) stored = persisted((await getMaterial(api, m.id)).body);
    const outcome = !r.requested ? `frontend-${r.blockedBy}` : r.status! >= 400 ? 'backend-rejected' : 'accepted';
    record({ kind: 'observe', type: m.contentType, field: fieldName, outcome, status: r.status, message: r.message, persisted: stored });
    if (r.status !== null) expect.soft(r.status, `${m.contentType}.${fieldName}：不該回 5xx`).toBeLessThan(500);
  });
}

/** API 直打（繞過前端），強制斷言 4xx */
async function apiRejected(m: MaterialRecord, fieldName: string, body: Body, knownGap?: string) {
  await withRestore(m, async () => {
    if (knownGap) test.fail(true, knownGap);
    await apiFieldCheck(api, {
      path: `marketing/materials/${m.id}`,
      method: 'patch',
      payload: { body },
      expect: 'reject',
      context: `${m.contentType}.${fieldName}（API 直打）`,
    });
  });
}

/** API 直打觀察：沒有確定規格，只記錄（apiFieldCheck 會強制斷言，故觀察型不走它） */
async function apiObserve(m: MaterialRecord, fieldName: string, body: Body, persisted?: (b: Body) => unknown) {
  await withRestore(m, async () => {
    const res = await api.patch(`marketing/materials/${m.id}`, { data: { body } });
    const resBody = await res.json().catch(() => ({}));
    const stored = res.ok() && persisted ? persisted((await getMaterial(api, m.id)).body) : undefined;
    record({ kind: 'api-observe', type: m.contentType, field: fieldName, status: res.status(), code: resBody?.error?.code, message: typeof resBody?.error?.message === 'string' ? resBody.error.message.slice(0, 300) : undefined, persisted: stored });
    expect.soft(res.status(), `${m.contentType}.${fieldName}（API 直打）不該 5xx`).toBeLessThan(500);
  });
}

/** 觀察欄位的前端長度上限：填入 n 字後實際留下幾字 */
async function observeMaxLength(page: Page, m: MaterialRecord, fieldName: string, loc: (p: Page) => Locator, n: number) {
  await gotoEdit(page, m.id, m.name);
  await setVal(loc(page), strOfLength(n, '字'));
  record({ kind: 'attr', type: m.contentType, field: fieldName, maxLength: await loc(page).getAttribute('maxlength'), filled: n, kept: (await loc(page).inputValue()).length });
}

// ───────────────────────────────────────────────────────────────────────
// 素材名稱（所有型別共用同一段前後端邏輯，在 line_text 上測一次）
// ───────────────────────────────────────────────────────────────────────

test.describe('素材名稱', () => {
  const m = useProbeMaterial('line', 'line_text', { text: `${E2E_PREFIX} 名稱探測 ${RUN_TAG}` });

  test('name 空值 → 被擋', async ({ page }) => {
    await probeRejected(page, m(), 'name=(空)', (p) => setVal(nameInput(p), ''));
  });
  test('name 純空白 → 被擋', async ({ page }) => {
    await probeRejected(page, m(), 'name="   "', (p) => setVal(nameInput(p), '   '));
  });
  test('name 201 字 → 被擋（後端上限 200）', async ({ page }) => {
    await probeRejected(page, m(), 'name=201 字', (p) => setVal(nameInput(p), `${E2E_PREFIX}${strOfLength(196, '名')}`));
  });
});

// ───────────────────────────────────────────────────────────────────────
// LINE（後端已確認會擋：強制斷言）
// ───────────────────────────────────────────────────────────────────────

test.describe('line_text 欄位探測', () => {
  const m = useProbeMaterial('line', 'line_text', { text: `${E2E_PREFIX} 欄位探測 ${RUN_TAG}` });
  const textArea = (p: Page) => p.getByPlaceholder('輸入要發送的文字訊息');

  test('text 空值 → 被擋', async ({ page }) => {
    await probeRejected(page, m(), 'text=(空)', (p) => setVal(textArea(p), ''));
  });
  test('觀察：text 純空白', async ({ page }) => {
    await probeObserve(page, m(), 'text="   "', (p) => setVal(textArea(p), '   '), (b) => b.text);
  });
  test('觀察：text 長度上限（前端 5001 字、API 直打 5001 字與數字型別）', async ({ page }) => {
    await observeMaxLength(page, m(), 'text', textArea, 5001);
    await apiObserve(m(), 'text=5001 字', { text: strOfLength(5001, '字') }, (b) => String(b.text).length);
    await apiObserve(m(), 'text=12345（數字型別）', { text: 12345 }, (b) => b.text);
  });
});

test.describe('line_image 欄位探測', () => {
  const m = useProbeMaterial('line', 'line_image', { mediaUrl: IMG, previewUrl: IMG });
  const urlBox = (p: Page) => field(p, '圖片', { exact: true });

  for (const [label, value] of [
    ['javascript:', JS_URL],
    ['非 HTTPS', 'http://example.com/a.jpg'],
    ['空值', ''],
    ['非網址 notaurl', 'notaurl'],
  ] as const) {
    test(`mediaUrl ${label} → 被擋`, async ({ page }) => {
      await probeRejected(page, m(), `mediaUrl=${value || '(空)'}`, (p) => setVal(urlBox(p), value));
    });
  }
  test('觀察：只換主圖、縮圖保留新建時的預設相對路徑', async () => {
    await apiObserve(m(), 'previewUrl=/material-samples/cafe.jpeg', { mediaUrl: IMG, previewUrl: '/material-samples/cafe.jpeg' }, (b) => b.previewUrl);
  });
});

test.describe('line_video 欄位探測', () => {
  const m = useProbeMaterial('line', 'line_video', { videoUrl: 'https://example.com/e2e-probe.mp4', previewImageUrl: IMG });
  const videoBox = (p: Page) => p.getByPlaceholder('https://example.com/video.mp4');
  const thumbBox = (p: Page) => p.getByPlaceholder('影片預覽圖（jpg / png）');

  for (const [label, value] of [
    ['YouTube 分享連結', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['空值', ''],
    ['javascript:', JS_URL],
    ['非 HTTPS', 'http://example.com/a.mp4'],
  ] as const) {
    test(`videoUrl ${label} → 被擋`, async ({ page }) => {
      await probeRejected(page, m(), `videoUrl=${value || '(空)'}`, (p) => setVal(videoBox(p), value));
    });
  }
  for (const [label, value] of [['空值', ''], ['javascript:', JS_URL]] as const) {
    test(`previewImageUrl ${label} → 被擋`, async ({ page }) => {
      await probeRejected(page, m(), `previewImageUrl=${value || '(空)'}`, (p) => setVal(thumbBox(p), value));
    });
  }
});

test.describe('line_carousel 欄位探測', () => {
  const m = useProbeMaterial('line', 'line_carousel', {
    pageType: 'product',
    pages: [{
      imageUrl: IMG, title: 'E2E 探測', description: 'E2E 說明',
      price: { currency: 'NT$', amount: '100' },
      action1: { type: 'uri', label: '看看', uri: 'https://example.com/e2e' },
    }],
  });
  const a1Uri = (p: Page) => p.getByPlaceholder('https://... 或 tel:0912345678').first();
  const a1Label = (p: Page) => p.getByPlaceholder('輸入動作標籤').first();
  const title = (p: Page) => p.getByPlaceholder('輸入標題');

  for (const [label, value] of [['javascript:', JS_URL], ['空值', ''], ['無 scheme example.com', 'example.com']] as const) {
    test(`pages[0].action1.uri ${label} → 被擋`, async ({ page }) => {
      await probeRejected(page, m(), `pages[0].action1.uri=${value || '(空)'}`, (p) => setVal(a1Uri(p), value));
    });
  }
  test('pages[0].action1.label 空值 → 被擋', async ({ page }) => {
    await probeRejected(page, m(), 'pages[0].action1.label=(空)', (p) => setVal(a1Label(p), ''));
  });
  test('pages[0].imageUrl javascript: → 被擋', async ({ page }) => {
    // 卡片編輯器同時只顯示目前頁的一個圖片欄位
    await probeRejected(page, m(), `pages[0].imageUrl=${JS_URL}`, (p) => setVal(p.getByPlaceholder('圖片網址'), JS_URL));
  });
  test('觀察：pages[0].title 空值（標題非必填）', async ({ page }) => {
    await probeObserve(page, m(), 'pages[0].title=(空)', (p) => setVal(title(p), ''), (b) => (b.pages as Body[])[0].title);
  });
  test('觀察：長度與頁數上限（前端 title 21 字／label 16 字；API 直打 title 60 字、13 頁）', async ({ page }) => {
    await observeMaxLength(page, m(), 'pages[0].title', title, 21);
    await observeMaxLength(page, m(), 'pages[0].action1.label', a1Label, 16);
    const longTitle = clone(m().body) as { pages: Body[] };
    longTitle.pages[0].title = strOfLength(60, '標');
    await apiObserve(m(), 'pages[0].title=60 字', longTitle, (b) => String((b.pages as Body[])[0].title).length);
    const thirteen = clone(m().body) as { pages: Body[] };
    thirteen.pages = Array.from({ length: 13 }, () => clone(thirteen.pages[0]));
    await apiObserve(m(), 'pages=13 頁', thirteen, (b) => (b.pages as unknown[]).length);
  });
});

test.describe('line_imagemap 欄位探測', () => {
  const m = useProbeMaterial('line', 'line_imagemap', {
    baseImageUrl: 'https://example.com/e2e-probe-imagemap', layoutId: 'lo_700_2v', width: 1040, height: 700,
    areas: [
      { x: 0, y: 0, width: 520, height: 700, action: { type: 'uri', label: '左', uri: 'https://example.com/left' } },
      { x: 520, y: 0, width: 520, height: 700, action: { type: 'message', label: '右', text: 'E2E 右' } },
    ],
  });
  const uriBox = (p: Page) => p.getByPlaceholder('https://... 或 tel:0912345678').first();
  const baseBox = (p: Page) => field(p, '底圖 *', { exact: true });

  test('底圖比例不符（800×800，版型 1040×700）→ 前端擋下不上傳', async ({ page }) => {
    await gotoEdit(page, m().id, m().name);
    let uploaded = false;
    page.on('request', (req) => {
      if (/\/files\/imagemap-upload$/.test(req.url())) uploaded = true;
    });
    const chooserP = page.waitForEvent('filechooser');
    await section(page, '底圖 *', true).getByRole('button', { name: '上傳', exact: true }).click();
    await (await chooserP).setFiles({ name: 'wrong.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 800, 800, 'wrong ratio') });
    await expect(page.getByText(/圖片比例與版型不符/)).toBeVisible();
    expect(uploaded, '比例不符的底圖不應送出上傳').toBe(false);
  });
  for (const [label, value] of [['javascript:', JS_URL], ['空值', '']] as const) {
    test(`areas[0].action.uri ${label} → 被擋`, async ({ page }) => {
      await probeRejected(page, m(), `areas[0].action.uri=${value || '(空)'}`, (p) => setVal(uriBox(p), value));
    });
    test(`baseImageUrl ${label} → 被擋`, async ({ page }) => {
      await probeRejected(page, m(), `baseImageUrl=${value || '(空)'}`, (p) => setVal(baseBox(p), value));
    });
  }
  test('areas[1].action.text 空值 → 被擋', async ({ page }) => {
    await probeRejected(page, m(), 'areas[1].action.text=(空)', (p) => setVal(p.getByPlaceholder('點擊後送出的文字').first(), ''));
  });
});

// ───────────────────────────────────────────────────────────────────────
// FB（後端目前沒有內容檢查：強制斷言應被擋 + test.fail，待修正 PR 合併後移除）
// 範圍依 openspec/changes/validate-fb-material-content 的需求
// ───────────────────────────────────────────────────────────────────────

test.describe('fb_text 欄位探測', () => {
  const m = useProbeMaterial('fb', 'fb_text', { text: `${E2E_PREFIX} 欄位探測 ${RUN_TAG}` });
  const textArea = (p: Page) => p.getByPlaceholder('輸入要發送的文字訊息');

  test('text 空值 → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'text=(空)', (p) => setVal(textArea(p), ''));
  });
  test('text 純空白 → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'text="   "', (p) => setVal(textArea(p), '   '));
  });
  test('text 2001 字（API 直打，上限 2000）→ 應被擋', async () => {
    await apiRejected(m(), 'text=2001 字', { text: strOfLength(2001, '字') });
  });
  test('觀察：text 前端長度上限', async ({ page }) => {
    await observeMaxLength(page, m(), 'text', textArea, 2001);
  });
});

test.describe('fb_image 欄位探測', () => {
  const m = useProbeMaterial('fb', 'fb_image', { url: IMG });
  const urlBox = (p: Page) => field(p, '圖片', { exact: true });

  for (const [label, value] of [['javascript:', JS_URL], ['空值', ''], ['非網址 notaurl', 'notaurl'], ...HOSTLESS_URLS] as const) {
    test(`url ${label} → 應被擋`, async ({ page }) => {
      await probeRejected(page, m(), `url=${value || '(空)'}`, (p) => setVal(urlBox(p), value));
    });
  }
});

test.describe('fb_video 欄位探測', () => {
  const m = useProbeMaterial('fb', 'fb_video', { url: 'https://example.com/e2e-probe.mp4' });
  const urlBox = (p: Page) => p.getByPlaceholder('https://...mp4');

  for (const [label, value] of [['javascript:', JS_URL], ['空值', ''], ...HOSTLESS_URLS] as const) {
    test(`url ${label} → 應被擋`, async ({ page }) => {
      await probeRejected(page, m(), `url=${value || '(空)'}`, (p) => setVal(urlBox(p), value));
    });
  }
  test('觀察：url 為 YouTube 分享連結', async ({ page }) => {
    await probeObserve(page, m(), 'url=YouTube', (p) => setVal(urlBox(p), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'), (b) => b.url);
  });
});

test.describe('fb_generic 欄位探測', () => {
  const m = useProbeMaterial('fb', 'fb_generic', {
    elements: [
      { title: 'E2E 商品 A', subtitle: 'NT$ 1', image_url: IMG, buttons: [{ type: 'web_url', title: '看看', url: 'https://example.com/a' }] },
      { title: 'E2E 商品 B', image_url: IMG },
    ],
  });
  const titles = (p: Page) => p.getByPlaceholder('商品標題');

  test('elements[0].image_url javascript: → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), `elements[0].image_url=${JS_URL}`, (p) => setVal(field(fbCard(p, 1), '圖片'), JS_URL));
  });
  test('elements[0].title 空值 → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'elements[0].title=(空)', (p) => setVal(titles(p).first(), ''));
  });
  test('刪光所有卡片（0 張）→ 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'elements=0 張', async (p) => {
      const count = await titles(p).count();
      for (let i = 0; i < count; i++) {
        // 卡片標頭的第一顆按鈕是刪除；刪掉後下一張遞補為「卡片 1」
        await fbCard(p, 1).getByRole('button').first().click();
        await expect(titles(p)).toHaveCount(count - i - 1);
      }
    });
  });
  test('11 張卡片（API 直打，上限 10）→ 應被擋', async () => {
    await apiRejected(m(), 'elements=11 張', { elements: Array.from({ length: 11 }, (_, i) => ({ title: `E2E ${i}` })) });
  });
});

test.describe('fb_button 欄位探測', () => {
  const m = useProbeMaterial('fb', 'fb_button', {
    text: `${E2E_PREFIX} 欄位探測`,
    buttons: [
      { type: 'postback', title: '查訂單', payload: 'menu:order' },
      { type: 'postback', title: '查商品', payload: 'menu:product' },
      { type: 'web_url', title: '官網', url: 'https://example.com' },
    ],
  });
  const mainText = (p: Page) => field(p, '主要訊息');
  const btnTitles = (p: Page) => p.getByPlaceholder('按鈕文字');

  test('text 空值 → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'text=(空)', (p) => setVal(mainText(p), ''));
  });
  test('buttons[2].url javascript: → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), `buttons[2].url=${JS_URL}`, (p) => setVal(p.getByPlaceholder('網址', { exact: true }).first(), JS_URL));
  });
  test('buttons[0].title 空值 → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'buttons[0].title=(空)', (p) => setVal(btnTitles(p).first(), ''));
  });
  test('刪光所有按鈕（0 顆）→ 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'buttons=0 顆', async (p) => {
      const count = await btnTitles(p).count();
      for (let i = 0; i < count; i++) {
        // 每列：按鈕文字、網址／回傳資料、刪除鈕
        await p.locator('div:has(> input[placeholder="按鈕文字"])').first().getByRole('button').click();
        await expect(btnTitles(p)).toHaveCount(count - i - 1);
      }
    });
  });
  test('4 顆按鈕（API 直打，上限 3）→ 應被擋', async () => {
    const body = clone(m().body) as { buttons: Body[] };
    body.buttons.push({ type: 'postback', title: '第四顆', payload: 'menu:4' });
    await apiRejected(m(), 'buttons=4 顆', body);
  });
  test('text 700 字（API 直打，上限 640）→ 應被擋', async () => {
    await apiRejected(m(), 'text=700 字', { ...m().body, text: strOfLength(700, '字') });
  });
});

test.describe('fb_media 欄位探測', () => {
  const m = useProbeMaterial('fb', 'fb_media', { media_type: 'image', url: IMG });
  const mediaType = (p: Page) => p.getByPlaceholder('image / video');

  for (const [label, value] of [['abc（非 image/video）', 'abc'], ['空值', '']] as const) {
    test(`media_type ${label} → 應被擋`, async ({ page }) => {
      await probeRejected(page, m(), `media_type=${value || '(空)'}`, (p) => setVal(mediaType(p), value));
    });
  }
  test('url javascript: → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), `url=${JS_URL}`, (p) => setVal(field(p, '媒體網址'), JS_URL));
  });
  test('url 與 attachment_id 皆空 → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'url+attachment_id=(皆空)', async (p) => {
      await setVal(field(p, '媒體網址'), '');
      await setVal(field(p, 'attachment_id'), '');
    });
  });
});

test.describe('fb_coupon 欄位探測', () => {
  const m = useProbeMaterial('fb', 'fb_coupon', {
    title: 'E2E 會員 8 折', subtitle: 'E2E 限時', coupon_pre_message: 'E2E 感謝支持',
    coupon_code: 'E2EPROBE', image_url: IMG, payload: 'e2e_probe',
  });
  const title = (p: Page) => field(p, '優惠券標題');

  test('title 空值 → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'title=(空)', (p) => setVal(title(p), ''));
  });
  test('image_url javascript: → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), `image_url=${JS_URL}`, (p) => setVal(field(p, '優惠券圖片'), JS_URL));
  });
  test('title 81 字（API 直打，上限 80）→ 應被擋', async () => {
    await apiRejected(m(), 'title=81 字', { ...m().body, title: strOfLength(81, '券') });
  });
  test('觀察：coupon_code 空值、含空格（API 直打）、title 前端長度上限', async ({ page }) => {
    await probeObserve(page, m(), 'coupon_code=(空)', (p) => setVal(field(p, '折扣碼'), ''), (b) => b.coupon_code);
    await apiObserve(m(), 'coupon_code="AB C"', { ...m().body, coupon_code: 'AB C' }, (b) => b.coupon_code);
    await observeMaxLength(page, m(), 'title', title, 81);
  });
});

test.describe('fb_receipt 欄位探測', () => {
  const m = useProbeMaterial('fb', 'fb_receipt', {
    recipient_name: 'E2E 王小明', order_number: `E2E-${RUN_TAG}`, currency: 'TWD',
    payment_method: 'Visa **4242', merchant_name: 'E2E 測試商店', summary: { total_cost: 650 },
  });
  const total = (p: Page) => field(p, '總金額', { role: 'spinbutton' });

  test('recipient_name 空值 → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'recipient_name=(空)', (p) => setVal(field(p, '收件人'), ''));
  });
  test('order_number 空值 → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'order_number=(空)', (p) => setVal(field(p, '訂單編號'), ''));
  });
  test('summary.total_cost -999 → 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'summary.total_cost=-999', (p) => setVal(total(p), '-999'));
  });
  test('currency XYZ1（非三個大寫字母）→ 應被擋', async ({ page }) => {
    await probeRejected(page, m(), 'currency=XYZ1', (p) => setVal(field(p, '幣別'), 'XYZ1'));
  });
  test('觀察：清空總金額（編輯器會轉成 0，屬合法值）', async ({ page }) => {
    await probeObserve(page, m(), 'summary.total_cost=(清空)', (p) => setVal(total(p), ''), (b) => b.summary);
  });
});

test.describe('fb_feedback 欄位探測', () => {
  const m = useProbeMaterial('fb', 'fb_feedback', {
    title: 'E2E 您對本次服務的滿意度？', subtitle: 'E2E 副標題', question_type: 'csat', expires_in_days: 7,
  });
  const days = (p: Page) => field(p, '有效天數', { role: 'spinbutton' });
  const title = (p: Page) => field(p, '標題', { exact: true });

  for (const [label, value] of [['-1', '-1'], ['清空（編輯器轉成 0）', ''], ['9999', '9999']] as const) {
    test(`expires_in_days ${label} → 應被擋（規格 1–7）`, async ({ page }) => {
      await probeRejected(page, m(), `expires_in_days=${value || '(清空)'}`, (p) => setVal(days(p), value));
    });
  }
  test('觀察：title 空值與前端長度上限', async ({ page }) => {
    await probeObserve(page, m(), 'title=(空)', (p) => setVal(title(p), ''), (b) => b.title);
    await observeMaxLength(page, m(), 'title', title, 100);
  });
});
