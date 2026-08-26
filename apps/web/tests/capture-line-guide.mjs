// capture-line-guide.mjs
// 連上「已開著 debugging port 的 Chrome」，找到 LINE Developers Console 分頁，
// 隱碼機密後，截「Channel secret」與「Channel access token」兩張圖寫檔。
//
// 前提：Chrome 需以 --remote-debugging-port=9222 啟動，且已登入 LINE Console。
//
// 跑法：node apps/web/tests/capture-line-guide.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../public/channel-guide/line');
mkdirSync(OUT_DIR, { recursive: true });

// 就地隱碼：把長 hex / base64 機密值遮成圓點（不動版面）
const MASK_FN = () => {
  const maskLong = (t) => t
    .replace(/\b[A-Za-z0-9+/=]{40,}\b/g, '••••••••••••••••••••••••••••••••••••••••')
    .replace(/\b[0-9a-f]{20,}\b/gi, '••••••••••••••••••••••••••••••')
    .replace(/\bU[0-9a-f]{20,}\b/gi, 'U••••••••••••••••••••••••••••••');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = []; let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) {
    const m = maskLong(node.textContent);
    if (m !== node.textContent) node.textContent = m;
  }
  document.querySelectorAll('input,textarea').forEach((el) => {
    if (el.value && /[A-Za-z0-9+/=]{40,}|[0-9a-f]{20,}/i.test(el.value)) el.value = '••••••••••••••••••••••••••••••';
  });
};

(async () => {
  console.log('→ 連線到 Chrome (CDP 9222)...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  console.log(`  找到 ${contexts.length} 個 context`);

  // 找 LINE Console 的分頁
  let page = null;
  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      if (p.url().includes('developers.line.biz/console')) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.error('❌ 找不到 LINE Developers Console 分頁，請先在該分頁開啟一個 Messaging API channel'); process.exit(1); }

  const channelId = page.url().match(/channel\/(\d+)/)?.[1];
  console.log(`  找到 LINE Console 分頁 (channel ${channelId ?? '?'})`);
  const base = `https://developers.line.biz/console/channel/${channelId}`;

  // ── 1. Channel access token（Messaging API 頁）──
  console.log('→ 截 Channel access token...');
  await page.goto(`${base}/messaging-api`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.evaluate(MASK_FN);
  await page.waitForTimeout(300);
  // 定位到「Channel access token (long-lived)」這一列標籤，往下 clip 涵蓋值 + Reissue
  const tokenLabel = page.locator('text=Channel access token (long-lived)').first();
  const tokenTitle = page.locator('text=Channel access token').first();
  if (await tokenTitle.count()) {
    await tokenTitle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const titleBox = await tokenTitle.boundingBox();
    // 從標題頂端往下截約 130px（含 long-lived 標籤、隱碼值、Reissue 按鈕）
    const clip = titleBox
      ? { x: Math.max(0, titleBox.x - 20), y: Math.max(0, titleBox.y - 15), width: 1200, height: 140 }
      : { x: 200, y: 400, width: 1100, height: 200 };
    await page.screenshot({ path: `${OUT_DIR}/line-token.png`, clip });
    console.log('  ✅ line-token.png');
  } else { console.warn('  ⚠️ 找不到 Channel access token 區塊'); }

  // ── 2. Channel secret（Basic settings 頁）──
  console.log('→ 截 Channel secret...');
  await page.goto(`${base}/basic`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.evaluate(MASK_FN);
  await page.waitForTimeout(300);
  const secretRow = page.locator('text=Channel secret').first();
  if (await secretRow.count()) {
    await secretRow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    // 截 Channel secret 那一列（含標籤、隱碼值、Issue 按鈕）— 用祖先容器
    const row = page.locator('div', { has: page.locator('text=Channel secret') }).last();
    await page.screenshot({ path: `${OUT_DIR}/line-secret.png`, clip: await (async () => {
      const box = await secretRow.boundingBox();
      return box ? { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 25), width: 1200, height: 80 } : { x: 200, y: 400, width: 1100, height: 120 };
    })() });
    console.log('  ✅ line-secret.png');
  } else { console.warn('  ⚠️ 找不到 Channel secret 區塊'); }

  console.log(`\n完成。圖存於 ${OUT_DIR}`);
  await browser.close();
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
