/**
 * 手冊第 04 章「通知」：影片與截圖。
 * 正式環境：不按「全部已讀」「標記已讀」，也不點通知卡片（點了會標成已讀）。
 */
import { test, Page, BrowserContext } from '@playwright/test';
import { startRecording, stopRecording, poster, caption, point, tap, go, newShotPage } from './manual-video-helpers';
import { shot, shotPage } from './manual-helpers';

async function blurNames(page: Page) {
  await page.addStyleTag({ content: `table tbody td:first-child span.text-sm{filter:blur(6px)!important}` });
}

/**
 * 2026-10-15 之前產生的 SLA 通知標題是英文，資料庫裡的舊通知仍是英文；之後產生的已是中文。
 * 畫面上把這兩個舊標題換成系統現在的中文標題（apps/workers/src/handlers/sla.handler.ts），
 * 讓手冊呈現目前的樣子。只改畫面上的文字，不改資料。
 */
async function currentSlaTitles(context: BrowserContext) {
  await context.addInitScript(() => {
    const map: Record<string, string> = {
      'First response SLA breached': '首次回應已逾期',
      'Resolution SLA breached': '解決期限已逾期',
    };
    const fix = (root: Node) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = w.nextNode())) {
        const t = (n.textContent || '').trim();
        if (map[t]) n.textContent = (n.textContent || '').replace(t, map[t]);
      }
    };
    const run = () => {
      if (document.body) fix(document.body);
    };
    new MutationObserver(run).observe(document, { childList: true, subtree: true, characterData: true });
    run();
  });
}

const bell = (page: Page) => page.locator('button:has(svg.lucide-bell)').first();
const dropdown = (page: Page) =>
  page.getByRole('button', { name: '查看全部通知' }).locator('xpath=ancestor::div[contains(@class,"shadow-lg")][1]');

test('ch04-notifications', async ({ browser }) => {
  test.setTimeout(150_000);
  const rec = await startRecording(browser, 'ch04-notifications');
  const { page } = rec;
  await currentSlaTitles(rec.context);
  await go(page, '/dashboard/contacts');
  await blurNames(page);
  await caption(page, '右上角的鈴鐺就是通知', 1200);
  await point(page, bell(page), 1600);
  await caption(page, '紅色數字是還沒看的通知數', 2000);
  await tap(page, bell(page), 1500);
  await caption(page, '點開會看到最新 10 則', 1200);
  await point(page, dropdown(page), 2000);
  await caption(page, '「全部已讀」一次清掉紅色數字', 1200);
  await point(page, dropdown(page).getByRole('button', { name: '全部已讀' }), 1600);
  await caption(page, '按「查看全部通知」看完整清單', 1000);
  await tap(page, page.getByRole('button', { name: '查看全部通知' }), 2500);
  await caption(page, '用分頁切換全部、未讀、已讀', 1000);
  await tap(page, page.getByRole('button', { name: '未讀', exact: true }), 1800);
  await tap(page, page.getByRole('button', { name: '已讀', exact: true }), 1800);
  await tap(page, page.getByRole('button', { name: '全部', exact: true }), 800);
  await page.locator('main div.cursor-pointer').first().waitFor({ timeout: 20000 });
  await caption(page, '未讀的卡片底色較深、右邊有藍點', 1200);
  await point(page, page.locator('main div.cursor-pointer').first(), 2000);
  await caption(page, '點一則通知，就會帶你到相關頁面', 2400);
  await stopRecording(rec);
  poster('ch04-notifications', 2);
});

test('ch04 截圖', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newShotPage(browser);
  await currentSlaTitles(page.context());
  await go(page, '/dashboard/contacts');
  await blurNames(page);
  await bell(page).click();
  await page.waitForTimeout(1200);
  await shot(page, dropdown(page), 'ch04-bell');
  await go(page, '/dashboard/notifications');
  await shotPage(page, 'ch04-page');
});
