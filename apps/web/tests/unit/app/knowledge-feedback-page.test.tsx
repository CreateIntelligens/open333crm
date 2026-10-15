// @vitest-environment jsdom
/**
 * 知識庫「回報調教」的「標為已處理」按鈕（問題清單 A08）。
 * 後端要求 knowledge.admin（knowledge.routes.ts），預設客服角色沒有這個權限。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { api, perms } = vi.hoisted(() => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
  perms: { granted: new Set<string>() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/knowledge/feedback',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: () => null }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: (code: string) => perms.granted.has(code) }));
vi.mock('#src/hooks/useKnowledge.js', () => ({
  useKnowledge: () => ({ articles: [], meta: { total: 0, totalPages: 1 }, isLoading: false, mutate: vi.fn() }),
  useCategories: () => ({ categories: [] }),
  useSources: () => ({ sources: [] }),
}));
const feedback = [
  {
    id: 'f1',
    articleId: 'a1',
    messageId: null,
    userQuestion: '冷氣漏水怎麼辦',
    botReply: '請檢查排水管',
    confidence: 0.8,
    rating: 'down',
    status: 'open',
    createdAt: '2026-10-15T03:00:00.000Z',
    article: { id: 'a1', title: '冷氣漏水', externalDocId: null },
  },
];
vi.mock('#src/hooks/useKbFeedback.js', () => ({
  useKbFeedbackList: () => ({ feedback, isLoading: false, mutate: vi.fn() }),
  resolveKbFeedback: vi.fn(),
}));

import KnowledgePage from '#src/app/dashboard/knowledge/page.js';

beforeEach(() => {
  perms.granted = new Set(['knowledge.view']);
});

test('沒有 knowledge.admin 時不顯示「標為已處理」，並說明需要的權限', async () => {
  perms.granted = new Set(['knowledge.view', 'knowledge.manage']);
  render(<KnowledgePage />);
  await screen.findByText('冷氣漏水怎麼辦');
  assert.ok(screen.queryByRole('button', { name: '標為已處理' }) === null);
  assert.ok(screen.getByText(/需要「知識庫進階」權限/));
  assert.ok(screen.getByRole('button', { name: '編輯文章' }));
});

test('有 knowledge.admin 時顯示「標為已處理」', async () => {
  perms.granted = new Set(['knowledge.view', 'knowledge.manage', 'knowledge.admin']);
  render(<KnowledgePage />);
  await screen.findByText('冷氣漏水怎麼辦');
  assert.ok(screen.getByRole('button', { name: '標為已處理' }));
});
