// @vitest-environment jsdom
/**
 * 我的績效（G11）：「平均首次回應」超過目標要顯示未達標。
 * 原本把「1 時 30 分」這種格式化後的字串 parseFloat 成 1，再跟目標 15 分比，永遠達標。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

const { perf } = vi.hoisted(() => ({ perf: { data: null as unknown, error: undefined as unknown, mutate: () => undefined } }));
vi.mock('#src/hooks/useAnalytics.js', () => ({
  useMyPerformance: () => ({ data: perf.data, isLoading: false, error: perf.error, mutate: perf.mutate }),
}));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: ({ title }: { title: string }) => <h1>{title}</h1> }));

import MyPerformancePage from '#src/app/dashboard/analytics/my/page.js';

afterEach(() => {
  cleanup();
  perf.error = undefined;
});

const base = {
  pendingCases: 0, slaSoonExpiring: 0, casesHandled: 3, casesResolved: 2,
  avgResolutionMinutes: 30, csatAvg: null, slaAchievementRate: null,
};

// 新版面（Claude Design）：每個指標是一張卡片（data-metric），達標狀態以文字「已達標／未達標」顯示，
// 目標寫成「目標 ≤ 15 分」，沒有資料顯示「—」且不接單位。測試目的與 main 原本的版本相同。
function metricCard(label: string) {
  return screen.getByText(label).closest('[data-metric]') as HTMLElement;
}

test('平均首次回應超過 1 小時顯示未達標', () => {
  perf.data = { ...base, avgFirstResponseMinutes: 90 };
  render(<MyPerformancePage />);
  const card = metricCard('平均首次回應');
  assert.match(card.textContent ?? '', /1 時 30\s*分/);
  assert.ok(within(card).queryByText('未達標') !== null);
  assert.ok(within(card).queryByText('已達標') === null);
});

test('平均首次回應在目標內顯示達標', () => {
  perf.data = { ...base, avgFirstResponseMinutes: 10 };
  render(<MyPerformancePage />);
  const card = metricCard('平均首次回應');
  assert.ok(within(card).queryByText('已達標') !== null);
});

test('平均首次回應的目標有單位', () => {
  perf.data = { ...base, avgFirstResponseMinutes: 90 };
  render(<MyPerformancePage />);
  const card = metricCard('平均首次回應');
  assert.match(card.textContent ?? '', /目標 ≤ 15 分/, `實際：${card.textContent}`);
});

test('沒有資料時只顯示 —，不接單位（不出現「—%」「— / 5」）', () => {
  perf.data = { ...base, csatAvg: null, slaAchievementRate: null };
  render(<MyPerformancePage />);
  for (const label of ['CSAT 分數', 'SLA 達成率']) {
    const card = metricCard(label);
    assert.ok(within(card).queryByText('—') !== null, `${label} 實際：${card.textContent}`);
    assert.doesNotMatch(card.textContent ?? '', /—\s*(%|\/\s*5)/);
  }
});

test('載入失敗且沒有資料：只顯示錯誤，不顯示「0 件」與「目前沒有待處理事項」（PR #539 bot 審查）', () => {
  perf.data = undefined;
  perf.error = new Error('500');
  render(<MyPerformancePage />);
  assert.ok(screen.queryByRole('alert') !== null);
  assert.ok(screen.queryByText('目前沒有待處理事項') === null);
  assert.ok(screen.queryByText('待處理提醒') === null);
  assert.ok(screen.queryByText('本月績效') === null);
});

test('分鐘數進位不出現「60 分」：119.6 分顯示 2 時 0 分', () => {
  perf.data = { ...base, avgFirstResponseMinutes: 10, avgResolutionMinutes: 119.6 };
  render(<MyPerformancePage />);
  const card = metricCard('平均解決時間');
  assert.match(card.textContent ?? '', /2 時 0\s*分/, `實際：${card.textContent}`);
});

test('高於目標時進度條 aria-valuenow 不超過 100（CSAT 4.8、SLA 95%）', () => {
  perf.data = { ...base, avgFirstResponseMinutes: 10, csatAvg: 4.8, slaAchievementRate: 95 };
  render(<MyPerformancePage />);
  for (const bar of screen.getAllByRole('progressbar')) {
    assert.ok(Number(bar.getAttribute('aria-valuenow')) <= 100, `${bar.getAttribute('aria-label')}：${bar.getAttribute('aria-valuenow')}`);
  }
});
