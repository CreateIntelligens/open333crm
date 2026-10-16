// @vitest-environment jsdom
/**
 * 我的績效（G11）：「平均首次回應」超過目標要顯示未達標。
 * 原本把「1 時 30 分」這種格式化後的字串 parseFloat 成 1，再跟目標 15 分比，永遠達標。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

const { perf } = vi.hoisted(() => ({ perf: { data: null as unknown } }));
vi.mock('#src/hooks/useAnalytics.js', () => ({ useMyPerformance: () => ({ data: perf.data, isLoading: false }) }));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: ({ title }: { title: string }) => <h1>{title}</h1> }));

import MyPerformancePage from '#src/app/dashboard/analytics/my/page.js';

afterEach(cleanup);

const base = {
  pendingCases: 0, slaSoonExpiring: 0, casesHandled: 3, casesResolved: 2,
  avgResolutionMinutes: 30, csatAvg: null, slaAchievementRate: null,
};

function firstResponseCard() {
  return screen.getByText('平均首次回應').parentElement as HTMLElement;
}

test('平均首次回應超過 1 小時顯示未達標', () => {
  perf.data = { ...base, avgFirstResponseMinutes: 90 };
  render(<MyPerformancePage />);
  const card = firstResponseCard();
  assert.ok(within(card).queryByText('1 時 30 分') !== null);
  assert.ok(within(card).queryByLabelText('未達標') !== null);
  assert.ok(within(card).queryByLabelText('達標') === null);
});

test('平均首次回應在目標內顯示達標', () => {
  perf.data = { ...base, avgFirstResponseMinutes: 10 };
  render(<MyPerformancePage />);
  const card = firstResponseCard();
  assert.ok(within(card).queryByLabelText('達標') !== null);
});

test('平均首次回應的目標有單位：目標 15 分內', () => {
  perf.data = { ...base, avgFirstResponseMinutes: 90 };
  render(<MyPerformancePage />);
  const card = firstResponseCard();
  assert.ok(within(card).queryByText('目標：15 分內') !== null, `實際：${card.textContent}`);
});

test('沒有資料時只顯示 -，不接單位（不出現「-%」「- / 5」）', () => {
  perf.data = { ...base, csatAvg: null, slaAchievementRate: null };
  render(<MyPerformancePage />);
  for (const label of ['CSAT 分數', 'SLA 達成率']) {
    const card = screen.getByText(label).parentElement as HTMLElement;
    assert.ok(within(card).queryByText('-') !== null, `${label} 實際：${card.textContent}`);
  }
});
