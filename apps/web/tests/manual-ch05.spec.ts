/**
 * 手冊第 05 章「自動化」：影片與截圖。
 * 正式環境：新增規則只填示範內容，最後按「取消」離開，不按「儲存規則」、不動列表開關。
 * 放行：POST /automation/rules/:id/test（試跑，只評估條件、不執行動作、不寫資料）。
 */
import { test, Page } from '@playwright/test';
import { startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage } from './manual-video-helpers';
import { shot, shotPage } from './manual-helpers';

const TEST_RULE = 'd5faeff5'; // 「louis」（啟用中，條件：聯絡人名稱包含 Ann）
const ALLOW_TEST = [/\/api\/v1\/automation\/rules\/[0-9a-f-]{36}\/test$/];

const statusFilter = (page: Page) => page.locator('select:has(option[value="inactive"])');
const triggerSelect = (page: Page) => page.locator('main select').first();
const card = (page: Page, title: string) =>
  page.getByText(title, { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');

test('ch05-automation-new', async ({ browser }) => {
  test.setTimeout(180_000);
  const rec = await startRecording(browser, 'ch05-automation-new');
  const { page } = rec;
  await go(page, '/dashboard/automation');
  await caption(page, '側欄點「自動化」，這裡是所有規則', 1500);
  await caption(page, '可以只看「啟用中」的規則', 800);
  await point(page, statusFilter(page), 700);
  await statusFilter(page).selectOption('active');
  await page.waitForTimeout(1500);
  await point(page, page.locator('table'), 1800);
  await caption(page, '按「新增規則」建立一條', 1000);
  await tap(page, page.getByRole('button', { name: '新增規則' }), 2500);
  await caption(page, '先取一個看得懂的名稱', 800);
  await typeIn(page, page.getByPlaceholder('例如：客訴自動開工單'), '範例：退貨自動開工單');
  await caption(page, '「當」：選什麼時候檢查', 1000);
  await point(page, triggerSelect(page), 700);
  await triggerSelect(page).selectOption({ label: '收到訊息' });
  await page.waitForTimeout(1200);
  await caption(page, '「如果」：設定條件', 1000);
  await tap(page, page.getByTestId('add-rule'), 1000);
  const rule = page.locator('.condition-builder .rule').first();
  await point(page, rule.locator('select.rule-fields'), 600);
  await rule.locator('select.rule-fields').selectOption({ label: '訊息內容' });
  await page.waitForTimeout(800);
  await point(page, rule.locator('select.rule-operators'), 600);
  await rule.locator('select.rule-operators').selectOption({ label: '包含' });
  await page.waitForTimeout(800);
  await typeIn(page, rule.locator('input.rule-value'), '退貨');
  await caption(page, '「就」：選要自動做的事', 1000);
  await tap(page, page.getByRole('button', { name: '新增動作' }), 1000);
  const actionType = card(page, '要做什麼').locator('select').first();
  await point(page, actionType, 600);
  await actionType.selectOption({ label: '建立工單' });
  await page.waitForTimeout(1000);
  await typeIn(page, card(page, '要做什麼').locator('input').first(), '範例：客人詢問退貨');
  await caption(page, '最上面會用一句話幫你翻譯規則', 1000);
  await point(page, page.getByText('這條規則會', { exact: true }).locator('..'), 2400);
  await caption(page, '確認沒問題就按「儲存規則」', 1000);
  await point(page, page.getByRole('button', { name: '儲存規則' }), 1600);
  await caption(page, '這次只是示範，按「取消」離開', 1000);
  await tap(page, page.getByRole('button', { name: '取消' }), 2000);
  await stopRecording(rec);
  poster('ch05-automation-new', 4);
});

test('ch05-automation-keyword', async ({ browser }) => {
  test.setTimeout(180_000);
  const rec = await startRecording(browser, 'ch05-automation-keyword');
  const { page } = rec;
  await go(page, '/dashboard/automation/new');
  await caption(page, '關鍵字自動回覆：客人問什麼就回什麼', 1500);
  await typeIn(page, page.getByPlaceholder('例如：客訴自動開工單'), '範例：營業時間自動回覆');
  await caption(page, '時機選「關鍵字命中」', 800);
  await point(page, triggerSelect(page), 700);
  await triggerSelect(page).selectOption({ label: '關鍵字命中' });
  await page.waitForTimeout(1200);
  await caption(page, '輸入關鍵字，按 Enter 加進去', 800);
  const kw = page.getByPlaceholder('輸入關鍵字後按新增...');
  await typeIn(page, kw, '營業時間');
  await kw.press('Enter');
  await page.waitForTimeout(700);
  await typeIn(page, kw, '幾點開');
  await kw.press('Enter');
  await page.waitForTimeout(1000);
  await caption(page, '比對方式選「任一命中」就好', 1000);
  await point(page, page.getByText('比對方式', { exact: true }).locator('..').locator('select'), 1600);
  await caption(page, '動作選「傳送訊息」，寫好回覆內容', 1000);
  await tap(page, page.getByRole('button', { name: '新增動作' }), 1000);
  const actionType = card(page, '要做什麼').locator('select').first();
  await actionType.selectOption({ label: '傳送訊息' });
  await page.waitForTimeout(800);
  await typeIn(page, card(page, '要做什麼').locator('input').first(), '範例：我們的營業時間是週一到週五 9:00-18:00');
  await caption(page, '有這條規則，AI 就不會再重複回答', 2200);
  await point(page, page.getByText('這條規則會', { exact: true }).locator('..'), 2000);
  await caption(page, '示範不儲存，按「取消」離開', 1000);
  await tap(page, page.getByRole('button', { name: '取消' }), 2000);
  await stopRecording(rec);
  poster('ch05-automation-keyword', 3);
});

test('ch05 截圖', async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await newShotPage(browser, { allowPost: ALLOW_TEST });
  await go(page, '/dashboard/automation');
  await statusFilter(page).selectOption('active');
  await page.waitForTimeout(1000);
  await shotPage(page, 'ch05-list');

  // 新增規則：填示範內容後截各區塊，最後不儲存
  await go(page, '/dashboard/automation/new');
  await page.getByPlaceholder('例如：客訴自動開工單').fill('範例：退貨自動開工單');
  await page.getByTestId('add-rule').click();
  const rule = page.locator('.condition-builder .rule').first();
  await rule.locator('select.rule-fields').selectOption({ label: '訊息內容' });
  await rule.locator('select.rule-operators').selectOption({ label: '包含' });
  await rule.locator('input.rule-value').fill('退貨');
  await page.getByRole('button', { name: '新增動作' }).click();
  await card(page, '要做什麼').locator('select').first().selectOption({ label: '建立工單' });
  await card(page, '要做什麼').locator('input').first().fill('範例：客人詢問退貨');
  await page.waitForTimeout(800);
  await shot(page, page.getByText('這條規則會', { exact: true }).locator('..'), 'ch05-summary');
  await shot(page, card(page, '基本設定'), 'ch05-basic');
  await shot(page, card(page, '在什麼情況下'), 'ch05-conditions');
  await shot(page, card(page, '要做什麼'), 'ch05-actions');

  // 選到「目前不會觸發」的時機時的紅字提醒（只看，不儲存）
  await triggerSelect(page).selectOption({ label: '工單關閉（目前不會觸發）' });
  await page.waitForTimeout(600);
  await shot(page, triggerSelect(page).locator('..'), 'ch05-not-dispatched');

  // 關鍵字區塊
  await triggerSelect(page).selectOption({ label: '關鍵字命中' });
  const kw = page.getByPlaceholder('輸入關鍵字後按新增...');
  await kw.fill('營業時間');
  await kw.press('Enter');
  await kw.fill('幾點開');
  await kw.press('Enter');
  await page.waitForTimeout(500);
  await shot(page, kw.locator('xpath=ancestor::div[contains(@class,"border-dashed")][1]'), 'ch05-keyword');

  // 試跑（已存在、啟用中的規則）
  await go(page, '/dashboard/automation');
  await page.getByPlaceholder('搜尋規則名稱').fill('louis');
  await page.waitForTimeout(800);
  await page.locator('table tbody tr').first().click();
  await page.waitForURL(new RegExp(TEST_RULE));
  await page.waitForTimeout(1500);
  const testCard = card(page, '試試看這條規則');
  await testCard.scrollIntoViewIfNeeded();
  await testCard.locator('input').first().fill('Ann');
  await testCard.getByRole('button', { name: '試試看' }).click();
  await page.waitForTimeout(2000);
  await shot(page, testCard, 'ch05-test');
});
