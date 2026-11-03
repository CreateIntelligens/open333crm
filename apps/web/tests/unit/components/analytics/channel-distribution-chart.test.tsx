// @vitest-environment jsdom
/**
 * 報表「渠道分析」：圖表顯示渠道名稱（Instagram、Facebook、網站聊天室），不顯示系統代號（THREADS、FB、WEBCHAT）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { test, vi } from 'vitest';
import { render } from '@testing-library/react';

// jsdom 量不到容器尺寸，ResponsiveContainer 不會畫圖；改成固定尺寸
vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>();
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children as React.ReactElement<{ width: number; height: number }>, { width: 800, height: 240 }),
  };
});

import { ChannelDistributionChart } from '#src/components/analytics/ChannelDistributionChart.js';

const data = {
  messagesByChannel: [
    { name: 'THREADS', value: 3 },
    { name: 'FB', value: 2 },
    { name: 'WEBCHAT', value: 1 },
  ],
  conversationsByChannel: [
    { name: 'THREADS', value: 2 },
    { name: 'FB', value: 1 },
    { name: 'WEBCHAT', value: 1 },
  ],
  botVsHuman: [],
};

test('各渠道對話數的橫軸顯示 Instagram、Facebook、網站聊天室，不顯示 THREADS、FB、WEBCHAT', () => {
  const { container } = render(<ChannelDistributionChart data={data} isLoading={false} />);
  const ticks = [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')].map((t) => t.textContent);
  assert.deepEqual(ticks, ['Instagram', 'Facebook', '網站聊天室']);
  const text = container.textContent ?? '';
  for (const code of ['THREADS', 'WEBCHAT']) assert.ok(!text.includes(code), `畫面出現系統代號 ${code}`);
});
