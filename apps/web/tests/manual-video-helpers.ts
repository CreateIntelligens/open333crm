/**
 * 手冊操作影片錄製工具。
 *
 * 每支影片 = 一個獨立 browser context（Playwright recordVideo），
 * 畫面上疊「繁中字幕」與「點擊提示圈」，全程以 MutationObserver 去識別化，
 * 錄完用 ffmpeg 轉成 H.264 mp4 放到 public/manual/uploads/videos/。
 *
 * ⚠️ 正式環境：腳本只能開表單、填示範文字、按「取消」，絕不按送出/發送/刪除。
 */
import { Browser, BrowserContext, Page, Locator } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { BASE_URL } from './manual-helpers';

export const VIDEOS_DIR = path.resolve(__dirname, '..', 'public/manual/uploads/videos');
fs.mkdirSync(VIDEOS_DIR, { recursive: true });

const SIZE = { width: 1280, height: 800 };

/** 注入每個頁面：字幕容器、點擊圈樣式、持續去識別化 */
const INIT_SCRIPT = `(() => {
  const css = \`
    #mv-cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;
      max-width:80%;padding:10px 22px;border-radius:12px;background:rgba(17,12,30,.86);color:#fff;
      font:600 20px/1.5 "PingFang TC","Noto Sans TC",sans-serif;letter-spacing:.02em;
      box-shadow:0 8px 30px rgba(0,0,0,.25);pointer-events:none;transition:opacity .25s}
    #mv-cap:empty{opacity:0}
    .mv-ring{position:fixed;z-index:2147483646;border:3px solid #F97316;border-radius:10px;
      box-shadow:0 0 0 6px rgba(249,115,22,.25);pointer-events:none;transition:all .25s}
    .mv-dot{position:fixed;z-index:2147483647;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
      background:rgba(249,115,22,.45);border:2px solid #F97316;pointer-events:none;animation:mvp .6s ease-out forwards}
    @keyframes mvp{from{transform:scale(.4);opacity:1}to{transform:scale(1.6);opacity:0}}
    img,[class*="avatar" i]{filter:blur(7px)!important}
  \`;
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g;
  const phoneRe = /09\\d{2}[-\\s]?\\d{3}[-\\s]?\\d{3}/g;
  const keep = /@(example\\.com|open333crm\\.dev)$/;
  function scrub(root){
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      const p = n.parentElement; if (p && p.closest('#mv-cap')) continue;
      const t = n.textContent || ''; let o = t;
      o = o.replace(emailRe, m => keep.test(m) ? m : 'member@example.com');
      o = o.replace(phoneRe, '09xx-xxx-xxx');
      if (o !== t) n.textContent = o;
    }
  }
  function boot(){
    if (!document.getElementById('mv-style')) {
      const s = document.createElement('style'); s.id='mv-style'; s.textContent = css; document.head.appendChild(s);
    }
    if (!document.getElementById('mv-cap')) {
      const c = document.createElement('div'); c.id='mv-cap'; document.body.appendChild(c);
      if (window.__mvCap) c.textContent = window.__mvCap;
    }
    scrub(document.body);
    new MutationObserver(ms => { for (const m of ms) for (const a of m.addedNodes) {
      if (a.nodeType===1) scrub(a); else if (a.nodeType===3 && a.parentElement) scrub(a.parentElement);
    }}).observe(document.body,{childList:true,subtree:true,characterData:false});
    // 原生 <dialog> 開在 top layer，會蓋住字幕與點擊框 → 把它們搬進最上層的 dialog
    const lift = () => {
      const d = [...document.querySelectorAll('dialog[open]')].pop();
      const host = d || document.body;
      const cap = document.getElementById('mv-cap');
      if (cap && cap.parentElement !== host) host.appendChild(cap);
      document.querySelectorAll('.mv-ring,.mv-dot').forEach(r => { if (r.parentElement !== host) host.appendChild(r); });
    };
    new MutationObserver(lift).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();`;

export interface Recorder {
  context: BrowserContext;
  page: Page;
  name: string;
}

/** 影片開始時間與第一句字幕時間，用來剪掉開頭載入空白 */
const timing = new WeakMap<Page, { t0: number; first?: number }>();

/**
 * 正式環境保險：擋下所有會改資料的 API 請求（非 GET），只放行登入續期
 * 與呼叫端明確列出的「唯讀但用 POST」端點（例如語義搜尋、分群人數預覽）。
 * 被擋的請求印在 console，前端會看到網路錯誤——錄影時本來就不該按送出。
 */
export async function guardWrites(context: BrowserContext, allowPost: RegExp[] = []) {
  // 手冊畫面不要出現右緣的 WebTalk 協作工具列（第三方 SDK，非 CRM 本身功能）
  await context.route('https://webtalk-nine.vercel.app/**', (route) => route.abort('blockedbyclient'));
  await context.route('**/api/v1/**', (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'GET' || req.method() === 'OPTIONS') return route.continue();
    if (url.includes('/auth/refresh')) return route.continue();
    if (allowPost.some((re) => re.test(url))) return route.continue();
    console.log(`🛡️ 已攔截寫入請求 ${req.method()} ${url.replace(/^.*\/api\/v1/, '')}`);
    return route.abort('blockedbyclient');
  });
}

export async function startRecording(
  browser: Browser,
  name: string,
  opts: { storageState?: string; allowPost?: RegExp[] } = {},
): Promise<Recorder> {
  const storageState = opts.storageState ?? 'auth-state.json';
  const context = await browser.newContext({
    storageState,
    viewport: SIZE,
    ignoreHTTPSErrors: true,
    recordVideo: { dir: path.join(VIDEOS_DIR, '_raw'), size: SIZE },
  });
  await context.addInitScript(INIT_SCRIPT);
  await guardWrites(context, opts.allowPost);
  const page = await context.newPage();
  timing.set(page, { t0: Date.now() });
  return { context, page, name };
}

/** 顯示字幕（停留 ms 毫秒讓觀眾讀完） */
export async function caption(page: Page, text: string, ms = 2200) {
  const tm = timing.get(page);
  if (tm && tm.first === undefined && text) tm.first = Date.now();
  await page.evaluate((t) => {
    (window as any).__mvCap = t;
    const c = document.getElementById('mv-cap');
    if (c) c.textContent = t;
  }, text);
  await page.waitForTimeout(ms);
}

/** 框出元素（提示「看這裡」），不點擊 */
export async function point(page: Page, locator: Locator, ms = 1400) {
  const el = locator.first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox();
  if (!box) return;
  await page.evaluate((b) => {
    document.querySelectorAll('.mv-ring').forEach((r) => r.remove());
    const r = document.createElement('div');
    r.className = 'mv-ring';
    Object.assign(r.style, { left: `${b.x - 6}px`, top: `${b.y - 6}px`, width: `${b.width + 12}px`, height: `${b.height + 12}px` });
    document.body.appendChild(r);
  }, box);
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.querySelectorAll('.mv-ring').forEach((r) => r.remove()));
}

/** 框出 → 點擊（顯示點擊波紋） */
export async function tap(page: Page, locator: Locator, waitAfter = 1200) {
  const el = locator.first();
  await point(page, el, 700);
  const box = await el.boundingBox();
  if (box) {
    await page.evaluate((b) => {
      const d = document.createElement('div');
      d.className = 'mv-dot';
      d.style.left = `${b.x + b.width / 2}px`;
      d.style.top = `${b.y + b.height / 2}px`;
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 700);
    }, box);
  }
  await el.click();
  await page.waitForTimeout(waitAfter);
}

/** 逐字輸入（看起來像真人在打字） */
export async function typeIn(page: Page, locator: Locator, text: string) {
  const el = locator.first();
  await point(page, el, 500);
  await el.click();
  await el.pressSequentially(text, { delay: 60 });
  await page.waitForTimeout(600);
}

export async function go(page: Page, pathname: string) {
  await page.goto(`${BASE_URL}${pathname}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if (page.url().includes('/login')) throw new Error('登入狀態失效，請重跑 capture-auth-api.ts');
}

/** 結束錄影並轉 mp4，回傳 mp4 路徑 */
export async function stopRecording(rec: Recorder): Promise<string> {
  await caption(rec.page, '', 300);
  const video = rec.page.video();
  await rec.context.close();
  if (!video) throw new Error('沒有錄到影片');
  const raw = await video.path();
  const out = path.join(VIDEOS_DIR, `${rec.name}.mp4`);
  const tm = timing.get(rec.page);
  const skip = tm?.first ? Math.max(0, (tm.first - tm.t0) / 1000 - 0.6) : 0;
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-ss', skip.toFixed(2), '-i', raw,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-an', out,
  ]);
  fs.unlinkSync(raw);
  console.log(`🎬 ${rec.name}.mp4`);
  return out;
}

/** 從影片抽一張封面圖（poster） */
export function poster(name: string, atSec = 1) {
  const mp4 = path.join(VIDEOS_DIR, `${name}.mp4`);
  const jpg = path.join(VIDEOS_DIR, `${name}.jpg`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(atSec), '-i', mp4, '-frames:v', '1', '-q:v', '4', jpg]);
}

/** 截圖用頁面：同樣有寫入保險與持續去識別化，但不錄影（1440×900） */
export async function newShotPage(
  browser: Browser,
  opts: { storageState?: string; allowPost?: RegExp[] } = {},
): Promise<Page> {
  const context = await browser.newContext({
    storageState: opts.storageState ?? 'auth-state.json',
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  await context.addInitScript(INIT_SCRIPT);
  await guardWrites(context, opts.allowPost);
  return context.newPage();
}
