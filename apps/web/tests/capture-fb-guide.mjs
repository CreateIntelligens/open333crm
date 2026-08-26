// capture-fb-guide.mjs
// 連上「已開 debugging port 的 CDP Chrome」，找到 Meta for Developers 後台分頁，
// 隱碼機密後，截 App ID/Secret（Basic settings）與 Page Access Token（Messenger）兩張圖寫檔。
//
// 前提：Chrome 以 --remote-debugging-port=9222 --user-data-dir=~/.chrome-cdp-profile 啟動，
//       且已登入 https://developers.facebook.com/ 並進入你的 App。
//
// 跑法：node apps/web/tests/capture-fb-guide.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../public/channel-guide/fb');
mkdirSync(OUT_DIR, { recursive: true });

// 就地隱碼：遮 App Secret（hex）、Access Token（EAA... 長字串）等
const MASK_FN = () => {
  const maskLong = (t) => t
    .replace(/\bEAA[A-Za-z0-9]{20,}\b/g, 'EAA••••••••••••••••••••••••••••••')  // Page access token
    .replace(/\b[A-Za-z0-9+/=]{40,}\b/g, '••••••••••••••••••••••••••••••••••••••••')
    .replace(/\b[0-9a-f]{28,}\b/gi, '••••••••••••••••••••••••••••••')           // app secret（32 hex）
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'you@example.com'); // email 個資
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = []; let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) {
    const m = maskLong(node.textContent);
    if (m !== node.textContent) node.textContent = m;
  }
  document.querySelectorAll('input,textarea').forEach((el) => {
    if (el.value && /EAA[A-Za-z0-9]{20,}|[A-Za-z0-9+/=]{40,}|[0-9a-f]{28,}/i.test(el.value)) {
      el.value = '••••••••••••••••••••••••••••••';
    }
  });
};

// 用文字標籤定位、往下 clip 截一塊。
// Meta 後台內容在 iframe 內：在每個 frame 用 getBoundingClientRect 取元素座標
// （相對主視窗），再用 page.screenshot({ clip }) 截。繞過 locator 的 iframe 限制。
async function clipByLabel(page, labelText, height = 130, out, { xFromLeft = true } = {}) {
  for (const f of [page.mainFrame(), ...page.frames()]) {
    const box = await f.evaluate((txt) => {
      const els = [...document.querySelectorAll('*')];
      // 先找純文字葉節點完全等於，再退回 includes
      let el = els.find((e) => e.children.length === 0 && e.textContent.trim() === txt);
      if (!el) el = els.find((e) => e.children.length === 0 && e.textContent.trim().includes(txt));
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
    }, labelText).catch(() => null);
    if (!box) continue;
    await page.waitForTimeout(400);
    // 重新量一次（scrollIntoView 後座標會變）
    const box2 = await f.evaluate((txt) => {
      const els = [...document.querySelectorAll('*')];
      let el = els.find((e) => e.children.length === 0 && e.textContent.trim() === txt)
        || els.find((e) => e.children.length === 0 && e.textContent.trim().includes(txt));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y) };
    }, labelText).catch(() => null);
    const bx = box2 || box;
    const startX = xFromLeft ? Math.max(0, bx.x - 30) : 200;
    const clip = {
      x: startX,
      y: Math.max(0, bx.y - 25),
      width: Math.min(1150, 1500 - startX),
      height,
    };
    await page.screenshot({ path: out, clip });
    return true;
  }
  console.warn(`  ⚠️ 找不到「${labelText}」`);
  return false;
}

(async () => {
  console.log('→ 連線到 CDP Chrome (9222)...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');

  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes('developers.facebook.com')) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.error('❌ 找不到 developers.facebook.com 分頁，請先登入 Meta 開發者後台並進入你的 App'); process.exit(1); }
  console.log(`  找到 Meta 後台分頁：${page.url().slice(0, 70)}`);

  const appId = page.url().match(/\/apps\/(\d+)/)?.[1];
  if (!appId) { console.warn('  ⚠️ 網址看不出 App ID，將只截目前畫面'); }

  // ── 1. App ID + App Secret（設定 → 基本資料）──
  // Meta 後台為中文介面：「應用程式編號」=App ID、「應用程式密鑰」=App Secret
  console.log('→ 截 應用程式編號 / 密鑰（基本資料）...');
  if (appId) {
    await page.goto(`https://developers.facebook.com/apps/${appId}/settings/basic/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
  }
  await page.evaluate(MASK_FN);
  await page.waitForTimeout(300);
  const ok1 = await clipByLabel(page, '應用程式編號', 260, `${OUT_DIR}/fb-app-basic.png`)
    || await clipByLabel(page, 'App ID', 260, `${OUT_DIR}/fb-app-basic.png`);
  if (ok1) console.log('  ✅ fb-app-basic.png');

  // ── 2. Page Access Token（Messenger → 產生存取權杖）──
  console.log('→ 截 產生存取權杖（Messenger）...');
  if (appId) {
    await page.goto(`https://developers.facebook.com/apps/${appId}/messenger/messenger_api_settings/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3500);
  }
  await page.evaluate(MASK_FN);
  await page.waitForTimeout(300);
  const ok2 = await clipByLabel(page, '產生存取權杖', 240, `${OUT_DIR}/fb-page-token.png`)
    || await clipByLabel(page, '存取權杖', 240, `${OUT_DIR}/fb-page-token.png`)
    || await clipByLabel(page, 'Generate token', 240, `${OUT_DIR}/fb-page-token.png`);
  if (ok2) console.log('  ✅ fb-page-token.png');
  else console.warn('  ⚠️ 存取權杖區塊未截到');

  console.log(`\n完成。圖存於 ${OUT_DIR}`);
  await browser.close();
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
