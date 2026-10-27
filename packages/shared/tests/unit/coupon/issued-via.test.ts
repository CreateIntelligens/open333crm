/**
 * 發放方式代碼（add-coupon-system design D32）：API、workers、後台共用同一組代碼與顯示文字。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  COUPON_ISSUED_VIA,
  COUPON_ISSUED_VIA_LABELS,
  couponIssuedViaLabel,
  isReservedCouponIssuedVia,
} from '#src/coupon/issued-via.js';

describe('發放方式代碼', () => {
  it('代碼與 design D32 的表一致', () => {
    assert.deepEqual(
      Object.values(COUPON_ISSUED_VIA).sort(),
      ['api', 'automation', 'batch', 'broadcast', 'follow', 'inbox', 'keyword', 'public_link'],
    );
  });

  it('每個代碼都有顯示文字', () => {
    assert.deepEqual(COUPON_ISSUED_VIA_LABELS, {
      inbox: '對話發券',
      keyword: '關鍵字',
      follow: '加好友',
      automation: '自動化',
      broadcast: '廣播',
      batch: '批次發放',
      public_link: '公開領券',
      api: 'API',
    });
  });

  it('舊資料的觸發事件名稱：keyword.matched 為關鍵字，其他含點的為自動化', () => {
    assert.equal(couponIssuedViaLabel('keyword.matched'), '關鍵字');
    assert.equal(couponIssuedViaLabel('message.received'), '自動化');
    assert.equal(couponIssuedViaLabel('follow'), '加好友');
    assert.equal(couponIssuedViaLabel('public_link'), '公開領券');
  });

  it('沒有值或不認得的值回 undefined，由呼叫端決定怎麼顯示', () => {
    assert.equal(couponIssuedViaLabel(null), undefined);
    assert.equal(couponIssuedViaLabel(''), undefined);
    assert.equal(couponIssuedViaLabel('partner'), undefined);
  });
});

describe('系統保留的發放方式', () => {
  it('除了 api 以外的代碼都是系統保留', () => {
    for (const code of ['inbox', 'keyword', 'follow', 'automation', 'broadcast', 'batch', 'public_link']) {
      assert.equal(isReservedCouponIssuedVia(code), true, code);
    }
    assert.equal(isReservedCouponIssuedVia('api'), false);
  });

  it('舊的觸發事件名稱會被顯示成關鍵字或自動化，也視為保留', () => {
    assert.equal(isReservedCouponIssuedVia('keyword.matched'), true);
    assert.equal(isReservedCouponIssuedVia('message.received'), true);
  });

  it('整合程式自訂的代碼不是保留', () => {
    assert.equal(isReservedCouponIssuedVia('partner'), false);
    assert.equal(isReservedCouponIssuedVia('crm_sync'), false);
  });
});
