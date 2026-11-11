/**
 * 手冊第 14 章「方案與帳務」影片與截圖（對 UAT 正式環境）。
 * 絕不按「送出申請」，且寫入保險會擋下所有 POST。
 * 示範租戶目前有一筆「處理中」的申請，表單被隱藏；為了示範表單長相，
 * 影片與表單截圖把 GET /plan-change 換成空清單（只影響這個瀏覽器分頁，不動正式資料）。
 */
import { test, Page } from '@playwright/test';
import { startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage } from './manual-video-helpers';
import { shot, shotPage } from './manual-helpers';

async function emptyHistory(page: Page) {
  await page.route('**/api/v1/plan-change', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
}

test('ch14-plan 申請升級或加購（不送出）', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch14-plan');
  const { page } = rec;
  await emptyHistory(page);
  await go(page, '/dashboard/plan');
  await caption(page, '「方案／帳務」用來申請升級或加購');
  await point(page, page.getByRole('button', { name: '升級方案' }), 1200);
  await caption(page, '要換更大的方案，選「升級方案」');
  await point(page, page.locator('select').first(), 1600);
  await caption(page, '在「目標方案」選要升到哪一版');
  await tap(page, page.getByRole('button', { name: '加購 Token' }));
  await caption(page, 'AI 額度不夠用，選「加購 Token」');
  await tap(page, page.getByRole('button', { name: '+50 萬' }));
  await caption(page, '選要加購多少額度');
  await typeIn(page, page.getByPlaceholder(/促銷檔期/), '範例：週年慶期間詢問量會增加');
  await caption(page, '備註可以寫原因，方便平台方審核', 2200);
  await point(page, page.getByRole('button', { name: '送出申請' }), 1600);
  await caption(page, '確認後按「送出申請」，等平台方核准', 2600);
  await caption(page, '（示範到這裡，不送出）', 1600);
  await stopRecording(rec);
  poster('ch14-plan', 2);
});

test('ch14 截圖', async ({ browser }) => {
  test.setTimeout(120000);
  const page = await newShotPage(browser);
  await go(page, '/dashboard/plan');
  // 真實畫面：有處理中的申請時表單會被隱藏；遮掉測試用備註
  await page.evaluate(() => {
    document.querySelectorAll('span.text-xs.text-muted-foreground').forEach((el) => { (el as HTMLElement).style.filter = 'blur(5px)'; });
  });
  await shot(page, page.locator('div.mx-auto.max-w-2xl'), 'ch14-pending');
  const p2 = await newShotPage(browser);
  await emptyHistory(p2);
  await go(p2, '/dashboard/plan');
  await shot(p2, p2.locator('div.mx-auto.max-w-2xl'), 'ch14-form-upgrade');
  await p2.getByRole('button', { name: '加購 Token' }).click();
  await p2.getByRole('button', { name: '+50 萬' }).click();
  await p2.getByPlaceholder(/促銷檔期/).fill('範例：週年慶期間詢問量會增加');
  await shot(p2, p2.locator('div.mx-auto.max-w-2xl'), 'ch14-form-topup');
  // 檢查：一般客服側欄（展開分析與管理）
  const agent = await newShotPage(browser, { storageState: 'auth-state-agent.json' });
  await go(agent, '/dashboard/inbox');
  await agent.getByRole('button', { name: '展開分析與管理' }).click().catch(() => {});
  await agent.waitForTimeout(800);
  await agent.screenshot({ path: '/private/tmp/claude-501/-Users-danielyang-Documents-opencrm-poc/d60edcc2-6f15-4406-b5fc-7cb731f17dc1/scratchpad/c6/agent-sidebar.png' });
});
