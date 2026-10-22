// @vitest-environment jsdom
/**
 * 店員核銷台一律淺色（2026-10-21 使用者決定）：店員手機系統設為深色時也不切換深色主題。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test } from 'vitest';
import { render } from '@testing-library/react';
import RedeemLayout from '#src/app/redeem/layout.js';

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

test('系統為深色時，核銷台仍是淺色', () => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('dark'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  render(<RedeemLayout><p>核銷台</p></RedeemLayout>);
  assert.equal(document.documentElement.classList.contains('dark'), false);
});
