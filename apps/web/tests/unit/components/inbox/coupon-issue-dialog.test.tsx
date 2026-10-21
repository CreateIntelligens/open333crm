// @vitest-environment jsdom
/**
 * 對話發券 Dialog（add-coupon-system A11；Jira CM-196「對話發券 UX 規格」第一階段）。
 * 替換 API，只測畫面行為：補償紀錄、選券、確認、發送中、五種失敗、確認結果中、回覆期限、放棄詢問。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('#src/lib/api.js', () => ({ default: { get: h.get, post: h.post } }));

import { CouponIssueDialog } from '#src/components/inbox/coupon/CouponIssueDialog.js';

const CONV = 'c0000000-0000-4000-8000-000000000001';
const AGENT = 'a0000000-0000-4000-8000-000000000009';

function coupon(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k1', name: '小額致歉金', couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, discountPercent: null,
    percentCap: null, giftName: null, giftQty: null, exchangeItem: null, minSpend: null,
    validityMode: 'AFTER_CLAIM', startAt: null, endAt: null, afterClaimDays: 30, afterOpenMinutes: null,
    perContactLimit: 2, receivedCount: 0, limitReached: false, lastClaimedAt: null, lastRedeemedAt: null,
    expiringAt: null, drivesSpend: false,
    ...overrides,
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    conversation: { id: CONV, status: 'ACTIVE', assignedToId: AGENT, contactId: 'p1', contactName: '林佩君', channelType: 'LINE' },
    blocked: null,
    history: {
      count: 1, totalAmount: 200,
      latest: { couponName: '客服補償金', issuedByName: '阿哲', issuedAt: '2026-09-20T06:05:00.000Z', status: 'USED' },
    },
    coupons: [
      coupon({ id: 'k0', name: '滿千折百 補償券', minSpend: 1000, drivesSpend: true }),
      coupon(),
    ],
    ...overrides,
  };
}

let ctx: ReturnType<typeof context>;
const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });
const apiError = (code: string, details?: Record<string, unknown>, status = 409) =>
  Object.assign(new Error(code), { response: { status, data: { success: false, error: { code, message: code, details } } } });

const onClose = vi.fn();
const onIssued = vi.fn();
const flush = () => act(async () => {});
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

async function openDialog() {
  render(<CouponIssueDialog open conversationId={CONV} onClose={onClose} onIssued={onIssued} />);
  await flush();
}

async function toConfirm(name = '小額致歉金') {
  await openDialog();
  const card = screen.getByText(name).closest('li') as HTMLElement;
  fireEvent.click(within(card).getByRole('button', { name: '選擇' }));
}

beforeEach(() => {
  ctx = context();
  h.get.mockReset();
  h.post.mockReset();
  onClose.mockReset();
  onIssued.mockReset();
  h.get.mockImplementation((url: string) => (url.startsWith('/coupon-issue/conversations/') ? ok(ctx) : ok({ state: 'unknown' })));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('顧客補償紀錄', () => {
  test('顯示近 90 天的次數、金額與最近一筆', async () => {
    await openDialog();
    assert.ok(screen.getByRole('heading', { name: '發券給 林佩君' }));
    assert.ok(screen.getByText('近 90 天補償 1 次，共 NT$200'));
    assert.ok(screen.getByText('最近一筆：客服補償金 · 阿哲 · 09/20 · 已使用'));
  });

  test('沒有紀錄時顯示尚無補償紀錄', async () => {
    ctx = context({ history: { count: 0, totalAmount: 0, latest: null } });
    await openDialog();
    assert.ok(screen.getByText('尚無補償紀錄'));
  });
});

describe('選券', () => {
  test('有消費門檻的券標示可帶動消費，每張券顯示面額、效期、限領、已領張數與門檻', async () => {
    await openDialog();
    const first = screen.getAllByRole('listitem')[0];
    assert.ok(within(first).getByText('滿千折百 補償券'));
    assert.ok(within(first).getByText('可帶動消費'));
    assert.ok(within(first).getByText('$100'));
    assert.ok(within(first).getByText('有效 30 天 · 每人限 2 張 · 此顧客已領 0 · 滿 NT$1,000 可用'));
  });

  test('已達每人上限的券停用並說明領取與使用日期', async () => {
    ctx = context({
      coupons: [coupon({
        receivedCount: 1, perContactLimit: 1, limitReached: true,
        lastClaimedAt: '2026-09-20T06:05:00.000Z', lastRedeemedAt: '2026-09-22T03:00:00.000Z',
      })],
    });
    await openDialog();
    assert.equal(button('選擇').disabled, true);
    assert.ok(screen.getByText('此顧客已於 09/20 領取，09/22 已使用'));
  });

  test('即將到期的券提示到期日', async () => {
    ctx = context({ coupons: [coupon({ validityMode: 'FIXED', afterClaimDays: null, endAt: '2026-10-23T15:59:59.000Z', expiringAt: '2026-10-23T15:59:59.000Z' })] });
    await openDialog();
    assert.ok(screen.getByText('此券將於 10/23 到期'));
  });

  test('沒有可發的補償券', async () => {
    ctx = context({ coupons: [] });
    await openDialog();
    assert.ok(screen.getByText('目前沒有可發送的補償券，請洽行銷人員建立'));
  });

  test('載入失敗可重試', async () => {
    h.get.mockImplementationOnce(() => Promise.reject(apiError('INTERNAL_ERROR', undefined, 500)));
    await openDialog();
    assert.ok(screen.getByRole('alert'));
    fireEvent.click(button('重試'));
    await flush();
    assert.ok(screen.getByText('小額致歉金'));
  });
});

describe('確認', () => {
  test('選券後在同一個 Dialog 切到確認畫面，返回回到選券', async () => {
    await toConfirm();
    assert.ok(screen.getByText('林佩君'));
    assert.ok(screen.getByText('小額致歉金 · NT$100'));
    assert.ok(screen.getByText(/^發送後 30 天（至 \d{4}\/\d{2}\/\d{2}）$/));
    assert.ok(screen.getByText('發送後無法撤回'));
    fireEvent.click(button('返回'));
    assert.ok(screen.getByText('滿千折百 補償券'));
  });

  test('確認發送：發送中停用，成功後關閉並回報面額', async () => {
    let resolve: (v: unknown) => void = () => {};
    h.post.mockImplementation(() => new Promise((r) => { resolve = r; }));
    await toConfirm();
    fireEvent.click(button('確認發送'));
    assert.equal(button('發送中…').disabled, true);
    const [url, body] = h.post.mock.calls[0];
    assert.equal(url, `/coupon-issue/conversations/${CONV}`);
    assert.equal(body.couponId, 'k1');
    assert.equal(body.expectedAssigneeId, AGENT);
    assert.match(body.requestKey, /^[0-9a-f-]{36}$/);
    await act(async () => {
      resolve({ data: { success: true, data: { instanceId: 'i1', code: 'X', couponId: 'k1', couponName: '小額致歉金', messageId: 'm1' } } });
    });
    assert.deepEqual(onIssued.mock.calls[0][0], { couponName: '小額致歉金', faceText: 'NT$100' });
    assert.equal(onClose.mock.calls.length, 1);
  });
});

describe('發送失敗時 Dialog 不關閉', () => {
  test('兩位座席同時發給同一位顧客', async () => {
    h.post.mockRejectedValue(apiError('PER_CONTACT_LIMIT_REACHED', { issuedByName: '阿哲' }));
    await toConfirm();
    fireEvent.click(button('確認發送'));
    await flush();
    const alert = screen.getByRole('alert');
    assert.ok(within(alert).getByText('此顧客剛剛已由 阿哲 領取，已達每人上限'));
    assert.ok(within(alert).getByText('這次的券未發出。'));
    assert.equal(onClose.mock.calls.length, 0);
    // 回到選券並重新整理清單
    assert.ok(screen.getByText('滿千折百 補償券'));
    assert.equal(h.get.mock.calls.filter(([u]) => String(u).startsWith('/coupon-issue/conversations/')).length, 2);
  });

  test('面板開著時券被暫停或發完', async () => {
    h.post.mockRejectedValue(apiError('COUPON_NOT_ISSUABLE'));
    await toConfirm();
    fireEvent.click(button('確認發送'));
    await flush();
    assert.ok(within(screen.getByRole('alert')).getByText('此券已停止發放，並重新整理券清單'));
    assert.equal(h.get.mock.calls.filter(([u]) => String(u).startsWith('/coupon-issue/conversations/')).length, 2);
  });

  test('顧客封鎖或取消追蹤', async () => {
    h.post.mockRejectedValue(apiError('COUPON_DELIVERY_FAILED'));
    await toConfirm();
    fireEvent.click(button('確認發送'));
    await flush();
    assert.ok(within(screen.getByRole('alert')).getByText('顧客目前無法接收訊息，券未發出'));
    assert.equal(onClose.mock.calls.length, 0);
  });

  test('發送途中對話被結束或轉派', async () => {
    h.post.mockRejectedValue(apiError('CONVERSATION_OUT_OF_SCOPE'));
    await toConfirm();
    fireEvent.click(button('確認發送'));
    await flush();
    assert.ok(within(screen.getByRole('alert')).getByText('此對話已不在你的處理範圍'));
    assert.equal(button('確認發送').disabled, true);
  });

  test('網路逾時：確認發送結果中，查到結果前不可重送', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.post.mockRejectedValue(Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' }));
    let state: unknown = { state: 'pending' };
    h.get.mockImplementation((url: string) => (url.startsWith('/coupon-issue/requests/') ? ok(state) : ok(ctx)));
    await toConfirm();
    fireEvent.click(button('確認發送'));
    await flush();
    assert.ok(within(screen.getByRole('alert')).getByText('確認發送結果中…'));
    assert.equal(button('確認中…').disabled, true);
    const key = h.post.mock.calls[0][1].requestKey;

    state = { state: 'done', result: { ok: true, instanceId: 'i1', code: 'X', couponId: 'k1', couponName: '小額致歉金', messageId: 'm1' } };
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    assert.ok(h.get.mock.calls.some(([u]) => u === `/coupon-issue/requests/${key}`));
    assert.equal(onIssued.mock.calls.length, 1);
    assert.equal(onClose.mock.calls.length, 1);
  });

  test('網路逾時後查無這次發券：可以重送，沿用同一個發送鍵', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.post.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    await toConfirm();
    fireEvent.click(button('確認發送'));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    assert.ok(within(screen.getByRole('alert')).getByText('系統沒有收到這次發券，券未發出，可以重新發送。'));
    h.post.mockResolvedValueOnce({ data: { success: true, data: { instanceId: 'i1', code: 'X', couponId: 'k1', couponName: '小額致歉金', messageId: 'm1' } } });
    fireEvent.click(button('確認發送'));
    await flush();
    assert.equal(h.post.mock.calls[1][1].requestKey, h.post.mock.calls[0][1].requestKey);
    assert.equal(onIssued.mock.calls.length, 1);
  });
});

describe('渠道限制', () => {
  test('超過 24 小時回覆期限時停用所有選擇與按鈕', async () => {
    ctx = context({ blocked: { reason: 'REPLY_WINDOW_EXPIRED', windowHours: 24 } });
    await openDialog();
    assert.ok(within(screen.getByRole('alert')).getByText('已超過回覆期限，無法發送優惠券'));
    for (const b of screen.getAllByRole('button', { name: '選擇' })) assert.equal((b as HTMLButtonElement).disabled, true);
  });

  test('對話已關閉', async () => {
    ctx = context({ blocked: { reason: 'CONVERSATION_CLOSED' } });
    await openDialog();
    assert.ok(within(screen.getByRole('alert')).getByText('對話已結束，無法發券'));
  });

  test('機器人處理中的對話不能發券', async () => {
    ctx = context({ blocked: { reason: 'BOT_HANDLED' } });
    await openDialog();
    assert.ok(within(screen.getByRole('alert')).getByText('請先接手對話再發券'));
    for (const b of screen.getAllByRole('button', { name: '選擇' })) assert.equal((b as HTMLButtonElement).disabled, true);
  });

  test('送出時對話已轉給機器人', async () => {
    h.post.mockRejectedValue(apiError('CONVERSATION_BOT_HANDLED'));
    await toConfirm();
    fireEvent.click(button('確認發送'));
    await flush();
    assert.ok(within(screen.getByRole('alert')).getByText('機器人處理中，請先接手對話再發券'));
    assert.ok(within(screen.getByRole('alert')).getByText('這次的券未發出。'));
  });
});

describe('關閉', () => {
  test('還沒選券時直接關閉', async () => {
    await openDialog();
    fireEvent.click(button('關閉'));
    assert.equal(onClose.mock.calls.length, 1);
  });

  test('已選券後關閉先詢問放棄這次發券', async () => {
    await toConfirm();
    fireEvent.click(button('關閉'));
    assert.equal(onClose.mock.calls.length, 0);
    assert.ok(screen.getByText('放棄這次發券？'));
    fireEvent.click(button('繼續發券'));
    assert.ok(screen.getByText('發送後無法撤回'));
    fireEvent.click(button('關閉'));
    fireEvent.click(button('放棄'));
    assert.equal(onClose.mock.calls.length, 1);
  });

  test('按 Esc 等同關閉，已選券時先詢問', async () => {
    await toConfirm();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    assert.ok(screen.getByText('放棄這次發券？'));
    assert.equal(onClose.mock.calls.length, 0);
  });
});

