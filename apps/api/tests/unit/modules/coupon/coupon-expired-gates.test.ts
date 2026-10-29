/**
 * 固定效期已過到期日的券不發（change improve-coupon-url-insert-ux，spec coupon-management
 * 「發券前檢查券可發放」）。到期後狀態仍是進行中，只看狀態會發出一拿到就過期的券。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { isClaimable } from '#src/modules/coupon/coupon-claim-link.service.js';
import { issueCoupons } from '#src/modules/coupon/coupon-issue.service.js';
import { CouponValidationError } from '#src/modules/coupon/coupon.service.js';

const T = 'a0000000-0000-0000-0000-000000000001';
const NOW = new Date('2026-10-28T08:00:00Z');
const PAST = new Date('2026-10-01T00:00:00Z');
const FUTURE = new Date('2026-12-31T00:00:00Z');

const link = (coupon: Record<string, unknown>) => ({
  status: 'ACTIVE', startAt: null, endAt: null, coupon: { status: 'ACTIVE', validityMode: null, endAt: null, ...coupon },
});

test('公開領券：券的固定效期已過到期日時不能領', () => {
  assert.equal(isClaimable(link({ validityMode: 'FIXED', endAt: PAST }), NOW), false);
  assert.equal(isClaimable(link({ validityMode: 'FIXED', endAt: FUTURE }), NOW), true);
  assert.equal(isClaimable(link({ validityMode: 'AFTER_CLAIM', endAt: PAST }), NOW), true, '不是固定效期不看到期日');
});

test('發券：券的固定效期已過到期日時拋出清楚的錯誤，不建立券', async () => {
  let created = 0;
  const tx = {
    $executeRaw: async () => 0,
    coupon: {
      findFirst: async () => ({
        id: 'c-1', tenantId: T, status: 'ACTIVE', validityMode: 'FIXED', endAt: PAST, codeMode: 'UNIQUE_CODE',
        sharedCode: null, codePrefix: null, afterClaimDays: null, totalLimit: null, perContactLimit: 1, claimTagId: null,
      }),
    },
    contact: { findMany: async () => [{ id: 'p1' }] },
    couponInstance: {
      count: async () => 0,
      findFirst: async () => null,
      create: async () => { created += 1; return { id: 'i', contactId: 'p1', code: 'X', status: 'CLAIMED' }; },
    },
  };
  await assert.rejects(
    issueCoupons({ tx: tx as never, tenantId: T } as never, 'c-1', { contactIds: ['p1'] }),
    (e: Error) => e instanceof CouponValidationError && e.message === '券已過到期日，無法發放',
  );
  assert.equal(created, 0);
});
