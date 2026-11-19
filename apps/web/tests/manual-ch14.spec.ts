/**
 * 手冊第 14 章「方案與帳務」影片與截圖（對 UAT 正式環境）。
 * 絕不按「送出申請」，且寫入保險會擋下所有 POST。
 * 新版 UI：「升級方案／加購 Token」是 role=tab，加購額度是 role=radio，備註用 label「備註」定位；
 * 外框沒有語意名稱，用 h1「方案」往上兩層取整塊內容。
 * 示範租戶目前有一筆「處理中」的申請，表單被隱藏；為了示範表單長相，
 * 影片與表單截圖把 GET /plan-change 換成空清單（只影響這個瀏覽器分頁，不動正式資料）。
 * 示範租戶的 AI 額度是「無上限」，新版 UI 會停用「加購 Token」分頁；為了示範加購表單，
 * 同樣把 GET /plan-change/topup-eligibility 換成 allowed: true（一樣只影響這個分頁）。
 */
import { test, Page } from '@playwright/test';
import { startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage } from './manual-video-helpers';
import { shot, shotPage } from './manual-helpers';

/** 方案頁主要內容（標題＋表單＋申請記錄） */
function planBox(page: Page) {
  return page.getByRole('heading', { name: '方案', level: 1 }).locator('xpath=../..');
}

/**
 * 示範租戶目前沒有「處理中」的申請，拍不到表單被換成提示文字的畫面；
 * 把 GET /plan-change 換成一筆示範用的處理中申請（只影響這個瀏覽器分頁，不動正式資料，不送任何寫入）。
 */
async function pendingHistory(page: Page) {
  await page.route('**/api/v1/plan-change', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const demo = [{
      id: 'demo-pending', type: 'upgrade', targetPlanSlug: 'professional', topupTokens: null,
      note: null, status: 'pending', reviewedAt: null, createdAt: new Date().toISOString(),
    }];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: demo }) });
  });
}

async function emptyHistory(page: Page) {
  await page.route('**/api/v1/plan-change', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/v1/plan-change/topup-eligibility', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { allowed: true } }) });
  });
}

test('ch14-plan 申請升級或加購（不送出）', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch14-plan');
  const { page } = rec;
  await emptyHistory(page);
  await go(page, '/dashboard/plan');
  await caption(page, '「方案／帳務」用來申請升級或加購');
  await point(page, page.getByRole('tab', { name: '升級方案' }), 1200);
  await caption(page, '要換更大的方案，選「升級方案」');
  await point(page, page.getByLabel('目標方案'), 1600);
  await caption(page, '在「目標方案」選要升到哪一版');
  await tap(page, page.getByRole('tab', { name: '加購 Token' }));
  await caption(page, 'AI 額度不夠用，選「加購 Token」');
  await tap(page, page.getByRole('radio', { name: /\+50 萬/ }));
  await caption(page, '選要加購多少額度');
  await typeIn(page, page.getByLabel(/備註/), '範例：週年慶期間詢問量會增加');
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
  await pendingHistory(page);
  await go(page, '/dashboard/plan');
  // 有處理中的申請時表單會被隱藏；保險起見仍遮掉記錄裡的時間與備註
  await page.evaluate(() => {
    document.querySelectorAll('span.truncate.text-xs').forEach((el) => { (el as HTMLElement).style.filter = 'blur(5px)'; });
  });
  await shot(page, planBox(page), 'ch14-pending');
  const p2 = await newShotPage(browser);
  await emptyHistory(p2);
  await go(p2, '/dashboard/plan');
  await shot(p2, planBox(p2), 'ch14-form-upgrade');
  await p2.getByRole('tab', { name: '加購 Token' }).click();
  await p2.getByRole('radio', { name: /\+50 萬/ }).click();
  await p2.getByLabel(/備註/).fill('範例：週年慶期間詢問量會增加');
  await shot(p2, planBox(p2), 'ch14-form-topup');
});
