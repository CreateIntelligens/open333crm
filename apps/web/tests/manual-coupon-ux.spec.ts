/**
 * 手冊 ch08「附券廣播」、ch09「在素材放優惠券」、ch18 11-3 的截圖與錄影（change improve-coupon-url-insert-ux）。
 *
 * ⚠️ 正式環境：只開表單、填示範文字、按「取消」。素材不存檔、廣播不建立也不發送。
 *   guardWrites 擋下所有寫入請求；唯一放行的 POST 是 /marketing/broadcasts/audience-preview（只預估人數，不建立群發）。
 *
 * 跑法：npx playwright test --config=playwright.shots.config.ts tests/manual-coupon-ux.spec.ts
 */
import { test, Page, Browser } from '@playwright/test';
import {
  startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage, Recorder,
} from './manual-video-helpers';
import { shot } from './manual-helpers';

const AUDIENCE_PREVIEW = [/\/api\/v1\/marketing\/broadcasts\/audience-preview$/];
// UAT 示範資料（錄製手冊專用）；資料改名或刪除後要換成新的名稱
const LINE_CHANNEL = /LINE/;
const COUPON_MATERIAL = /驗收廣播A（含券連結）/;
const BROADCAST_COUPON = /\[驗收\] 廣播券A/;

/** 原生 <dialog> 在 top layer，字幕與框線要搬進 dialog 才不會被遮罩壓暗 */
const DIALOG_LAYER_FIX = `(() => {
  function fix(){
    const d = [...document.querySelectorAll('dialog[open]')].pop();
    const cap = document.getElementById('mv-cap');
    const host = d || document.body;
    if (cap && cap.parentElement !== host) host.appendChild(cap);
    document.querySelectorAll('.mv-ring,.mv-dot').forEach(r => { if (r.parentElement !== host) host.appendChild(r); });
  }
  const start = () => new MutationObserver(fix).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();`;

async function rec(browser: Browser, name: string, allowPost: RegExp[] = []): Promise<Recorder> {
  const r = await startRecording(browser, name, { allowPost });
  await r.context.addInitScript(DIALOG_LAYER_FIX);
  return r;
}

async function finish(r: Recorder, posterAt = 2) {
  await stopRecording(r);
  poster(r.name, posterAt);
}

/** 新增素材 → 選平台 → 選「純文字」，進到編輯器 */
async function openTextEditor(page: Page, platform: 'LINE' | 'FB Messenger', animate = false) {
  await go(page, '/dashboard/marketing/materials/new');
  const platformCard = page.getByRole('button', { name: new RegExp(platform) }).first();
  const textCard = page.getByText('純文字', { exact: true }).first();
  if (animate) {
    await tap(page, platformCard, 800);
    await tap(page, textCard, 1500);
  } else {
    await platformCard.click();
    await page.waitForTimeout(600);
    await textCard.click();
    await page.waitForTimeout(1500);
  }
  return page.getByPlaceholder('輸入要發送的文字訊息');
}

/** 選原生 select 的某個選項（依選項文字比對） */
async function pick(page: Page, select: ReturnType<Page['locator']>, label: RegExp) {
  const value = await select.evaluate(
    (el, src) => {
      const re = new RegExp(src);
      return [...(el as HTMLSelectElement).options].find((o) => re.test(o.text))?.value ?? null;
    },
    label.source,
  );
  if (!value) throw new Error(`找不到選項 ${label}`);
  await select.selectOption(value);
  await page.waitForTimeout(1200);
}

function selectWith(page: Page, optionText: string) {
  return page.locator('select', { has: page.locator('option', { hasText: optionText }) }).first();
}

test.describe.configure({ mode: 'serial' });

test('ch09 截圖：FB 類型、券連結按鈕、領券連結清單', async ({ browser }) => {
  const page = await newShotPage(browser);

  // FB Messenger 類型選擇（8 種）
  // 8 種類型要一次拍完，視窗拉高
  await page.setViewportSize({ width: 1440, height: 1120 });
  await go(page, '/dashboard/marketing/materials/new');
  await page.getByRole('button', { name: /FB Messenger/ }).first().click();
  await page.waitForTimeout(1200);
  await shot(page, page.locator('main'), 'ch09-picker-fb');
  await page.setViewportSize({ width: 1440, height: 900 });

  // LINE 純文字：插入顧客專屬券連結，預覽顯示標籤
  const textarea = await openTextEditor(page, 'LINE');
  await textarea.fill('秋季回饋活動開跑！點下方連結領取你的專屬折價券：\n');
  await textarea.press('End');
  await page.getByRole('button', { name: /插入顧客專屬券連結/ }).click();
  await page.waitForTimeout(800);
  const content = page.locator('section, div').filter({ has: textarea }).filter({ has: page.getByRole('button', { name: /插入領券連結/ }) }).last();
  await shot(page, content, 'ch09-coupon-buttons');
  await shot(page, page.getByText('顧客專屬券連結', { exact: true }).last().locator('xpath=ancestor::*[contains(@class,"rounded")][2]'), 'ch09-coupon-preview');

  // 插入領券連結：展開清單
  await page.getByRole('button', { name: /插入領券連結/ }).click();
  await page.waitForTimeout(1500);
  await shot(page, page.getByRole('group', { name: '選擇要插入的領券連結' }), 'ch09-claim-picker');
  await page.context().close();
});

test('ch08 截圖：附上優惠券、發券結果', async ({ browser }) => {
  const page = await newShotPage(browser, { allowPost: AUDIENCE_PREVIEW });
  await go(page, '/dashboard/marketing/broadcasts');
  await page.getByRole('button', { name: '建立廣播' }).first().click();
  await page.waitForTimeout(1200);
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('廣播名稱').fill('秋季回饋 附券廣播');
  await pick(page, selectWith(page, '請選擇渠道'), LINE_CHANNEL);
  await pick(page, selectWith(page, '請選擇素材'), COUPON_MATERIAL);
  await pick(page, selectWith(page, '不附券'), BROADCAST_COUPON);
  await page.waitForTimeout(1500);
  await shot(page, page.locator('#broadcast-coupon').locator('xpath=ancestor::div[1]'), 'ch08-broadcast-coupon');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  // 正式環境不建立廣播，發券結果要靠 UAT 上已發送過的附券廣播；找不到就讓測試失敗，免得手冊留著舊圖
  const result = page.getByRole('button', { name: '查看發券結果' }).first();
  if (!(await result.count())) throw new Error('列表上沒有附券廣播可看發券結果');
  await result.click();
  await page.waitForTimeout(1500);
  await shot(page, page.getByRole('dialog'), 'ch08-broadcast-coupon-result');
  await page.context().close();
});

test('ch09 影片：在素材放優惠券', async ({ browser }) => {
  const r = await rec(browser, 'ch09-coupon-url');
  const { page } = r;
  await go(page, '/dashboard/marketing/materials/new');
  await caption(page, '素材庫按「新增素材」，選 LINE、純文字', 1400);
  await tap(page, page.getByRole('button', { name: /LINE/ }).first(), 800);
  await tap(page, page.getByText('純文字', { exact: true }).first(), 1500);
  const textarea = page.getByPlaceholder('輸入要發送的文字訊息');
  await textarea.fill('');
  await caption(page, '先寫好訊息內容', 1200);
  await typeIn(page, textarea, '秋季回饋活動開跑！點連結領取你的專屬折價券：');
  await textarea.press('End');
  await textarea.press('Enter');
  await caption(page, '要每人一張券：按「插入顧客專屬券連結」', 1200);
  await tap(page, page.getByRole('button', { name: /插入顧客專屬券連結/ }), 1000);
  await caption(page, '預覽顯示成「顧客專屬券連結」，附券廣播發送時換成每個人自己的券連結', 1200);
  await point(page, page.getByText('顧客專屬券連結', { exact: true }).last(), 2600);
  await caption(page, '這種連結只有附券廣播會換掉；關鍵字回覆或一般廣播請改用領券連結', 3000);

  await textarea.press('Enter');
  await textarea.pressSequentially('還沒加好友的朋友也能領：', { delay: 60 });
  await caption(page, '要大家共用的連結：按「插入領券連結」', 1200);
  await tap(page, page.getByRole('button', { name: /插入領券連結/ }), 1500);
  await caption(page, '只列出同渠道、還能領的連結，選一條', 2200);
  const option = page.getByRole('group', { name: '選擇要插入的領券連結' }).getByRole('button').filter({ hasNotText: '關閉' }).first();
  await tap(page, option, 1200);
  await caption(page, '連結插在游標的位置；確認內容後按「存為素材」', 2600);
  await point(page, textarea, 2000);
  await finish(r, 3);
});

test('ch18 影片：附券廣播（素材有顧客專屬券連結）', async ({ browser }) => {
  const r = await rec(browser, 'ch18-broadcast-url', AUDIENCE_PREVIEW);
  const { page } = r;
  await go(page, '/dashboard/marketing/broadcasts');
  await caption(page, '廣播頁按「建立廣播」', 1200);
  await tap(page, page.getByRole('button', { name: '建立廣播' }).first(), 1200);
  const dialog = page.getByRole('dialog');
  await typeIn(page, dialog.getByPlaceholder('廣播名稱'), '秋季回饋 附券廣播');
  await caption(page, '選渠道與放了「顧客專屬券連結」的素材', 1000);
  await pick(page, selectWith(page, '請選擇渠道'), LINE_CHANNEL);
  await pick(page, selectWith(page, '請選擇素材'), COUPON_MATERIAL);
  await caption(page, '還沒附券時，對話框提醒並停用「建立」', 1000);
  await point(page, dialog.getByRole('button', { name: '建立' }), 2400);
  await caption(page, '在「附上優惠券」選一張進行中的行銷券', 1000);
  await pick(page, selectWith(page, '不附券'), BROADCAST_COUPON);
  await caption(page, '下方顯示剩餘名額；每位收件人會拿到自己的券連結', 1200);
  await point(page, page.locator('#broadcast-coupon').locator('xpath=ancestor::div[1]'), 2600);
  await caption(page, '選好受眾後按「建立」，再到列表按「立即發送」', 2800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  const result = page.getByRole('button', { name: '查看發券結果' }).first();
  if (!(await result.count())) throw new Error('列表上沒有附券廣播可看發券結果');
  await caption(page, '發送後，按列表上的「發券結果」看每個人有沒有收到', 1200);
  await tap(page, result, 1500);
  await caption(page, '有失敗或跳過的人時，這裡會列出原因', 2800);
  await finish(r, 4);
});
