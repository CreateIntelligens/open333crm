// @vitest-environment jsdom
/**
 * 活動詳情的廣播表格顯示失敗原因（change broadcast-failure-reason，issue #287）。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('#src/lib/api.js', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ campaignId: 'camp-1' }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: () => null }));
const campaign = {
  id: 'camp-1',
  name: '週年慶活動',
  status: 'active',
  broadcasts: [
    { id: 'b-1', name: '週年慶推播', status: 'failed', targetType: 'all', totalCount: 2, successCount: 0, failedCount: 2, failureReason: '全部 2 位對象都發送失敗。渠道回應：Authentication failed' },
    { id: 'b-2', name: '舊推播', status: 'failed', targetType: 'all', totalCount: 0, successCount: 0, failedCount: 0, failureReason: null },
  ],
};
vi.mock('#src/hooks/useMarketing.js', () => ({
  useCampaign: () => ({ campaign, isLoading: false, mutate: vi.fn() }),
  useBroadcasts: () => ({ broadcasts: campaign.broadcasts }),
}));

import CampaignDetailPage from '#src/app/dashboard/marketing/campaigns/[campaignId]/page.js';

test('Failed broadcast in the list：活動詳情的廣播表格顯示失敗原因，沒有原因時說明沒有記錄', () => {
  render(<CampaignDetailPage />);
  assert.ok(screen.queryByText(/全部 2 位對象都發送失敗/) !== null, '應顯示失敗原因');
  assert.ok(screen.queryByText(/沒有記錄失敗原因/) !== null, '舊廣播應說明沒有記錄原因');
});
