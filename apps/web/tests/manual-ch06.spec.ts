/**
 * 手冊第 06 章「知識庫」影片與截圖（對 UAT 正式環境，只開表單不送出）。
 * 唯一放行的 POST：/knowledge/search（語義搜尋，只讀：產生查詢向量後 SELECT，不寫資料）。
 */
import { test } from '@playwright/test';
import { startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage } from './manual-video-helpers';
import { shot, shotPage } from './manual-helpers';

const SAMPLE_CSV = '/private/tmp/claude-501/-Users-danielyang-Documents-opencrm-poc/d60edcc2-6f15-4406-b5fc-7cb731f17dc1/scratchpad/c6/範例FAQ.csv';
const SEARCH_ONLY = [/\/api\/v1\/knowledge\/search$/];

test('ch06-articles 文章列表與狀態', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch06-articles');
  const { page } = rec;
  await go(page, '/dashboard/knowledge/articles');
  await caption(page, '這裡是知識庫的「文章管理」');
  await point(page, page.getByPlaceholder('搜尋文章...'));
  await caption(page, '可以用關鍵字、分類、來源找文章');
  await tap(page, page.getByRole('button', { name: '草稿', exact: true }));
  await caption(page, '「草稿」：還在寫，AI 客服不會用');
  await tap(page, page.getByRole('button', { name: '已發布', exact: true }));
  await caption(page, '「已發布」：AI 客服會拿來回答');
  await point(page, page.locator('[title="已向量化"]').first(), 1600);
  await caption(page, '標題前的綠色小圖示＝AI 已讀進這篇');
  await point(page, page.getByTitle('封存').first(), 1200);
  await caption(page, '右邊是編輯、封存、刪除按鈕');
  await tap(page, page.getByRole('button', { name: '全部', exact: true }));
  await caption(page, '點「全部」回到完整列表', 1800);
  await stopRecording(rec);
  poster('ch06-articles', 2);
});

test('ch06-article-new 新增文章（不儲存）', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch06-article-new');
  const { page } = rec;
  await go(page, '/dashboard/knowledge/articles');
  await caption(page, '點「新增文章」開始寫一篇');
  await tap(page, page.getByRole('button', { name: '新增文章' }));
  await caption(page, '標題寫成客人會問的問題', 1800);
  await typeIn(page, page.getByPlaceholder('文章標題'), '範例：門市營業時間是幾點？');
  await caption(page, '分類可留空，會自動歸「一般」', 1800);
  await typeIn(page, page.getByPlaceholder('例：常見問題、產品說明'), '範例：門市資訊');
  await caption(page, '內容寫清楚答案，越具體越好', 1800);
  await typeIn(page, page.getByPlaceholder(/^文章內容/), '範例：週一至週五 10:00–21:00，週末 11:00–20:00。');
  await caption(page, '標籤用逗號隔開', 1600);
  await typeIn(page, page.getByPlaceholder(/以逗號分隔/), '範例, 門市');
  await tap(page, page.getByRole('button', { name: '預覽' }));
  await caption(page, '「預覽」可以檢查內容');
  await point(page, page.getByRole('button', { name: '儲存', exact: true }));
  await caption(page, '寫好按「儲存」，會先存成草稿', 2400);
  await tap(page, page.getByRole('button', { name: '取消' }));
  await caption(page, '（示範到這裡，按取消不存）', 1800);
  await stopRecording(rec);
  poster('ch06-article-new', 3);
});

test('ch06-import 匯入檔案（不上傳）', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch06-import');
  const { page } = rec;
  await go(page, '/dashboard/knowledge/articles');
  await caption(page, '已有現成的 FAQ？用「匯入文章」');
  await tap(page, page.getByRole('button', { name: '匯入文章' }));
  await point(page, page.getByText(/支援格式/), 1800);
  await caption(page, 'PDF、Word、Excel、CSV 等都可以');
  await page.locator('input[type=file]').setInputFiles(SAMPLE_CSV);
  await page.waitForTimeout(600);
  await caption(page, '選好檔案後會列在這裡', 1800);
  await point(page, page.getByText(/已選 \d+ 個檔案/), 1400);
  await point(page, page.getByRole('button', { name: /上傳 \d+ 個檔案/ }), 1400);
  await caption(page, '按「上傳」才會真的匯入', 2200);
  await caption(page, '有「問題、答案」欄的表會直接發布', 2600);
  await tap(page, page.getByRole('button', { name: '取消' }));
  await caption(page, '（示範到這裡，按取消不上傳）', 1800);
  await stopRecording(rec);
  poster('ch06-import', 2);
});

test('ch06-search 語義搜尋', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch06-search', { allowPost: SEARCH_ONLY });
  const { page } = rec;
  await go(page, '/dashboard/knowledge/search');
  await caption(page, '「語義搜尋」用來測 AI 找不找得到答案');
  await caption(page, '輸入客人會怎麼問，用口語就好', 1800);
  await typeIn(page, page.getByPlaceholder(/冰箱不冷/), '冰箱不冷怎麼辦');
  await tap(page, page.getByRole('button', { name: '搜尋', exact: true }), 500);
  await page.getByText(/% 匹配/).first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  await caption(page, '找到的文章會依相符程度排列');
  await point(page, page.getByText(/% 匹配/).first(), 1600);
  await caption(page, '百分比越高，代表越接近客人的問題', 2400);
  await caption(page, '找不到？就是該補文章的地方', 2200);
  await stopRecording(rec);
  poster('ch06-search', 3);
});

test('ch06-feedback 回報調教', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch06-feedback');
  const { page } = rec;
  await go(page, '/dashboard/knowledge/feedback');
  await caption(page, '客人按「沒幫到我」，就會出現在這裡');
  await point(page, page.getByText('使用者問：').first(), 1600);
  await caption(page, '先看客人問什麼、AI 怎麼答');
  await point(page, page.getByText('命中文章：').first(), 1600);
  await caption(page, '這是 AI 當時參考的文章');
  await point(page, page.getByRole('button', { name: '編輯文章' }).first(), 1600);
  await caption(page, '內容不對？點「編輯文章」直接修');
  await point(page, page.getByRole('button', { name: '標為已處理' }).first(), 1600);
  await caption(page, '修好後點「標為已處理」結案', 2200);
  await stopRecording(rec);
  poster('ch06-feedback', 2);
});

test('ch06 截圖', async ({ browser }) => {
  test.setTimeout(180000);
  const page = await newShotPage(browser, { allowPost: SEARCH_ONLY });
  await go(page, '/dashboard/knowledge/articles');
  await shotPage(page, 'ch06-articles');
  await shot(page, page.locator('[title="已向量化"]').first().locator('xpath=ancestor::tr[1]'), 'ch06-article-row');
  await page.getByRole('button', { name: '新增文章' }).click();
  await page.waitForTimeout(800);
  await page.getByPlaceholder('文章標題').fill('範例：門市營業時間是幾點？');
  await page.getByPlaceholder('例：常見問題、產品說明').fill('範例：門市資訊');
  await page.getByPlaceholder(/^文章內容/).fill('範例：週一至週五 10:00–21:00，週末 11:00–20:00。');
  await page.getByPlaceholder(/以逗號分隔/).fill('範例, 門市');
  await shot(page, page.getByRole('dialog'), 'ch06-article-dialog');
  await page.getByRole('button', { name: '取消' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '匯入文章' }).click();
  await page.waitForTimeout(500);
  await page.locator('input[type=file]').setInputFiles(SAMPLE_CSV);
  await page.waitForTimeout(500);
  await shot(page, page.getByRole('dialog'), 'ch06-import-dialog');
  await page.getByRole('button', { name: '取消' }).click();

  await go(page, '/dashboard/knowledge/search');
  await page.getByPlaceholder(/冰箱不冷/).fill('冰箱不冷怎麼辦');
  await page.getByRole('button', { name: '搜尋', exact: true }).click();
  await page.getByText(/% 匹配/).first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  await shotPage(page, 'ch06-search');

  await go(page, '/dashboard/knowledge/feedback');
  await shot(page, page.getByText('使用者問：').first().locator('xpath=ancestor::div[contains(@class,"rounded-lg") and contains(@class,"border")][1]'), 'ch06-feedback-card');
});
