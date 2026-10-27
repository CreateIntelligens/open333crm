// @vitest-environment jsdom
/**
 * LINE 關鍵字回覆表單的「同時發送優惠券」（add-coupon-system A15 15.1、design D25；
 * spec coupon-management「關鍵字回覆可以同時發券」）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { KeywordReplyEditDialog } from '#src/components/line/keyword-reply/KeywordReplyEditDialog.js';
import type { KeywordReply } from '#src/hooks/useKeywordReplies.js';

const coupons = [
  { id: 'k-active', displayCode: 'CP-24A7', name: '秋季九折', purpose: 'MARKETING', status: 'ACTIVE' },
  { id: 'k-service', displayCode: 'CP-31B2', name: '小額致歉金', purpose: 'SERVICE', status: 'ACTIVE' },
  { id: 'k-draft', displayCode: 'CP-0D01', name: '草稿券', purpose: 'MARKETING', status: 'DRAFT' },
  { id: 'k-ended', displayCode: 'CP-0E02', name: '已結束的券', purpose: 'MARKETING', status: 'ENDED' },
  { id: 'k-paused', displayCode: 'CP-0P03', name: '暫停的券', purpose: 'MARKETING', status: 'PAUSED' },
];

beforeEach(() => {
  api.get.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/marketing/materials')) {
      return { data: { data: [{ id: 'm-1', name: '歡迎訊息', contentType: 'text', channelType: 'line' }], meta: { totalPages: 1 } } };
    }
    if (url.startsWith('/coupons')) return { data: { success: true, data: coupons, meta: { total: coupons.length, page: 1, limit: 100 } } };
    throw new Error(`unexpected ${url}`);
  });
});
afterEach(cleanup);

const render = (ui: React.ReactElement) =>
  rtlRender(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

function openDialog(reply: KeywordReply | null = null) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<KeywordReplyEditDialog open reply={reply} onClose={() => {}} onSave={onSave} />);
  return onSave;
}

async function couponSelect(): Promise<HTMLSelectElement> {
  return (await screen.findByLabelText('同時發送優惠券')) as HTMLSelectElement;
}

async function fillBasics() {
  fireEvent.change(screen.getByPlaceholderText(/例：詢問營業時間/), { target: { value: '秋季領券' } });
  fireEvent.change(screen.getByPlaceholderText(/輸入關鍵字後按 Enter/), { target: { value: '領券' } });
  fireEvent.click(screen.getByRole('button', { name: /加入/ }));
}

const optionLabels = (select: HTMLSelectElement) => Array.from(select.options).map((o) => o.textContent);

test('從清單選券：選「秋季九折（CP-24A7）· 行銷」並儲存，送出這張券的 ID', async () => {
  const onSave = openDialog();
  await fillBasics();
  const select = await couponSelect();
  await screen.findByRole('option', { name: '秋季九折（CP-24A7）· 行銷' });
  fireEvent.change(select, { target: { value: 'k-active' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.equal(onSave.mock.calls.length, 1);
  assert.equal(onSave.mock.calls[0][0].couponId, 'k-active');
  assert.equal(onSave.mock.calls[0][0].materialId, null);
});

test('草稿或已結束的券不在清單：只有進行中的券（行銷與客服補償都列）', async () => {
  openDialog();
  const select = await couponSelect();
  await screen.findByRole('option', { name: '秋季九折（CP-24A7）· 行銷' });
  const labels = optionLabels(select);
  assert.ok(labels.includes('小額致歉金（CP-31B2）· 客服補償'));
  assert.equal(labels.some((l) => /草稿券|已結束的券|暫停的券/.test(l ?? '')), false);
});

test('已存的券被暫停：下拉選單顯示「已暫停、已結束或找不到的券」並保留原值', async () => {
  openDialog({
    id: 'r1', name: '秋季領券', keywords: ['領券'], matchMode: 'any', materialId: null, couponId: 'k-paused', failureText: '',
    isActive: true, createdAt: '2026-10-01T00:00:00.000Z', actions: [], conditions: null,
  });
  const select = await couponSelect();
  await screen.findByRole('option', { name: '秋季九折（CP-24A7）· 行銷' });
  assert.equal(select.value, 'k-paused');
  assert.match(select.options[select.selectedIndex]?.textContent ?? '', /已暫停、已結束或找不到的券/);
});

test('只發券的關鍵字規則：不選素材也能儲存，可填發不出時回覆顧客', async () => {
  const onSave = openDialog();
  await fillBasics();
  const select = await couponSelect();
  await screen.findByRole('option', { name: '秋季九折（CP-24A7）· 行銷' });
  fireEvent.change(select, { target: { value: 'k-active' } });
  fireEvent.change(screen.getByLabelText('發不出時回覆顧客'), { target: { value: '您已經領過這張券囉' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.deepEqual(onSave.mock.calls[0][0], {
    name: '秋季領券', keywords: ['領券'], matchMode: 'any', materialId: null, couponId: 'k-active', failureText: '您已經領過這張券囉',
  });
});

test('素材與優惠券都沒選：表單提示至少選一個，不送出', async () => {
  const onSave = openDialog();
  await fillBasics();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  screen.getByText('回覆素材與優惠券至少要選一個');
  assert.equal(onSave.mock.calls.length, 0);
});

test('規則上的券已暫停，只修改關鍵字可以存檔：表單不擋，仍標示券已暫停', async () => {
  const onSave = openDialog({
    id: 'r1', name: '秋季領券', keywords: ['領券'], matchMode: 'any', materialId: null, couponId: 'k-paused', failureText: '',
    isActive: true, createdAt: '2026-10-01T00:00:00.000Z', actions: [], conditions: null,
  });
  await screen.findByRole('option', { name: '秋季九折（CP-24A7）· 行銷' });
  screen.getByText(/這張券已暫停、已結束或被刪除/);
  fireEvent.change(screen.getByPlaceholderText(/輸入關鍵字後按 Enter/), { target: { value: '優惠' } });
  fireEvent.click(screen.getByRole('button', { name: /加入/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.equal(onSave.mock.calls.length, 1);
  assert.equal(onSave.mock.calls[0][0].couponId, 'k-paused');
  assert.deepEqual(onSave.mock.calls[0][0].keywords, ['領券', '優惠']);
});

// ── 傳送的素材不是 LINE 素材（PR #364 第二輪審查）──────────────────────────
const fbReply: KeywordReply = {
  id: 'r-fb', name: '詢價', keywords: ['價格'], matchMode: 'any', materialId: 'm-fb', couponId: null, failureText: '',
  isActive: true, createdAt: '2026-10-01T00:00:00.000Z', actions: [], conditions: null,
  materialIssue: { kind: 'other_channel', channelLabel: 'Facebook' },
};

test('傳送 Facebook 素材的規則：開啟就說明原因，儲存時擋下', async () => {
  const onSave = openDialog(fbReply);
  await screen.findByText('這條規則傳送的是 Facebook 素材，請到自動化規則編輯');
  fireEvent.change(screen.getByPlaceholderText(/輸入關鍵字後按 Enter/), { target: { value: '多少錢' } });
  fireEvent.click(screen.getByRole('button', { name: /加入/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.equal(onSave.mock.calls.length, 0, '不送出');
  assert.ok(screen.getAllByText('這條規則傳送的是 Facebook 素材，請到自動化規則編輯').length >= 1);
  const link = screen.getByRole('link', { name: '到自動化規則編輯' });
  assert.equal(link.getAttribute('href'), '/dashboard/automation/r-fb');
});

test('傳送 Facebook 素材的規則改選 LINE 素材：可以儲存', async () => {
  const onSave = openDialog(fbReply);
  await screen.findByRole('option', { name: /歡迎訊息/ });
  fireEvent.change(screen.getByDisplayValue('— 請選擇 —'), { target: { value: 'm-1' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.equal(onSave.mock.calls.length, 1);
  assert.equal(onSave.mock.calls[0][0].materialId, 'm-1');
});
