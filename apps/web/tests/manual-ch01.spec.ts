/**
 * 手冊第 01 章「收件匣」操作影片與截圖。
 * ⚠️ UAT 即正式環境：只開表單、打示範文字、按取消；所有寫入請求都被 guardWrites 擋下。
 *
 * 示範租戶的進行中對話全是 Bot 處理中，沒有「客服處理中」的對話可以示範回覆框、
 * 模板、快速回覆、交回 Bot。這幾支影片在「瀏覽器端」把該對話 GET 回應的 status 改成
 * AGENT_HANDLED 來呈現客服接手後的畫面（只改顯示，不送任何寫入）。
 */
import { test, Page, BrowserContext } from '@playwright/test';
import {
  startRecording, stopRecording, poster, go, caption, point, tap, typeIn, newShotPage,
} from './manual-video-helpers';
import { shot, shotPage } from './manual-helpers';

/**
 * 個資遮蔽（新版 UI：左欄 div.w-80.border-r、右欄 div.w-80.border-l）：
 * 顧客訊息泡泡、非訪客的姓名／預覽／頭像縮寫、表頭與右欄姓名、聯絡方式、其他渠道對話內容；隱藏右下浮動工具
 */
const PII_SCRIPT = `(() => {
  const css = \`
    [data-testid="chat-messages"] div.bg-background[class*="rounded-tl-"]{filter:blur(6px)!important}
    [data-testid="other-channel-message"]{filter:blur(5px)!important}
    div.inline-flex.rounded-full.overflow-hidden{filter:blur(6px)!important}
    div.w-80.border-l dd:not(.flex){filter:blur(5px)!important}
  \`;
  const NAMES = ['Daniel', 'D', 'YD', '劉柏毅', '楊丹尼', 'Yang Daniel'];
  function run(){
    if (!document.getElementById('pii-style') && document.head) {
      const s = document.createElement('style'); s.id = 'pii-style'; s.textContent = css; document.head.appendChild(s);
    }
    // 左欄列表：不是匿名訪客的項目，模糊姓名與最後訊息
    document.querySelectorAll('div.w-80.border-r button').forEach(b => {
      if (!b.querySelector('p')) return;
      if ((b.textContent || '').includes('Chatbox Visitor')) return;
      b.querySelectorAll('span.truncate.text-sm, p').forEach(e => { e.style.filter = 'blur(5px)'; });
    });
    // 聊天表頭姓名、右欄姓名
    document.querySelectorAll('h3.text-xl, div.w-80.border-l h3').forEach(e => {
      if (!(e.textContent || '').includes('Chatbox Visitor')) e.style.filter = 'blur(6px)';
    });
    document.querySelectorAll('h1,h2,h3,h4,p,span,div').forEach(e => {
      if (e.children.length) return;
      if (NAMES.includes((e.textContent || '').trim())) e.style.filter = 'blur(6px)';
    });
    // 右欄「其他渠道的對話」預覽
    const h = [...document.querySelectorAll('h4')].find(x => (x.textContent||'').includes('其他渠道的對話'));
    if (h && h.parentElement) h.parentElement.querySelectorAll('p, span.block.truncate').forEach(p => p.style.filter = 'blur(5px)');
    // 浮動工具列（非本系統元件）
    document.querySelectorAll('[title="聊天室"],[title="網頁摘要與對話"],[title="切換主題"]').forEach(b => {
      let e = b; for (let i = 0; i < 8 && e && e.parentElement && e.parentElement !== document.body; i++) e = e.parentElement;
      if (e && e !== document.body) e.style.display = 'none';
    });
  }
  setInterval(run, 250);
})();`;

/** 左欄對話列表、右欄聯絡人面板、聊天表頭 */
const LIST = (page: Page) => page.locator('div.w-80.border-r');
const PANEL = (page: Page) => page.locator('div.w-80.border-l');
const HEADER = (page: Page) => page.locator('h3.text-xl').locator('xpath=ancestor::div[contains(@class,"border-b")][1]');

async function protect(context: BrowserContext, page: Page) {
  await context.addInitScript(PII_SCRIPT);
  await page.addScriptTag({ content: PII_SCRIPT }).catch(() => {});
}

/** 讓指定對話在畫面上呈現「客服處理中」（只改瀏覽器收到的 GET 回應） */
async function asAgentHandled(page: Page, id: string) {
  await page.route(new RegExp(`/api/v1/conversations/${id}$`), async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const j = await res.json();
    if (j?.data) j.data.status = 'AGENT_HANDLED';
    await route.fulfill({ response: res, json: j });
  });
}

/** 從「已關閉」清單找一筆 LINE 對話的 id（有其他渠道對話、可示範快速回覆） */
async function findLineConversation(page: Page): Promise<string> {
  let id = '';
  const h = async (r: any) => {
    if (r.url().includes('status=CLOSED')) {
      try { const j = await r.json(); id = j.data.find((x: any) => x.channelType === 'LINE')?.id || id; } catch {}
    }
  };
  page.on('response', h);
  await go(page, '/dashboard/inbox');
  await LIST(page).getByRole('tab', { name: '已關閉' }).click();
  for (let i = 0; i < 20 && !id; i++) await page.waitForTimeout(500);
  page.off('response', h);
  if (!id) throw new Error('找不到 LINE 對話');
  return id;
}

const botItem = (page: Page) => LIST(page).locator('button').filter({ hasText: 'Chatbox Visitor' }).filter({ hasText: '機器人處理中' }).first();

test('ch01-list 對話列表與篩選', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch01-list');
  const { page } = rec;
  await protect(rec.context, page);
  await go(page, '/dashboard/inbox');
  await caption(page, '左邊是所有對話的列表');
  await point(page, LIST(page), 1200);
  await caption(page, '上方切換「進行中」與「已關閉」', 1700);
  await tap(page, LIST(page).getByRole('tab', { name: '已關閉' }));
  await caption(page, '已關閉可選要看最近幾天', 1700);
  await point(page, page.getByLabel('關閉時間範圍'), 1600);
  await tap(page, LIST(page).getByRole('tab', { name: '進行中' }));
  await caption(page, '快速篩選：全部、未讀、我的', 1700);
  await tap(page, LIST(page).getByRole('button', { name: /^未讀/ }));
  await tap(page, LIST(page).getByRole('button', { name: /^全部/ }));
  await caption(page, '搜尋框可找聯繫人名稱或訊息', 1700);
  await typeIn(page, page.getByPlaceholder('搜尋對話、聯繫人'), '7c9efe');
  await page.waitForTimeout(1200);
  await page.getByPlaceholder('搜尋對話、聯繫人').fill('');
  await caption(page, '標題右邊的按鈕打開「進階篩選」', 1700);
  await tap(page, LIST(page).getByRole('button', { name: '進階篩選' }));
  await caption(page, '依狀態、渠道、指派對象篩選', 1700);
  await tap(page, page.locator('label').filter({ hasText: 'Bot 處理中' }), 600);
  await tap(page, page.getByRole('button', { name: '套用篩選' }), 1200);
  await caption(page, '套用後上方出現篩選條件', 1700);
  await point(page, page.getByText(/篩選結果：\d+ 個對話/), 1800);
  await caption(page, '按條件旁的 X 就能移除', 2200);
  await stopRecording(rec);
  poster('ch01-list', 2);
});

test('ch01-open 打開對話與聯絡人面板', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch01-open');
  const { page } = rec;
  await protect(rec.context, page);
  const id = await findLineConversation(page);
  await go(page, `/dashboard/inbox?conv=${id}`);
  await caption(page, '點一筆對話，中間顯示訊息', 1700);
  await point(page, HEADER(page), 1600);
  await caption(page, '表頭：渠道、狀態與負責人', 2000);
  await caption(page, '標示「AI 助理」的紫色泡泡是 Bot 自動回覆', 1700);
  await point(page, page.locator('[data-testid="chat-messages"] div.bg-ai-subtle[class*="rounded-tl-"]').last(), 1800);
  await caption(page, '右邊是這位顧客的資料', 1700);
  await point(page, PANEL(page), 1600);
  await caption(page, '同一位顧客在其他渠道的對話也看得到', 1700);
  await point(page, page.locator('h4', { hasText: '其他渠道的對話' }).locator('..'), 1800);
  await caption(page, '點一筆可展開最近的訊息', 1700);
  await tap(page, page.locator('h4', { hasText: '其他渠道的對話' }).locator('..').locator('button').first(), 1800);
  await caption(page, '「查看聯繫人詳情」到聯絡人頁', 1700);
  await point(page, page.getByRole('link', { name: /查看聯繫人詳情/ }), 1800);
  await stopRecording(rec);
  poster('ch01-open', 2);
});

test('ch01-takeover 接管與交回 Bot', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch01-takeover');
  const { page } = rec;
  await protect(rec.context, page);
  const id = await findLineConversation(page);
  await go(page, '/dashboard/inbox');
  await botItem(page).click();
  await page.waitForTimeout(2500);
  await caption(page, 'Bot 處理中的對話，輸入框是鎖住的', 1700);
  await point(page, page.getByPlaceholder(/Bot 處理中/), 1800);
  await caption(page, '要親自回覆，按「接管對話」', 1700);
  await point(page, page.getByRole('button', { name: '接管對話' }).first(), 1500);
  await point(page, page.getByRole('button', { name: '接管對話' }).last(), 1500);
  await caption(page, '注意：一按就會傳「稍等，正在為您轉接」給顧客', 2600);
  await asAgentHandled(page, id);
  await go(page, `/dashboard/inbox?conv=${id}`);
  await caption(page, '接管後，表頭會出現「交回 Bot」', 1700);
  await point(page, page.getByRole('button', { name: '交回 Bot' }), 2000);
  await caption(page, '處理完按它，Bot 會繼續自動回覆', 2400);
  await stopRecording(rec);
  poster('ch01-takeover', 2);
});

test('ch01-reply 回覆與快速回覆', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch01-reply');
  const { page } = rec;
  await protect(rec.context, page);
  const id = await findLineConversation(page);
  await asAgentHandled(page, id);
  await go(page, `/dashboard/inbox?conv=${id}`);
  const box = page.locator('textarea[data-message-input]');
  await caption(page, '在下方輸入框打字回覆顧客', 1700);
  await typeIn(page, box, '範例：您好，我們已收到您的問題');
  await caption(page, '按 Enter 送出，Shift+Enter 換行', 2200);
  await caption(page, 'LINE 對話可以加快速回覆按鈕', 1700);
  await tap(page, page.locator('button[title="加快速回覆按鈕"]'), 800);
  await typeIn(page, page.getByPlaceholder('按鈕文字'), '範例：查詢訂單');
  await tap(page, page.getByRole('button', { name: '加入', exact: true }), 1000);
  await caption(page, '顧客在 LINE 點一下就能回覆', 2200);
  await caption(page, '示範到這裡，不送出', 1200);
  await page.locator('button[title="移除"]').first().click().catch(() => {});
  await box.fill('');
  await stopRecording(rec);
  poster('ch01-reply', 3);
});

test('ch01-template 插入模板', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch01-template');
  const { page } = rec;
  await protect(rec.context, page);
  const id = await findLineConversation(page);
  await asAgentHandled(page, id);
  await go(page, `/dashboard/inbox?conv=${id}`);
  await caption(page, '常用的話可以用模板，不用每次重打', 1700);
  await tap(page, page.locator('button[title="模板"]'), 1200);
  await caption(page, '分類分頁可以切換', 1700);
  await point(page, page.getByPlaceholder('搜尋模板...').locator('xpath=following::div[1]'), 1500);
  await caption(page, '也可以直接搜尋', 1700);
  await typeIn(page, page.getByPlaceholder('搜尋模板...'), '問卷');
  await page.waitForTimeout(800);
  await caption(page, '點選模板，有變數的會請你先填', 1700);
  await tap(page, page.locator('h3:text("選擇模板")').locator('xpath=ancestor::div[contains(@class,"absolute")][1]').locator('button, [role=button], div.cursor-pointer').filter({ hasText: '問卷' }).first(), 1500);
  await caption(page, '填好按「插入」就會帶進輸入框', 2400);
  await stopRecording(rec);
  poster('ch01-template', 2);
});

test('ch01-close 結案對話框', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch01-close');
  const { page } = rec;
  await protect(rec.context, page);
  await go(page, '/dashboard/inbox');
  await botItem(page).click();
  await page.waitForTimeout(2500);
  await caption(page, '問題處理完，就把對話結案', 2200);
  await caption(page, '問題處理完，按右上角「結束對話」', 1700);
  await tap(page, page.getByRole('button', { name: '結束對話' }), 1200);
  await caption(page, '可以寫下結案原因（選填）', 1700);
  await typeIn(page, page.getByPlaceholder(/問題已解決/), '範例：問題已解決');
  await point(page, page.getByRole('button', { name: '確認結案' }), 1500);
  await caption(page, '按「確認結案」就完成，這裡示範先取消', 2200);
  await tap(page, page.getByRole('dialog').getByRole('button', { name: '取消' }), 800);
  await stopRecording(rec);
  poster('ch01-close', 2);
});

test('ch01-case 從對話建立工單', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch01-case');
  const { page } = rec;
  await protect(rec.context, page);
  await go(page, '/dashboard/inbox');
  await botItem(page).click();
  await page.waitForTimeout(2500);
  await caption(page, '需要後續追蹤，就從右欄「快速操作」開工單', 1700);
  await tap(page, PANEL(page).getByRole('button', { name: '建立工單' }), 1500);
  await caption(page, '聯絡人與來源對話會自動帶入', 1700);
  await point(page, page.getByText('來源對話').locator('..'), 1600);
  await typeIn(page, page.getByPlaceholder('案件標題...'), '範例：詢問電鍋保固');
  await caption(page, '選好分類與優先級', 1700);
  const dlg = page.getByRole('dialog');
  const cat = dlg.locator('select').filter({ hasText: '產品諮詢' }).first();
  await point(page, cat, 600);
  await cat.selectOption({ label: '產品諮詢' });
  await page.waitForTimeout(800);
  await caption(page, '按「建立案件」會跳到工單頁', 1700);
  await point(page, dlg.getByRole('button', { name: '建立案件' }), 1600);
  await caption(page, '這裡示範先取消', 1700);
  await tap(page, dlg.getByRole('button', { name: '取消' }), 800);
  await stopRecording(rec);
  poster('ch01-case', 2);
});

test('ch01 截圖', async ({ browser }) => {
  const page = await newShotPage(browser);
  await protect(page.context(), page);
  const id = await findLineConversation(page);
  await asAgentHandled(page, id);
  await go(page, `/dashboard/inbox?conv=${id}`);
  await page.waitForTimeout(1500);
  await shotPage(page, 'ch01-overview');
  await shot(page, HEADER(page), 'ch01-header');
  await shot(page, PANEL(page), 'ch01-contact-panel');
  await go(page, '/dashboard/inbox');
  await LIST(page).getByRole('button', { name: '進階篩選' }).click();
  await page.waitForTimeout(800);
  await shot(page, page.locator('h3:text("進階篩選")').locator('xpath=ancestor::div[contains(@class,"fixed")][1]'), 'ch01-filter');
  await page.keyboard.press('Escape');
  await go(page, '/dashboard/inbox');
  await botItem(page).click();
  await page.waitForTimeout(2500);
  await shot(page, page.getByText('Bot 自動處理中').locator('xpath=ancestor::div[1]/..'), 'ch01-bot-banner');
  await page.getByRole('button', { name: '結束對話' }).click();
  await page.waitForTimeout(800);
  await shot(page, page.getByRole('dialog'), 'ch01-close-dialog');
});
