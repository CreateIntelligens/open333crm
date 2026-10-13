/**
 * FB 9 種版型的內容檢查（change validate-fb-material-content，spec material-system）。
 *
 * 2026-10-13 UAT E2E：FB 版型後端完全不檢查，必填欄位空值、javascript: 網址、負數金額都能存。
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';
import { validateFbMaterialBody } from '#src/modules/marketing/fb-material-validation.js';

/** 前端編輯器的預設內容：直接讀 apps/web 的檔案，避免兩邊漂移 */
const { DEFAULT_BODY_FOR_TYPE } = (await import(
  pathToFileURL(join(repoRoot, 'apps/web/src/components/materials/default-bodies.ts')).href
)) as { DEFAULT_BODY_FOR_TYPE: Record<string, Record<string, unknown>> };

const FB_TYPES = ['fb_text', 'fb_image', 'fb_video', 'fb_generic', 'fb_button', 'fb_media', 'fb_coupon', 'fb_receipt', 'fb_feedback'];
const clone = (type: string) => structuredClone(DEFAULT_BODY_FOR_TYPE[type]);

/** 斷言回 400 且 details.issues 指出指定欄位 */
function rejects(type: string, body: Record<string, unknown>, path: string) {
  assert.throws(
    () => validateFbMaterialBody(type, body),
    (e: { statusCode?: number; details?: { issues?: Array<{ path: string }> } }) => {
      assert.equal(e.statusCode, 400, `${type} 應回 400`);
      const paths = e.details?.issues?.map((i) => i.path) ?? [];
      assert.ok(paths.includes(path), `${type} 應指出 ${path}，實際 ${paths.join(', ')}`);
      return true;
    },
  );
}

test('Valid default content：9 種版型的編輯器預設內容都通過', () => {
  for (const type of FB_TYPES) {
    assert.ok(DEFAULT_BODY_FOR_TYPE[type], `預設內容缺 ${type}`);
    assert.doesNotThrow(() => validateFbMaterialBody(type, clone(type)), type);
  }
});

test('非 FB 版型不檢查', () => {
  assert.doesNotThrow(() => validateFbMaterialBody('line_text', { text: '' }));
});

test('Empty required field：必填欄位去空白後為空', () => {
  rejects('fb_coupon', { ...clone('fb_coupon'), title: '   ' }, 'body.title');
  rejects('fb_text', { text: '' }, 'body.text');
  rejects('fb_button', { ...clone('fb_button'), text: '' }, 'body.text');
  rejects('fb_receipt', { ...clone('fb_receipt'), recipient_name: '' }, 'body.recipient_name');
  rejects('fb_receipt', { ...clone('fb_receipt'), order_number: ' ' }, 'body.order_number');
  const generic = clone('fb_generic') as { elements: Array<Record<string, unknown>> };
  generic.elements[0].title = '';
  rejects('fb_generic', generic, 'body.elements.0.title');
});

test('長度上限', () => {
  rejects('fb_text', { text: 'a'.repeat(2001) }, 'body.text');
  assert.doesNotThrow(() => validateFbMaterialBody('fb_text', { text: 'a'.repeat(2000) }));
  rejects('fb_button', { ...clone('fb_button'), text: 'a'.repeat(641) }, 'body.text');
  rejects('fb_coupon', { ...clone('fb_coupon'), title: 'a'.repeat(81) }, 'body.title');
  rejects('fb_coupon', { ...clone('fb_coupon'), subtitle: 'a'.repeat(81) }, 'body.subtitle');
  const button = clone('fb_button') as { buttons: Array<Record<string, unknown>> };
  button.buttons[0].title = 'a'.repeat(21);
  rejects('fb_button', button, 'body.buttons.0.title');
});

test('Too many buttons、No cards：卡片與按鈕數量', () => {
  const button = clone('fb_button') as { buttons: unknown[] };
  button.buttons.push({ type: 'postback', title: '第四顆', payload: 'x' });
  rejects('fb_button', button, 'body.buttons');
  rejects('fb_button', { ...clone('fb_button'), buttons: [] }, 'body.buttons');
  rejects('fb_generic', { elements: [] }, 'body.elements');
  const many = { elements: Array.from({ length: 11 }, (_, i) => ({ title: `卡 ${i}` })) };
  rejects('fb_generic', many, 'body.elements');
  const cardButtons = clone('fb_generic') as { elements: Array<{ buttons?: unknown[] }> };
  cardButtons.elements[0].buttons = Array.from({ length: 4 }, () => ({ type: 'web_url', title: 'x', url: 'https://example.com' }));
  rejects('fb_generic', cardButtons, 'body.elements.0.buttons');
  rejects('fb_media', { ...clone('fb_media'), buttons: [1, 2].map(() => ({ type: 'web_url', title: 'x', url: 'https://example.com' })) }, 'body.buttons');
});

test('javascript scheme 與其他不安全網址', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'notaurl', '//evil.com/x.jpg']) {
    rejects('fb_image', { url: bad }, 'body.url');
  }
  rejects('fb_video', { url: 'javascript:alert(1)' }, 'body.url');
  rejects('fb_media', { media_type: 'image', url: 'javascript:alert(1)' }, 'body.url');
  rejects('fb_coupon', { ...clone('fb_coupon'), image_url: 'javascript:alert(1)' }, 'body.image_url');
  const generic = clone('fb_generic') as { elements: Array<Record<string, unknown>> };
  generic.elements[1].image_url = 'javascript:alert(1)';
  rejects('fb_generic', generic, 'body.elements.1.image_url');
  const button = clone('fb_button') as { buttons: Array<Record<string, unknown>> };
  button.buttons[2].url = 'javascript:alert(1)';
  rejects('fb_button', button, 'body.buttons.2.url');
});

test('圖片與影片網址必填；大圖廣告要有網址或 attachment_id', () => {
  rejects('fb_image', { url: '' }, 'body.url');
  rejects('fb_video', {}, 'body.url');
  rejects('fb_media', { media_type: 'image' }, 'body.url');
  assert.doesNotThrow(() => validateFbMaterialBody('fb_media', { media_type: 'video', attachment_id: '1234567890' }));
});

test('Sample image path：站內路徑與 http(s) 都接受', () => {
  for (const ok of ['/material-samples/product.jpeg', 'https://cdn.example.com/a.jpg', 'http://example.com/a.jpg']) {
    assert.doesNotThrow(() => validateFbMaterialBody('fb_image', { url: ok }), ok);
  }
});

test('Negative total、幣別格式', () => {
  rejects('fb_receipt', { ...clone('fb_receipt'), summary: { total_cost: -1 } }, 'body.summary.total_cost');
  rejects('fb_receipt', { ...clone('fb_receipt'), summary: { total_cost: '650' } }, 'body.summary.total_cost');
  rejects('fb_receipt', { ...clone('fb_receipt'), currency: 'XYZ1' }, 'body.currency');
  rejects('fb_receipt', { ...clone('fb_receipt'), currency: 'twd' }, 'body.currency');
  assert.doesNotThrow(() => validateFbMaterialBody('fb_receipt', { ...clone('fb_receipt'), summary: { total_cost: 0 } }));
});

test('Feedback expiry out of range 與問卷類型', () => {
  for (const bad of [9999, -1, 0, 1.5]) {
    rejects('fb_feedback', { ...clone('fb_feedback'), expires_in_days: bad }, 'body.expires_in_days');
  }
  for (const ok of [1, 7]) {
    assert.doesNotThrow(() => validateFbMaterialBody('fb_feedback', { ...clone('fb_feedback'), expires_in_days: ok }));
  }
  rejects('fb_feedback', { ...clone('fb_feedback'), question_type: 'abc' }, 'body.question_type');
});

test('Free-text media type 與按鈕類型', () => {
  rejects('fb_media', { ...clone('fb_media'), media_type: 'abc' }, 'body.media_type');
  const button = clone('fb_button') as { buttons: Array<Record<string, unknown>> };
  button.buttons[0] = { type: 'phone_number', title: 'x', payload: '+886' };
  rejects('fb_button', button, 'body.buttons.0.type');
  const postback = clone('fb_button') as { buttons: Array<Record<string, unknown>> };
  postback.buttons[0] = { type: 'postback', title: '查訂單', payload: '' };
  rejects('fb_button', postback, 'body.buttons.0.payload');
});

test('沒有值的欄位以編輯器顯示的預設值處理，不擋（media_type、currency、question_type、expires_in_days）', () => {
  // 編輯器在這些欄位沒有值時顯示 image／TWD／csat／7，FB 外掛也有預設；擋下會讓畫面與錯誤訊息對不上
  const media = clone('fb_media');
  delete media.media_type;
  assert.doesNotThrow(() => validateFbMaterialBody('fb_media', media));
  const receipt = clone('fb_receipt');
  delete receipt.currency;
  assert.doesNotThrow(() => validateFbMaterialBody('fb_receipt', receipt));
  const feedback = clone('fb_feedback');
  delete feedback.question_type;
  delete feedback.expires_in_days;
  assert.doesNotThrow(() => validateFbMaterialBody('fb_feedback', feedback));
});
