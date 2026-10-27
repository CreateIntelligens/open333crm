// @vitest-environment jsdom
/**
 * 廣播表單的「附上優惠券」（add-coupon-system A15 15.24、design D29）：只列進行中的行銷券；
 * 受眾大於剩餘名額時顯示警示，勾選確認後才能建立。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('#src/lib/api.js', () => ({ default: { get: h.get } }));

import { BroadcastCouponField } from '#src/components/marketing/BroadcastCouponField.js';

beforeEach(() => {
  h.get.mockReset();
  h.get.mockResolvedValue({ data: { data: [{ id: 'c1', name: '秋季九折', displayCode: 'MKT-1' }] } });
});

describe('廣播可以附上優惠券', () => {
  test('只列出進行中的行銷券', async () => {
    const onChange = vi.fn();
    render(<BroadcastCouponField value="" onChange={onChange} preview={null} acknowledged={false} onAcknowledge={() => {}} />);
    await screen.findByRole('option', { name: /秋季九折/ });
    const url = String(h.get.mock.calls[0][0]);
    assert.match(url, /status=ACTIVE/);
    assert.match(url, /purpose=MARKETING/);
    fireEvent.change(screen.getByLabelText('附上優惠券（選填）'), { target: { value: 'c1' } });
    assert.deepEqual(onChange.mock.calls[0], ['c1']);
  });

  test('預覽顯示剩餘名額', async () => {
    const onAck = vi.fn();
    render(
      <BroadcastCouponField
        value="c1"
        onChange={() => {}}
        preview={{ reachable: 80, coupon: { remaining: 50, limitReached: 5 } }}
        acknowledged={false}
        onAcknowledge={onAck}
      />,
    );
    await waitFor(() => assert.ok(screen.getByText(/25 人拿不到/)));
    fireEvent.click(screen.getByRole('checkbox', { name: /我了解/ }));
    assert.deepEqual(onAck.mock.calls[0], [true]);
  });

  test('沒有選券時不顯示名額', async () => {
    render(<BroadcastCouponField value="" onChange={() => {}} preview={{ reachable: 80 }} acknowledged={false} onAcknowledge={() => {}} />);
    await screen.findByRole('option', { name: /秋季九折/ });
    assert.ok(screen.queryByText(/剩餘名額/) === null);
  });

  test('進行中的行銷券超過 100 張時全部列出', async () => {
    // PR #364 審查：原本只取第一頁 100 張，第 101 張之後選不到
    h.get.mockImplementation(async (_url: string, config?: { params?: { page?: number } }) => {
      const page = config?.params?.page ?? 1;
      return page === 1
        ? { data: { data: [{ id: 'c1', name: '秋季九折', displayCode: 'MKT-1' }], meta: { totalPages: 2 } } }
        : { data: { data: [{ id: 'c101', name: '冬季八折', displayCode: 'MKT-101' }], meta: { totalPages: 2 } } };
    });
    render(<BroadcastCouponField value="" onChange={() => {}} preview={null} acknowledged={false} onAcknowledge={() => {}} />);
    await screen.findByRole('option', { name: /冬季八折/ });
    assert.ok(screen.getByRole('option', { name: /秋季九折/ }));
  });

  test('優惠券清單載入失敗時說明原因', async () => {
    h.get.mockRejectedValue({ response: { status: 403, data: { error: { message: '權限不足' } } } });
    render(<BroadcastCouponField value="" onChange={() => {}} preview={null} acknowledged={false} onAcknowledge={() => {}} />);
    await screen.findByText(/優惠券清單載入失敗/);
  });
});
