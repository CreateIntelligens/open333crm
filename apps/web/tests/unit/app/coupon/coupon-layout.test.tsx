// @vitest-environment jsdom
/**
 * 顧客票券頁一律淺色（2026-10-21 使用者決定）：手機系統設為深色時也不切換深色主題。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test } from 'vitest';
import { render } from '@testing-library/react';
import CouponLayout from '#src/app/coupon/layout.js';

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

test('系統為深色時，票券頁仍是淺色', () => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('dark'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  render(<CouponLayout><p>券夾</p></CouponLayout>);
  assert.equal(document.documentElement.classList.contains('dark'), false);
});
