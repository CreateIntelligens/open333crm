import assert from 'node:assert/strict';
import { test } from 'vitest';

import { faceValue } from '#src/lib/fan-coupon/labels.js';
import type { FanCoupon } from '#src/hooks/useFanCoupons.js';

function percent(discountPercent: number) {
  return { couponType: 'DISCOUNT_PERCENT', discountPercent } as unknown as FanCoupon['coupon'];
}

// 顧客端與核銷台、後台要顯示同一個折數（操作手冊實測 2026-10-22：顧客端寫「80 折」，核銷台寫「8 折」）
test('% 折扣券的折數與核銷台一致：折掉 20% 為 8 折，折掉 15% 為 85 折', () => {
  assert.equal(faceValue(percent(20)).value, '8');
  assert.equal(faceValue(percent(15)).value, '85');
  assert.equal(faceValue(percent(15)).suffix, '折');
});
