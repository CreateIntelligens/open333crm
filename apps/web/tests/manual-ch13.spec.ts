/**
 * 手冊第 13 章「報表」影片與截圖（對 UAT 正式環境，只看不匯出）。
 * 不放行任何 POST（匯出 CSV 是 POST，且檔案含真實客戶資料，不示範下載）。
 * 不碰日期輸入框（清空會讓頁面當掉，見 audit A-2）。
 */
import { test, Page } from '@playwright/test';
import { startRecording, stopRecording, poster, caption, point, tap, go, newShotPage } from './manual-video-helpers';
import { shot, shotPage } from './manual-helpers';

/** 模糊客服姓名、案件標題、聯絡人等個資欄（持續監看，切分頁後也有效）。
 * 新版 UI：SLA 違規表的標題改成 h2，改用表頭文字判斷要糊哪幾欄。 */
const MASK_SCRIPT = `(() => {
  const PII_HEADERS = ['案件標題', '指派客服', '聯繫人', '客服'];
  function m(){
    document.querySelectorAll('table').forEach((tbl) => {
      const heads = [...tbl.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim());
      const idx = new Set([0]);
      heads.forEach((h, i) => { if (PII_HEADERS.some((k) => h.startsWith(k))) idx.add(i); });
      tbl.querySelectorAll('tbody tr').forEach((tr) => {
        const tds = tr.querySelectorAll('td');
        idx.forEach((i) => { if (tds[i]) tds[i].style.filter = 'blur(6px)'; });
      });
    });
  }
  function boot(){ m(); new MutationObserver(m).observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();`;
async function maskPeople(page: Page) {
  await page.addInitScript(MASK_SCRIPT);
}

test('ch13-analytics 報表總覽', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch13-analytics');
  const { page } = rec;
  await maskPeople(page);
  await go(page, '/dashboard/analytics');
  // 新版側欄：收合按鈕叫「收合子選單」，收起來讓報表畫面寬一點
  await page.getByRole('button', { name: '收合子選單' }).click().catch(() => {});
  await page.mouse.move(700, 450); // 移開滑鼠，收掉「展開子選單」提示
  await page.waitForTimeout(800);
  await caption(page, '「報表 > 總覽」看整個團隊的成績');
  await point(page, page.getByRole('radio', { name: '30 天' }), 1200);
  await caption(page, '右上角選要看的期間');
  await tap(page, page.getByRole('radio', { name: '90 天' }), 2500);
  await caption(page, '上方四張卡是最重要的數字', 2200);
  await tap(page, page.getByRole('tab', { name: '案件報表' }), 400);
  await caption(page, '「案件報表」看案件量與 SLA 違規');
  await tap(page, page.getByRole('tab', { name: '客服績效' }), 400);
  await caption(page, '「客服績效」比較每位客服的表現');
  await tap(page, page.getByRole('tab', { name: '渠道分析' }), 400);
  await caption(page, '「渠道分析」看客人都從哪裡來');
  await point(page, page.getByRole('button', { name: '匯出 CSV' }), 1400);
  await caption(page, '需要留存時按「匯出 CSV」', 2200);
  await tap(page, page.getByRole('tab', { name: '概覽' }), 1200);
  await stopRecording(rec);
  poster('ch13-analytics', 2);
});

test('ch13 截圖', async ({ browser }) => {
  test.setTimeout(150000);
  const page = await newShotPage(browser);
  await maskPeople(page);
  await go(page, '/dashboard/analytics');
  await page.waitForTimeout(1500);
  await shotPage(page, 'ch13-overview');
  // CSAT 卡的「客服代評 N 筆」只有期間內有代評才出現；UAT 示範租戶沒有代評，
  // 攔截概覽的 GET 回應補上示範數字（只改 GET，其他方法 fallback，寫入仍由 guardWrites 擋下）
  const OVERVIEW = '**/api/v1/analytics/overview**';
  await page.route(OVERVIEW, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') return route.fulfill({ response: res });
    const patch = (d: any) => ({ ...d, csatAvg: d.csatAvg ?? 4.5, csatAgentRatedCount: d.csatAgentRatedCount || 1 });
    const json = body.data && typeof body.data === 'object' ? { ...body, data: patch(body.data) } : patch(body);
    return route.fulfill({ response: res, json });
  });
  await page.getByRole('radio', { name: '90 天' }).click();
  await page.waitForTimeout(2500);
  await shot(page, page.getByRole('region', { name: '關鍵指標' }), 'ch13-kpi-csat');
  await page.unroute(OVERVIEW);
  await page.getByRole('radio', { name: '30 天' }).click();
  await page.waitForTimeout(2000);
  await page.getByRole('tab', { name: '案件報表' }).click();
  await page.waitForTimeout(2000);
  await shotPage(page, 'ch13-cases');
  await page.getByRole('tab', { name: '客服績效' }).click();
  await page.waitForTimeout(2000);
  await shotPage(page, 'ch13-agents');
  await page.getByRole('tab', { name: '渠道分析' }).click();
  await page.waitForTimeout(2000);
  await shotPage(page, 'ch13-channels');
  // 一般客服：側欄沒有「報表」，但直接開網址可以看到自己的績效
  const agent = await newShotPage(browser, { storageState: 'auth-state-agent.json' });
  await go(agent, '/dashboard/analytics/my');
  await agent.waitForTimeout(1500);
  await shotPage(agent, 'ch13-my');
});
