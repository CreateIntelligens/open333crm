/**
 * 固定效期已到期的券不發（change improve-coupon-url-insert-ux，spec coupon-management
 * 「發券前檢查券可發放」）。固定效期的券到期後狀態仍是進行中（系統沒有排程自動結束），
 * 照常發出去的券一拿到就過期。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { isCouponPastFixedEnd, issueInstances } from '#src/coupon/issue.js';

const T = 'a0000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-28T08:00:00Z');

const coupon = (extra: Record<string, unknown> = {}) => ({
  id: 'c-1', codeMode: 'AUTO', sharedCode: null, codePrefix: null,
  validityMode: 'FIXED', endAt: new Date('2026-10-01T00:00:00Z'), afterClaimDays: null,
  totalLimit: null, perContactLimit: 1, ...extra,
});

test('isCouponPastFixedEnd：固定效期且到期日已過才算', () => {
  assert.equal(isCouponPastFixedEnd(coupon(), NOW), true);
  assert.equal(isCouponPastFixedEnd(coupon({ endAt: NOW }), NOW), true, '到期當下就不再發');
  assert.equal(isCouponPastFixedEnd(coupon({ endAt: new Date('2026-12-31T00:00:00Z') }), NOW), false);
  assert.equal(isCouponPastFixedEnd(coupon({ validityMode: 'AFTER_CLAIM' }), NOW), false, '不是固定效期不看到期日');
  assert.equal(isCouponPastFixedEnd(coupon({ endAt: null }), NOW), false);
  assert.equal(isCouponPastFixedEnd(coupon({ validityMode: null }), NOW), false);
});

test('issueInstances：固定效期已到期時每位對象都略過，不建立券', async () => {
  let created = 0;
  const tx = {
    $executeRaw: async () => 0,
    contact: { findMany: async () => [{ id: 'p1' }, { id: 'p2' }] },
    couponInstance: {
      count: async () => 0,
      findFirst: async () => null,
      create: async () => { created += 1; return { id: 'i', contactId: 'p1', code: 'X', status: 'CLAIMED' }; },
    },
  };
  const out = await issueInstances(tx as never, { tenantId: T, coupon: coupon(), contactIds: ['p1', 'p2'] });
  assert.equal(created, 0);
  assert.deepEqual(out.issued, []);
  assert.deepEqual(out.skipped, [
    { contactId: 'p1', reason: 'COUPON_EXPIRED' },
    { contactId: 'p2', reason: 'COUPON_EXPIRED' },
  ]);
});
