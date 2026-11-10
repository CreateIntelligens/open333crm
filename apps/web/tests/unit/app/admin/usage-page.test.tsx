// @vitest-environment jsdom
/**
 * 平台後台的用量統計頁（openspec/changes/fix-platform-usage-trial-display，
 * platform-usage「每日用量以台灣日期分日並補齊沒有用量的日子」）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { platformApi } = vi.hoisted(() => ({
  platformApi: {
    get: vi.fn(async (url: string) => {
      if (url === '/usage/overview') {
        return { data: { data: { totalTokens: 400, totalCostUsd: '0.75', totalCalls: 2, activeTenants: 1, byProvider: [] } } };
      }
      if (url === '/usage/tenants') {
        return {
          data: {
            data: [{ tenantId: 't-1', tenantName: '創造智能', planName: '標準版', totalTokens: 400, totalCostUsd: '0.75', calls: 2 }],
          },
        };
      }
      if (url === '/usage/tenants/t-1') {
        return {
          data: {
            data: {
              trend: [
                { day: '2026-11-08', tokens: 100, costUsd: '0.5', calls: 1 },
                { day: '2026-11-09', tokens: 0, costUsd: '0', calls: 0 },
                { day: '2026-11-10', tokens: 300, costUsd: '0.25', calls: 1 },
              ],
              byFeature: [],
            },
          },
        };
      }
      return { data: { data: null } };
    }),
  },
}));
vi.mock('#src/app/admin/lib/platform-api.js', () => ({ platformApi }));

import UsagePage from '#src/app/admin/usage/page.js';

beforeEach(() => {
  // 台灣時間 2026-11-10 10:00
  vi.useFakeTimers({ now: new Date('2026-11-10T02:00:00.000Z'), toFake: ['Date'] });
  platformApi.get.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

const paramsOf = (url: string) => {
  const call = platformApi.get.mock.calls.find((c) => c[0] === url) as unknown as [string, { params: { from: string; to: string } }];
  assert.ok(call, `沒有呼叫 ${url}`);
  return call[1].params;
};

test('近 30 天從台灣 29 天前的 00:00 起算，三個查詢用同一個區間', async () => {
  render(<UsagePage />);
  fireEvent.click(await screen.findByText('創造智能'));
  await screen.findByTitle('2026-11-08: 100 token');

  const overview = paramsOf('/usage/overview');
  // 台灣 2026-10-12 00:00 = UTC 2026-10-11 16:00
  assert.equal(overview.from, '2026-10-11T16:00:00.000Z');
  assert.equal(overview.to, '2026-11-10T02:00:00.000Z');
  assert.deepEqual(paramsOf('/usage/tenants'), overview);
  assert.deepEqual(paramsOf('/usage/tenants/t-1'), overview);
});

test('沒有用量的日子不畫長條，仍佔一格', async () => {
  render(<UsagePage />);
  fireEvent.click(await screen.findByText('創造智能'));

  const zero = await screen.findByTitle('2026-11-09: 0 token');
  assert.equal(zero.style.height, '0px');
  const used = screen.getByTitle('2026-11-08: 100 token');
  assert.ok(Number.parseInt(used.style.height, 10) > 0);
});
