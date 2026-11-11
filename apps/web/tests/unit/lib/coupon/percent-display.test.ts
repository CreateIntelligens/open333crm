import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ default: {} }));

import { faceValueText } from '#src/lib/coupon/labels.js';
import { faceShort, faceText } from '#src/lib/coupon/issue.js';

// 後台、收件匣發券面板、顧客端、核銷台要顯示同一個折數（操作手冊實測 2026-10-22）
const pct = (discountPercent: number) =>
  ({ couponType: 'DISCOUNT_PERCENT', discountPercent, percentCap: null, discountAmount: null, minSpend: null }) as never;

test('後台券面額：折掉 20% 顯示「打 8 折」', () => {
  assert.match(faceValueText(pct(20)), /打 8 折/);
});

test('發券面板：折掉 20% 顯示「8 折」，折掉 15% 顯示「85 折」', () => {
  assert.equal(faceShort(pct(20)), '8 折');
  assert.equal(faceText(pct(20)), '8 折');
  assert.equal(faceShort(pct(15)), '85 折');
});
