/**
 * 序號明細的發放來源（add-coupon-system A15 15.7、design D27、D32；spec coupon-management
 * 「自動化發券記錄發券的規則」）。對照表與 @open333crm/shared 的發放方式代碼同一份。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { issuedSourceLines, issuedViaLabel } from '#src/components/coupons/detail/detail-helpers.js';

test('舊資料的觸發事件名稱：keyword.matched 顯示「關鍵字」，message.received 顯示「自動化」', () => {
  assert.equal(issuedViaLabel('keyword.matched'), '關鍵字');
  assert.equal(issuedViaLabel('message.received'), '自動化');
});

test('新的發放方式代碼都有顯示文字', () => {
  assert.equal(issuedViaLabel('follow'), '加好友');
  assert.equal(issuedViaLabel('public_link'), '公開領券');
  assert.equal(issuedViaLabel('broadcast'), '廣播');
});

test('不認得的值顯示「其他方式」，沒有值不顯示', () => {
  assert.equal(issuedViaLabel('something-else'), '其他方式');
  assert.equal(issuedViaLabel(null), null);
});

test('關鍵字規則發券的歸因：上行規則名稱，下行「關鍵字」', () => {
  assert.deepEqual(
    issuedSourceLines({ issuedVia: 'keyword', issuedSourceName: '秋季領券', issuedByName: null }),
    { primary: '秋季領券', secondary: '關鍵字' },
  );
});
