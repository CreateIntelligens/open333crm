// @vitest-environment jsdom
/**
 * 廣播列表在發送完成前自動更新（change fix-coupon-broadcast-immediate-run，
 * spec coupon-management「發放紀錄與廣播列表在發送完成前自動更新」）。
 *
 * 2026-10-27 UAT：附券廣播「立即發送」後列表停在「已排程」，要手動重新整理才看到結果。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('#src/lib/api.js', () => ({ default: { get: h.get, post: vi.fn() } }));

import { useBroadcasts } from '#src/hooks/useMarketing.js';

const reply = (rows: unknown[]) => ({ data: { success: true, data: rows } });
const row = (status: string, scheduledAt: string | null = new Date(Date.now() - 1000).toISOString()) => ({
  id: 'b1', name: '秋季附券', status, couponId: 'c1', scheduledAt,
});

function Statuses() {
  const { broadcasts } = useBroadcasts();
  return <ul>{broadcasts.map((b: { id: string; status: string }) => <li key={b.id}>{b.status}</li>)}</ul>;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  h.get.mockReset();
});
afterEach(() => vi.useRealTimers());

function renderList() {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
      <Statuses />
    </SWRConfig>,
  );
}
const flush = () => act(async () => {});
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

test('廣播列表自動更新到已完成', async () => {
  h.get
    .mockResolvedValueOnce(reply([row('scheduled')]))
    .mockResolvedValueOnce(reply([row('sending')]))
    .mockResolvedValue(reply([row('completed')]));
  renderList();
  await flush();
  assert.ok(screen.getByText('scheduled'));
  await advance(5_000);
  assert.ok(screen.getByText('sending'));
  await advance(5_000);
  assert.ok(screen.getByText('completed'));

  const calls = h.get.mock.calls.length;
  await advance(30_000);
  assert.equal(h.get.mock.calls.length, calls, '完成後不再重新載入');
});

test('排程在未來的廣播不自動更新', async () => {
  h.get.mockResolvedValue(reply([row('scheduled', new Date(Date.now() + 3600_000).toISOString())]));
  renderList();
  await flush();
  const calls = h.get.mock.calls.length;
  await advance(30_000);
  assert.equal(h.get.mock.calls.length, calls);
});
