import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_PREFIX, newApiContext } from './helpers';
import {
  RUN_TAG,
  deleteMaterials,
  expectInList,
  fbCard,
  field,
  getMaterial,
  gotoEdit,
  makeJpeg,
  makeMp4,
  nameInput,
  pickType,
  previewPane,
  saveNew,
  section,
  setVal,
  uploadVia,
} from './material-helpers';

/**
 * 素材庫「每種可見型別各建一則」E2E（LINE 5 種 + FB 9 種），每次回歸都跑。
 *
 * 每個型別一個 test：從 /dashboard/marketing/materials/new 選型別 → 透過 UI 填值
 * （含真上傳圖片／影片）→ 存檔 → 用 API 讀回比對填入的值 → 列表搜得到 → 重開編輯頁欄位值一致。
 *
 * 欄位的非法值／邊界值探測不在這裡，改放 manual-material-field-probes.spec.ts（只手動跑）。
 *
 * 資料紀律（UAT 就是正式環境）：
 *   - 只建立名稱帶 [E2E] 的素材；afterAll 刪除本次建立的全部素材，刪除失敗會列出 id 並讓 afterAll 失敗。
 *   - 不發送任何訊息：LINE 版型存檔時後端會呼叫 LINE validate/push（只驗不送），
 *     那是產品既有的存檔流程；本測試不呼叫任何發送／廣播端點。
 *
 * 標籤用 @material-types（不用 @materials，避免 --grep @materials 時連帶跑這支）。
 */
test.describe.configure({ mode: 'default', retries: 0 });
test.setTimeout(3 * 60_000);

let api: APIRequestContext;
/** 本 worker 建立的素材 id；建立成功就立刻記下，afterAll 全部刪除 */
const createdIds: string[] = [];

test.beforeEach(async () => {
  // 每個 test 重新換 access token（15 分鐘過期，整輪可能超過）
  api = await newApiContext();
});
test.afterEach(async () => {
  await api?.dispose();
});
test.afterAll(async () => {
  if (!createdIds.length) return;
  const cleanupApi = await newApiContext();
  try {
    await deleteMaterials(cleanupApi, createdIds);
  } finally {
    await cleanupApi.dispose();
  }
});

/** 存檔並斷言建立成功；id 立刻記入清理清單 */
async function saveAndTrack(page: Page, type: string): Promise<string> {
  const r = await saveNew(page);
  if (r.id) createdIds.push(r.id);
  expect(r.requested, `建立 ${type}：存檔請求沒有送出（前端擋下）`).toBe(true);
  expect(r.status, `建立 ${type} 失敗：${r.message}`).toBe(201);
  return r.id;
}

/** API 讀回比對 + 列表搜得到 */
async function verifyCreated(page: Page, type: string, name: string, id: string, expectedBody: Record<string, unknown>) {
  const m = await getMaterial(api, id);
  expect(m.name).toBe(name);
  expect(m.contentType).toBe(type);
  expect(m.body, `${type} 讀回 body 應與填入值一致`).toMatchObject(expectedBody);
  await expectInList(page, name);
  return m;
}

const jpeg = (buffer: Buffer, name: string) => ({ name, mimeType: 'image/jpeg', buffer });

/** 預覽區有顯示該網址的圖片（預覽 <img> 的 alt 為空，沒有 img role，只能以 src 比對） */
async function expectPreviewImage(page: Page, url: string) {
  await expect(previewPane(page).locator(`img[src="${url}"]`).first()).toBeVisible();
}

// ───────────────────────────────────────────────────────────────────────
// LINE
// ───────────────────────────────────────────────────────────────────────

test.describe('@material-types LINE 素材', () => {
  test('line_text 純文字：建立（emoji / 換行 / 快速回覆）', async ({ page }) => {
    const type = 'line_text';
    const name = `${E2E_PREFIX} LINE 純文字 🙂 ${RUN_TAG}`;
    const text = `${E2E_PREFIX} LINE 純文字內容 ${RUN_TAG}\n第二行 🙂👨‍👩‍👧‍👦 結尾`;
    const textArea = page.getByPlaceholder('輸入要發送的文字訊息');

    await pickType(page, 'line', '純文字', '一則純文字訊息');
    await setVal(nameInput(page), name);
    await setVal(textArea, text);
    await page.getByPlaceholder('例：同意').fill('好的');
    await page.getByPlaceholder(/例：我同意/).fill('我要了解更多');
    await page.getByRole('button', { name: '加入' }).click();
    await expect(previewPane(page).getByText(`${E2E_PREFIX} LINE 純文字內容`, { exact: false })).toBeVisible();

    const id = await saveAndTrack(page, type);
    await verifyCreated(page, type, name, id, { text, quickReplies: [{ label: '好的', text: '我要了解更多' }] });

    await gotoEdit(page, id, name);
    await expect(textArea).toHaveValue(text);
    await expect(page.getByText('我要了解更多', { exact: false }).first()).toBeVisible();
  });

  test('line_image 單張圖片：建立（真上傳主圖與縮圖）', async ({ page }) => {
    const type = 'line_image';
    const name = `${E2E_PREFIX} LINE 單張圖片 ${RUN_TAG}`;
    const mainSection = section(page, '圖片', true);
    const thumbSection = section(page, '縮圖');

    await pickType(page, 'line', '單張圖片', '發送一張圖片給顧客');
    await setVal(nameInput(page), name);
    const up = await uploadVia(page, mainSection, jpeg(await makeJpeg(page, 1024, 768, `E2E LINE image ${RUN_TAG}`), 'e2e-line.jpg'));
    expect(up.ok, `主圖上傳失敗 ${up.status} ${up.message}`).toBeTruthy();
    await expect(mainSection.getByRole('textbox')).toHaveValue(up.url);
    const upThumb = await uploadVia(page, thumbSection, jpeg(await makeJpeg(page, 240, 240, 'thumb'), 'e2e-thumb.jpg'));
    expect(upThumb.ok, `縮圖上傳失敗 ${upThumb.status} ${upThumb.message}`).toBeTruthy();
    await expect(thumbSection.getByRole('textbox')).toHaveValue(upThumb.url);

    const id = await saveAndTrack(page, type);
    // 期望值一律取自「填入的值」（上傳回應），不取讀回結果本身
    await verifyCreated(page, type, name, id, { mediaUrl: up.url, previewUrl: upThumb.url });

    await gotoEdit(page, id, name);
    await expect(mainSection.getByRole('textbox')).toHaveValue(up.url);
    await expect(thumbSection.getByRole('textbox')).toHaveValue(upThumb.url);
    await expectPreviewImage(page, up.url);
  });

  test('line_video 影片：建立（真上傳 mp4 + 縮圖）', async ({ page }) => {
    const type = 'line_video';
    const name = `${E2E_PREFIX} LINE 影片 ${RUN_TAG}`;
    const mp4 = makeMp4();
    test.skip(!mp4, '本機沒有 ffmpeg，無法產生 mp4');
    const videoBox = page.getByPlaceholder('https://example.com/video.mp4');
    const thumbBox = page.getByPlaceholder('影片預覽圖（jpg / png）');

    await pickType(page, 'line', '影片', '影片 + 結束畫面 CTA 按鈕');
    await setVal(nameInput(page), name);
    const up = await uploadVia(page, section(page, '影片 *', true), { name: 'e2e-video.mp4', mimeType: 'video/mp4', buffer: mp4! });
    expect(up.ok, `影片上傳失敗 ${up.status} ${up.message}`).toBeTruthy();
    await expect(videoBox).toHaveValue(up.url);
    const upThumb = await uploadVia(page, section(page, '縮圖 *', true), jpeg(await makeJpeg(page, 640, 360, `E2E video thumb ${RUN_TAG}`), 'e2e-video-thumb.jpg'));
    expect(upThumb.ok, `縮圖上傳失敗 ${upThumb.status} ${upThumb.message}`).toBeTruthy();
    await expect(thumbBox).toHaveValue(upThumb.url);

    const id = await saveAndTrack(page, type);
    const m = await verifyCreated(page, type, name, id, { videoUrl: up.url, previewImageUrl: upThumb.url });
    // 結束畫面 UI 已移除，但預設 body 帶有 endCard；記在報告註記裡供人工判讀（不影響通過與否）
    test.info().annotations.push({ type: 'endCard', description: JSON.stringify(m.body.endCard ?? null) });

    await gotoEdit(page, id, name);
    await expect(videoBox).toHaveValue(up.url);
    await expect(thumbBox).toHaveValue(upThumb.url);
    await expectPreviewImage(page, upThumb.url);
  });

  test('line_carousel 卡片訊息：建立 2 頁（真上傳）', async ({ page }) => {
    const type = 'line_carousel';
    const name = `${E2E_PREFIX} LINE 卡片訊息 ${RUN_TAG}`;
    const title = page.getByPlaceholder('輸入標題');
    const actionLabel = page.getByPlaceholder('輸入動作標籤').first();
    const actionUri = page.getByPlaceholder('https://... 或 tel:0912345678').first();

    await pickType(page, 'line', '卡片訊息', '多張卡片輪播（商品 / 地點 / 人物 / 圖文）');
    await setVal(nameInput(page), name);

    // 第 1 頁（預設商品頁）：改標題／說明／價格／動作 1，上傳圖片
    const t1 = 'E2E 商品一 🙂';
    const d1 = 'E2E 說明第一行\n第二行';
    const uri1 = `https://example.com/e2e/buy-1?run=${RUN_TAG}`;
    await setVal(title, t1);
    await setVal(page.getByPlaceholder('輸入文字說明'), d1);
    await setVal(page.getByPlaceholder('00,000'), '1,990');
    await setVal(actionLabel, '立即購買');
    await setVal(actionUri, uri1);
    // 卡片編輯器同時只顯示目前頁的一個圖片欄位
    const up1 = await uploadVia(page, page, jpeg(await makeJpeg(page, 1024, 665, 'E2E card 1'), 'e2e-card1.jpg'));
    expect(up1.ok, `第 1 頁圖片上傳失敗 ${up1.status} ${up1.message}`).toBeTruthy();

    // 第 2 頁：新增頁面 → 標題 + 動作 1 + 上傳圖片
    await page.getByRole('button', { name: '新增頁面' }).click();
    await expect(page.getByRole('button', { name: '第 2 頁' })).toBeVisible();
    const t2 = 'E2E 商品二';
    const uri2 = `https://example.com/e2e/buy-2?run=${RUN_TAG}`;
    await setVal(title, t2);
    await setVal(actionLabel, '看看');
    await setVal(actionUri, uri2);
    const up2 = await uploadVia(page, page, jpeg(await makeJpeg(page, 1024, 665, 'E2E card 2'), 'e2e-card2.jpg'));
    expect(up2.ok, `第 2 頁圖片上傳失敗 ${up2.status} ${up2.message}`).toBeTruthy();

    await expect(previewPane(page).getByText(t1).first()).toBeVisible();
    await expect(previewPane(page).getByText(t2).first()).toBeVisible();

    const id = await saveAndTrack(page, type);
    const m = await verifyCreated(page, type, name, id, {
      pageType: 'product',
      pages: [
        { title: t1, description: d1, imageUrl: up1.url, price: { currency: 'NT$', amount: '1,990' }, action1: { type: 'uri', label: '立即購買', uri: uri1 } },
        { title: t2, imageUrl: up2.url, action1: { type: 'uri', label: '看看', uri: uri2 } },
      ],
    });
    expect(m.body.pages, '卡片數量應為 2').toHaveLength(2);

    await gotoEdit(page, id, name);
    await expect(title).toHaveValue(t1);
    await expect(page.getByPlaceholder('輸入文字說明')).toHaveValue(d1);
    await page.getByRole('button', { name: '第 2 頁' }).click();
    await expect(title).toHaveValue(t2);
  });

  test('line_imagemap 圖文訊息：建立（真上傳底圖）', async ({ page }) => {
    const type = 'line_imagemap';
    const name = `${E2E_PREFIX} LINE 圖文訊息 ${RUN_TAG}`;
    const baseSection = section(page, '底圖 *', true);
    const uriL = `https://example.com/e2e/left?run=${RUN_TAG}`;
    const textR = 'E2E 我點了右邊 🙂';

    await pickType(page, 'line', '圖文訊息', '一張大圖切割成多個可點擊區域');
    await setVal(nameInput(page), name);
    const up = await uploadVia(page, baseSection, jpeg(await makeJpeg(page, 1040, 700, `E2E imagemap ${RUN_TAG}`), 'e2e-imagemap.jpg'));
    expect(up.ok, `底圖上傳失敗 ${up.status} ${up.message}`).toBeTruthy();
    await expect(baseSection.getByRole('textbox')).toHaveValue(up.url);

    await setVal(page.getByPlaceholder('輸入動作標籤').nth(0), '左邊');
    await setVal(page.getByPlaceholder('https://... 或 tel:0912345678').first(), uriL);
    await setVal(page.getByPlaceholder('輸入動作標籤').nth(1), '右邊');
    await setVal(page.getByPlaceholder('點擊後送出的文字').first(), textR);

    const id = await saveAndTrack(page, type);
    await verifyCreated(page, type, name, id, {
      baseImageUrl: up.url, layoutId: 'lo_700_2v', width: 1040, height: 700,
      areas: [
        { x: 0, y: 0, width: 520, height: 700, action: { type: 'uri', label: '左邊', uri: uriL } },
        { x: 520, y: 0, width: 520, height: 700, action: { type: 'message', label: '右邊', text: textR } },
      ],
    });

    await gotoEdit(page, id, name);
    await expect(baseSection.getByRole('textbox')).toHaveValue(up.url);
    await expect(page.getByPlaceholder('https://... 或 tel:0912345678').first()).toHaveValue(uriL);
    await expect(page.getByPlaceholder('點擊後送出的文字').first()).toHaveValue(textR);
  });
});

// ───────────────────────────────────────────────────────────────────────
// FB
// ───────────────────────────────────────────────────────────────────────

test.describe('@material-types FB 素材', () => {
  test('fb_text 純文字：建立（emoji / 換行）', async ({ page }) => {
    const type = 'fb_text';
    const name = `${E2E_PREFIX} FB 純文字 ${RUN_TAG}`;
    const text = `${E2E_PREFIX} FB 純文字內容 ${RUN_TAG}\n第二行 🙂👍`;
    const textArea = page.getByPlaceholder('輸入要發送的文字訊息');

    await pickType(page, 'fb', '純文字', '一則純文字訊息');
    await setVal(nameInput(page), name);
    await setVal(textArea, text);
    await expect(previewPane(page).getByText(`${E2E_PREFIX} FB 純文字內容`, { exact: false })).toBeVisible();

    const id = await saveAndTrack(page, type);
    await verifyCreated(page, type, name, id, { text });
    await gotoEdit(page, id, name);
    await expect(textArea).toHaveValue(text);
  });

  test('fb_image 單張圖片：建立（真上傳）', async ({ page }) => {
    const type = 'fb_image';
    const name = `${E2E_PREFIX} FB 單張圖片 ${RUN_TAG}`;
    const imgSection = section(page, '圖片', true);

    await pickType(page, 'fb', '單張圖片', '發送一張圖片給顧客');
    await setVal(nameInput(page), name);
    const up = await uploadVia(page, imgSection, jpeg(await makeJpeg(page, 1024, 768, `E2E FB image ${RUN_TAG}`), 'e2e-fb.jpg'));
    expect(up.ok, `上傳失敗 ${up.status} ${up.message}`).toBeTruthy();
    await expectPreviewImage(page, up.url);

    const id = await saveAndTrack(page, type);
    await verifyCreated(page, type, name, id, { url: up.url });
    await gotoEdit(page, id, name);
    await expect(imgSection.getByRole('textbox')).toHaveValue(up.url);
  });

  test('fb_video 影片：建立（上傳 mp4 後貼網址）', async ({ page }) => {
    const type = 'fb_video';
    const name = `${E2E_PREFIX} FB 影片 ${RUN_TAG}`;
    const box = page.getByPlaceholder('https://...mp4');
    const mp4 = makeMp4();
    test.skip(!mp4, '本機沒有 ffmpeg，無法產生 mp4');

    await pickType(page, 'fb', '影片', '發送一段影片給顧客');
    await setVal(nameInput(page), name);
    // FB 影片編輯器沒有上傳鈕（只能貼網址）→ 用 API 上傳一支 mp4 取得真實網址再貼上
    const res = await api.post('files/upload', { multipart: { file: { name: 'e2e-fb-video.mp4', mimeType: 'video/mp4', buffer: mp4! } } });
    const upBody = await res.json().catch(() => ({}));
    expect(res.ok(), `影片上傳失敗 ${res.status()} ${upBody?.error?.message ?? ''}`).toBeTruthy();
    const url: string = upBody.data.url;
    await setVal(box, url);

    const id = await saveAndTrack(page, type);
    await verifyCreated(page, type, name, id, { url });
    await gotoEdit(page, id, name);
    await expect(box).toHaveValue(url);
  });

  test('fb_generic 商品輪播：建立 3 張卡（真上傳）', async ({ page }) => {
    const type = 'fb_generic';
    const name = `${E2E_PREFIX} FB 商品輪播 ${RUN_TAG}`;
    const titles = page.getByPlaceholder('商品標題');
    const subs = page.getByPlaceholder('副標題（選填）');

    await pickType(page, 'fb', '商品輪播', '多商品橫向滑動展示');
    await setVal(nameInput(page), name);
    await setVal(titles.nth(0), 'E2E 商品 A 🙂');
    await setVal(subs.nth(0), 'NT$ 100');
    await setVal(titles.nth(1), 'E2E 商品 B');
    await page.getByRole('button', { name: /新增卡片/ }).click();
    await expect(titles).toHaveCount(3);
    await setVal(titles.nth(2), 'E2E 商品 C');
    await setVal(subs.nth(2), '第三張');
    const urls: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const up = await uploadVia(page, fbCard(page, i), jpeg(await makeJpeg(page, 955, 500, `E2E FB card ${i}`), `e2e-fbcard${i}.jpg`));
      expect(up.ok, `卡片 ${i} 圖片上傳失敗 ${up.status} ${up.message}`).toBeTruthy();
      urls.push(up.url);
    }
    await expect(previewPane(page).getByText('E2E 商品 C').first()).toBeVisible();

    const id = await saveAndTrack(page, type);
    const m = await verifyCreated(page, type, name, id, {
      elements: [
        { title: 'E2E 商品 A 🙂', subtitle: 'NT$ 100', image_url: urls[0] },
        { title: 'E2E 商品 B', image_url: urls[1] },
        { title: 'E2E 商品 C', subtitle: '第三張', image_url: urls[2] },
      ],
    });
    expect(m.body.elements).toHaveLength(3);
    await gotoEdit(page, id, name);
    await expect(titles).toHaveCount(3);
    await expect(titles.nth(2)).toHaveValue('E2E 商品 C');
  });

  test('fb_button 按鈕選單：建立 3 顆按鈕', async ({ page }) => {
    const type = 'fb_button';
    const name = `${E2E_PREFIX} FB 按鈕選單 ${RUN_TAG}`;
    const mainText = field(page, '主要訊息');
    const btnTitles = page.getByPlaceholder('按鈕文字');
    const siteBox = page.getByPlaceholder('網址', { exact: true }).first();
    const text = 'E2E 請問需要什麼協助？🙂\n第二行';
    const site = `https://example.com/e2e?run=${RUN_TAG}`;

    await pickType(page, 'fb', '按鈕選單', '文字 + 1-3 顆按鈕引導下一步');
    await setVal(nameInput(page), name);
    await setVal(mainText, text);
    await setVal(btnTitles.nth(0), 'E2E 查訂單');
    await setVal(page.getByPlaceholder('回傳資料', { exact: true }).nth(0), 'E2E_ORDER');
    await setVal(btnTitles.nth(2), 'E2E 官網');
    await setVal(siteBox, site);
    await expect(previewPane(page).getByText('E2E 查訂單').first()).toBeVisible();

    const id = await saveAndTrack(page, type);
    await verifyCreated(page, type, name, id, {
      text,
      buttons: [
        { type: 'postback', title: 'E2E 查訂單', payload: 'E2E_ORDER' },
        { type: 'postback', title: '查商品', payload: 'menu:product' },
        { type: 'web_url', title: 'E2E 官網', url: site },
      ],
    });
    await gotoEdit(page, id, name);
    await expect(mainText).toHaveValue(text);
    await expect(siteBox).toHaveValue(site);
  });

  test('fb_media 大圖／影片廣告：建立（真上傳）', async ({ page }) => {
    const type = 'fb_media';
    const name = `${E2E_PREFIX} FB 大圖廣告 ${RUN_TAG}`;
    const attach = field(page, 'attachment_id');
    const urlSection = section(page, '媒體網址');

    await pickType(page, 'fb', '大圖／影片廣告', '大圖或影片 + 1 顆 CTA 按鈕');
    await setVal(nameInput(page), name);
    await setVal(page.getByPlaceholder('image / video'), 'image');
    await setVal(attach, '1234567890');
    const up = await uploadVia(page, urlSection, jpeg(await makeJpeg(page, 1200, 628, `E2E FB media ${RUN_TAG}`), 'e2e-fbmedia.jpg'));
    expect(up.ok, `上傳失敗 ${up.status} ${up.message}`).toBeTruthy();
    await expectPreviewImage(page, up.url);

    const id = await saveAndTrack(page, type);
    await verifyCreated(page, type, name, id, { media_type: 'image', attachment_id: '1234567890', url: up.url });
    await gotoEdit(page, id, name);
    await expect(attach).toHaveValue('1234567890');
    await expect(urlSection.getByRole('textbox')).toHaveValue(up.url);
  });

  test('fb_coupon 優惠券：建立（真上傳，折扣碼空格被前端去除）', async ({ page }) => {
    const type = 'fb_coupon';
    const name = `${E2E_PREFIX} FB 優惠券 ${RUN_TAG}`;
    const title = field(page, '優惠券標題');
    const code = field(page, '折扣碼');

    await pickType(page, 'fb', '優惠券', 'Messenger 專屬優惠券模板');
    await setVal(nameInput(page), name);
    await setVal(title, 'E2E 會員 9 折 🙂');
    await setVal(field(page, '副標題'), 'E2E 限時');
    await setVal(field(page, '優惠券前訊息'), 'E2E 感謝支持');
    // 逐字輸入含空格的折扣碼：編輯器的 onChange 會去掉空白，欄位應只剩 E2E90
    await code.fill('');
    await code.pressSequentially('E2E 9 0');
    await expect(code, '折扣碼欄位應去除輸入的空格').toHaveValue('E2E90');
    await setVal(field(page, 'webhook 回傳資料'), 'e2e_coupon_payload');
    const up = await uploadVia(page, section(page, '優惠券圖片'), jpeg(await makeJpeg(page, 1024, 558, `E2E coupon ${RUN_TAG}`), 'e2e-coupon.jpg'));
    expect(up.ok, `上傳失敗 ${up.status} ${up.message}`).toBeTruthy();
    await expect(previewPane(page).getByText('E2E 會員 9 折', { exact: false }).first()).toBeVisible();

    const id = await saveAndTrack(page, type);
    await verifyCreated(page, type, name, id, {
      title: 'E2E 會員 9 折 🙂', subtitle: 'E2E 限時', coupon_pre_message: 'E2E 感謝支持',
      coupon_code: 'E2E90', image_url: up.url, payload: 'e2e_coupon_payload',
    });
    await gotoEdit(page, id, name);
    await expect(title).toHaveValue('E2E 會員 9 折 🙂');
    await expect(code).toHaveValue('E2E90');
  });

  test('fb_receipt 訂單收據：建立', async ({ page }) => {
    const type = 'fb_receipt';
    const name = `${E2E_PREFIX} FB 訂單收據 ${RUN_TAG}`;
    const order = field(page, '訂單編號');
    const total = field(page, '總金額', { role: 'spinbutton' });
    const orderNo = `E2E-${RUN_TAG}`;

    await pickType(page, 'fb', '訂單收據', '電商訂單明細');
    await setVal(nameInput(page), name);
    await setVal(field(page, '收件人'), 'E2E 王小明');
    await setVal(order, orderNo);
    await setVal(field(page, '幣別'), 'TWD');
    await setVal(field(page, '付款方式'), 'Visa **4242');
    await setVal(field(page, '商家名稱'), 'E2E 測試商店');
    await setVal(total, '1234.5');
    await expect(previewPane(page).getByText(orderNo, { exact: false }).first()).toBeVisible();

    const id = await saveAndTrack(page, type);
    await verifyCreated(page, type, name, id, {
      recipient_name: 'E2E 王小明', order_number: orderNo, currency: 'TWD',
      payment_method: 'Visa **4242', merchant_name: 'E2E 測試商店', summary: { total_cost: 1234.5 },
    });
    await gotoEdit(page, id, name);
    await expect(order).toHaveValue(orderNo);
    await expect(total).toHaveValue('1234.5');
  });

  test('fb_feedback 滿意度調查：建立（NPS）', async ({ page }) => {
    const type = 'fb_feedback';
    const name = `${E2E_PREFIX} FB 滿意度調查 ${RUN_TAG}`;
    const qtype = field(page, '問題類型', { role: 'combobox' });
    const days = field(page, '有效天數', { role: 'spinbutton' });
    const titleText = 'E2E 您對本次服務滿意嗎？🙂';

    await pickType(page, 'fb', '滿意度調查', 'CSAT / NPS 評分量表');
    await setVal(nameInput(page), name);
    await setVal(field(page, '標題', { exact: true }), titleText);
    await setVal(field(page, '副標題', { exact: true }), 'E2E 副標題');
    await qtype.selectOption('nps');
    // 有效天數用 5：FB 版型後端驗證（validate-fb-material-content）規定 1–7 天
    await setVal(days, '5');
    await expect(previewPane(page).getByText('E2E 您對本次服務滿意嗎', { exact: false }).first()).toBeVisible();

    const id = await saveAndTrack(page, type);
    await verifyCreated(page, type, name, id, { title: titleText, subtitle: 'E2E 副標題', question_type: 'nps', expires_in_days: 5 });
    await gotoEdit(page, id, name);
    await expect(qtype).toHaveValue('nps');
    await expect(days).toHaveValue('5');
  });
});
