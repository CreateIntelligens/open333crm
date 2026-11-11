// @vitest-environment jsdom
/**
 * 報表頁的 CSAT 分數卡（issue #339 決定 8，analytics-reports「滿意度分數只算客人自評」）：
 * 平均只算客人自評，卡片另外顯示客服代評的筆數。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { KpiCards } from '#src/components/analytics/KpiCards.js';

afterEach(cleanup);

const base = { totalMessages: 10, openCases: 2, slaAchievementRate: 80 };

test('報表頁顯示客服代評筆數', () => {
  render(<KpiCards isLoading={false} data={{ ...base, csatAvg: 4.5, csatAgentRatedCount: 3 }} />);

  assert.ok(screen.queryByText('4.5') !== null, '顯示客人自評的平均');
  assert.ok(screen.queryByText('客服代評 3 筆（不計入平均）') !== null, '顯示客服代評的筆數');
});

test('沒有客服代評時不顯示代評筆數', () => {
  render(<KpiCards isLoading={false} data={{ ...base, csatAvg: 4.5, csatAgentRatedCount: 0 }} />);

  assert.ok(screen.queryByText(/客服代評/) === null);
});
