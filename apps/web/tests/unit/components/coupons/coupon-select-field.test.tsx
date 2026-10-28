// @vitest-environment jsdom
/**
 * 關鍵字回覆、加好友禮的選券欄（change improve-coupon-url-insert-ux，spec coupon-management
 * 「發券前檢查券可發放」）：固定效期已過到期日的券狀態仍是進行中，但規則觸發時不會發券，不能選。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('#src/lib/api.js', () => ({ default: { get: h.get } }));

import { CouponSelectField } from '#src/components/coupons/CouponSelectField.js';

const rows = [
  { id: 'c1', name: '秋季九折', displayCode: 'MKT-1', purpose: 'MARKETING', status: 'ACTIVE', validityMode: 'FIXED', endAt: '2099-12-31T00:00:00Z' },
  { id: 'c2', name: '夏季已到期', displayCode: 'MKT-2', purpose: 'MARKETING', status: 'ACTIVE', validityMode: 'FIXED', endAt: '2020-01-01T00:00:00Z' },
];

beforeEach(() => {
  h.get.mockReset().mockResolvedValue({ data: { data: rows } });
});
afterEach(cleanup);

function renderField(value: string) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CouponSelectField label="發送優惠券" value={value} onChange={() => {}} />
    </SWRConfig>,
  );
}

test('不列出固定效期已過到期日的券', async () => {
  renderField('');
  await screen.findByRole('option', { name: /秋季九折/ });
  assert.ok(screen.queryByRole('option', { name: /夏季已到期/ }) === null);
});

test('規則上已選的券過了到期日：提醒規則觸發時不會發券', async () => {
  renderField('c2');
  assert.ok(await screen.findByText(/已過到期日/));
});
