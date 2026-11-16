// @vitest-environment jsdom
/**
 * /admin/plans 的留言自動私訊上限欄位（change add-comment-keyword-private-reply tasks 9.7；
 * spec comment-reply-platform-controls「平台設定留言自動私訊的方案上限」、design D23）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { platformApi, store } = vi.hoisted(() => ({
  store: { limits: {} as Record<string, number | null> },
  platformApi: { get: vi.fn(), patch: vi.fn() },
}));
vi.mock('#src/app/admin/lib/platform-api.js', () => ({ platformApi }));

import PlansPage from '#src/app/admin/plans/page.js';

beforeEach(() => {
  vi.clearAllMocks();
  store.limits = { maxAgents: 5 };
  platformApi.get.mockImplementation(async (url: string) => {
    if (url === '/registry') return { data: { data: { features: [], channelTypes: [] } } };
    return {
      data: {
        data: [
          { id: 'plan-pro', slug: 'pro', name: '專業版', features: [], limits: { ...store.limits }, allowedChannelTypes: [], permissionOverrides: {}, priceMonthly: 3000, isActive: true },
        ],
      },
    };
  });
  platformApi.patch.mockImplementation(async (_url: string, body: { limits: Record<string, number | null> }) => {
    store.limits = body.limits;
    return { data: { data: {} } };
  });
});

test('設定上限並讀回：留言規則數設 10、每月留言私訊數留空送 null', async () => {
  render(<PlansPage />);
  const rules = (await screen.findByLabelText('專業版 留言規則數（啟用中）')) as HTMLInputElement;
  const monthly = screen.getByLabelText('專業版 每月留言私訊數') as HTMLInputElement;
  assert.equal(rules.value, '');
  assert.equal(monthly.value, '');

  fireEvent.change(rules, { target: { value: '10' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });

  assert.equal(platformApi.patch.mock.calls.length, 1);
  const [url, body] = platformApi.patch.mock.calls[0];
  assert.equal(url, '/plans/plan-pro');
  assert.equal(body.limits.maxCommentReplyRules, 10);
  assert.ok('monthlyCommentReplies' in body.limits, '留空的上限也要送出 null，而不是省略');
  assert.equal(body.limits.monthlyCommentReplies, null);
  // 既有上限不受影響
  assert.equal(body.limits.maxAgents, 5);

  // 讀回：重新載入後顯示儲存的值
  await waitFor(() => assert.ok(platformApi.get.mock.calls.filter(([u]) => u === '/plans').length >= 2));
  assert.equal(store.limits.maxCommentReplyRules, 10);
  assert.equal((screen.getByLabelText('專業版 留言規則數（啟用中）') as HTMLInputElement).value, '10');
});
