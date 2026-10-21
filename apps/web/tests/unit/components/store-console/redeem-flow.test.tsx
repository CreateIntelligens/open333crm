// @vitest-environment jsdom
/**
 * 核銷台：手動輸入序號 → 查券 → 確認核銷 → 結果。
 * spec store-redemption「查券不改變券的狀態」「核銷台核銷記錄門市且可安全重試」，design D13（手動輸入不補連字號）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LookupResponse } from '#src/lib/store-console-api.js';
import { coupon, lookupOk, me, networkError, today } from './fixtures.js';

const api = vi.hoisted(() => ({
  storeLogin: vi.fn(),
  getStoreName: vi.fn(),
  getMe: vi.fn(),
  lookupCoupon: vi.fn(),
  redeemCoupon: vi.fn(),
  getToday: vi.fn(),
  getStoreToken: vi.fn(),
  setStoreToken: vi.fn(),
  clearStoreToken: vi.fn(),
}));
vi.mock('#src/lib/store-console-api.js', () => api);
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { StoreConsoleApp } from '#src/components/store-console/StoreConsoleApp.js';

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getStoreToken.mockReturnValue('tok');
  api.getMe.mockResolvedValue(me());
  api.getToday.mockResolvedValue(today());
});

async function openManual() {
  render(<StoreConsoleApp storeId={null} />);
  fireEvent.click(await screen.findByRole('tab', { name: '手動核銷' }));
  return screen.getByLabelText('輸入券上的序號') as HTMLInputElement;
}

async function lookupAndConfirm(code = 'autumnr9xux9rg') {
  const input = await openManual();
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: '查詢' }));
  await screen.findByRole('button', { name: '確認核銷' });
}

// ── 手動輸入 ──

test('手動輸入只轉大寫，不自動補連字號；輸入框為等寬字且關閉自動校正', async () => {
  const input = await openManual();
  assert.equal(input.getAttribute('autocapitalize'), 'characters');
  assert.equal(input.getAttribute('autocomplete'), 'off');
  assert.equal(input.getAttribute('spellcheck'), 'false');
  assert.ok(input.className.includes('font-mono'));
  assert.ok(screen.getByText('輸入顧客券上 QR Code 下方的序號，連字號可省略。'));

  fireEvent.change(input, { target: { value: 'autumnr9xu' } });
  assert.equal(input.value, 'AUTUMNR9XU');
  fireEvent.change(input, { target: { value: 'autumn-r9xu x9rg' } });
  assert.equal(input.value, 'AUTUMN-R9XU X9RG');
});

test('沒有輸入時不能查詢；有輸入就能查詢，按 Enter 也會查詢', async () => {
  api.lookupCoupon.mockResolvedValue(lookupOk());
  const input = await openManual();
  assert.equal((screen.getByRole('button', { name: '查詢' }) as HTMLButtonElement).disabled, true);
  fireEvent.change(input, { target: { value: 'ab' } });
  assert.equal((screen.getByRole('button', { name: '查詢' }) as HTMLButtonElement).disabled, false);
  fireEvent.submit(input.closest('form')!);
  await screen.findByRole('button', { name: '確認核銷' });
  assert.equal(api.lookupCoupon.mock.calls[0][0], 'AB');
});

// ── 確認核銷 ──

test('查券結果可核銷：顯示結帳要做什麼、最低消費警示與券明細', async () => {
  api.lookupCoupon.mockResolvedValue(lookupOk());
  await lookupAndConfirm();
  assert.equal(api.lookupCoupon.mock.calls[0][0], 'AUTUMNR9XUX9RG');
  assert.ok(screen.getByText('結帳折抵'));
  assert.ok(screen.getByText('NT$100'));
  assert.ok(screen.getByText('最低消費'));
  assert.ok(screen.getByText('本次消費未滿 NT$1,000 不能使用'));
  assert.ok(screen.getByText('秋季回饋 滿千折百'));
  assert.ok(screen.getByText('陳◯明'));
  assert.ok(screen.getByText('2026/10/01 – 10/31'));
  assert.ok(screen.getByText('AUTUMN-R9XU-X9RG'));
  assert.ok(screen.getByText('按「取消」不會使用這張券'));
});

test('各券型的確認主卡文字', async () => {
  const cases: [Partial<ReturnType<typeof coupon>>, string[]][] = [
    [{ couponType: 'DISCOUNT_PERCENT', discountPercent: 15, percentCap: 300, minSpend: null }, ['結帳打折', '85 折', '最多折', 'NT$300']],
    [{ couponType: 'GIFT', giftName: '濾網', giftQty: 1, minSpend: null }, ['贈送', '濾網 ×1']],
    [{ couponType: 'EXCHANGE', exchangeItem: '冰美式中杯', exchangeValueCap: 90, minSpend: null }, ['兌換', '冰美式中杯 ×1', '價值上限', 'NT$90']],
  ];
  for (const [over, texts] of cases) {
    api.lookupCoupon.mockResolvedValue(lookupOk(coupon(over)));
    const { unmount } = render(<StoreConsoleApp storeId={null} />);
    fireEvent.click(await screen.findByRole('tab', { name: '手動核銷' }));
    fireEvent.change(screen.getByLabelText('輸入券上的序號'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: '查詢' }));
    await screen.findByRole('button', { name: '確認核銷' });
    for (const t of texts) assert.ok(screen.getAllByText(t).length > 0, t);
    unmount();
  }
});

test('按取消回到手動核銷，不核銷', async () => {
  api.lookupCoupon.mockResolvedValue(lookupOk());
  await lookupAndConfirm();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await screen.findByLabelText('輸入券上的序號');
  assert.equal(api.redeemCoupon.mock.calls.length, 0);
});

test('送出中顯示「核銷中…」並停用取消、確認與返回', async () => {
  api.lookupCoupon.mockResolvedValue(lookupOk());
  api.redeemCoupon.mockReturnValue(new Promise(() => {}));
  await lookupAndConfirm();
  fireEvent.click(screen.getByRole('button', { name: '確認核銷' }));
  const busy = await screen.findByRole('button', { name: '核銷中…' });
  assert.equal((busy as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole('button', { name: '返回' }) as HTMLButtonElement).disabled, true);
  fireEvent.click(busy);
  assert.equal(api.redeemCoupon.mock.calls.length, 1);
});

test('核銷成功：顯示核銷完成、明細含核銷時間與門市，下一位回掃描，紀錄數更新', async () => {
  api.lookupCoupon.mockResolvedValue(lookupOk());
  api.redeemCoupon.mockResolvedValue({ ok: true, redeemedAt: '2026-10-07T02:54:00.000Z', storeName: '大同3C・內湖門市', coupon: coupon() });
  await lookupAndConfirm();
  api.getToday.mockResolvedValue(today({ summary: { count: 1, discountTotal: 100, giftCount: 0, exchangeCount: 0 } }));
  fireEvent.click(screen.getByRole('button', { name: '確認核銷' }));
  await screen.findByText('核銷完成');
  assert.ok(screen.getByText('結帳折抵 NT$100'));
  assert.ok(screen.getByText('2026/10/07 10:54'));
  assert.ok(screen.getByText('大同3C・內湖門市', { selector: 'dd' }));
  const [code, key] = api.redeemCoupon.mock.calls[0];
  assert.equal(code, 'AUTUMN-R9XU-X9RG');
  assert.ok(typeof key === 'string' && key.length >= 8);

  fireEvent.click(screen.getByRole('button', { name: '下一位' }));
  await screen.findByRole('tab', { name: '掃描核銷', selected: true });
  await waitFor(() => assert.ok(screen.getByRole('button', { name: '紀錄 1' })));
});

test('網路錯誤：顯示網路不穩與結果未確認，重試沿用同一個重試鍵', async () => {
  api.lookupCoupon.mockResolvedValue(lookupOk());
  api.redeemCoupon.mockRejectedValueOnce(networkError());
  api.redeemCoupon.mockResolvedValueOnce({ ok: true, redeemedAt: '2026-10-07T02:54:00.000Z', storeName: '大同3C・內湖門市', coupon: coupon() });
  await lookupAndConfirm();
  fireEvent.click(screen.getByRole('button', { name: '確認核銷' }));
  await screen.findByText('網路不穩');
  // 請求可能已到後端並核銷：不能說券尚未使用，請店員按重試確認結果（沿用重試鍵不會重複核銷）
  assert.ok(screen.getByText('結果未確認'));
  assert.ok(screen.queryByText('券尚未使用') === null);
  assert.ok(screen.getByText('請按「重試」確認結果，不會重複核銷'));
  assert.ok(screen.getByText('「網路有點慢，我確認一下結果。」'));
  fireEvent.click(screen.getByRole('button', { name: '重試' }));
  await screen.findByText('核銷完成');
  assert.equal(api.redeemCoupon.mock.calls.length, 2);
  assert.equal(api.redeemCoupon.mock.calls[1][1], api.redeemCoupon.mock.calls[0][1]);
});

test('重新確認核銷（不是重試）會產生新的重試鍵', async () => {
  api.lookupCoupon.mockResolvedValue(lookupOk());
  api.redeemCoupon.mockRejectedValueOnce(networkError());
  await lookupAndConfirm();
  fireEvent.click(screen.getByRole('button', { name: '確認核銷' }));
  await screen.findByText('網路不穩');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  // 回到原本的分頁（手動），再查一次並確認
  fireEvent.click(await screen.findByRole('button', { name: '查詢' }));
  api.redeemCoupon.mockResolvedValueOnce({ ok: false, reason: 'ALREADY_REDEEMED', coupon: coupon(), redeemedAt: '2026-10-05T06:31:00.000Z', redeemedStoreName: '大同3C・信義門市' });
  fireEvent.click(await screen.findByRole('button', { name: '確認核銷' }));
  await screen.findByText('已於 10/5 使用過');
  assert.notEqual(api.redeemCoupon.mock.calls[1][1], api.redeemCoupon.mock.calls[0][1]);
});

// ── 失敗結果 ──

const FAILS: [string, LookupResponse, string[]][] = [
  [
    '已使用',
    { result: 'USED', coupon: coupon(), redeemedAt: '2026-10-05T06:31:00.000Z', redeemedStoreName: '大同3C・信義門市' },
    ['已於 10/5 使用過', '請顧客確認是否已用過', '2026/10/05 14:31', '大同3C・信義門市', '「這張券在 10/5 下午 2:31 已經使用過了，麻煩您確認一下。」', '返回掃描'],
  ],
  [
    '已到期',
    { result: 'EXPIRED', coupon: coupon(), expiresAt: '2026-09-30T15:59:00.000Z' },
    ['已於 9/30 到期', '過期的券無法核銷', '「這張券 9/30 已經到期了，有問題可以聯絡我們的客服。」', '返回掃描'],
  ],
  [
    '未到生效日',
    { result: 'NOT_YET', coupon: coupon(), availableAt: '2026-10-19T16:00:00.000Z' },
    ['10/20 起才能使用', '請顧客於生效日後再使用', '「這張券 10/20 起才能使用喔。」', '返回掃描'],
  ],
  [
    '找不到',
    { result: 'NOT_FOUND' },
    ['找不到這張券', '請確認序號是否正確', 'XYZ123', '「我再確認一次券號，請稍等。」', '確認序號後重新輸入', '重新掃描'],
  ],
  [
    '需在顧客手機上核銷',
    { result: 'WRONG_MODE', coupon: coupon({ name: '客服補償金 NT$200', redeemMode: 'STAFF_CODE' }) },
    ['需在顧客手機上核銷', '此券為店員驗證碼券或顧客自助券', '客服補償金 NT$200', '店員驗證碼', '「這張券要在您的手機上使用，請按「立即使用」。」'],
  ],
  [
    '活動已提前結束',
    { result: 'ENDED', coupon: coupon() },
    ['活動已提前結束', '這張券的活動已結束，無法核銷', '「這個活動已經提前結束了，有問題可以聯絡我們的客服。」'],
  ],
  [
    '輸入共用券號',
    { result: 'SHARED_CODE' },
    ['這是共用券號', '每位顧客的共用券號都相同，分不出是誰的券', '請掃描顧客手機上的 QR Code', '「麻煩出示手機上的優惠券 QR Code，我幫您掃描。」', '返回掃描'],
  ],
  [
    '尚未領取',
    { result: 'NOT_CLAIMED', coupon: coupon() },
    ['尚未領取', '顧客還沒有領取這張券，請顧客先完成領取', '「這張券還沒有領取，請先在手機上完成領取喔。」'],
  ],
];

for (const [label, response, texts] of FAILS) {
  test(`查券結果「${label}」直接顯示失敗畫面`, async () => {
    api.lookupCoupon.mockResolvedValue(response);
    const input = await openManual();
    fireEvent.change(input, { target: { value: 'xyz123' } });
    fireEvent.click(screen.getByRole('button', { name: '查詢' }));
    await screen.findByText('核銷結果');
    assert.ok(screen.getByText('無法使用'));
    for (const t of texts) assert.ok(screen.getAllByText(t).length > 0, t);
  });
}

test('找不到這張券：按「確認序號後重新輸入」回到手動並保留剛才的序號', async () => {
  api.lookupCoupon.mockResolvedValue({ result: 'NOT_FOUND' });
  const input = await openManual();
  fireEvent.change(input, { target: { value: 'xyz123' } });
  fireEvent.click(screen.getByRole('button', { name: '查詢' }));
  fireEvent.click(await screen.findByRole('button', { name: '確認序號後重新輸入' }));
  const again = (await screen.findByLabelText('輸入券上的序號')) as HTMLInputElement;
  assert.equal(again.value, 'XYZ123');
});

test('確認核銷時被另一台搶先：顯示已使用與使用門市', async () => {
  api.lookupCoupon.mockResolvedValue(lookupOk());
  api.redeemCoupon.mockResolvedValue({ ok: false, reason: 'ALREADY_REDEEMED', coupon: coupon(), redeemedAt: '2026-10-07T02:53:00.000Z', redeemedStoreName: '大同3C・信義門市' });
  await lookupAndConfirm();
  fireEvent.click(screen.getByRole('button', { name: '確認核銷' }));
  await screen.findByText('已於 10/7 使用過');
  assert.ok(screen.getByText('大同3C・信義門市'));
});

test('查券時網路錯誤：在手動分頁顯示錯誤說明', async () => {
  api.lookupCoupon.mockRejectedValue(networkError());
  const input = await openManual();
  fireEvent.change(input, { target: { value: 'abc' } });
  fireEvent.click(screen.getByRole('button', { name: '查詢' }));
  const alert = await screen.findByRole('alert');
  assert.ok(alert.textContent?.includes('網路不穩，請確認網路後再試一次'));
});
