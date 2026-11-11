// @vitest-environment jsdom
/**
 * SLA 倒數顯示（S04）：逾期很久時不再顯示「-2202h 32m 11s」，改成中文、以天為單位。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SlaCountdown, formatSlaRemaining } from '#src/components/shared/SlaCountdown.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('逾期超過一天時以天與小時表示', () => {
  assert.equal(formatSlaRemaining(-(91 * DAY + 18 * HOUR + 32 * MIN + 11_000)), '逾期 91 天 18 小時');
});

test('逾期不到一天時以小時與分鐘表示', () => {
  assert.equal(formatSlaRemaining(-(5 * HOUR + 3 * MIN + 2_000)), '逾期 5 小時 3 分');
});

test('剩餘不到一小時時以分鐘與秒表示', () => {
  assert.equal(formatSlaRemaining(12 * MIN + 30_000), '剩 12 分 30 秒');
});

test('剩餘超過一天時以天與小時表示', () => {
  assert.equal(formatSlaRemaining(2 * DAY + 4 * HOUR), '剩 2 天 4 小時');
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T00:00:00Z'));
});
afterEach(() => vi.useRealTimers());

test('元件逾期顯示中文，不出現英文單位', () => {
  render(<SlaCountdown deadline={new Date(Date.now() - 92 * DAY).toISOString()} />);
  assert.ok(screen.queryByText('逾期 92 天 0 小時') !== null);
  assert.ok(screen.queryByText(/\d+h /) === null);
});
