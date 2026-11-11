/**
 * 選券清單只列可發放的券（change improve-coupon-url-insert-ux，spec coupon-management
 * 「發券前檢查券可發放」）：固定效期到期後狀態仍是進行中，只看狀態會選到發不出去的券。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { isCouponIssuable } from '#src/lib/coupon/issuable.js';

const NOW = Date.parse('2026-10-28T08:00:00Z');

test('進行中、沒過固定效期的到期日才算可發放', () => {
  assert.equal(isCouponIssuable({ status: 'ACTIVE', validityMode: 'FIXED', endAt: '2026-12-31T00:00:00Z' }, NOW), true);
  assert.equal(isCouponIssuable({ status: 'ACTIVE', validityMode: 'FIXED', endAt: '2026-10-01T00:00:00Z' }, NOW), false);
  assert.equal(isCouponIssuable({ status: 'ACTIVE', validityMode: 'FIXED', endAt: '2026-10-28T08:00:00Z' }, NOW), false, '到期當下就不能發');
  assert.equal(isCouponIssuable({ status: 'ACTIVE', validityMode: 'AFTER_CLAIM', endAt: '2026-10-01T00:00:00Z' }, NOW), true);
  assert.equal(isCouponIssuable({ status: 'ACTIVE' }, NOW), true, '清單沒有帶效期欄位時只看狀態');
  assert.equal(isCouponIssuable({ status: 'PAUSED', validityMode: 'AFTER_CLAIM', endAt: null }, NOW), false);
});
