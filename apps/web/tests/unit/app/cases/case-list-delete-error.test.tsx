// @vitest-environment jsdom
/**
 * 工單列表刪除失敗時，顯示後端的錯誤訊息（HC-CASES-16）。後端把訊息放在
 * `response.data.error.message`。頁面原本讀 `response.data.message`，所以一律顯示「刪除工單失敗」。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), delete: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/hooks/useCases.js', () => ({
  useCases: () => ({ cases: [{ id: 'case-1', title: '冷氣不冷' }], meta: { total: 1 }, isLoading: false, mutate: vi.fn() }),
  useCaseStats: () => ({ stats: {}, mutate: vi.fn() }),
}));
vi.mock('#src/components/layout/Topbar.js', () => ({
  Topbar: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
}));
vi.mock('#src/components/case/CaseDashboardStats.js', () => ({ CaseDashboardStats: () => null }));
vi.mock('#src/components/case/CaseCreateModal.js', () => ({ CaseCreateModal: () => null }));
vi.mock('#src/components/case/CaseList.js', () => ({
  CaseList: ({ onDelete }: { onDelete: (id: string) => void }) => (
    <button type="button" onClick={() => onDelete('case-1')}>刪除</button>
  ),
}));

import CasesPage from '#src/app/dashboard/cases/page.js';

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: { data: [] } });
  api.delete.mockReset();
});
afterEach(cleanup);

test('刪除被後端拒絕時，列表顯示後端的錯誤訊息', async () => {
  api.delete.mockRejectedValue({
    response: { status: 403, data: { success: false, error: { code: 'FORBIDDEN', message: '權限不足：需要 case.delete' } } },
  });
  render(<CasesPage />);
  fireEvent.click(screen.getByText('刪除'));
  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, '權限不足：需要 case.delete');
});
