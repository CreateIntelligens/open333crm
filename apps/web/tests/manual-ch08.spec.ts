/**
 * 手冊 ch08–ch10（行銷活動／廣播／分群、素材庫、LINE 渠道工具）錄影與截圖。
 *
 * ⚠️ 正式環境：只開表單、填示範文字、按「取消」。
 *   絕不按：建立、儲存、存為素材、立即發送、發布、取消發布、綁定、刪除、狀態膠囊。
 *   唯一放行的 POST：/marketing/segments/preview（分群人數預覽，只查詢不寫入）。
 *
 * 跑法：npx playwright test --config=playwright.shots.config.ts tests/manual-ch08.spec.ts
 */
import { test, Page, Locator, Browser } from '@playwright/test';
import {
  startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage, Recorder,
} from './manual-video-helpers';
import { shot, SHOTS_DIR } from './manual-helpers';
import * as path from 'path';

const SEGMENT_PREVIEW = [/\/api\/v1\/marketing\/segments\/preview$/];
// 以下兩個是 UAT 示範租戶的固定 LINE 渠道 id（錄製手冊專用）；換環境或渠道重建後要改成新的 id。
const OA_EMPTY = 'a2e0d432-16b2-46fc-a0ed-25ff1edf5845'; // 「第二個line串接」：沒有任何 Rich Menu，示範用
const OA_MAIN = 'c4ca29ba-45f9-4f0f-adc9-8fb967469c1b'; // 「LINE OA」：只截圖，不按任何按鈕

/**
 * 原生 <dialog showModal()> 在 top layer，字幕與框線會被遮罩壓暗。
 * 有開著的 dialog 時，把字幕、框線、點擊圈搬進 dialog 裡。
 */
const DIALOG_LAYER_FIX = `(() => {
  function fix(){
    const d = [...document.querySelectorAll('dialog[open]')].pop();
    const cap = document.getElementById('mv-cap');
    const host = d || document.body;
    if (cap && cap.parentElement !== host) host.appendChild(cap);
    document.querySelectorAll('.mv-ring,.mv-dot').forEach(r => { if (r.parentElement !== host) host.appendChild(r); });
  }
  const start = () => new MutationObserver(fix).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();`;

/** 示範素材圖不是個資，取消 helper 的全域模糊 */
const UNBLUR_SAMPLES = `img[src*="material-samples"]{filter:none!important}`;

async function rec(browser: Browser, name: string, allowPost: RegExp[] = []): Promise<Recorder> {
  const r = await startRecording(browser, name, { allowPost });
  await r.context.addInitScript(DIALOG_LAYER_FIX);
  return r;
}

async function finish(r: Recorder) {
  await stopRecording(r);
  poster(r.name, 2);
}

/** 把測試資料（[E2E]、亂打的名稱）列藏起來，畫面比較乾淨 */
async function hideTestData(page: Page) {
  await page.evaluate(() => {
    const junk = /^(\[E2E|123|aaa|ＱＱＱ|測試)/;
    document.querySelectorAll('tbody tr, .grid > div').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (el.tagName !== 'TR' && t.length > 600) return; // 卡片只處理單張，不碰整塊版面
      const cells = [...el.querySelectorAll('td, h3, h4, p, span')].map((c) => (c.textContent || '').trim()).filter(Boolean);
      if (/\[E2E/.test(t) || cells.slice(0, 3).some((c) => junk.test(c))) {
        (el as HTMLElement).style.display = 'none';
      }
    });
  });
}

async function pick(page: Page, select: Locator, re: RegExp) {
  const sel = select.first();
  await point(page, sel, 700);
  const opts = await sel.locator('option').evaluateAll((os) =>
    os.map((o) => ({ v: (o as HTMLOptionElement).value, t: (o.textContent || '').trim() })),
  );
  const hit = opts.find((o) => o.v && re.test(o.t) && !/\[E2E\]/.test(o.t));
  if (!hit) throw new Error(`下拉找不到 ${re}：${opts.map((o) => o.t).join(' / ')}`);
  await sel.selectOption(hit.v);
  await page.waitForTimeout(900);
  return hit.t;
}

async function retype(page: Page, loc: Locator, text: string) {
  await loc.first().fill('');
  await typeIn(page, loc, text);
}

// ───────────────────────── ch08 行銷 ─────────────────────────

test('ch08-campaign-create', async ({ browser }) => {
  const r = await rec(browser, 'ch08-campaign-create');
  const p = r.page;
  await go(p, '/dashboard/marketing/campaigns');
  await hideTestData(p);
  await caption(p, '行銷活動：把多次廣播收成一組');
  await tap(p, p.getByRole('button', { name: '新增活動' }));
  const d = p.locator('dialog[open]');
  await caption(p, '填活動名稱與說明');
  await typeIn(p, d.getByPlaceholder('活動名稱'), '範例：週年慶活動');
  await typeIn(p, d.getByPlaceholder('活動描述'), '範例：全館 85 折');
  await caption(p, '開始與結束日期可以不填');
  await point(p, d.locator('input[type=date]').first());
  await d.locator('input[type=date]').nth(0).fill('2026-11-01');
  await d.locator('input[type=date]').nth(1).fill('2026-11-30');
  await p.waitForTimeout(800);
  await caption(p, '最後按「建立」，這裡先示範取消');
  await point(p, d.getByRole('button', { name: '建立' }));
  await tap(p, d.getByRole('button', { name: '取消' }));
  await finish(r);
});

test('ch08-broadcast-create', async ({ browser }) => {
  const r = await rec(browser, 'ch08-broadcast-create');
  const p = r.page;
  await go(p, '/dashboard/marketing/broadcasts');
  await hideTestData(p);
  await caption(p, '廣播：把一則素材發給一群聯絡人');
  await tap(p, p.getByRole('button', { name: '建立廣播' }));
  const d = p.locator('dialog[open]');
  await typeIn(p, d.getByPlaceholder('廣播名稱'), '範例：週年慶 LINE 推播');
  await caption(p, '先選要從哪個渠道發送');
  await pick(p, d.locator('select').nth(0), /\(LINE\)/);
  await caption(p, '再選素材，要選同平台的素材');
  await pick(p, d.locator('select').nth(1), /line_carousel|line_text|line_flex/);
  await caption(p, '下方會出現素材預覽', 2600);
  await caption(p, '受眾請選「全部聯絡人」或「受眾分群」');
  await pick(p, d.locator('select').nth(3), /^受眾分群$/);
  await pick(p, d.locator('select').nth(4), /人\)$/);
  await caption(p, '排程留空，就只存成草稿');
  await point(p, d.locator('input[type=datetime-local]'));
  await caption(p, '這裡示範先取消，不建立');
  await tap(p, d.getByRole('button', { name: '取消' }));
  await finish(r);
});

test('ch08-segment-create', async ({ browser }) => {
  const r = await rec(browser, 'ch08-segment-create', SEGMENT_PREVIEW);
  const p = r.page;
  await go(p, '/dashboard/marketing/segments');
  await caption(p, '受眾分群：用條件圈出一群聯絡人');
  await tap(p, p.getByRole('button', { name: '新增分群' }));
  const d = p.locator('dialog[open]');
  await typeIn(p, d.getByPlaceholder('分群名稱'), '範例：LINE 好友');
  await caption(p, '設定條件：渠道類型是 LINE');
  await pick(p, d.locator('select').filter({ has: p.locator('option', { hasText: '選擇渠道' }) }), /^LINE$/);
  await caption(p, '條件值一定要填，留空會變全部人');
  await caption(p, '按「預覽人數」先看有幾位');
  await tap(p, d.getByRole('button', { name: '預覽人數' }), 2000);
  await point(p, d.getByText('符合人數'), 1800);
  await caption(p, '確認後按「建立」，這裡先示範取消');
  await tap(p, d.getByRole('button', { name: '取消' }));
  await finish(r);
});

// ───────────────────────── ch09 素材庫 ─────────────────────────

test('ch09-material-browse', async ({ browser }) => {
  const r = await rec(browser, 'ch09-material-browse');
  const p = r.page;
  await go(p, '/dashboard/marketing/materials');
  await hideTestData(p);
  await caption(p, '素材庫：所有可發送的訊息都在這');
  await caption(p, '左邊用分類篩選，「管理」可新增分類');
  await point(p, p.getByRole('button', { name: '管理', exact: true }));
  await caption(p, '上方可搜尋名稱、切換 LINE 或 FB');
  await point(p, p.getByPlaceholder('搜尋素材名稱'));
  await tap(p, p.getByRole('button', { name: 'LINE', exact: true }));
  await hideTestData(p);
  await caption(p, '也能依使用次數排序');
  await pick(p, p.locator('main select').first(), /使用次數/);
  await hideTestData(p);
  await caption(p, '點「編輯」就能修改素材內容');
  await point(p, p.getByRole('button', { name: '編輯' }).first());
  await finish(r);
});

test('ch09-line-card', async ({ browser }) => {
  const r = await rec(browser, 'ch09-line-card');
  const p = r.page;
  await go(p, '/dashboard/marketing/materials');
  await hideTestData(p);
  await caption(p, '建立素材：按「從版型建立」');
  await tap(p, p.getByRole('button', { name: '從版型建立' }), 1800);
  await caption(p, '先選平台，這裡選 LINE');
  await point(p, p.getByRole('button', { name: /LINE 官方帳號訊息/ }));
  await caption(p, '再選訊息類型：卡片訊息');
  await tap(p, p.getByRole('button', { name: /卡片訊息/ }), 1800);
  await p.addStyleTag({ content: UNBLUR_SAMPLES });
  await retype(p, p.getByPlaceholder('如：母親節新品推播'), '範例：週年慶新品卡片');
  await caption(p, '頁面類型選「商品服務」');
  await point(p, p.getByRole('button', { name: /商品服務/ }));
  await caption(p, '填標題、說明和價格');
  await retype(p, p.getByPlaceholder('輸入標題'), '範例：經典咖啡機');
  await retype(p, p.getByPlaceholder('輸入文字說明'), '週年慶限定，買就送咖啡豆');
  await retype(p, p.getByPlaceholder('00,000'), '2,990');
  await caption(p, '右邊的即時預覽會跟著變', 2600);
  await point(p, p.getByText('即時預覽').locator('..'), 1600);
  await caption(p, '動作 1 決定按鈕點了要做什麼');
  await point(p, p.getByPlaceholder('輸入動作標籤').first());
  await caption(p, '按「新增頁面」可以再加一張卡片');
  await tap(p, p.getByRole('button', { name: '新增頁面' }), 1500);
  await caption(p, '填好按「存為素材」，這裡先示範取消');
  await point(p, p.getByRole('button', { name: '存為素材' }));
  await tap(p, p.getByRole('button', { name: '取消', exact: true }));
  await finish(r);
});

// ───────────────────────── ch10 LINE 渠道工具 ─────────────────────────

test('ch10-richmenu-new', async ({ browser }) => {
  const r = await rec(browser, 'ch10-richmenu-new');
  const p = r.page;
  await go(p, '/dashboard/line/rich-menus');
  await caption(p, 'Rich Menu：LINE 聊天室底部的選單');
  await caption(p, '先選要設定的 LINE 官方帳號');
  const sel = p.locator('select').first();
  await point(p, sel, 700);
  await sel.selectOption(OA_EMPTY);
  await p.waitForTimeout(1800);
  await tap(p, p.getByRole('button', { name: /建立.*Rich Menu/ }).first(), 1800);
  await caption(p, '選一個版型，分大選單和小選單');
  await point(p, p.getByText(/大選單/).first(), 1200);
  await tap(p, p.getByRole('button', { name: /2 × 2（四等分）/ }), 1800);
  await retype(p, p.getByPlaceholder('如：主選單 v1'), '範例：會員主選單');
  await retype(p, p.getByPlaceholder('如：菜單'), '會員專區');
  await caption(p, '「設為所有好友的預設選單」預設不勾，勾了一發布就換掉所有好友的選單', 3200);
  await point(p, p.getByText('設為所有好友的預設選單'), 1200);
  await caption(p, '背景圖要符合尺寸，1MB 以內');
  await point(p, p.getByRole('button', { name: '上傳' }));
  await caption(p, '展開每個區域，設定點了要做什麼');
  const act = p.locator('select').filter({ has: p.locator('option', { hasText: '開啟網址' }) }).first();
  await pick(p, act, /開啟網址/);
  await typeIn(p, p.getByPlaceholder('https://...').first(), 'https://example.com/member');
  await caption(p, '存草稿不會改到 LINE，這裡先示範取消');
  await point(p, p.getByRole('button', { name: '儲存草稿' }));
  await tap(p, p.getByRole('button', { name: '取消', exact: true }));
  await finish(r);
});

test('ch10-keyword-create', async ({ browser }) => {
  const r = await rec(browser, 'ch10-keyword-create');
  const p = r.page;
  await go(p, '/dashboard/line/keyword-replies');
  await p.waitForTimeout(3000); // 規則明細是逐筆載入，等全部回來再隱藏測試資料
  await hideTestData(p);
  await caption(p, '關鍵字回覆：客戶打到字就自動回素材');
  await tap(p, p.getByRole('button', { name: '建立關鍵字回覆' }));
  await typeIn(p, p.getByPlaceholder('例：詢問營業時間、預約諮詢、產品 DM'), '範例：詢問營業時間');
  await caption(p, '輸入關鍵字後按 Enter，可加好幾個');
  const kw = p.getByPlaceholder('輸入關鍵字後按 Enter 或點「加入」');
  await typeIn(p, kw, '營業時間');
  await kw.press('Enter');
  await typeIn(p, kw, '幾點開');
  await kw.press('Enter');
  await p.waitForTimeout(800);
  await caption(p, '兩個以上可選「任一」或「全部」都要出現');
  await point(p, p.getByText('比對方式').locator('..'), 1600);
  await caption(p, '選要回覆的 LINE 素材');
  const matSel = p.locator('select').filter({ has: p.locator('option', { hasText: '請選擇' }) }).first();
  await pick(p, matSel, /新LINE|LINE/);
  await caption(p, '這裡示範先取消，不儲存');
  await tap(p, p.getByRole('button', { name: '取消', exact: true }));
  await finish(r);
});

test('ch10-quickreply-create', async ({ browser }) => {
  const r = await rec(browser, 'ch10-quickreply-create');
  const p = r.page;
  await go(p, '/dashboard/line/quick-replies');
  await caption(p, '快速回覆：把常用按鈕組存起來');
  await tap(p, p.getByRole('button', { name: '建立預設組' }));
  await typeIn(p, p.getByPlaceholder('例：滿意度調查、預約時段、是否同意條款'), '範例：滿意度調查');
  await caption(p, '左邊打按鈕文字，右邊打點了送出的話');
  await typeIn(p, p.getByPlaceholder('例：同意'), '非常滿意');
  await typeIn(p, p.getByPlaceholder(/例：我同意/), '我給 5 分');
  await tap(p, p.getByRole('button', { name: '加入' }), 900);
  await caption(p, '記得按「加入」，按鈕才會加進清單');
  await typeIn(p, p.getByPlaceholder('例：同意'), '還可以');
  await tap(p, p.getByRole('button', { name: '加入' }), 900);
  await typeIn(p, p.getByPlaceholder('例：同意'), '不滿意');
  await tap(p, p.getByRole('button', { name: '加入' }), 900);
  await caption(p, '右邊可預覽客戶看到的樣子', 2600);
  await point(p, p.getByText('用戶在 LINE 看到的樣子').locator('..'), 1600);
  await caption(p, '這裡示範先取消，不儲存');
  await tap(p, p.getByRole('button', { name: '取消', exact: true }));
  await finish(r);
});

// ───────────────────────── 截圖 ─────────────────────────

test('shots', async ({ browser }) => {
  test.setTimeout(300_000);
  const p = await newShotPage(browser, { allowPost: SEGMENT_PREVIEW });
  await p.addInitScript(DIALOG_LAYER_FIX);
  const main = () => p.locator('main').last();

  // ch08
  await go(p, '/dashboard/marketing/campaigns');
  await hideTestData(p);
  await shot(p, main(), 'ch08-campaigns');
  await go(p, '/dashboard/marketing/campaigns');
  await p.getByText('春季家電節').first().click();
  await p.waitForTimeout(2500);
  await shot(p, main(), 'ch08-campaign-detail');

  await go(p, '/dashboard/marketing/broadcasts');
  await hideTestData(p);
  await shot(p, main(), 'ch08-broadcasts');
  await p.getByRole('button', { name: '建立廣播' }).click();
  let d = p.locator('dialog[open]');
  await d.getByPlaceholder('廣播名稱').fill('範例：週年慶 LINE 推播');
  await pick(p, d.locator('select').nth(0), /\(LINE\)/);
  await pick(p, d.locator('select').nth(1), /line_carousel|line_text|line_flex/);
  await pick(p, d.locator('select').nth(3), /^受眾分群$/);
  await pick(p, d.locator('select').nth(4), /人\)$/);
  await p.waitForTimeout(1200);
  await d.evaluate((el) => { el.scrollTop = 0; });
  await shot(p, d, 'ch08-broadcast-dialog');
  await d.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await p.waitForTimeout(400);
  await shot(p, d, 'ch08-broadcast-audience');
  await d.getByRole('button', { name: '取消' }).click();

  await go(p, '/dashboard/marketing/segments');
  await p.getByRole('button', { name: '新增分群' }).click();
  d = p.locator('dialog[open]');
  await d.getByPlaceholder('分群名稱').fill('範例：LINE 好友');
  await pick(p, d.locator('select').filter({ has: p.locator('option', { hasText: '選擇渠道' }) }), /^LINE$/);
  await d.getByRole('button', { name: '預覽人數' }).click();
  await p.waitForTimeout(2500);
  await shot(p, d, 'ch08-segment-dialog');
  await d.getByRole('button', { name: '取消' }).click();

  // ch09
  await go(p, '/dashboard/marketing/materials');
  await hideTestData(p);
  await shot(p, main(), 'ch09-list');
  await p.getByRole('button', { name: '管理', exact: true }).click();
  await p.waitForTimeout(1000);
  await shot(p, p.locator('dialog[open]'), 'ch09-category-manager');
  await p.keyboard.press('Escape');

  await go(p, '/dashboard/marketing/materials/new');
  await shot(p, main(), 'ch09-picker-line');
  await p.getByRole('button', { name: /FB Messenger/ }).click();
  await p.waitForTimeout(800);
  await shot(p, main(), 'ch09-picker-fb');

  await go(p, '/dashboard/marketing/materials/new');
  await p.getByRole('button', { name: /卡片訊息/ }).click();
  await p.waitForTimeout(1800);
  await p.addStyleTag({ content: UNBLUR_SAMPLES });
  await p.getByPlaceholder('如：母親節新品推播').fill('範例：週年慶新品卡片');
  await p.getByPlaceholder('輸入標題').fill('範例：經典咖啡機');
  await p.getByPlaceholder('輸入文字說明').fill('週年慶限定，買就送咖啡豆');
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(SHOTS_DIR, 'ch09-editor.png') });
  await shot(p, p.getByText('動作 1（必填）').locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), 'ch09-action');
  await shot(p, p.locator('section', { hasText: '快速回覆按鈕' }).last(), 'ch09-quickreply');
  await shot(p, p.getByText('分類與標籤').locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), 'ch09-governance');

  // 既有素材的編輯頁：素材成效、版本歷史（只截圖，不按還原）。找一筆有版本紀錄的素材
  await go(p, '/dashboard/marketing/materials');
  const n = await p.locator('tbody tr').count();
  let gotStats = false;
  for (let i = 0; i < n; i++) {
    await go(p, '/dashboard/marketing/materials');
    await p.locator('tbody tr').nth(i).getByRole('button', { name: '編輯' }).click();
    await p.waitForURL(/materials\/[0-9a-f-]{36}/);
    await p.waitForTimeout(2500);
    const hist = p.getByText('版本歷史').locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
    if (!gotStats) { await shot(p, p.getByText('素材成效').locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), 'ch09-stats'); gotStats = true; }
    if (await hist.getByText('目前').count()) {
      // 版本列會顯示素材名稱，把測試用名稱換成示範文字
      await hist.evaluate((el) => {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let t: Node | null;
        while ((t = w.nextNode())) if (/\[E2E\]/.test(t.textContent || '')) t.textContent = (t.textContent || '').replace(/\[E2E\][^·]*/, '範例：週年慶推播 ');
      });
      await shot(p, hist, 'ch09-history');
      break;
    }
  }

  // ch10
  await go(p, `/dashboard/line/rich-menus?channelId=${OA_MAIN}`);
  await p.waitForTimeout(1500);
  await shot(p, main(), 'ch10-richmenu-list');
  await go(p, `/dashboard/line/rich-menus/new?channelId=${OA_EMPTY}`);
  await shot(p, main(), 'ch10-layouts');
  await p.getByRole('button', { name: /2 × 2（四等分）/ }).click();
  await p.waitForTimeout(1500);
  await p.getByPlaceholder('如：主選單 v1').fill('範例：會員主選單');
  await p.screenshot({ path: path.join(SHOTS_DIR, 'ch10-richmenu-editor.png') });
  await p.addStyleTag({ content: '.sticky.bottom-0{display:none!important}' });
  await shot(p, p.getByText(/^區域設定（共/).locator('xpath=..'), 'ch10-area-action');

  await go(p, '/dashboard/line/keyword-replies');
  await p.getByRole('button', { name: '建立關鍵字回覆' }).click();
  await p.getByPlaceholder('例：詢問營業時間、預約諮詢、產品 DM').fill('範例：詢問營業時間');
  const kw = p.getByPlaceholder('輸入關鍵字後按 Enter 或點「加入」');
  await kw.fill('營業時間'); await kw.press('Enter');
  await kw.fill('幾點開'); await kw.press('Enter');
  await pick(p, p.locator('select').filter({ has: p.locator('option', { hasText: '請選擇' }) }).first(), /新LINE|LINE/);
  await p.waitForTimeout(1200);
  await shot(p, p.locator('div.fixed.inset-0 > div').first(), 'ch10-keyword-dialog');

  await go(p, '/dashboard/line/quick-replies');
  await shot(p, main(), 'ch10-quickreply-list');
  await p.getByRole('button', { name: '建立預設組' }).click();
  await p.getByPlaceholder('例：滿意度調查、預約時段、是否同意條款').fill('範例：滿意度調查');
  for (const [a, b] of [['非常滿意', '我給 5 分'], ['還可以', ''], ['不滿意', '']]) {
    await p.getByPlaceholder('例：同意').fill(a);
    if (b) await p.getByPlaceholder(/例：我同意/).fill(b);
    await p.getByRole('button', { name: '加入' }).click();
  }
  await p.waitForTimeout(800);
  await shot(p, p.locator('div.fixed.inset-0 > div').first(), 'ch10-quickreply-dialog');
});

/**
 * 廣播失敗原因與「重新發送」「取消」按鈕（#287）。
 *
 * 前置資料（腳本不建立：截圖腳本會擋掉所有寫入請求，避免在正式環境誤發）：
 * 1. 建一個沒有任何聯絡人的標籤（POST /tags，type MANUAL、scope CONTACT）。
 * 2. 建一則名為「會員日優惠通知」的廣播：LINE 渠道、targetType 'tags' 指向該標籤、
 *    scheduledAt 設在一兩分鐘後（POST /marketing/broadcasts）。
 * 3. 等排程執行，狀態變成 failed、原因為「所選標籤下沒有可在此渠道發送的對象。」（受眾為空，不會發出訊息）。
 * 拍完到後台取消這則廣播、刪除該標籤。
 * 找不到符合的失敗廣播時，這個測試直接失敗並說明缺什麼，不會拍出錯的畫面。
 */
test('ch08-broadcast-failed', async ({ browser }) => {
  const p = await newShotPage(browser);
  await go(p, '/dashboard/marketing/broadcasts');
  await hideTestData(p);
  const row = p.locator('tbody tr', { hasText: '會員日優惠通知' }).filter({ hasText: '失敗' }).first();
  await row.waitFor({ timeout: 15_000 }).catch(() => {
    throw new Error('找不到狀態為「失敗」的「會員日優惠通知」廣播，請先依檔案註解建立前置資料');
  });
  const reason = (await row.innerText()).includes('所選標籤下沒有可在此渠道發送的對象');
  if (!reason) throw new Error('「會員日優惠通知」沒有顯示失敗原因，請確認它是在 #287 上線後失敗的');
  await row.scrollIntoViewIfNeeded();
  await shot(p, p.locator('table').filter({ has: row }).first(), 'ch08-broadcast-failed');
});
