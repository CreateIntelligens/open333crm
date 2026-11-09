// @vitest-environment jsdom
/**
 * 工單詳情頁顯示滿意度（issue #444 的頁面接線）：頁面把 API 回傳的 csatScore、csatSentAt、
 * csatRespondedAt、csatComment 傳給 CaseDetail。#444 只以元件測試驗證 CaseDetail，
 * 頁面沒有傳這些欄位，UAT 上看不到滿意度區塊（2026-11-04 UAT 驗證發現）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('next/navigation', () => ({ useParams: () => ({ caseId: 'case-1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('#src/components/layout/Topbar.js', () => ({
  Topbar: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
}));
vi.mock('#src/components/contact/TagManager.js', () => ({ TagManager: () => null }));

import CaseDetailPage from '#src/app/dashboard/cases/[caseId]/page.js';

let csat: Record<string, unknown> = {};
beforeEach(() => {
  api.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/cases/case-1') {
      return {
        data: {
          data: {
            id: 'case-1', title: '冷氣不冷', status: 'CLOSED', priority: 'MEDIUM',
            createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', events: [], notes: [],
            ...csat,
          },
        },
      };
    }
    return { data: { data: [] } };
  });
});

test('工單詳情頁顯示客人的滿意度分數', async () => {
  csat = { csatScore: 2, csatSentAt: '2026-11-04T04:36:00Z', csatRespondedAt: '2026-11-04T04:38:00Z' };
  render(<CaseDetailPage />);
  const section = await screen.findByTestId('case-csat');
  assert.match(section.textContent ?? '', /2 分/);
});

test('問卷已寄出但客人還沒評分時顯示尚未評分', async () => {
  csat = { csatScore: null, csatSentAt: '2026-11-04T04:36:00Z' };
  render(<CaseDetailPage />);
  const section = await screen.findByTestId('case-csat');
  assert.match(section.textContent ?? '', /尚未評分/);
});
