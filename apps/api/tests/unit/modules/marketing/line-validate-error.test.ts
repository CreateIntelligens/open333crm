/**
 * LINE 表單版型的驗證錯誤改用編輯器欄位名稱（change readable-material-validation-errors，
 * spec material-system「LINE Form Material Errors Use Editor Field Names」）。
 *
 * 測試資料是 2026-10-13 UAT 欄位探測時 LINE validate API 實際回的內容。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { formatLineValidateError } from '#src/modules/marketing/line-validate-error.js';

/** LINE 一般訊息的錯誤格式：details[].property 是 messages[0].xxx */
const messageError = (property: string, message: string) => ({
  message: 'The request body has 1 error(s)',
  details: [{ message, property: `messages[0].${property}` }],
});

/** LINE Flex 訊息的錯誤格式：details[].property 是 JSON pointer */
const flexError = (...items: Array<[string, string]>) => ({
  message: 'A message (messages[0]) in the request body is invalid',
  details: items.map(([property, message]) => ({ property, message })),
});

test('Empty text：純文字空白顯示「訊息內容不可空白」', () => {
  assert.equal(formatLineValidateError('line_text', 400, messageError('text', 'May not be empty')), '訊息內容不可空白');
});

test('長度上限翻成中文', () => {
  assert.equal(
    formatLineValidateError('line_text', 400, messageError('text', 'Length must be between 0 and 5000')),
    '訊息內容不可超過 5000 字',
  );
});

test('圖片與影片的網址欄位依版型命名', () => {
  assert.equal(
    formatLineValidateError('line_image', 400, messageError('previewImageUrl', 'Must be a valid HTTPS URL')),
    '縮圖網址必須是 https:// 開頭的公開網址',
  );
  assert.equal(
    formatLineValidateError('line_image', 400, messageError('originalContentUrl', 'May not be empty')),
    '圖片網址不可空白',
  );
  assert.equal(
    formatLineValidateError('line_video', 400, messageError('previewImageUrl', 'May not be empty')),
    '預覽圖網址不可空白',
  );
  assert.equal(
    formatLineValidateError('line_video', 400, messageError('originalContentUrl', 'Must be a valid HTTPS URL')),
    '影片網址必須是 https:// 開頭的公開網址',
  );
});

test('圖文訊息的底圖與點擊區', () => {
  assert.equal(
    formatLineValidateError('line_imagemap', 400, messageError('baseUrl', 'Must be a valid HTTPS URL')),
    '底圖網址必須是 https:// 開頭的公開網址',
  );
  assert.equal(
    formatLineValidateError(
      'line_imagemap',
      400,
      messageError('actions[0].linkUri', "The URI must use one of the following schemes: 'http', 'https', 'tel', 'mailto', 'line', 'linemusic'"),
    ),
    '第 1 個點擊區的連結開頭不正確，請用 https://、http://、tel: 或 line://',
  );
  assert.equal(
    formatLineValidateError('line_imagemap', 400, messageError('actions[1].text', 'May not be empty')),
    '第 2 個點擊區的文字不可空白',
  );
});

test('Carousel button link：卡片按鈕連結用頁數與按鈕順序命名，不顯示 JSON 路徑', () => {
  const msg = formatLineValidateError(
    'line_carousel',
    400,
    flexError(['/contents/0/footer/contents/0/action/uri', 'invalid uri scheme']),
  );
  assert.equal(msg, '第 1 頁第 1 個按鈕的連結開頭不正確，請用 https://、http://、tel: 或 line://');
  assert.ok(!msg.includes('/contents/'));
});

test('卡片的圖片與按鈕文字', () => {
  assert.equal(
    formatLineValidateError('line_carousel', 400, flexError(['/contents/2/hero/url', 'invalid uri scheme'])),
    '第 3 頁的圖片網址開頭不正確，請用 https://、http://、tel: 或 line://',
  );
  assert.equal(
    formatLineValidateError('line_carousel', 400, flexError(['/contents/0/footer/contents/1/action/label', 'must be non-empty text'])),
    '第 1 頁第 2 個按鈕的文字不可空白',
  );
});

test('同一欄位有多則說明時只留一則：空白優先，其次網址格式', () => {
  const uri = '/contents/0/footer/contents/0/action/uri';
  assert.equal(
    formatLineValidateError(
      'line_carousel',
      400,
      flexError([uri, 'invalid uri'], [uri, 'must be non-empty text'], [uri, 'invalid uri scheme']),
    ),
    '第 1 頁第 1 個按鈕的連結不可空白',
  );
  assert.equal(
    formatLineValidateError('line_carousel', 400, flexError([uri, 'invalid uri'], [uri, 'invalid uri scheme'])),
    '第 1 頁第 1 個按鈕的連結格式不正確',
  );
});

test('不同欄位的錯誤全部列出，以分號分隔', () => {
  assert.equal(
    formatLineValidateError('line_carousel', 400, flexError(
      ['/contents/0/hero/url', 'invalid uri scheme'],
      ['/contents/1/footer/contents/0/action/label', 'must be non-empty text'],
    )),
    '第 1 頁的圖片網址開頭不正確，請用 https://、http://、tel: 或 line://；第 2 頁第 1 個按鈕的文字不可空白',
  );
});

test('對應不到的欄位與說明保留原文', () => {
  assert.equal(
    formatLineValidateError('line_text', 400, messageError('quickReply.items[0].imageUrl', 'Some new LINE rule')),
    'quickReply.items[0].imageUrl：Some new LINE rule',
  );
});

test('Flex material keeps the property path：Flex 版型保留 LINE 屬性路徑與原文', () => {
  const msg = formatLineValidateError('line_flex_template', 400, flexError(['/contents/0/hero/url', 'invalid uri scheme']));
  assert.ok(msg.includes('/contents/0/hero/url'), msg);
  assert.ok(msg.includes('invalid uri scheme'), msg);
});

test('沒有 details 時說明 LINE 驗證失敗與狀態碼', () => {
  assert.equal(formatLineValidateError('line_text', 401, { message: 'Authentication failed' }), 'LINE 驗證失敗（HTTP 401）：Authentication failed');
  assert.equal(formatLineValidateError('line_text', 500, null), 'LINE 驗證失敗（HTTP 500）');
});
