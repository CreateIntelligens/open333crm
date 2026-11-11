/**
 * 優惠券後台規則的純函式：店員驗證碼格式、發布後鎖定欄位、顧客端生效前遮蔽。
 * 對應 openspec/changes/add-coupon-system 的「店員驗證碼格式」「發布後鎖定關鍵設定」
 * 「未到生效日的券不顯示序號」。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { staffCodeError, findLockedChanges } from '#src/modules/coupon/coupon-rules.js';
import { toFanView } from '#src/modules/coupon/coupon-fan.service.js';

describe('店員驗證碼格式', () => {
  it('驗證碼位數或字元不符', () => {
    for (const code of ['123', '1234567', '12a4', '']) {
      assert.equal(staffCodeError(code), '需 4–6 位數字', `「${code}」應被拒絕`);
    }
  });

  it('驗證碼為連續或重複數字', () => {
    for (const code of ['111111', '0000', '123456', '654321', '2345']) {
      assert.equal(staffCodeError(code), '請避免使用連續或重複的數字', `「${code}」應被拒絕`);
    }
  });

  it('合法驗證碼（含開頭為 0）通過', () => {
    for (const code of ['082741', '582917', '1357', '90210']) {
      assert.equal(staffCodeError(code), null, `「${code}」應通過`);
    }
  });
});

describe('發布後鎖定關鍵設定', () => {
  const published = {
    couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, minSpend: 0, purpose: 'MARKETING',
    validityMode: 'FIXED', startAt: new Date('2026-10-01'), endAt: new Date('2026-10-31'),
    codeMode: 'UNIQUE_CODE', codePrefix: 'AUTUMN', redeemMode: 'STAFF_CODE', staffCode: '582917',
  };

  it('修改鎖定欄位時列出該欄位', () => {
    assert.deepEqual(findLockedChanges(published, { discountAmount: 200 }), ['discountAmount']);
    assert.deepEqual(findLockedChanges(published, { staffCode: '582918', redeemMode: 'SELF' }).sort(), ['redeemMode', 'staffCode']);
    assert.deepEqual(findLockedChanges(published, { endAt: '2026-11-30' }), ['endAt']);
  });

  it('值沒有改變的鎖定欄位不算修改', () => {
    assert.deepEqual(findLockedChanges(published, { discountAmount: 100, endAt: '2026-10-31T00:00:00.000Z' }), []);
  });

  it('可改欄位不受限制', () => {
    assert.deepEqual(findLockedChanges(published, { name: '新名稱', perContactLimit: 3, totalLimit: 500 }), []);
  });
});

describe('未到生效日的券不顯示序號', () => {
  const base = {
    id: 'i1', code: 'AUTUMN-7K2P-4M9X', status: 'CLAIMED',
    expiresAt: null, claimedAt: null, openedAt: null, redeemedAt: null,
  };
  const coupon = {
    name: '秋季回饋', description: null, terms: null, imageUrl: null,
    couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, discountPercent: null,
    validityMode: 'FIXED', startAt: new Date(Date.now() + 86_400_000), redeemMode: 'STAFF_CODE',
    afterOpenMinutes: null,
  };

  it('生效前檢視券詳情', () => {
    const view = toFanView({ ...base, coupon: { ...coupon, maskCodeBeforeStart: true } });
    assert.equal(view.code, null);
    assert.equal(view.codeHidden, true);
  });

  it('商家關閉生效前遮蔽', () => {
    const view = toFanView({ ...base, coupon: { ...coupon, maskCodeBeforeStart: false } });
    assert.equal(view.code, 'AUTUMN-7K2P-4M9X');
    assert.equal(view.codeHidden, false);
    // 仍未生效：使用按鈕不可用，由 availableAt 告知前端
    assert.ok(view.availableAt instanceof Date);
  });
});
