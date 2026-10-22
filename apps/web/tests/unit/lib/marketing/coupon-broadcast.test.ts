/**
 * 附券廣播的前端規則（add-coupon-system A15 15.24、design D29、D31）：名額警示與結果的原因文字。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  couponCapacityWarning,
  couponBroadcastReasonLabel,
  couponResultLines,
} from '#src/lib/marketing/coupon-broadcast.js';

describe('預覽顯示剩餘名額', () => {
  it('受眾大於剩餘名額時警示', () => {
    const w = couponCapacityWarning({ reachable: 80, coupon: { remaining: 50, limitReached: 5 } });
    assert.ok(w);
    assert.match(w, /剩餘名額 50/);
    assert.match(w, /25 人/, '可拿券的 75 人中有 25 人拿不到');
  });

  it('名額足夠時不警示', () => {
    assert.equal(couponCapacityWarning({ reachable: 40, coupon: { remaining: 50, limitReached: 0 } }), null);
  });

  it('沒有發行總量時不警示', () => {
    assert.equal(couponCapacityWarning({ reachable: 4000, coupon: { remaining: null, limitReached: 0 } }), null);
  });
});

describe('結果頁的原因文字', () => {
  it('素材已送達、優惠券訊息送不出', () => {
    assert.equal(couponBroadcastReasonLabel('COUPON_MESSAGE_FAILED'), '素材已送達，優惠券訊息送不出');
  });

  it('不認得的代碼顯示其他原因', () => {
    assert.equal(couponBroadcastReasonLabel('SOMETHING_NEW'), '其他原因');
  });

  it('依原因分列跳過與失敗人數', () => {
    const lines = couponResultLines({
      issued: 2,
      pending: 0,
      skipped: { TOTAL_LIMIT_REACHED: 1, NO_CHANNEL_IDENTITY: 3 },
      failed: { DELIVERY_FAILED: 1 },
    });
    assert.deepEqual(lines, [
      { kind: 'issued', label: '發券', count: 2 },
      { kind: 'skipped', label: '因發行總量已發完跳過', count: 1 },
      { kind: 'skipped', label: '因沒有這個渠道的身分跳過', count: 3 },
      { kind: 'failed', label: '訊息送不出（顧客可能已封鎖）', count: 1 },
    ]);
  });
});
