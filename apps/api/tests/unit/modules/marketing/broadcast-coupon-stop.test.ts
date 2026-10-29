/**
 * 附券廣播發送途中券不能再發時的停止原因（change improve-coupon-url-insert-ux，spec coupon-management
 * 「固定效期已過到期日的券不發放」）。到期與暫停的處理方式不同：暫停可以恢復後重新發送，到期要改附其他券。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { couponUnavailableStop } from '#src/modules/marketing/broadcast-coupon.flow.js';

test('券在發送途中被暫停或結束', () => {
  const stop = couponUnavailableStop('inactive', 3);
  assert.equal(stop.code, 'COUPON_NOT_ACTIVE');
  assert.match(stop.reason, /被暫停或結束/);
  assert.match(stop.reason, /其餘 3 位沒有發送/);
});

test('券在發送途中過了到期日', () => {
  const stop = couponUnavailableStop('expired', 2);
  assert.equal(stop.code, 'COUPON_EXPIRED');
  assert.match(stop.reason, /過了到期日/);
  assert.match(stop.reason, /其餘 2 位沒有發送/);
  assert.match(stop.reason, /改附其他券/);
});
