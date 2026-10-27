// @vitest-environment jsdom
/**
 * 關鍵字回覆表單的「同時發送優惠券」與渠道（add-coupon-system A15 15.1、design D25；
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
      // 依查詢的渠道回素材：LINE 有「歡迎訊息」、Facebook 有「FB 歡迎」，其他渠道沒有素材
      const channelType = new URLSearchParams(url.split('?')[1] ?? '').get('channelType');
      const all = [
        { id: 'm-1', name: '歡迎訊息', contentType: 'text', channelType: 'line' },
        { id: 'm-fb', name: 'FB 歡迎', contentType: 'fb_text', channelType: 'fb' },
      ];
      return { data: { data: all.filter((m) => m.channelType === channelType), meta: { totalPages: 1 } } };
    }
    if (url.startsWith('/coupons')) return { data: { success: true, data: coupons, meta: { total: coupons.length, page: 1, limit: 100 } } };
    throw new Error(`unexpected ${url}`);
  });
});
afterEach(cleanup);

const render = (ui: React.ReactElement) =>
  rtlRender(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

function openDialog(reply: KeywordReply | null = null, defaultChannel?: 'LINE' | 'FB' | 'THREADS') {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<KeywordReplyEditDialog open reply={reply} defaultChannel={defaultChannel} onClose={() => {}} onSave={onSave} />);
  return onSave;
}

/** 規則資料的預設值：LINE 規則、只發券 */
function reply(overrides: Partial<KeywordReply> = {}): KeywordReply {
  return {
    id: 'r1', name: '秋季領券', keywords: ['領券'], matchMode: 'any', materialId: null, couponId: 'k-paused', failureText: '',
    isActive: true, createdAt: '2026-10-01T00:00:00.000Z', actions: [], conditions: null,
    channel: 'LINE', defaultChannel: 'LINE',
    ...overrides,
  };
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
  openDialog(reply());
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
    name: '秋季領券', channel: 'LINE', keywords: ['領券'], matchMode: 'any', materialId: null, couponId: 'k-active', failureText: '您已經領過這張券囉',
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
  const onSave = openDialog(reply());
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

// ── 傳送的素材與規則渠道不符（PR #364 第二輪審查；change add-fb-ig-keyword-coupon design D5）──────
const fbReply = reply({
  id: 'r-fb', name: '詢價', keywords: ['價格'], materialId: 'm-fb', couponId: null,
  channel: 'LINE', defaultChannel: 'LINE',
  materialLookup: { channelType: 'fb', isActive: true },
  materialIssue: { kind: 'other_channel', channelLabel: 'Facebook', ruleChannelLabel: 'LINE' },
});
const FB_MISMATCH = '這條規則傳送的是 Facebook 素材，與所選渠道 LINE 不符，請改選素材或到自動化規則編輯';

test('傳送 Facebook 素材的規則不能在這頁存檔：開啟就說明原因，儲存時擋下', async () => {
  const onSave = openDialog(fbReply);
  await screen.findByText(FB_MISMATCH);
  fireEvent.change(screen.getByPlaceholderText(/輸入關鍵字後按 Enter/), { target: { value: '多少錢' } });
  fireEvent.click(screen.getByRole('button', { name: /加入/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.equal(onSave.mock.calls.length, 0, '不送出');
  assert.ok(screen.getAllByText(FB_MISMATCH).length >= 1);
  const link = screen.getByRole('link', { name: '到自動化規則編輯' });
  assert.equal(link.getAttribute('href'), '/dashboard/automation/r-fb');
});

test('傳送 Facebook 素材的規則改選 LINE 素材：可以儲存', async () => {
  const onSave = openDialog(fbReply);
  await screen.findByRole('option', { name: /歡迎訊息/ });
  fireEvent.change(screen.getByLabelText('回覆素材'), { target: { value: 'm-1' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.equal(onSave.mock.calls.length, 1);
  assert.equal(onSave.mock.calls[0][0].materialId, 'm-1');
  assert.equal(onSave.mock.calls[0][0].channel, 'LINE');
});

// ── 關鍵字回覆依所選渠道觸發（change add-fb-ig-keyword-coupon design D4、D5）─────────────

test('建立時選 Facebook：素材選單只列 Facebook 素材，儲存送出渠道 FB', async () => {
  const onSave = openDialog();
  await fillBasics();
  const channel = screen.getByLabelText('渠道') as HTMLSelectElement;
  assert.equal(channel.value, 'LINE', '「全部」時預設為 LINE');
  assert.deepEqual(Array.from(channel.options).map((o) => o.textContent), ['LINE', 'Facebook', 'Instagram']);
  fireEvent.change(channel, { target: { value: 'FB' } });
  await screen.findByRole('option', { name: /FB 歡迎/ });
  assert.ok(screen.queryByRole('option', { name: /^歡迎訊息/ }) === null, '不列 LINE 素材');
  fireEvent.change(screen.getByLabelText('回覆素材'), { target: { value: 'm-fb' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.equal(onSave.mock.calls.length, 1);
  assert.equal(onSave.mock.calls[0][0].channel, 'FB');
  assert.equal(onSave.mock.calls[0][0].materialId, 'm-fb');
});

test('建立時預設為列表目前篩選的渠道', async () => {
  openDialog(null, 'FB');
  assert.equal((screen.getByLabelText('渠道') as HTMLSelectElement).value, 'FB');
});

test('Instagram 的關鍵字回覆只發券：素材選單停用並說明，選券後儲存送出渠道 THREADS', async () => {
  const onSave = openDialog();
  await fillBasics();
  fireEvent.change(screen.getByLabelText('渠道'), { target: { value: 'THREADS' } });
  assert.equal((screen.getByLabelText('回覆素材') as HTMLSelectElement).disabled, true);
  screen.getByText('Instagram 目前沒有素材，只能發券');
  assert.ok(screen.queryByText(/THREADS/) === null, '畫面不顯示 THREADS');
  const select = await couponSelect();
  await screen.findByRole('option', { name: '秋季九折（CP-24A7）· 行銷' });
  fireEvent.change(select, { target: { value: 'k-active' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.equal(onSave.mock.calls.length, 1);
  assert.equal(onSave.mock.calls[0][0].channel, 'THREADS');
  assert.equal(onSave.mock.calls[0][0].materialId, null);
});

test('已有渠道的規則不能改渠道：顯示渠道，沒有可以更改渠道的選單', async () => {
  openDialog(reply({ channel: 'FB', defaultChannel: 'FB' }));
  await screen.findByText(/渠道：Facebook/);
  assert.ok(screen.queryByLabelText('渠道') === null);
});

test('沒有渠道條件的舊規則：渠道預設為 LINE、可以改選，並說明儲存後只在所選渠道觸發', async () => {
  const onSave = openDialog(reply({ channel: null, defaultChannel: 'LINE', couponId: 'k-active' }));
  assert.equal((screen.getByLabelText('渠道') as HTMLSelectElement).value, 'LINE');
  screen.getByText('這條規則原本沒有限定渠道，儲存後只在所選渠道的對話觸發');
  await screen.findByRole('option', { name: '秋季九折（CP-24A7）· 行銷' });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.equal(onSave.mock.calls[0][0].channel, 'LINE');
});

test('渠道條件這頁無法辨識：說明原因並連到自動化規則編輯，儲存時擋下', async () => {
  const onSave = openDialog(reply({ id: 'r-web', channel: null, channelIssue: true, defaultChannel: 'LINE', couponId: 'k-active' }));
  screen.getAllByText('這條規則的渠道條件這頁不能編輯，請到自動化規則編輯');
  assert.equal(screen.getByRole('link', { name: '到自動化規則編輯' }).getAttribute('href'), '/dashboard/automation/r-web');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.equal(onSave.mock.calls.length, 0);
});
