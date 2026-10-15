// @vitest-environment jsdom
/**
 * 工單詳情頁頂部按鈕與狀態下拉（S05、S06）：
 * 按鈕只在狀態機允許時出現；下拉選「已升級」與「升級」按鈕一樣開升級對話框。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('next/navigation', () => ({ useParams: () => ({ caseId: 'case-1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('#src/components/layout/Topbar.js', () => ({
  Topbar: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
}));
vi.mock('#src/components/contact/TagManager.js', () => ({ TagManager: () => null }));

import CaseDetailPage from '#src/app/dashboard/cases/[caseId]/page.js';

let status = 'OPEN';
beforeEach(() => {
  api.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/cases/case-1') {
      return {
        data: {
          data: {
            id: 'case-1', title: '冷氣不冷', status, priority: 'MEDIUM',
            createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', events: [], notes: [],
          },
        },
      };
    }
    return { data: { data: [] } };
  });
  api.patch.mockReset().mockResolvedValue({ data: { data: {} } });
  api.post.mockReset().mockResolvedValue({ data: { data: {} } });
});

async function renderWith(s: string) {
  status = s;
  render(<CaseDetailPage />);
  await screen.findByText('時間軸與備註');
}

const button = (name: string) => screen.queryByRole('button', { name: new RegExp(name) });

test('開啟的工單：不顯示「標記解決」與「升級」，顯示「關閉案件」', async () => {
  await renderWith('OPEN');
  assert.ok(button('標記解決') === null);
  assert.ok(button('^升級$') === null);
  assert.ok(button('關閉案件') !== null);
});

test('處理中的工單：顯示「標記解決」與「升級」', async () => {
  await renderWith('IN_PROGRESS');
  assert.ok(button('標記解決') !== null);
  assert.ok(button('^升級$') !== null);
});

test('待處理與已升級的工單：不顯示「標記解決」', async () => {
  await renderWith('PENDING');
  assert.ok(button('標記解決') === null);
  assert.ok(button('^升級$') !== null);
});

test('已升級的工單：不顯示「標記解決」與「升級」', async () => {
  await renderWith('ESCALATED');
  assert.ok(button('標記解決') === null);
  assert.ok(button('^升級$') === null);
});

test('狀態下拉選「已升級」：開升級對話框，不直接 PATCH', async () => {
  await renderWith('IN_PROGRESS');
  const select = screen.getAllByRole('combobox').find((el) =>
    Array.from((el as HTMLSelectElement).options).some((o) => o.value === 'ESCALATED'),
  ) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'ESCALATED' } });

  await waitFor(() => assert.ok(screen.queryByText('確認升級') !== null, '應開啟升級對話框'));
  assert.equal(api.patch.mock.calls.length, 0);
});

test('重新開啟失敗：畫面顯示錯誤', async () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  api.post.mockRejectedValueOnce({ response: { data: { error: { message: '權限不足' } } } });
  await renderWith('CLOSED');
  fireEvent.click(button('重新開啟')!);
  await waitFor(() => assert.equal(alert.mock.calls.length, 1));
  assert.match(String(alert.mock.calls[0][0]), /權限不足/);
  alert.mockRestore();
});
