/**
 * 手冊第 17 章「其他設定」影片與截圖。
 * ⚠️ 正式環境：只開對話框、填示範文字、按「取消」。不按儲存／建立／產生 Token／撤銷／刪除。
 * 營業時間的開關與假日「新增」只改畫面上的草稿，沒有按「儲存設定」就不會寫入。
 */
import { test, Page } from '@playwright/test';
import { startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage } from './manual-video-helpers';
import { shot } from './manual-helpers';

/** 去識別化：糊掉客戶名稱、隱藏 [E2E] 測試資料（持續監看，對話框晚載入也會處理） */
async function scrub(page: Page) {
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const run = () => {
      const leaves = [...document.querySelectorAll('main *, [role="dialog"] *')].filter((e) => e.children.length === 0);
      for (const el of leaves) {
        const t = (el.textContent || '').trim();
        if (/^Daniel$|david|tatung|大同/i.test(t)) (el as HTMLElement).style.filter = 'blur(6px)';
        if (t.startsWith('[E2E]')) {
          const box = (el.closest('tr, li, .grid > div') || el.closest('div.rounded-lg.border')) as HTMLElement | null;
          if (box) box.style.display = 'none';
        }
      }
    };
    run();
    if (!(window as any).__scrubObs) {
      (window as any).__scrubObs = new MutationObserver(() => run());
      (window as any).__scrubObs.observe(document.body, { childList: true, subtree: true });
    }
  });
}

/** 對話框較高時，字幕移到左下，避免被蓋住 */
async function captionLeft(page: Page) {
  await page.addStyleTag({ content: '#mv-cap{left:24px!important;transform:none!important;max-width:300px!important}' });
}

test('ch17-tags 新增標籤', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch17-tags');
  const { page } = rec;
  await go(page, '/dashboard/settings/tags');
  await scrub(page);
  await caption(page, '標籤管理列出所有分類標籤');
  await caption(page, '上方可依適用範圍篩選', 800);
  await tap(page, page.getByRole('button', { name: /^案件 \d+$/ }));
  await tap(page, page.getByRole('button', { name: /^全部 \d+$/ }));
  await caption(page, '按「新增標籤」建立新的', 800);
  await tap(page, page.getByRole('button', { name: '新增標籤' }));
  await captionLeft(page);
  const dlg = page.getByRole('dialog');
  await caption(page, '取一個好懂的名稱', 600);
  await typeIn(page, dlg.getByPlaceholder('例：VIP'), '範例：週年慶參加者');
  await caption(page, '挑一個顏色', 600);
  await tap(page, dlg.locator('button[style*="background"]').nth(3), 800);
  await caption(page, '選這個標籤要貼在哪裡', 600);
  await point(page, dlg.locator('select'), 1400);
  await typeIn(page, dlg.getByPlaceholder('標籤用途說明'), '範例：參加週年慶活動的客人');
  await caption(page, '下方預覽貼上去的樣子', 600);
  await point(page, dlg.getByText('預覽：'), 1400);
  await caption(page, '示範按取消，不建立', 800);
  await tap(page, dlg.getByRole('button', { name: '取消', exact: true }));
  await stopRecording(rec);
  poster('ch17-tags', 2);
});

test('ch17-sla 建立 SLA 政策', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch17-sla');
  const { page } = rec;
  await go(page, '/dashboard/settings/sla');
  await caption(page, '每個優先級各有回覆與解決的時限');
  await point(page, page.getByText('首回時間').first(), 1600);
  await caption(page, '按「建立 SLA 政策」', 800);
  await tap(page, page.getByRole('button', { name: '建立 SLA 政策' }));
  await captionLeft(page);
  const dlg = page.getByRole('dialog');
  await typeIn(page, dlg.getByPlaceholder('例：VIP 快速服務'), '範例：VIP 快速服務');
  await caption(page, '選要套用的優先級', 600);
  await point(page, dlg.locator('select'), 800);
  await dlg.locator('select').selectOption({ label: '高' });
  await page.waitForTimeout(800);
  const nums = dlg.locator('input[type=number]');
  await caption(page, '首次回應：幾分鐘內要回第一句', 600);
  await nums.nth(0).fill('');
  await typeIn(page, nums.nth(0), '30');
  await caption(page, '解決時間：幾分鐘內要結案', 600);
  await nums.nth(1).fill('');
  await typeIn(page, nums.nth(1), '240');
  await caption(page, '預警：到期前多久先提醒', 600);
  await nums.nth(2).fill('');
  await typeIn(page, nums.nth(2), '30');
  await caption(page, '示範按取消，不儲存', 800);
  await tap(page, dlg.getByRole('button', { name: '取消', exact: true }));
  await stopRecording(rec);
  poster('ch17-sla', 2);
});

test('ch17-office-hours 營業時間', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch17-office-hours');
  const { page } = rec;
  await go(page, '/dashboard/settings/office-hours');
  await caption(page, '先打開營業時間的總開關', 800);
  await tap(page, page.getByRole('switch').first(), 1500);
  await caption(page, '選你的時區', 600);
  await point(page, page.locator('main select').first(), 1400);
  await caption(page, '每天可以開關，填上下班時間', 600);
  await point(page, page.getByText('每週排程'), 800);
  await point(page, page.locator('input[type=time]').first(), 1400);
  await caption(page, '國定假日可以另外加進來', 600);
  await page.locator('input[type=date]').fill('2026-12-25');
  await point(page, page.locator('input[type=date]'), 800);
  await tap(page, page.getByRole('button', { name: '新增', exact: true }), 1200);
  await caption(page, '下班時間收到訊息，會自動回這段話', 600);
  await point(page, page.locator('main textarea'), 2000);
  await caption(page, '設定好按「儲存設定」；示範不儲存', 600);
  await point(page, page.getByRole('button', { name: '儲存設定' }), 1800);
  await stopRecording(rec);
  poster('ch17-office-hours', 2);
});

test('ch17-identity-binding 跨渠道綁定', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch17-identity-binding');
  const { page } = rec;
  await go(page, '/dashboard/settings/identity-binding');
  await caption(page, '讓同一位客人在不同渠道被認成同一人');
  await caption(page, '方法一：綁定代碼', 600);
  await point(page, page.getByText('啟用跨渠道綁定').first(), 1400);
  await caption(page, '客人傳這個關鍵字，就會收到綁定代碼', 600);
  await point(page, page.getByPlaceholder('綁定帳號'), 1800);
  await caption(page, '傳這個關鍵字可以自己解除', 600);
  await point(page, page.getByPlaceholder('解除綁定'), 1600);
  await caption(page, '方法二：客人登記 email 自動歸戶', 600);
  await point(page, page.getByRole('heading', { name: 'Email 登記' }), 1800);
  await caption(page, '方法三：客人登記手機自動歸戶', 600);
  await point(page, page.getByRole('heading', { name: '手機登記' }), 1800);
  await caption(page, '開啟前，先看完這份確認清單', 600);
  await point(page, page.getByText('啟用前請確認'), 2200);
  await stopRecording(rec);
  poster('ch17-identity-binding', 2);
});

test('ch17 截圖', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await newShotPage(browser);
  page.on('dialog', (d) => d.dismiss());

  await go(page, '/dashboard/settings/tags');
  await scrub(page);
  await shot(page, page.locator('main'), 'ch17-tags');
  await page.getByRole('button', { name: '新增標籤' }).click();
  await page.waitForTimeout(1000);
  await shot(page, page.getByRole('dialog'), 'ch17-tag-add');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();

  await go(page, '/dashboard/settings/sla');
  await shot(page, page.locator('main'), 'ch17-sla');
  await page.getByRole('button', { name: '建立 SLA 政策' }).click();
  await page.waitForTimeout(1000);
  await shot(page, page.getByRole('dialog'), 'ch17-sla-add');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();

  // 只在畫面上打開開關讓區塊顯示，不按儲存
  await go(page, '/dashboard/settings/office-hours');
  await page.getByRole('switch').first().click();
  await page.waitForTimeout(800);
  await shot(page, page.locator('main'), 'ch17-office-hours');

  await go(page, '/dashboard/settings/tracking');
  await shot(page, page.locator('main'), 'ch17-tracking');

  await go(page, '/dashboard/settings/identity-binding');
  await shot(page, page.locator('main'), 'ch17-identity-binding');

  await go(page, '/dashboard/settings/api-keys');
  await page.getByRole('button', { name: '建立金鑰' }).click();
  await page.waitForTimeout(1000);
  await shot(page, page.getByRole('dialog'), 'ch17-apikey-add');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();

  await go(page, '/dashboard/settings/cli-sessions');
  await page.getByRole('button', { name: '產生 Token' }).first().click();
  await page.waitForTimeout(1000);
  await shot(page, page.getByRole('dialog'), 'ch17-cli-add');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
});

test('ch17-webtalk WebTalk 協作設定', async ({ browser }) => {
  const page = await newShotPage(browser);
  await go(page, '/dashboard/settings/webtalk');
  await shot(page, page.locator('main'), 'ch17-webtalk');
});
