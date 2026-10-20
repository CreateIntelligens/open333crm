/**
 * 券夾狀態判定（add-coupon-system「顧客可於券夾查看持有的券」）。純函式。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { walletStatusOf, walletTabOf } from '#src/modules/coupon/coupon-fan.service.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-20T12:00:00+08:00').getTime();
const base = { status: 'CLAIMED', expiresAt: null as Date | null };
const coupon = { validityMode: 'AFTER_CLAIM' as string | null, startAt: null as Date | null };

describe('券夾狀態判定', () => {
  it('即將到期的券主動提示', () => {
    const soon = walletStatusOf({ ...base, expiresAt: new Date(now + 2 * DAY) }, coupon, now);
    assert.deepEqual(soon, { walletStatus: 'EXPIRING', daysLeft: 2 });
    const later = walletStatusOf({ ...base, expiresAt: new Date(now + 4 * DAY) }, coupon, now);
    assert.equal(later.walletStatus, 'AVAILABLE');
  });

  it('已過到期時間的券列為已失效', () => {
    const r = walletStatusOf({ ...base, expiresAt: new Date(now - 1000) }, coupon, now);
    assert.equal(r.walletStatus, 'EXPIRED');
    assert.equal(walletTabOf(r.walletStatus), 'invalid');
  });

  it('活動提前結束的券註明原因', () => {
    const r = walletStatusOf({ ...base, status: 'REVOKED' }, coupon, now);
    assert.equal(r.walletStatus, 'ENDED');
    assert.equal(walletTabOf(r.walletStatus), 'invalid');
  });

  it('已使用與未到生效日', () => {
    assert.equal(walletStatusOf({ ...base, status: 'REDEEMED' }, coupon, now).walletStatus, 'USED');
    const notYet = walletStatusOf(base, { validityMode: 'FIXED', startAt: new Date(now + DAY) }, now);
    assert.equal(notYet.walletStatus, 'NOT_YET');
    assert.equal(walletTabOf(notYet.walletStatus), 'available');
  });
});
