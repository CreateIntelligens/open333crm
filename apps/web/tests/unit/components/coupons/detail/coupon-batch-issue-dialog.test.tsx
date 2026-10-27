// @vitest-environment jsdom
/**
 * 券詳情頁「發送給…」（add-coupon-system A15 15.24、design D31）：選一個渠道與對象、
 * 送出前看到可送達人數與剩餘名額，名額不足時要確認才能送出。替換 API 與資料 hook，只測畫面行為。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  channels: [
    { id: 'ch-line', displayName: '門市 LINE', channelType: 'LINE', isActive: true },
    { id: 'ch-web', displayName: '網站客服', channelType: 'WEBCHAT', isActive: true },
  ],
  preview: {} as Record<string, unknown>,
}));

/** 預設預覽；每個測試開始前還原，改了它的測試中途失敗也不影響後面的測試 */
const DEFAULT_PREVIEW = { matched: 1, reachable: 1, coupon: { remaining: 50, limitReached: 0 }, maxRecipients: 1000 };

vi.mock('#src/lib/api.js', () => ({ default: { get: h.get, post: h.post } }));
vi.mock('#src/hooks/useChannels.js', () => {
  const result = { channels: h.channels, isLoading: false, error: undefined, mutate: vi.fn() };
  return { useChannels: () => result };
});
const tagsOk = { tags: [{ id: 't1', name: '秋季檔期意向', color: '#000', scope: 'CONTACT' }], isLoading: false, error: undefined, mutate: vi.fn() };
const tagsState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('#src/hooks/useContactTags.js', () => ({ useContactTags: () => tagsState.current }));
vi.mock('#src/hooks/useMarketing.js', () => {
  const result = { segments: [], isLoading: false, error: undefined, mutate: vi.fn() };
  return { useSegments: () => result };
});

import { CouponBatchIssueDialog } from '#src/components/coupons/detail/CouponBatchIssueDialog.js';

const COUPON_ID = '11111111-1111-4111-8111-111111111111';
const AMY = { id: '22222222-2222-4222-8222-222222222222', displayName: '王小美', phone: null, email: null };

beforeEach(() => {
  tagsState.current = tagsOk;
  h.preview = DEFAULT_PREVIEW;
  h.get.mockReset();
  h.post.mockReset();
  h.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/contacts')) return { data: { data: [AMY] } };
    return { data: { data: [] } };
  });
  h.post.mockImplementation(async (url: string) => {
    if (url.endsWith('/batch-issue/preview')) return { data: { data: h.preview } };
    if (url.endsWith('/batch-issue')) return { data: { data: { broadcastId: 'b1', name: '批次發放 2026-10-22 15:30', status: 'scheduled' } } };
    throw new Error(`unexpected ${url}`);
  });
});

async function pickAmy() {
  fireEvent.change(screen.getByLabelText('渠道'), { target: { value: 'ch-line' } });
  fireEvent.change(screen.getByPlaceholderText('輸入姓名、電話或 email 搜尋'), { target: { value: '小美' } });
  const option = await screen.findByRole('checkbox', { name: /王小美/ });
  fireEvent.click(option);
}

describe('從券詳情頁批次發券', () => {
  test('勾選聯絡人發券', async () => {
    const onQueued = vi.fn();
    render(<CouponBatchIssueDialog couponId={COUPON_ID} couponName="秋季九折" open onOpenChange={() => {}} onQueued={onQueued} />);
    await pickAmy();
    await screen.findByText(/可送達 1 人/);
    const submit = screen.getByRole('button', { name: '送出' });
    await waitFor(() => assert.equal((submit as HTMLButtonElement).disabled, false));
    await act(async () => {
      fireEvent.click(submit);
    });
    const call = h.post.mock.calls.find(([url]) => url === `/coupons/${COUPON_ID}/batch-issue`);
    assert.ok(call, '呼叫批次發券 API');
    assert.deepEqual(call[1], { channelId: 'ch-line', targetType: 'contacts', contactIds: [AMY.id] });
    assert.equal(onQueued.mock.calls.length, 1);
  });

  test('只列出可以發訊息的渠道', () => {
    render(<CouponBatchIssueDialog couponId={COUPON_ID} couponName="秋季九折" open onOpenChange={() => {}} onQueued={() => {}} />);
    const select = screen.getByLabelText('渠道') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    assert.ok(values.includes('ch-line'));
    assert.ok(!values.includes('ch-web'), '網站客服沒有渠道身分可以主動推送');
  });

  test('預覽顯示剩餘名額', async () => {
    h.preview = { matched: 80, reachable: 80, coupon: { remaining: 50, limitReached: 5 }, maxRecipients: 1000 };
    render(<CouponBatchIssueDialog couponId={COUPON_ID} couponName="秋季九折" open onOpenChange={() => {}} onQueued={() => {}} />);
    await pickAmy();
    await screen.findByText(/可送達 80 人，剩餘名額 50 張，5 人已達每人上限/);
    await screen.findByText(/25 人拿不到/);
    const submit = screen.getByRole('button', { name: '送出' }) as HTMLButtonElement;
    assert.equal(submit.disabled, true, '名額不足時要先確認');
    fireEvent.click(screen.getByRole('checkbox', { name: /我了解/ }));
    await waitFor(() => assert.equal(submit.disabled, false));
  });

  test('標籤載入失敗：說明原因並可重試，不顯示成「尚無標籤」', async () => {
    // PR #364 第四輪審查：原本載入失敗時顯示「尚無標籤」，管理員會以為沒有標籤
    const retry = vi.fn();
    tagsState.current = { tags: [], isLoading: false, error: { response: { status: 500, data: { error: { message: '伺服器忙碌中' } } } }, mutate: retry };
    render(<CouponBatchIssueDialog couponId={COUPON_ID} couponName="秋季九折" open onOpenChange={() => {}} onQueued={() => {}} />);
    fireEvent.change(screen.getByLabelText('對象'), { target: { value: 'tags' } });
    const alert = await screen.findByRole('alert');
    assert.match(alert.textContent ?? '', /標籤載入失敗/);
    assert.ok(screen.queryByText('尚無標籤') === null);
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    assert.equal(retry.mock.calls.length, 1);
  });
});
