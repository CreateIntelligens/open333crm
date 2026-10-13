/**
 * 素材庫 E2E 共用工具（tenant-materials-all-types.spec.ts 與
 * manual-material-field-probes.spec.ts 共用）。
 *
 * 不是 spec 檔（不以 .spec.ts 結尾），playwright.uat.config.ts 的 testMatch 不會選到它。
 */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { E2E_PREFIX, gotoAndCheck } from './helpers';
import { submitAndObserve, type SubmitResult } from './field-helpers';

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();

/**
 * 本次執行的識別碼：日期時間到秒＋隨機碼。
 * 只到分鐘時，同一分鐘內重跑（或兩個 worker 同時載入）會產生同名素材。
 */
export const RUN_TAG =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
  `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-` +
  randomUUID().slice(0, 6);

export const MATERIALS_PATH = '/dashboard/marketing/materials';

// ───────────────────────────────────────────────────────────────────────
// 定位
// ───────────────────────────────────────────────────────────────────────

export const nameInput = (p: Page) => p.getByPlaceholder('如：母親節新品推播');
export const saveBtn = (p: Page) => p.getByRole('button', { name: /存為素材|儲存中/ });
export const previewPane = (p: Page) => p.getByRole('complementary').filter({ hasText: '即時預覽' });
/** 編輯頁按存檔時，名稱空白會被前端擋下並顯示此提示（不送出請求） */
export const nameRequiredToast = (p: Page) => p.getByText('素材名稱必填', { exact: true });

/**
 * 以 label 文字找出「label 與其欄位」所在的那一層 div。
 * 編輯器的 label 都沒有 htmlFor 綁定，getByLabel 抓不到；
 * label 與欄位是同一個 div 的直接子元素，所以用 `div:has(> label…)` 鎖定該層。
 *
 * @param exact true 時 label 文字須完全相同（例如「標題」不可誤中「副標題」）
 */
export function section(p: Page | Locator, label: string, exact = false): Locator {
  const sel = exact ? `label:text-is("${label}")` : `label:has-text("${label}")`;
  return p.locator(`div:has(> ${sel})`);
}

/** section 內的輸入欄位（textbox = input/textarea；spinbutton = number；combobox = select） */
export function field(
  p: Page | Locator,
  label: string,
  opts: { role?: 'textbox' | 'spinbutton' | 'combobox'; exact?: boolean } = {},
): Locator {
  return section(p, label, opts.exact).getByRole(opts.role ?? 'textbox');
}

/** FB 商品輪播的第 n 張卡片（1 起算）：卡片標頭是 <strong>卡片 n</strong> */
export const fbCard = (p: Page, n: number) => p.locator(`div:has(> div > strong:text-is("卡片 ${n}"))`);

// ───────────────────────────────────────────────────────────────────────
// 測試檔案產生
// ───────────────────────────────────────────────────────────────────────

/** 用頁面 canvas 產生指定尺寸的 JPEG（不依賴外部檔案） */
export async function makeJpeg(page: Page, w: number, h: number, text: string): Promise<Buffer> {
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

/** 用 ffmpeg 產生 1 秒的小 mp4；本機沒有 ffmpeg 則回 null（呼叫端自行決定 skip） */
export function makeMp4(): Buffer | null {
  const out = path.join(os.tmpdir(), `e2e-video-${RUN_TAG}.mp4`);
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

// ───────────────────────────────────────────────────────────────────────
// UI 操作
// ───────────────────────────────────────────────────────────────────────

export async function setVal(loc: Locator, value: string) {
  await loc.fill('');
  if (value) await loc.fill(value);
}

/**
 * 按 scope 內的「上傳」按鈕、從檔案選擇器送檔，回傳後端給的網址
 * （/files/upload → data.url；/files/imagemap-upload → data.baseUrl）。
 * scope 內必須只有一個上傳欄位。上傳失敗時回傳 status 與錯誤訊息，不用假網址掩蓋。
 */
export async function uploadVia(
  page: Page,
  scope: Page | Locator,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<{ ok: boolean; url: string; status: number; message?: string }> {
  const resP = page.waitForResponse(
    (r) => /\/files\/(upload|imagemap-upload)$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 60_000 },
  );
  const chooserP = page.waitForEvent('filechooser');
  await scope.getByRole('button', { name: '上傳', exact: true }).click();
  await (await chooserP).setFiles(file);
  const res = await resP;
  const body = await res.json().catch(() => ({}));
  const url = (body?.data?.baseUrl ?? body?.data?.url ?? '') as string;
  return { ok: res.ok(), url, status: res.status(), message: body?.error?.message };
}

/** 新增頁：選平台 → 選型別卡（以型別名稱＋說明文字鎖定卡片） */
export async function pickType(page: Page, channel: 'line' | 'fb', typeLabel: string, typeDesc: string) {
  await gotoAndCheck(page, `${MATERIALS_PATH}/new`);
  await expect(page.getByRole('heading', { name: '選擇訊息類型' })).toBeVisible({ timeout: 15_000 });
  if (channel === 'fb') {
    const fbBtn = page.getByRole('button', { name: /FB Messenger/ });
    await fbBtn.click();
    await expect(fbBtn).toHaveAttribute('aria-pressed', 'true');
  }
  await page
    .getByRole('button')
    .filter({ hasText: typeDesc })
    .filter({ has: page.getByText(typeLabel, { exact: true }) })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /編輯素材/ })).toBeVisible({ timeout: 15_000 });
}

/**
 * 新建頁按存檔，回傳 POST 結果。成功（201）時等跳到編輯頁才回傳，
 * 呼叫端必須立刻把 id 記下供 afterAll 清理。
 */
export async function saveNew(page: Page): Promise<SubmitResult & { id: string; message: string }> {
  const r = await submitAndObserve(
    page,
    () => saveBtn(page).click(),
    /\/marketing\/materials$/,
    'POST',
    45_000, // LINE 版型存檔時後端會呼叫 LINE validate，可能較慢
    { blockedSignal: nameRequiredToast(page) },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = r.body as any;
  const id = (body?.data?.id as string) ?? '';
  if (r.status === 201 && id) {
    await page.waitForURL(new RegExp(`${MATERIALS_PATH}/${id}$`), { timeout: 15_000 });
  }
  return { ...r, id, message: (body?.error?.message as string) ?? '' };
}

export async function gotoEdit(page: Page, id: string, expectName?: string) {
  await gotoAndCheck(page, `${MATERIALS_PATH}/${id}`);
  await expect(page.getByRole('heading', { name: /編輯素材/ })).toBeVisible({ timeout: 20_000 });
  if (expectName) await expect(nameInput(page)).toHaveValue(expectName, { timeout: 15_000 });
}

export async function expectInList(page: Page, name: string) {
  await gotoAndCheck(page, MATERIALS_PATH);
  await expect(page.getByRole('heading', { name: '訊息素材' })).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder('搜尋素材名稱').fill(name);
  await expect(page.getByRole('table').getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
}

// ───────────────────────────────────────────────────────────────────────
// API
// ───────────────────────────────────────────────────────────────────────

export interface MaterialRecord {
  id: string;
  name: string;
  contentType: string;
  body: Record<string, unknown>;
}

export async function getMaterial(api: APIRequestContext, id: string): Promise<MaterialRecord> {
  const res = await api.get(`marketing/materials/${id}`);
  expect(res.status(), `GET 素材 ${id}`).toBe(200);
  return (await res.json()).data;
}

/** 以 API 建立素材（探測用）。名稱必須帶 [E2E] 前綴，否則直接拒絕。 */
export async function createMaterialViaApi(
  api: APIRequestContext,
  input: { name: string; channelType: 'line' | 'fb'; contentType: string; body: Record<string, unknown> },
): Promise<MaterialRecord> {
  if (!input.name.startsWith(E2E_PREFIX)) throw new Error(`測試素材名稱必須以 ${E2E_PREFIX} 開頭：${input.name}`);
  const res = await api.post('marketing/materials', { data: input });
  const text = await res.text();
  expect(res.status(), `建立探測素材 ${input.contentType} 失敗：${text}`).toBe(201);
  return JSON.parse(text).data;
}

/**
 * 刪除本次建立的素材（軟刪，同 tenant-materials.spec.ts 的 DELETE marketing/materials/:id）。
 * 刪除前先讀回確認名稱帶 [E2E] 前綴，避免誤刪既有資料。
 * 任何一筆失敗都會在輸出列出 id，最後丟錯讓 afterAll 顯示失敗（不靜默）。
 */
export async function deleteMaterials(api: APIRequestContext, ids: string[]): Promise<void> {
  const failed: string[] = [];
  for (const id of ids) {
    try {
      const got = await api.get(`marketing/materials/${id}`);
      if (got.status() === 404) continue; // 已不存在
      const name: string = (await got.json().catch(() => ({})))?.data?.name ?? '';
      if (!name.startsWith(E2E_PREFIX)) {
        failed.push(`${id}（名稱「${name}」不帶 ${E2E_PREFIX}，未刪除）`);
        continue;
      }
      const res = await api.delete(`marketing/materials/${id}`);
      if (!res.ok()) failed.push(`${id}（DELETE 回 ${res.status()}：${(await res.text()).slice(0, 200)}）`);
    } catch (err) {
      failed.push(`${id}（${err instanceof Error ? err.message : String(err)}）`);
    }
  }
  if (failed.length) {
    const msg = `[CLEANUP] 以下 ${failed.length} 則測試素材刪除失敗，請手動清理：\n  ${failed.join('\n  ')}`;
    console.error(msg);
    throw new Error(msg);
  }
  if (ids.length) console.log(`[CLEANUP] 已刪除 ${ids.length} 則測試素材：${ids.join(', ')}`);
}
