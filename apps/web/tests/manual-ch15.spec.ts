/**
 * 手冊第 15 章「渠道管理」影片與截圖。
 * ⚠️ 正式環境：只開對話框看欄位、填示範文字、按「取消」。
 *   不按：刪除、儲存、套用、測試連線、用 Facebook 連結粉專、建立並驗證、指派團隊的新增/撤銷、產生連結。
 * ⚠️ Webhook 網址、粉專 ID、Verify Token、嵌入碼、WebChat 連結、成員姓名一律在畫面上遮掉。
 * 寫入保險會擋下所有非 GET 的 API 請求，本章沒有放行任何 POST。
 */
import { test, Page, Locator } from '@playwright/test';
import {
  startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage,
} from './manual-video-helpers';
import { shot } from './manual-helpers';

/** 遮蔽渠道相關機密：網址、帳號 ID、Verify Token、嵌入碼、成員姓名 */
const MASK = `(() => {
  const css = [
    'pre{filter:blur(6px)!important}',
    'input[readonly]{filter:blur(5px)!important}',
    'label.cursor-pointer span.truncate{filter:blur(5px)!important}',
    'input[placeholder*="1660"]{filter:blur(5px)!important}',
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

/** 依顯示名稱找渠道卡片 */
function card(page: Page, name: string): Locator {
  return page.locator('div.rounded-xl').filter({ has: page.getByText(name, { exact: true }) }).last();
}

const PATH = '/dashboard/settings/channels';

test('ch15-overview 渠道管理總覽', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch15-overview');
  const { page } = rec;
  await mask(page);
  await go(page, PATH);
  await caption(page, '設定 > 渠道管理，每張卡片是一個渠道');
  await point(page, card(page, 'LINE OA'), 1800);
  await caption(page, '右上可以新增渠道，或用設定精靈一步步來', 1200);
  await point(page, page.getByRole('button', { name: '設定精靈' }), 1200);
  await point(page, page.getByRole('button', { name: '新增渠道' }), 1200);
  const c = card(page, 'LINE OA');
  await caption(page, '「停用」暫停收發訊息、保留歷史，可隨時重新啟用', 1600);
  await point(page, c.getByRole('button', { name: '停用', exact: true }), 1600);
  await caption(page, '「測試連線」檢查帳號金鑰是否還有效', 1200);
  await point(page, c.getByRole('button', { name: '測試連線' }), 1600);
  await caption(page, '機器人圖示是 Bot 設定', 1000);
  await point(page, c.getByTitle('Bot 設定'), 1400);
  await caption(page, '鉛筆是編輯，紅色垃圾桶是刪除', 1000);
  await point(page, c.locator('button').nth(-2), 1200);
  await point(page, c.locator('button').last(), 1400);
  await caption(page, '權杖失效時，卡片會出現紅框提醒', 1000);
  await point(page, page.getByText('存取權杖已失效，目前收不到也無法回覆訊息').first(), 2400);
  await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(600);
  await caption(page, '最上方的「Webhook 公開網址」一般不用改，填錯所有渠道都收不到訊息', 1800);
  await point(page, page.getByText('Webhook 公開網址').first(), 2400);
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
  await tap(page, dialog.getByText('欄位說明：這些值要去哪裡取得？'), 1500);
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
  await caption(page, '要換金鑰或改名字，按卡片上的鉛筆');
  await tap(page, card(page, 'LINE OA').locator('button').nth(-2), 1800);
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
  await caption(page, '按卡片上的機器人圖示，打開 Bot 設定');
  await tap(page, card(page, 'LINE OA').getByTitle('Bot 設定'), 1500);
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
  await caption(page, '網站聊天（WebChat）卡片有三個專屬按鈕');
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
  await shot(page, card(page, 'IG333'), 'ch15-token-expired');
  await shot(page, page.locator('div.rounded-xl').filter({ hasText: 'Webhook 公開網址' }).first(), 'ch15-webhook-base');

  // 新增渠道：LINE / FB / IG / WebChat
  await page.getByRole('button', { name: '新增渠道' }).first().click();
  await page.waitForTimeout(1500);
  const dialog = page.getByRole('dialog').filter({ hasText: '新增渠道' });
  await dialog.getByPlaceholder('例：我的 LINE 官方帳號').fill('範例：門市 LINE 官方帳號');
  await shot(page, dialog, 'ch15-add-line');
  await dialog.locator('select').first().selectOption('FB');
  await page.waitForTimeout(600);
  await dialog.locator('input').nth(0).fill('範例：品牌粉絲專頁');
  await shot(page, dialog, 'ch15-add-fb');
  await dialog.locator('select').first().selectOption('THREADS');
  await page.waitForTimeout(600);
  await dialog.locator('input').nth(0).fill('範例：品牌 Instagram');
  await shot(page, dialog, 'ch15-add-ig');
  await dialog.locator('select').first().selectOption('WEBCHAT');
  await page.waitForTimeout(600);
  await dialog.locator('input').nth(0).fill('範例：官網即時客服');
  await shot(page, dialog, 'ch15-add-webchat');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  // 編輯渠道
  await card(page, 'LINE OA').locator('button').nth(-2).click();
  await page.waitForTimeout(2000);
  const edit = page.getByRole('dialog').filter({ hasText: '編輯渠道' });
  await shot(page, edit, 'ch15-edit-line');
  await edit.getByRole('button', { name: '取消', exact: true }).click();

  // Bot 設定
  await card(page, 'LINE OA').getByTitle('Bot 設定').click();
  await page.waitForTimeout(1500);
  const bot = page.getByRole('dialog').filter({ hasText: 'Bot 設定' });
  await shot(page, bot, 'ch15-bot');
  await bot.getByRole('button', { name: '取消', exact: true }).click();

  // WebChat 嵌入碼
  await card(page, '官網即時客服').getByRole('button', { name: '取得嵌入碼' }).click();
  await page.waitForTimeout(1500);
  await shot(page, page.getByRole('dialog').filter({ hasText: 'WebChat 嵌入碼' }), 'ch15-embed');
});
