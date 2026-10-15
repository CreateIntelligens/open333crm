/**
 * 手冊第 11 章「粉絲活動」影片與截圖。
 * ⚠️ 正式環境：只開表單、填示範文字、按「取消」。不按發布、結束、刪除、抽獎、確認調整。
 * 寫入保險會擋下所有非 GET 的 API 請求，本章沒有放行任何 POST。
 */
import { test, Page } from '@playwright/test';
import {
  startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage,
} from './manual-video-helpers';
import { shot } from './manual-helpers';

/** 去掉示範租戶測試資料的「[E2E] 」前綴，讓畫面乾淨一點（只改畫面文字，不改資料） */
const TIDY = `(() => {
  const fix = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      const t = n.textContent || '';
      if (t.includes('[E2E] ')) n.textContent = t.replace(/\\[E2E\\] /g, '');
    }
  };
  const boot = () => { fix(document.body); new MutationObserver(() => fix(document.body)).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();`;

async function tidy(page: Page) {
  await page.context().addInitScript(TIDY);
}

test('ch11-activities 建立活動', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch11-activities');
  const { page } = rec;
  await tidy(page);
  await go(page, '/dashboard/portal/activities');
  await caption(page, '粉絲活動 > 活動管理，每張卡片是一個活動');
  await point(page, page.locator('.grid > div').first(), 1800);
  await caption(page, '卡片上看得到類型、狀態和參加人數', 2000);
  await point(page, page.getByRole('button', { name: '查看已封存' }));
  await caption(page, '封存的活動收在「查看已封存」裡', 2000);
  await tap(page, page.getByRole('button', { name: '建立活動' }));
  const dialog = page.getByRole('dialog');
  await caption(page, '先選類型：投票、表單或競猜', 2000);
  await typeIn(page, dialog.getByPlaceholder('活動標題'), '範例：週年慶人氣商品投票');
  await typeIn(page, dialog.getByPlaceholder('活動描述'), '選出你最愛的商品');
  await caption(page, '投票要列出選項，按「新增」可多加一列', 2200);
  await typeIn(page, dialog.getByPlaceholder('選項 1'), '保溫杯');
  await tap(page, dialog.getByRole('button', { name: '新增' }).first(), 600);
  await typeIn(page, dialog.getByPlaceholder('選項 2'), '帆布袋');
  await caption(page, '改選「競猜」，每個選項多一個「正確」勾選', 1200);
  await dialog.locator('select').first().selectOption('QUIZ');
  await page.waitForTimeout(800);
  await point(page, dialog.getByText('正確').first(), 1600);
  await caption(page, '改選「表單」，改成設定要客戶填的欄位', 1200);
  await dialog.locator('select').first().selectOption('FORM');
  await page.waitForTimeout(800);
  await point(page, dialog.getByPlaceholder('欄位 key').first(), 1600);
  await caption(page, '這次只是示範，按「取消」離開', 1500);
  await tap(page, dialog.getByRole('button', { name: '取消', exact: true }));
  await stopRecording(rec);
  poster('ch11-activities', 3);
});

test('ch11-submissions 提交紀錄', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch11-submissions');
  const { page } = rec;
  await tidy(page);
  await go(page, '/dashboard/portal/submissions');
  await caption(page, '粉絲活動 > 提交紀錄');
  await point(page, page.locator('main select').first());
  await caption(page, '先選一個活動', 1200);
  await page.locator('main select').first().selectOption({ index: 1 });
  await page.waitForTimeout(1500);
  await caption(page, '下方表格列出參加者與答案摘要', 2200);
  await point(page, page.locator('main table').first(), 1800);
  await caption(page, '右上的「抽獎」可從參加者中隨機抽出中獎人', 2400);
  await point(page, page.getByRole('button', { name: '抽獎' }).first(), 1800);
  await caption(page, '抽出的結果無法收回，按之前請確認', 2400);
  await stopRecording(rec);
  poster('ch11-submissions', 2);
});

test('ch11-points 查積分與手動調整', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch11-points');
  const { page } = rec;
  await go(page, '/dashboard/portal/points');
  await caption(page, '粉絲活動 > 積分管理');
  const box = page.getByPlaceholder('搜尋聯絡人（名稱、電話、Email）');
  await typeIn(page, box, 'Chatbox Visitor');
  await box.press('Enter');
  await page.waitForTimeout(2000);
  await caption(page, '找到的客戶名稱與目前點數會顯示在這裡', 2400);
  await point(page, page.getByText(/\d+ 點/).first(), 1600);
  await caption(page, '先核對名稱是不是你要找的人', 2400);
  await tap(page, page.getByRole('button', { name: '手動調整' }));
  const dialog = page.getByRole('dialog');
  await caption(page, '正數是加點，負數是扣點', 1200);
  const amt = dialog.locator('input[type="number"]');
  await point(page, amt, 500);
  await amt.selectText();
  await amt.pressSequentially('50', { delay: 80 });
  await page.waitForTimeout(600);
  await typeIn(page, dialog.getByPlaceholder('調整原因'), '範例：客訴補償');
  await caption(page, '確認無誤才按「確認調整」，示範先按取消', 2200);
  await tap(page, dialog.getByRole('button', { name: '取消', exact: true }));
  await stopRecording(rec);
  poster('ch11-points', 2);
});

test('ch11 截圖', async ({ browser }) => {
  const page = await newShotPage(browser);
  await tidy(page);
  await page.goto('about:blank');
  await go(page, '/dashboard/portal/activities');
  await shot(page, page.locator('main'), 'ch11-activity-list');
  await page.getByRole('button', { name: '建立活動' }).click();
  await page.waitForTimeout(800);
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('活動標題').fill('範例：週年慶人氣商品投票');
  await dialog.getByPlaceholder('選項 1').fill('保溫杯');
  await shot(page, dialog, 'ch11-activity-form');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  await go(page, '/dashboard/portal/points');
  const box = page.getByPlaceholder('搜尋聯絡人（名稱、電話、Email）');
  await box.fill('Chatbox Visitor');
  await box.press('Enter');
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: '手動調整' }).click();
  await page.waitForTimeout(600);
  const adj = page.getByRole('dialog');
  await adj.locator('input[type="number"]').fill('50');
  await adj.getByPlaceholder('調整原因').fill('範例：客訴補償');
  await shot(page, adj, 'ch11-points-adjust');
  await adj.getByRole('button', { name: '取消', exact: true }).click();
  await shot(page, page.locator('main .space-y-4').first(), 'ch11-points');
});
