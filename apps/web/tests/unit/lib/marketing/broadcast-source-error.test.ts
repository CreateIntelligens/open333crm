/**
 * 建立廣播：含顧客專屬券連結的素材要附券（change improve-coupon-url-insert-ux，
 * spec coupon-management「沒附券的廣播不可使用含顧客專屬券連結的素材」）。
 * broadcastSourceError() 的結果決定提醒文字與建立按鈕是否停用。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { broadcastSourceError } from '#src/lib/marketing/broadcast-form.js';

const withUrl = { text: '秋季優惠：{{coupon.url}}' };

test('建立對話框提醒並停用建立按鈕：選了含券連結的素材、不附券', () => {
  const message = broadcastSourceError('LINE', { materialId: 'm1', couponId: '' }, withUrl);
  assert.ok(message !== null, '應回傳停用原因');
  assert.match(message, /顧客專屬券連結/);
  assert.match(message, /附上優惠券/);
});

test('附上一張券後提醒消失', () => {
  assert.equal(broadcastSourceError('LINE', { materialId: 'm1', couponId: 'c1' }, withUrl), null);
});

test('不含券連結的素材不受影響', () => {
  assert.equal(broadcastSourceError('LINE', { materialId: 'm1', couponId: '' }, { text: '秋季優惠開跑' }), null);
});
