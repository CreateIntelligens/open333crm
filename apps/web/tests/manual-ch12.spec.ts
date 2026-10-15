/**
 * 手冊第 12 章「短連結」影片與截圖。
 * ⚠️ 正式環境：只開表單、填示範文字、按「取消」；不編輯既有連結、不刪除。
 * ⚠️ 不在錄影瀏覽器開啟任何 /s/xxx 短網址（會計入點擊、觸發自動貼標）。
 * 寫入保險會擋下所有非 GET 的 API 請求，本章沒有放行任何 POST。
 */
import { test, Page } from '@playwright/test';
import {
  startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage,
} from './manual-video-helpers';
import { shot } from './manual-helpers';

/** 藏掉測試資料列、模糊「目標 URL」欄與 QR 視窗裡的網址 */
const TIDY = `(() => {
  const css = 'td:nth-child(3){filter:blur(5px)!important} dialog p.break-all,[role=dialog] p.break-all{filter:blur(5px)!important}';
  const fix = () => {
    document.querySelectorAll('tr').forEach((tr) => { if ((tr.textContent || '').includes('[E2E]')) tr.style.display = 'none'; });
    document.querySelectorAll('option').forEach((o) => { if ((o.textContent || '').includes('[E2E]')) o.remove(); });
  };
  const boot = () => {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    fix(); new MutationObserver(fix).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();`;

async function tidy(page: Page) {
  await page.context().addInitScript(TIDY);
}

test('ch12-create 建立短連結', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch12-create');
  const { page } = rec;
  await tidy(page);
  await go(page, '/dashboard/shortlinks/links');
  await caption(page, '短連結 > 連結管理，按「建立連結」');
  await tap(page, page.getByRole('button', { name: '建立連結' }));
  const dialog = page.getByRole('dialog');
  await caption(page, '貼上要縮短的原始網址（必填）', 1200);
  await typeIn(page, dialog.getByPlaceholder('https://example.com/page'), 'https://example.com/anniversary');
  await typeIn(page, dialog.getByPlaceholder('連結描述'), '範例：週年慶活動頁');
  await caption(page, '自訂代碼可留空，系統會自動產生', 1200);
  await typeIn(page, dialog.getByPlaceholder('promo1'), 'anniv2026');
  await caption(page, '展開「UTM 參數」，讓 GA 分得出流量來源', 1200);
  await tap(page, dialog.locator('summary', { hasText: 'UTM 參數' }), 600);
  await typeIn(page, dialog.getByPlaceholder('utm_source'), 'line');
  await typeIn(page, dialog.getByPlaceholder('utm_campaign'), 'anniversary');
  await caption(page, '選一個標籤，點擊的客戶會自動被貼上', 2200);
  await point(page, dialog.locator('select').nth(0), 1600);
  await caption(page, '到期時間過了，連結就會失效', 2000);
  await point(page, dialog.locator('input[type="datetime-local"]'), 1400);
  await caption(page, '選 LINE 渠道，可認出在 LINE 裡點的是誰', 2200);
  await point(page, dialog.locator('select').nth(1), 1600);
  await caption(page, '「社群預覽」決定貼到聊天室時的預覽卡', 1200);
  await tap(page, dialog.locator('summary', { hasText: '社群預覽' }), 900);
  await caption(page, '示範到這裡，按「取消」離開', 1500);
  await tap(page, dialog.getByRole('button', { name: '取消', exact: true }));
  await stopRecording(rec);
  poster('ch12-create', 2);
});

test('ch12-list 列表與 QR Code', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch12-list');
  const { page } = rec;
  await tidy(page);
  await go(page, '/dashboard/shortlinks/links');
  await caption(page, '每一列是一個短連結，看得到點擊數與狀態');
  await point(page, page.locator('table thead'), 1600);
  const row = page.locator('tr', { hasText: '/s/0pQ6uA' });
  await caption(page, '操作欄四個小圖示：複製、QR Code、編輯、刪除', 2400);
  await point(page, row.locator('td').last(), 1800);
  await caption(page, '按 QR Code 圖示', 800);
  await tap(page, row.getByTitle('QR Code'), 1500);
  await caption(page, '可以下載 QR Code 圖片印在文宣上', 2400);
  await point(page, page.getByRole('button', { name: '下載' }), 1400);
  await tap(page, page.getByRole('button', { name: '關閉' }));
  await caption(page, '標題是「-」的多半是廣播自動產生的，別改別刪', 2600);
  await stopRecording(rec);
  poster('ch12-list', 2);
});

test('ch12-stats 統計分析', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch12-stats');
  const { page } = rec;
  await tidy(page);
  await go(page, '/dashboard/shortlinks/stats');
  await caption(page, '短連結 > 統計分析，先選一個連結');
  const sel = page.locator('main select').first();
  await point(page, sel, 900);
  const value = await sel.locator('option', { hasText: '0pQ6uA' }).getAttribute('value');
  await sel.selectOption(value!);
  await page.waitForTimeout(2000);
  await caption(page, '上方是總點擊、唯一點擊和識別率', 1000);
  await point(page, page.getByText(/識別率/).first(), 1600);
  await caption(page, '每日點擊趨勢：看哪幾天最多人點', 1000);
  await point(page, page.getByText('每日點擊趨勢'), 1600);
  await caption(page, '右邊是點擊的來源分布', 1000);
  await point(page, page.getByText('來源分布'), 1600);
  await caption(page, '圖表只算近 30 天，最近沒人點就會是空的', 2800);
  await stopRecording(rec);
  poster('ch12-stats', 3);
});

test('ch12 截圖', async ({ browser }) => {
  const page = await newShotPage(browser);
  await tidy(page);
  await go(page, '/dashboard/shortlinks/links');
  await shot(page, page.locator('main .space-y-4').first(), 'ch12-list');
  await page.getByRole('button', { name: '建立連結' }).click();
  await page.waitForTimeout(800);
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('https://example.com/page').fill('https://example.com/anniversary');
  await dialog.getByPlaceholder('連結描述').fill('範例：週年慶活動頁');
  await dialog.locator('summary', { hasText: 'UTM 參數' }).click();
  await dialog.getByPlaceholder('utm_source').fill('line');
  await dialog.getByPlaceholder('utm_campaign').fill('anniversary');
  await shot(page, dialog, 'ch12-create');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  await go(page, '/dashboard/shortlinks/stats');
  const sel = page.locator('main select').first();
  const value = await sel.locator('option', { hasText: '0pQ6uA' }).getAttribute('value');
  await sel.selectOption(value!);
  await page.waitForTimeout(2500);
  await shot(page, page.locator('main .space-y-6').first(), 'ch12-stats');
});
