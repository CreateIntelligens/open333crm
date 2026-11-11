/**
 * 手冊第 02 章「工單」操作影片與截圖。
 * ⚠️ UAT 即正式環境：只開表單、打示範文字、按取消；所有寫入請求都被 guardWrites 擋下。
 * 詳情頁的下拉選了就會存檔，所以影片只框出、不改值。
 */
import { test, Page, BrowserContext } from '@playwright/test';
import {
  startRecording, stopRecording, poster, go, caption, point, tap, typeIn, newShotPage,
} from './manual-video-helpers';
import { shot, shotPage } from './manual-helpers';

/** 遮蔽真實姓名（聯絡人欄）、隱藏右下浮動工具 */
const PII_SCRIPT = `(() => {
  function run(){
    // 列表聯絡人欄（第 3 欄）：非匿名訪客就模糊
    const ths = [...document.querySelectorAll('thead th')];
    const ci = ths.findIndex(th => (th.textContent || '').trim() === '聯絡人');
    if (ci >= 0) document.querySelectorAll('tbody tr').forEach(tr => {
      const td = tr.children[ci]; if (!td) return;
      if (!(td.textContent || '').includes('Chatbox Visitor')) td.style.filter = 'blur(6px)';
    });
    document.querySelectorAll('h1,h2,h3,h4,p,span,a,div,button,td,dd').forEach(e => {
      if (e.children.length) return;
      const t = (e.textContent || '').trim();
      if (t === '劉柏毅' || t === 'Daniel') e.style.filter = 'blur(6px)';
    });
    document.querySelectorAll('[title="聊天室"],[title="網頁摘要與對話"],[title="切換主題"]').forEach(b => {
      let e = b; for (let i = 0; i < 8 && e && e.parentElement && e.parentElement !== document.body; i++) e = e.parentElement;
      if (e && e !== document.body) e.style.display = 'none';
    });
  }
  setInterval(run, 250);
})();`;

async function protect(context: BrowserContext, page: Page) {
  await context.addInitScript(PII_SCRIPT);
  await page.addScriptTag({ content: PII_SCRIPT }).catch(() => {});
}

/** 有指派負責人的工單（看起來最接近日常使用），找不到就用第一筆 */
/** 「標記解決」「升級」只在處理中的工單出現，所以優先挑處理中的工單 */
const pickRow = async (page: Page) => {
  const inProgress = page.locator('tbody tr').filter({ hasText: '處理中' }).first();
  if (await inProgress.count()) return inProgress;
  const assigned = page.locator('tbody tr').filter({ hasNotText: '未指派' }).first();
  return (await assigned.count()) ? assigned : page.locator('tbody tr').first();
};

async function openCase(page: Page) {
  await go(page, '/dashboard/cases');
  await (await pickRow(page)).click();
  await page.getByText('時間軸與備註').waitFor();
  await page.waitForTimeout(1500);
}

test('ch02-list 工單列表與篩選', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch02-list');
  const { page } = rec;
  await protect(rec.context, page);
  await go(page, '/dashboard/cases');
  await caption(page, '上方四張卡片是目前的工作量', 1700);
  await point(page, page.getByText('SLA 違規').first().locator('xpath=ancestor::div[contains(@class,"grid")][1]'), 2000);
  await caption(page, '搜尋框可以找標題或描述', 1700);
  await typeIn(page, page.getByPlaceholder(/搜尋工單標題或描述/), '自動建單');
  await page.waitForTimeout(1000);
  await page.getByPlaceholder(/搜尋工單標題或描述/).fill('');
  await caption(page, '下拉選單依負責人、優先級、分類、SLA 篩選', 1700);
  const pri = page.locator('select').filter({ hasText: '所有優先級' });
  await point(page, pri, 600);
  await pri.selectOption({ label: '緊急' });
  await page.waitForTimeout(1500);
  await pri.selectOption({ index: 0 });
  await caption(page, '下方分頁依狀態切換', 1700);
  await tap(page, page.getByRole('tab', { name: /開啟/ }).or(page.getByRole('button', { name: /^開啟/ })).first(), 1000);
  await tap(page, page.getByRole('tab', { name: /全部/ }).or(page.getByRole('button', { name: /^全部/ })).first(), 800);
  await caption(page, 'SLA 欄是剩下的處理時間，紅色代表已逾時', 1700);
  await point(page, page.locator('thead th', { hasText: 'SLA' }), 2200);
  await caption(page, '點任一列進入工單詳情', 1800);
  await stopRecording(rec);
  poster('ch02-list', 2);
});

test('ch02-detail 工單詳情', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch02-detail');
  const { page } = rec;
  await protect(rec.context, page);
  await go(page, '/dashboard/cases');
  await caption(page, '點一張工單打開詳情', 1700);
  await tap(page, await pickRow(page), 2000);
  await page.getByText('時間軸與備註').waitFor();
  await caption(page, '左邊可以直接改狀態、優先級、分類', 1700);
  await point(page, page.locator('h4', { hasText: '狀態' }).locator('..'), 1400);
  await point(page, page.locator('h4', { hasText: '優先級' }).locator('..'), 1200);
  await point(page, page.locator('h4', { hasText: '分類' }).locator('..'), 1200);
  await caption(page, '也能改負責人，選了就自動儲存', 1700);
  await point(page, page.locator('h4', { hasText: '負責人' }).locator('..'), 1800);
  await caption(page, '往下看 SLA 時限', 1700);
  await point(page, page.locator('h4', { hasText: 'SLA' }).locator('..'), 2000);
  const link = page.getByRole('link', { name: '查看對話' });
  if (await link.count()) {
    await caption(page, '「查看對話」回到原本的收件匣對話', 1700);
    await point(page, link, 1800);
  }
  await caption(page, '右上角是常用的狀態按鈕', 1700);
  await point(page, page.getByRole('button', { name: '標記解決' }), 1000);
  await point(page, page.getByRole('button', { name: '關閉案件' }), 1000);
  await point(page, page.getByRole('button', { name: '升級' }), 1200);
  await caption(page, '「標記解決」「升級」只在處理中的工單出現，新工單請先改成處理中', 2600);
  await stopRecording(rec);
  poster('ch02-detail', 2);
});

test('ch02-notes 時間軸與內部備註', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch02-notes');
  const { page } = rec;
  await protect(rec.context, page);
  await openCase(page);
  await caption(page, '右邊是這張工單的所有紀錄', 1700);
  await point(page, page.getByText('時間軸與備註').locator('../..'), 1800);
  await caption(page, '同事之間的交接，寫在備註', 1700);
  await typeIn(page, page.getByPlaceholder('撰寫備註...'), '範例：已電話聯繫客戶，明天回覆');
  await caption(page, '「內部備註」預設勾選，只有後台看得到', 1700);
  await point(page, page.getByLabel('內部備註'), 1800);
  await caption(page, '按「新增備註」就會加進時間軸', 1700);
  await point(page, page.getByRole('button', { name: '新增備註' }), 1800);
  await page.getByPlaceholder('撰寫備註...').fill('');
  await caption(page, '示範到這裡，不送出', 1500);
  await stopRecording(rec);
  poster('ch02-notes', 2);
});

test('ch02-create 新增工單', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch02-create');
  const { page } = rec;
  await protect(rec.context, page);
  await go(page, '/dashboard/cases');
  await caption(page, '按右上角「新增工單」', 1700);
  await tap(page, page.getByRole('button', { name: '新增工單' }), 1200);
  const dlg = page.getByRole('dialog');
  await caption(page, '先搜尋並選擇聯絡人（至少 2 個字）', 1700);
  await typeIn(page, page.getByPlaceholder('搜尋聯絡人姓名...'), 'Chatbox');
  await page.waitForTimeout(1500);
  const cand = dlg.locator('div.absolute.z-50 button, div.absolute.z-50 [role=option], div.absolute.z-50 div.cursor-pointer').first();
  if (await cand.count()) await tap(page, cand, 800);
  await caption(page, '工單掛在聯絡人所在的渠道；有好幾個渠道時要選一個', 2200);
  const ch = dlg.getByText(/^渠道/).first();
  if (await ch.count()) await point(page, ch, 1400);
  await caption(page, '填案件標題', 1700);
  await typeIn(page, page.getByPlaceholder('案件標題...'), '範例：週年慶訂單查詢');
  await caption(page, '選分類，優先級預設是「中」', 1700);
  const cat = dlg.locator('select').filter({ hasText: '訂單問題' }).first();
  await point(page, cat, 600);
  await cat.selectOption({ label: '訂單問題' });
  await page.waitForTimeout(800);
  await caption(page, '負責人、SLA 可以先不選', 1700);
  await point(page, dlg.locator('select').last(), 1400);
  await caption(page, '按「建立案件」完成，這裡示範先取消', 1700);
  await point(page, dlg.getByRole('button', { name: '建立案件' }), 1400);
  await tap(page, dlg.getByRole('button', { name: '取消' }), 800);
  await stopRecording(rec);
  poster('ch02-create', 2);
});

test('ch02 截圖', async ({ browser }) => {
  const page = await newShotPage(browser);
  await protect(page.context(), page);
  await go(page, '/dashboard/cases');
  await page.waitForTimeout(1000);
  await shotPage(page, 'ch02-list');
  await openCase(page);
  await shotPage(page, 'ch02-detail');
  await shot(page, page.getByText('時間軸與備註').locator('../..'), 'ch02-timeline');
  await page.getByRole('button', { name: '升級' }).click();
  await page.waitForTimeout(800);
  await shot(page, page.getByRole('dialog'), 'ch02-escalate');
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
  await go(page, '/dashboard/cases');
  await page.getByRole('button', { name: '新增工單' }).click();
  await page.waitForTimeout(800);
  await shot(page, page.getByRole('dialog'), 'ch02-create-dialog');
});
