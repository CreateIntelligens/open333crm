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

// issue #502：每日 Token 長條圖只占左半邊、和下方起訖日期對不上
const barsOf = () => screen.getAllByTitle(/^\d{4}-\d{2}-\d{2}: .* token$/);

test('長條數等於區間天數', async () => {
  render(<UsagePage />);
  fireEvent.click(await screen.findByText('創造智能'));
  await screen.findByTitle('2026-11-08: 100 token');

  assert.equal(barsOf().length, 3);
});

test('長條跟著容器寬度平均伸展，不是固定 px 寬，並保留最大與最小寬度', async () => {
  render(<UsagePage />);
  fireEvent.click(await screen.findByText('創造智能'));
  await screen.findByTitle('2026-11-08: 100 token');

  for (const bar of barsOf()) {
    assert.equal(bar.style.flexGrow, '1', `${bar.title} 沒有 flex-grow`);
    assert.equal(bar.style.flexShrink, '1', `${bar.title} 不能收縮`);
    assert.equal(bar.style.width, '', `${bar.title} 不應寫死 px 寬度`);
    assert.ok(bar.style.maxWidth.endsWith('px'), `${bar.title} 沒有最大寬度`);
    assert.ok(bar.style.minWidth.endsWith('px'), `${bar.title} 沒有最小寬度`);
  }
});

test('起訖日期與長條在同一個寬度的容器內，首尾長條貼齊左右兩端', async () => {
  render(<UsagePage />);
  fireEvent.click(await screen.findByText('創造智能'));
  await screen.findByTitle('2026-11-08: 100 token');

  const bars = barsOf();
  const barRow = bars[0].parentElement;
  assert.ok(barRow !== null);
  // 長條數少、碰到最大寬度時，用 space-between 讓第一根貼左、最後一根貼右，跟日期列一致
  assert.equal(barRow.style.justifyContent, 'space-between');

  const start = screen.getByText('2026-11-08', { selector: 'span' });
  const end = screen.getByText('2026-11-10', { selector: 'span' });
  const dateRow = start.parentElement;
  assert.ok(dateRow !== null && dateRow === end.parentElement);
  assert.equal(dateRow.style.justifyContent, 'space-between');
  // 日期列與長條列是同一個寬度容器的子元素，橫向捲動時一起捲動
  assert.ok(dateRow.parentElement === barRow.parentElement, '日期列和長條列不在同一個容器內');
  // 該容器設定最小寬度（長條太多時撐出橫向捲軸），外層負責捲動
  const inner = barRow.parentElement as HTMLElement;
  assert.ok(inner.style.minWidth.endsWith('px'), '共用容器沒有最小寬度');
  assert.equal((inner.parentElement as HTMLElement).style.overflowX, 'auto');
});
