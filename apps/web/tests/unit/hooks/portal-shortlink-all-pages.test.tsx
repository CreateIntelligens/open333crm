// @vitest-environment jsdom
/**
 * 粉絲活動、提交紀錄、積分交易、短連結列表要取回全部資料（M13，2026-10-15 手冊盤點發現）。
 *
 * 修正前：這些 hook 不帶 page/limit，只拿到後端預設的前 20 筆，畫面又沒有分頁，
 * 第 21 筆以後在後台看不到也改不了。這些 API 的 meta 只有 total/page/limit，沒有 totalPages。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/SocketProvider.js', () => ({ useSocket: () => ({ socket: null }) }));

import { useActivities, usePoints, useSubmissions } from '#src/hooks/usePortal.js';
import { useShortLinks } from '#src/hooks/useShortLinks.js';

const TOTAL = 130;

beforeEach(() => {
  api.get.mockReset();
  // 模擬後端：沒帶 limit 時預設 20；meta 沒有 totalPages
  api.get.mockImplementation(async (_url: string, config?: { params?: { page?: number; limit?: number } }) => {
    const page = config?.params?.page ?? 1;
    const limit = config?.params?.limit ?? 20;
    const start = (page - 1) * limit;
    const data = Array.from({ length: Math.max(0, Math.min(limit, TOTAL - start)) }, (_, i) => ({ id: `r-${start + i}` }));
    return { data: { success: true, data, meta: { total: TOTAL, page, limit } } };
  });
});
afterEach(cleanup);

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

test('活動列表取回全部 130 筆', async () => {
  const { result } = renderHook(() => useActivities({ status: 'DRAFT' }), { wrapper });
  await waitFor(() => assert.equal(result.current.activities.length, TOTAL));
});

test('提交紀錄取回全部', async () => {
  const { result } = renderHook(() => useSubmissions('a-1'), { wrapper });
  await waitFor(() => assert.equal(result.current.submissions.length, TOTAL));
});

test('積分交易取回全部', async () => {
  const { result } = renderHook(() => usePoints('c-1'), { wrapper });
  await waitFor(() => assert.equal(result.current.transactions.length, TOTAL));
});

test('短連結列表取回全部', async () => {
  const { result } = renderHook(() => useShortLinks(), { wrapper });
  await waitFor(() => assert.equal(result.current.links.length, TOTAL));
});
