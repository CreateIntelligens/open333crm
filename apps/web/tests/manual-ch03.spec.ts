/**
 * 手冊第 03 章「聯絡人」：影片與截圖。
 * 正式環境：只看、只填示範文字，合併示範到第 3 步就按「取消」，絕不按「確認合併」「確定解除」。
 */
import { test, Page } from '@playwright/test';
import { startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage } from './manual-video-helpers';
import { shot, shotPage } from './manual-helpers';

// 示範用聯絡人（名稱是系統產生的「LINE User xxxx」，不是真人名）
const PRIMARY = '816d5ff1-b5de-495d-bfcd-417028c4f4fc'; // LINE User f598f5
// 有多個渠道身份與合併紀錄的聯絡人（名稱是真人名，畫面上會模糊）
const RICH = '67b877db-2a96-4e5e-b1c0-ea4c438ceabb';

/**
 * 個資遮蔽（新版 UI：聯繫人列表是 role=table 的 div 格線，不是 <table>／<td>）：
 * 真人姓名（系統產生的「LINE User xxxx」「Chatbox Visitor xxxx」保留）、電話／email 欄、頭像縮寫、
 * 渠道帳號名稱與 uid、對話紀錄內容。用 init script 每 250ms 重跑，換頁、載入新資料也遮得到。
 */
const PII_SCRIPT = `(() => {
  const css = \`
    div.inline-flex.rounded-full.overflow-hidden{filter:blur(7px)!important}
    [role="table"] [role="row"] > [role="cell"]:nth-child(2),
    [role="table"] [role="row"] > [role="cell"]:nth-child(3),
    [data-testid="channel-identity"] p.text-sm.font-semibold,
    [data-testid="channel-identity"] p.font-mono,
    [data-testid="history-message"] > div:last-child{filter:blur(6px)!important}
  \`;
  const SYSTEM = /^(LINE User|Chatbox Visitor)\\s/;
  const blurName = e => { if (e && !SYSTEM.test((e.textContent || '').trim())) e.style.filter = 'blur(6px)'; };
  function run(){
    if (!document.getElementById('pii-style') && document.head) {
      const s = document.createElement('style'); s.id = 'pii-style'; s.textContent = css; document.head.appendChild(s);
    }
    // 列表姓名欄
    document.querySelectorAll('[role="table"] [role="row"] > [role="cell"]:first-child span.truncate').forEach(blurName);
    // 詳情頁頂部姓名、電話
    document.querySelectorAll('h2.text-xl').forEach(e => { if (!e.closest('[role="dialog"], dialog')) blurName(e); });
    document.querySelectorAll('svg.lucide-phone').forEach(i => { if (i.parentElement) i.parentElement.style.filter = 'blur(6px)'; });
    // 合併對話框的聯絡人名稱
    document.querySelectorAll('[role="dialog"] p.truncate.text-sm, [role="dialog"] p.truncate.text-sm.font-semibold').forEach(blurName);
    document.querySelectorAll('[title="聊天室"],[title="網頁摘要與對話"],[title="切換主題"]').forEach(b => {
      let e = b; for (let i = 0; i < 8 && e && e.parentElement && e.parentElement !== document.body; i++) e = e.parentElement;
      if (e && e !== document.body) e.style.display = 'none';
    });
  }
  setInterval(run, 250);
})();`;

async function protect(page: Page) {
  // 記下聯繫人列表回應的 id 順序（列表列沒有連結，用位置找示範聯絡人）
  page.on('response', async (r) => {
    if (!/\/api\/v1\/contacts(\?|$)/.test(r.url()) || r.request().method() !== 'GET') return;
    try {
      const j = await r.json();
      const ids = (j?.data || []).map((c: any) => c.id);
      await page.evaluate((x) => { (window as any).__contactIds = x; }, ids);
    } catch {}
  });
  await page.context().addInitScript(PII_SCRIPT);
  await page.addScriptTag({ content: PII_SCRIPT }).catch(() => {});
}
/** 相容舊呼叫：init script 已持續遮蔽，這裡只等一下讓它跑過一輪 */
async function blurPII(page: Page) {
  await page.addScriptTag({ content: PII_SCRIPT }).catch(() => {});
  await page.waitForTimeout(300);
}

const ROWS = (page: Page) => page.locator('[role="table"] [role="row"][tabindex="0"]');

test('ch03-contacts-find', async ({ browser }) => {
  test.setTimeout(150_000);
  const rec = await startRecording(browser, 'ch03-contacts-find');
  const { page } = rec;
  await protect(page);
  await go(page, '/dashboard/contacts');
  await blurPII(page);
  await caption(page, '側欄點「聯繫人」，這裡是客人名冊');
  await point(page, page.getByRole('columnheader', { name: '渠道' }), 1600);
  await caption(page, '渠道欄看得出客人從哪個渠道進來', 2000);
  const search = page.getByPlaceholder('搜尋聯繫人');
  await caption(page, '用右上角搜尋框找人', 1200);
  await typeIn(page, search, 'LINE User');
  await page.waitForTimeout(1500);
  await caption(page, '名字、電話、Email 都搜得到', 2000);
  await search.fill('');
  await page.waitForTimeout(1500);
  await blurPII(page);
  await caption(page, '點任一列，打開聯絡人詳情', 1400);
  // 點有渠道身份、對話紀錄與合併紀錄的示範聯絡人（RICH）那一列；列表依最近活躍排序，從 API 回應找它的位置
  const idx = await page.evaluate(async (id) => {
    const w = window as any; return (w.__contactIds || []).indexOf(id);
  }, RICH);
  await tap(page, idx >= 0 ? ROWS(page).nth(idx) : ROWS(page).first(), 2500);
  await blurPII(page);
  await caption(page, '上方是基本資料，右邊是渠道身份', 1200);
  await point(page, page.getByText('渠道身份', { exact: true }), 1600);
  await caption(page, '合併紀錄：看他跟誰合併過', 1200);
  await point(page, page.getByText('合併紀錄', { exact: true }), 1600);
  await caption(page, '左邊「活動時間軸」列出對話與工單', 1200);
  await point(page, page.getByRole('tab', { name: '活動時間軸' }), 1600);
  await caption(page, '切到「對話紀錄」看跨渠道訊息', 1000);
  await tap(page, page.getByRole('tab', { name: '對話紀錄' }), 2500);
  await blurPII(page);
  await caption(page, '各渠道的訊息依時間排成一條', 2400);
  await stopRecording(rec);
  poster('ch03-contacts-find', 3);
});

test('ch03-contacts-merge', async ({ browser }) => {
  test.setTimeout(150_000);
  const rec = await startRecording(browser, 'ch03-contacts-merge');
  const { page } = rec;
  await protect(page);
  await go(page, `/dashboard/contacts/${PRIMARY}`);
  await caption(page, '同一位客人被分成兩筆時，按右上角「合併聯繫人」');
  await tap(page, page.getByRole('button', { name: '合併聯繫人' }), 1500);
  const dialog = page.getByRole('dialog');
  await caption(page, '左邊是目前這位，會被保留', 1200);
  await point(page, dialog.getByText('主要聯絡人（保留）'), 1600);
  await caption(page, '右邊搜尋要併進來的那一筆', 1000);
  await typeIn(page, dialog.getByPlaceholder('搜尋聯絡人...'), 'LINE User');
  await page.waitForTimeout(1800);
  await tap(page, dialog.locator('button').filter({ hasText: 'd572d8' }), 1200);
  await caption(page, '選好後按「下一步」', 1000);
  await tap(page, dialog.getByRole('button', { name: '下一步' }), 2500);
  await caption(page, '第 2 步：看哪些資料會搬過來', 1200);
  await point(page, dialog.getByRole('table'), 2400);
  await tap(page, dialog.getByRole('button', { name: '下一步' }), 1500);
  await caption(page, '第 3 步：看清楚警告，再勾選確認', 1200);
  await point(page, dialog.getByText('我已確認並瞭解'), 2000);
  await caption(page, '示範到這裡，按「取消」不合併', 1000);
  await tap(page, dialog.getByRole('button', { name: '取消' }), 1500);
  await stopRecording(rec);
  poster('ch03-contacts-merge', 3);
});

test('ch03 截圖', async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await newShotPage(browser);
  await protect(page);
  await go(page, '/dashboard/contacts');
  await blurPII(page);
  await shotPage(page, 'ch03-list');

  await go(page, `/dashboard/contacts/${RICH}`);
  await blurPII(page);
  await shotPage(page, 'ch03-detail');
  const card = (title: string) =>
    page.getByText(title, { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-xl") or contains(@class,"rounded-lg")][1]');
  await shot(page, card('標籤'), 'ch03-tags');
  // 打開「解除合併」確認列（只看，不按「確定解除」）
  const revert = page.getByRole('button', { name: '解除合併' });
  if (await revert.count()) await revert.first().click();
  await page.waitForTimeout(500);
  await shot(page, card('合併紀錄'), 'ch03-merge-history');
  await page.getByRole('tab', { name: '對話紀錄' }).click();
  await page.getByTestId('history-message').first().waitFor({ timeout: 15000 }).catch(() => {});
  await blurPII(page);
  await shotPage(page, 'ch03-history');

  // 合併對話框各步驟（示範用的系統產生名稱，不是真人名）
  await go(page, `/dashboard/contacts/${PRIMARY}`);
  await page.getByRole('button', { name: '合併聯繫人' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('搜尋聯絡人...').fill('LINE User');
  await page.waitForTimeout(1500);
  await dialog.locator('button').filter({ hasText: 'd572d8' }).first().click();
  await shot(page, dialog, 'ch03-merge-step1');
  await dialog.getByRole('button', { name: '下一步' }).click();
  await dialog.getByRole('table').waitFor();
  await shot(page, dialog, 'ch03-merge-step2');
  await dialog.getByRole('button', { name: '下一步' }).click();
  await page.waitForTimeout(500);
  await shot(page, dialog, 'ch03-merge-step3');
  await dialog.getByRole('button', { name: '取消' }).click();
});
