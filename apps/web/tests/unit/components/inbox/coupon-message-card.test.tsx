// @vitest-environment jsdom
/**
 * 收件匣顯示自動化發出的券卡（add-coupon-system A15 15.8、design D27；spec coupon-management
 * 「自動化發出的券在收件匣顯示為券卡」）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CouponMessageCard } from '#src/components/inbox/coupon/CouponMessageCard.js';

const coupon = {
  instanceId: 'i-1',
  couponId: 'c-1',
  name: '秋季九折',
  couponType: 'DISCOUNT_PERCENT' as const,
  discountAmount: null,
  discountPercent: 10,
  giftName: null,
  exchangeItem: null,
  minSpend: null,
  expiresAt: null,
  issuedByName: null,
};

test('收件匣顯示自動化發出的券卡：券名、面額與「由規則「秋季領券」發送」', () => {
  render(<CouponMessageCard coupon={coupon} createdAt="2026-10-22T08:00:00.000Z" ruleName="秋季領券" />);
  screen.getByText('秋季九折');
  screen.getByText('9 折');
  screen.getByText(/由規則「秋季領券」發送/);
});

test('座席發的券仍顯示座席名稱', () => {
  render(<CouponMessageCard coupon={{ ...coupon, issuedByName: '王小美' }} createdAt="2026-10-22T08:00:00.000Z" />);
  screen.getByText(/由 王小美 發送/);
  assert.ok(screen.queryByText(/由規則/) === null);
});
