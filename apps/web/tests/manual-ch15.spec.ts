/**
 * 手冊第 15 章「渠道管理」影片與截圖。
 * ⚠️ 正式環境：只開對話框看欄位、填示範文字、按「取消」。
 *   不按：刪除、儲存、套用、測試連線、用 Facebook 連結粉專、建立並驗證、指派團隊的新增/撤銷、產生連結。
 * ⚠️ Webhook 網址、粉專 ID、Verify Token、嵌入碼、WebChat 連結、成員姓名一律在畫面上遮掉。
 * 寫入保險會擋下所有非 GET 的 API 請求，本章沒有放行任何 POST。
 * ch15-fb-connect 會按「用 Facebook 連結粉專」，但開始授權、選粉專、連結三支 API 都在本頁攔截回假資料。
 *
 * 新版 UI：渠道從卡片改成列表的一列；圖示按鈕有 aria-label（Bot 設定、下游 Webhook 轉發、編輯渠道、刪除渠道）；
 * 新增／編輯／Bot 設定改成佔滿內容區的 PageDialog（role=dialog）。
 */
import { test, Page, Locator } from '@playwright/test';
import {
  startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage,
} from './manual-video-helpers';
import { shot, sanitize, SHOTS_DIR, BASE_URL } from './manual-helpers';
import * as path from 'path';

/** 遮蔽渠道相關機密：網址、帳號 ID、Verify Token、嵌入碼、成員姓名 */
const MASK = `(() => {
  const css = [
    'pre{filter:blur(6px)!important}',
    'input[readonly]{filter:blur(5px)!important}',
    'label.cursor-pointer span.truncate{filter:blur(5px)!important}',
    'input[placeholder*="1660"]{filter:blur(5px)!important}',
    'input[aria-label="Webhook 公開網址"]{filter:blur(5px)!important}',
    'p.font-mono,span.font-mono,code{filter:blur(5px)!important}',
  ].join('');
  const rules = [
    [/https?:\\/\\/[^\\s"'<>]*(webhooks|chatbox|ngrok)[^\\s"'<>]*/g, 'https://••••••（網址已遮蔽）'],
    [/open333crm_[0-9a-f-]{6,}/g, 'open333crm_••••••••'],
    [/\\b\\d{10,}\\b/g, '••••••••••'],
    [/(自動取得：|目前使用：)[^｜]*/g, '$1••••••'],
    [/tatung/g, '官網即時客服'],
    [/^\s*@[A-Za-z0-9._-]{3,}\s*$/g, '@••••••'],
  ];
  const fix = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      const t = n.textContent || ''; let o = t;
      for (const [re, rep] of rules) o = o.replace(re, rep);
      if (o !== t) n.textContent = o;
    }
    document.querySelectorAll('input[placeholder*="@"]').forEach((el) => { el.placeholder = el.placeholder.replace(/@[A-Za-z0-9._-]{3,}/g, '@••••••'); });
    document.querySelectorAll('option').forEach((op) => { if ((op.textContent || '').includes('tatung')) op.textContent = op.textContent.replace(/tatung/g, '官網即時客服'); });
  };
  const boot = () => {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    fix(document.body);
    new MutationObserver(() => fix(document.body)).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();`;

async function mask(page: Page) {
  await page.context().addInitScript(MASK);
}

/** 依顯示名稱找渠道列（同時含名稱與「編輯渠道」按鈕的最內層 div） */
function card(page: Page, name: string): Locator {
  return page.locator('div')
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: '編輯渠道' }) })
    .last();
}

/** 表單比視窗高：暫時拉高視窗，讓 PageDialog 一次拍完整張表單 */
async function tall(page: Page, height = 1900) {
  await page.setViewportSize({ width: 1440, height });
  await page.waitForTimeout(500);
}
/** PageDialog 佔滿內容區，只拍裡面的表單本體，避免下方大片空白 */
function body(dialog: Locator): Locator {
  return dialog.locator(':scope > div').first();
}
async function normal(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
}

const PATH = '/dashboard/settings/channels';

/**
 * UAT 目前沒有權杖失效的渠道，又不能真的弄壞渠道：把 GET /channels 的回應裡
 * 第一個啟用中的 FB／IG 渠道標成 tokenHealth.status = 'invalid'（只影響這個瀏覽器分頁，不動正式資料）。
 * 前端 ChannelAccountRouting 依 settings.tokenHealth.status === 'invalid' 顯示紅框。
 */
async function fakeExpiredToken(page: Page) {
  await page.route('**/api/v1/channels', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const json = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];
    const target = list.find((c: any) => c.isActive && c.channelType === 'THREADS')
      ?? list.find((c: any) => c.isActive && c.channelType === 'FB');
    if (target) {
      target.settings = {
        ...(target.settings ?? {}),
        tokenHealth: { status: 'invalid', checkedAt: new Date().toISOString() },
      };
    }
    return route.fulfill({ response: res, json });
  });
}

/**
 * LINE OA 在 UAT 沒有存好完整的 LIFF 設定，「測試 LIFF 設定」按鈕是停用的。為了示範設定好的樣子，
 * 把 GET /channels 回應裡 LINE OA 的 settings.liffConfig／liffTest 換成示範值（截圖時欄位一律模糊；只影響這個分頁）。
 */
async function fakeLiffConfig(page: Page) {
  await page.route('**/api/v1/channels', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const json = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];
    const line = list.find((c: any) => c.displayName === 'LINE OA');
    if (line) {
      const liffConfig = { liffId: '1660000000-AbCdEfGh', loginChannelId: '1660000001' };
      const verifiedAt = new Date(Date.now() - 2 * 86400_000).toISOString();
      line.settings = { ...(line.settings ?? {}), liffConfig, liffTest: { ...liffConfig, verifiedAt } };
    }
    return route.fulfill({ response: res, json });
  });
}

/** 有權杖失效紅框的那一列 */
function expiredRow(page: Page): Locator {
  return page.locator('div')
    .filter({ has: page.getByText('存取權杖已失效，目前收不到也無法回覆訊息') })
    .filter({ has: page.getByRole('button', { name: '編輯渠道' }) })
    .last();
}

/**
 * 「測試 LIFF 設定」要送 POST /channels/:id/liff-test 在正式環境建立測試紀錄，寫入保險會擋下且不可放行。
 * 為了示範按下後的畫面，照 LiffTestPanel 的 JSX（同樣的 class 與文字）把 QR code 區塊與「等待手機的測試結果」
 * 插進面板裡；QR 是示範圖樣、連結是遮蔽過的假網址，不送任何請求。
 */
const LIFF_TEST_DEMO = `(panel) => {
  const n = 25, cell = 6, pad = 12, size = n * cell + pad * 2;
  let rects = '';
  const finder = (x, y) => {
    rects += '<rect x="' + (pad + x * cell) + '" y="' + (pad + y * cell) + '" width="' + 7 * cell + '" height="' + 7 * cell + '" fill="#000"/>';
    rects += '<rect x="' + (pad + (x + 1) * cell) + '" y="' + (pad + (y + 1) * cell) + '" width="' + 5 * cell + '" height="' + 5 * cell + '" fill="#fff"/>';
    rects += '<rect x="' + (pad + (x + 2) * cell) + '" y="' + (pad + (y + 2) * cell) + '" width="' + 3 * cell + '" height="' + 3 * cell + '" fill="#000"/>';
  };
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const inFinder = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
    if (!inFinder && rnd() > 0.5) rects += '<rect x="' + (pad + x * cell) + '" y="' + (pad + y * cell) + '" width="' + cell + '" height="' + cell + '" fill="#000"/>';
  }
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '"><rect width="100%" height="100%" fill="#fff"/>' + rects + '</svg>';
  const qr = 'data:image/svg+xml;base64,' + btoa(svg);
  panel.querySelectorAll('[data-liff-demo]').forEach((el) => el.remove());
  const wrap = document.createElement('div');
  wrap.setAttribute('data-liff-demo', '');
  wrap.innerHTML =
    '<div class="mt-3 flex flex-wrap gap-3">' +
      '<img src="' + qr + '" alt="LIFF 測試連結 QR code" class="h-32 w-32 rounded border bg-white" />' +
      '<div class="min-w-0 flex-1 space-y-1.5">' +
        '<p>用手機 LINE 掃描 QR code，或在手機的 LINE 開啟下方連結。測試連結 10 分鐘內有效，結果會同時顯示在手機和這裡。</p>' +
        '<a href="#" class="block break-all text-primary underline">https://liff.line.me/••••••（網址已遮蔽）</a>' +
        '<p class="text-muted-foreground">請用已經加官方帳號好友的 LINE 帳號測試。</p>' +
      '</div>' +
    '</div>' +
    '<p class="mt-2 flex items-center gap-1 text-muted-foreground">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 等待手機的測試結果…' +
    '</p>';
  panel.appendChild(wrap);
}`;

/** Bot 設定視窗裡的 LIFF 區塊：從「LIFF App ID」欄位到「測試 LIFF 設定」面板 */
async function liffClip(page: Page, dialog: Locator) {
  const top = await dialog.getByText('LIFF App ID（短連結身份收集）').locator('xpath=..').boundingBox();
  const panel = await liffPanel(dialog).boundingBox();
  if (!top || !panel) return null;
  const x = top.x - 16;
  const y = top.y - 16;
  return { x, y, width: top.width + 32, height: panel.y + panel.height - y + 16 };
}
function liffPanel(dialog: Locator): Locator {
  return dialog.locator('div.rounded-md.border').filter({ has: dialog.page().getByRole('button', { name: '測試 LIFF 設定' }) }).last();
}


test('ch15-overview 渠道管理總覽', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch15-overview');
  const { page } = rec;
  await mask(page);
  await fakeExpiredToken(page);
  await go(page, PATH);
  await caption(page, '設定 > 渠道管理，列表的每一列是一個渠道');
  await point(page, card(page, 'LINE OA'), 1800);
  await page.getByRole('heading', { name: '渠道管理' }).scrollIntoViewIfNeeded();
  await caption(page, '右邊可以新增渠道，或用設定精靈一步步來', 1200);
  await point(page, page.getByRole('button', { name: '設定精靈' }), 1200);
  await point(page, page.getByRole('button', { name: '新增渠道' }), 1200);
  const c = card(page, 'LINE OA');
  await caption(page, '「停用」暫停收發訊息、保留歷史，可隨時重新啟用', 1600);
  await point(page, c.getByRole('button', { name: '停用', exact: true }), 1600);
  await caption(page, '「測試連線」檢查帳號金鑰是否還有效', 1200);
  await point(page, c.getByRole('button', { name: '測試連線' }), 1600);
  await caption(page, '第一個圖示是 Bot 設定', 1000);
  await point(page, c.getByRole('button', { name: 'Bot 設定' }), 1400);
  await caption(page, '鉛筆是編輯，紅色垃圾桶是刪除', 1000);
  await point(page, c.getByRole('button', { name: '編輯渠道' }), 1200);
  await point(page, c.getByRole('button', { name: '刪除渠道' }), 1400);
  // UAT 沒有權杖失效的渠道：fakeExpiredToken 把一個 IG／FB 渠道在這個分頁裡標成失效來示範紅框
  const expired = page.getByText('存取權杖已失效，目前收不到也無法回覆訊息');
  await expired.first().scrollIntoViewIfNeeded();
  await caption(page, '權杖失效時，渠道下方會出現紅色提醒，告訴你怎麼修', 1000);
  await point(page, expired.first().locator('xpath=../..'), 2800);
  // 新版內容區是內層捲動容器，滑鼠滾輪不一定捲得動，直接捲到標題
  await page.getByRole('heading', { name: 'Webhook 公開網址' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await caption(page, '最上方的「Webhook 公開網址」一般不用改，填錯所有渠道都收不到訊息', 1800);
  await point(page, page.getByRole('heading', { name: 'Webhook 公開網址' }), 2400);
  await stopRecording(rec);
  poster('ch15-overview', 2);
});

test('ch15-add 新增渠道', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch15-add');
  const { page } = rec;
  await mask(page);
  await go(page, PATH);
  await caption(page, '按「新增渠道」');
  await tap(page, page.getByRole('button', { name: '新增渠道' }).first());
  const dialog = page.getByRole('dialog').filter({ hasText: '新增渠道' });
  await caption(page, '先選渠道類型，這裡示範 LINE', 1200);
  await point(page, dialog.locator('select').first(), 1200);
  await typeIn(page, dialog.getByPlaceholder('例：我的 LINE 官方帳號'), '範例：門市 LINE 官方帳號');
  await caption(page, 'LINE 要填兩組金鑰，不知道去哪拿就按這裡', 1200);
  await tap(page, dialog.getByRole('button', { name: '這些值要去哪裡取得？' }), 1500);
  const guide = page.getByRole('dialog').filter({ hasText: 'LINE 渠道欄位說明' });
  await caption(page, '說明會一步步告訴你去 LINE 後台哪裡複製', 2600);
  await guide.locator('.overflow-y-auto').first().evaluate((el) => el.scrollBy({ top: 300, behavior: 'smooth' })).catch(() => {});
  await page.waitForTimeout(1200);
  await tap(page, guide.getByRole('button', { name: '關閉' }));
  await caption(page, '下方勾選哪些同事看得到這個渠道的對話', 1200);
  await point(page, dialog.getByText('誰看得到這個渠道'), 2200);
  await caption(page, '換成 Facebook，要填的欄位就不一樣', 1000);
  await dialog.locator('select').first().selectOption('FB');
  await page.waitForTimeout(800);
  await point(page, dialog.getByText('粉專 ID 不需填寫', { exact: false }), 2000);
  await caption(page, 'Instagram 也有自己的三個欄位', 1000);
  await dialog.locator('select').first().selectOption('THREADS');
  await page.waitForTimeout(800);
  await point(page, dialog.getByText('Instagram 應用程式密鑰'), 2000);
  await caption(page, '示範到這裡，按「取消」離開', 1200);
  await tap(page, dialog.getByRole('button', { name: '取消', exact: true }));
  await stopRecording(rec);
  poster('ch15-add', 3);
});

test('ch15-wizard 設定精靈', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch15-wizard');
  const { page } = rec;
  await mask(page);
  await go(page, PATH);
  await caption(page, '第一次接渠道，建議用「設定精靈」');
  await tap(page, page.getByRole('button', { name: '設定精靈' }));
  const dialog = page.getByRole('dialog').filter({ hasText: '步驟' });
  await caption(page, '步驟 1：選類型、取名字', 1000);
  await point(page, dialog.locator('select').first(), 1000);
  await typeIn(page, dialog.getByPlaceholder('例：我的 LINE 官方帳號'), '範例：門市 LINE 官方帳號');
  await tap(page, dialog.getByRole('button', { name: '下一步' }));
  await caption(page, '步驟 2：貼上金鑰、勾選誰看得到', 2400);
  await point(page, dialog.getByText('誰看得到這個渠道'), 1600);
  await caption(page, '按「建立並驗證」，系統會自動測試並設定 LINE Webhook', 2800);
  await point(page, dialog.getByRole('button', { name: '建立並驗證' }), 1600);
  await caption(page, '示範先按鍵盤 Esc 關閉，不建立渠道', 1800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await stopRecording(rec);
  poster('ch15-wizard', 2);
});

test('ch15-edit 編輯渠道與可見範圍', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch15-edit');
  const { page } = rec;
  await mask(page);
  await go(page, PATH);
  await caption(page, '要換金鑰或改名字，按渠道右邊的鉛筆');
  await tap(page, card(page, 'LINE OA').getByRole('button', { name: '編輯渠道' }), 1800);
  const dialog = page.getByRole('dialog').filter({ hasText: '編輯渠道' });
  await caption(page, '金鑰欄留空就是不更換', 1000);
  await point(page, dialog.getByPlaceholder('留空表示不更新').first(), 1800);
  await caption(page, '這是要貼到 LINE 後台的 Webhook 網址', 1200);
  await point(page, dialog.getByText('Webhook URL', { exact: true }), 2000);
  await caption(page, '「跨渠道綁定」通常不用改，系統會自動取得', 1000);
  await point(page, dialog.getByText(/跨渠道綁定：/), 2200);
  await caption(page, '按「取消」離開，不會更動任何設定', 1400);
  await tap(page, dialog.getByRole('button', { name: '取消', exact: true }));
  await stopRecording(rec);
  poster('ch15-edit', 2);
});

test('ch15-bot Bot 設定', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch15-bot');
  const { page } = rec;
  await mask(page);
  await go(page, PATH);
  await caption(page, '按渠道右邊的「Bot 設定」圖示');
  await tap(page, card(page, 'LINE OA').getByRole('button', { name: 'Bot 設定' }), 1500);
  const dialog = page.getByRole('dialog').filter({ hasText: 'Bot 設定' });
  await caption(page, 'Bot 模式決定客戶來訊時誰先回', 1000);
  await point(page, dialog.locator('select').first(), 2000);
  await caption(page, 'Bot 回幾次還沒解決，就自動轉真人', 1000);
  await point(page, dialog.getByText('Bot 最大回覆次數'), 1800);
  await caption(page, '客戶打出這些字，就直接轉給客服', 1000);
  await point(page, dialog.getByText('轉接關鍵字'), 2000);
  await typeIn(page, dialog.getByPlaceholder('輸入關鍵字'), '找店長');
  const scroller = dialog.locator('[class*="max-h-"]').first();
  await scroller.evaluate((el) => el.scrollBy({ top: 500, behavior: 'smooth' })).catch(() => {});
  await page.waitForTimeout(900);
  await caption(page, '首次進站招呼語：新朋友第一次來訊時自動發送', 1000);
  await point(page, dialog.getByText('首次進站招呼語'), 2200);
  await scroller.evaluate((el) => el.scrollBy({ top: 500, behavior: 'smooth' })).catch(() => {});
  await page.waitForTimeout(900);
  await caption(page, '非營業時間問候語：下班時間自動回覆', 1000);
  await point(page, dialog.getByText('非營業時間問候語'), 2000);
  await caption(page, '示範先按「取消」，改好了再按「儲存」', 1400);
  await tap(page, dialog.getByRole('button', { name: '取消', exact: true }));
  await stopRecording(rec);
  poster('ch15-bot', 2);
});

test('ch15-webchat 嵌入碼與背景', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch15-webchat');
  const { page } = rec;
  await mask(page);
  await go(page, PATH);
  const c = card(page, '官網即時客服');
  await c.scrollIntoViewIfNeeded();
  await caption(page, '網站聊天（WebChat）渠道有三個專屬按鈕');
  await point(page, c.getByRole('button', { name: '取得嵌入碼' }), 1000);
  await tap(page, c.getByRole('button', { name: '取得嵌入碼' }), 1500);
  await caption(page, '把這段程式碼交給網站管理員，貼到網頁裡', 2600);
  await caption(page, '這個視窗沒有關閉鈕，按鍵盤 Esc 關掉', 1800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await caption(page, '「背景」可以換聊天頁的背景圖', 1000);
  await tap(page, c.getByRole('button', { name: '背景' }), 1500);
  const bg = page.getByRole('dialog').filter({ hasText: 'Chatbox 背景' });
  await point(page, bg.getByText('上傳背景圖片'), 2000);
  await caption(page, '示範先按「取消」', 1000);
  await tap(page, bg.getByRole('button', { name: '取消', exact: true }));
  await stopRecording(rec);
  poster('ch15-webchat', 2);
});

test('ch15 截圖', async ({ browser }) => {
  const page = await newShotPage(browser);
  await mask(page);
  await go(page, PATH);
  await page.waitForTimeout(1500);
  await shot(page, page.locator('main'), 'ch15-overview');
  await shot(page, card(page, 'LINE OA'), 'ch15-card-line');
  await shot(page, page.getByRole('heading', { name: 'Webhook 公開網址' }).locator('xpath=../../..'), 'ch15-webhook-base');

  // 新增渠道：LINE / FB / IG / WebChat
  await page.getByRole('button', { name: '新增渠道' }).first().click();
  await page.waitForTimeout(1500);
  const dialog = page.getByRole('dialog').filter({ hasText: '新增渠道' });
  await dialog.getByPlaceholder('例：我的 LINE 官方帳號').fill('範例：門市 LINE 官方帳號');
  await tall(page);
  await shot(page, body(dialog), 'ch15-add-line');
  await dialog.locator('select').first().selectOption('FB');
  await page.waitForTimeout(600);
  await dialog.locator('input').nth(0).fill('範例：品牌粉絲專頁');
  await dialog.locator('select').first().selectOption('THREADS');
  await page.waitForTimeout(600);
  await dialog.locator('input').nth(0).fill('範例：品牌 Instagram');
  await dialog.locator('select').first().selectOption('WEBCHAT');
  await page.waitForTimeout(600);
  await dialog.locator('input').nth(0).fill('範例：官網即時客服');
  await shot(page, body(dialog), 'ch15-add-webchat');
  await normal(page);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForTimeout(800);

  // 編輯渠道
  await card(page, 'LINE OA').getByRole('button', { name: '編輯渠道' }).click();
  await page.waitForTimeout(2000);
  const edit = page.getByRole('dialog').filter({ hasText: '編輯渠道' });
  await tall(page);
  await shot(page, body(edit), 'ch15-edit-line');
  await normal(page);
  await edit.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForTimeout(800);

  // Bot 設定
  await card(page, 'LINE OA').getByRole('button', { name: 'Bot 設定' }).click();
  await page.waitForTimeout(1500);
  const bot = page.getByRole('dialog').filter({ hasText: 'Bot 設定' });
  await shot(page, body(bot), 'ch15-bot');
  await bot.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForTimeout(800);

  // 網站聊天室嵌入碼
  await card(page, '官網即時客服').getByRole('button', { name: '取得嵌入碼' }).click();
  await page.waitForTimeout(1500);
  await shot(page, page.getByRole('dialog').filter({ hasText: '網站聊天室嵌入碼' }), 'ch15-embed');
});

test('ch15-token-expired 權杖失效紅框（攔截 GET 示範）', async ({ browser }) => {
  const page = await newShotPage(browser);
  await mask(page);
  await fakeExpiredToken(page);
  await go(page, PATH);
  await page.waitForTimeout(1500);
  await shot(page, expiredRow(page), 'ch15-token-expired');
});

test('ch15-liff LIFF 欄位與測試 QR（不儲存、不送測試）', async ({ browser }) => {
  const page = await newShotPage(browser);
  await mask(page);
  await fakeLiffConfig(page);
  await go(page, PATH);
  await page.waitForTimeout(1500);
  await card(page, 'LINE OA').getByRole('button', { name: 'Bot 設定' }).click();
  await page.waitForTimeout(1500);
  const bot = page.getByRole('dialog').filter({ hasText: 'Bot 設定' });
  await tall(page, 2400);
  await liffPanel(bot).scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await sanitize(page);
  const c1 = await liffClip(page, bot);
  if (!c1) throw new Error('找不到 LIFF 區塊');
  await page.screenshot({ path: path.join(SHOTS_DIR, 'ch15-liff-fields.png'), clip: c1 });
  console.log('✓ ch15-liff-fields.png');

  await liffPanel(bot).evaluate(eval(LIFF_TEST_DEMO));
  await page.waitForTimeout(600);
  await shot(page, liffPanel(bot), 'ch15-liff-test-qr');
  await normal(page);
  await bot.getByRole('button', { name: '取消', exact: true }).click();
});

/**
 * ch15-fb-connect：用 Facebook 連結粉專的完整流程。
 * Facebook 授權畫面無法在自動化瀏覽器登入，改用 2026-11-19 在使用者 Chrome 截的三張圖（個資已模糊，
 * tests/manual-assets/fb-connect/），由本機路由當成「Facebook 頁面」播放；最後一步實際沒有按「儲存」。
 * 「開始授權」「選擇粉專」「連結」三支 API 都用假資料回應，UAT 不會建立或更新任何渠道。
 */
test('ch15-fb-connect 用 Facebook 連結粉專', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch15-fb-connect');
  const { page } = rec;
  await mask(page);
  const fs = await import('fs');
  const asset = (n: number) => fs.readFileSync(path.join(__dirname, 'manual-assets/fb-connect', `fb${n}.png`));
  const SESSION = 'demo-session';
  const k = 1440 / 1470;
  const btn = (label: string, x0: number, y0: number, x1: number, y1: number, next: string) =>
    `<a aria-label="${label}" href="${next}" style="position:absolute;left:${x0 * k}px;top:${y0 * k}px;width:${(x1 - x0) * k}px;height:${(y1 - y0) * k}px"></a>`;
  const fbPage = (n: number, hotspot: string, extra = '') =>
    `<!doctype html><meta charset="utf-8"><title>商家專用 Facebook 登入</title>
     <body style="margin:0;background:#999;position:relative">
     <img src="/__fbdemo/img/${n}.png" style="display:block;width:1440px;filter:none!important">${hotspot}${extra}</body>`;
  await page.route('**/__fbdemo/img/*.png', (r) => r.fulfill({ contentType: 'image/png', body: asset(Number(r.request().url().match(/(\d)\.png$/)![1])) }));
  await page.route('**/__fbdemo/1', (r) => r.fulfill({ contentType: 'text/html', body: fbPage(1, btn('編輯設定', 497, 189, 723, 225, '/__fbdemo/2')) }));
  await page.route('**/__fbdemo/2', (r) => r.fulfill({ contentType: 'text/html', body: fbPage(2, btn('繼續', 817, 649, 958, 685, '/__fbdemo/3'),
    `<div aria-label="粉專清單" style="position:absolute;left:${490 * k}px;top:${230 * k}px;width:${480 * k}px;height:${280 * k}px"></div>`) }));
  await page.route('**/__fbdemo/3', (r) => r.fulfill({ contentType: 'text/html', body: fbPage(3, btn('儲存', 817, 649, 958, 685, `${PATH}?metaConnect=${SESSION}`),
    `<div aria-label="權限清單" style="position:absolute;left:${497 * k}px;top:${160 * k}px;width:${455 * k}px;height:${210 * k}px"></div>`) }));
  await page.route('**/meta-connect/start', (r) => r.fulfill({ json: { success: true, data: { url: `${BASE_URL}/__fbdemo/1` } } }));
  const PAGES = [
    { id: '100000000000001', name: '範例：品牌粉絲專頁', pictureUrl: null, linkedInThisTenant: false, linkedMode: null },
    { id: '100000000000002', name: '範例：門市粉絲專頁', pictureUrl: null, linkedInThisTenant: false, linkedMode: null },
  ];
  await page.route(`**/meta-connect/sessions/${SESSION}/pages`, (r) => r.fulfill({ json: { success: true, data: PAGES } }));
  await page.route(`**/meta-connect/sessions/${SESSION}/connect`, (r) =>
    r.fulfill({ json: { success: true, data: [{ pageId: PAGES[0].id, status: 'connected', channelId: '00000000-0000-4000-8000-0000000000fb' }] } }));

  await go(page, PATH);
  await page.getByRole('heading', { name: '渠道管理' }).scrollIntoViewIfNeeded();
  await caption(page, '設定 > 渠道管理，按「用 Facebook 連結粉專」');
  await tap(page, page.getByRole('button', { name: '用 Facebook 連結粉專' }), 1800);
  await caption(page, '畫面會跳到 Facebook，請用「粉專管理員」的帳號登入', 2600);
  await caption(page, '以前授權過會問要不要沿用，按「編輯設定」重新選粉專', 1800);
  await tap(page, page.getByLabel('編輯設定'), 1500);
  await caption(page, '選「只能使用目前的粉絲專頁」，勾選要接進系統的粉專', 1600);
  await point(page, page.getByLabel('粉專清單'), 2400);
  await caption(page, '按「繼續」', 900);
  await tap(page, page.getByLabel('繼續'), 1500);
  await caption(page, '這是系統需要的權限：收發 Messenger 訊息、管理粉專設定', 1600);
  await point(page, page.getByLabel('權限清單'), 2400);
  await caption(page, '確認後按「儲存」', 900);
  await tap(page, page.getByLabel('儲存'), 2200);
  const dialog = page.getByRole('dialog').filter({ hasText: '選擇要連結的粉專' });
  await dialog.waitFor();
  await caption(page, '回到渠道管理，自動跳出「選擇要連結的粉專」', 2000);
  await tap(page, dialog.getByRole('checkbox').first(), 800);
  await caption(page, '勾選粉專，按「連結所選粉專」', 1000);
  await tap(page, dialog.getByRole('button', { name: '連結所選粉專' }), 1500);
  await caption(page, '顯示「已連結」就完成了，不用另外設定 Webhook', 1600);
  await point(page, dialog.getByText('已連結').first(), 1800);
  await caption(page, '按「完成」關閉視窗', 900);
  await tap(page, dialog.getByRole('button', { name: '完成' }), 1200);
  await stopRecording(rec);
  poster('ch15-fb-connect', 2);
});
