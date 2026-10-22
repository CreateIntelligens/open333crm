// @vitest-environment jsdom
/**
 * 「LINE 管理 → 加好友禮」設定頁（add-coupon-system A15 15.14、15.16；design D28；
 * spec coupon-management「加好友禮」）。
 *
 * 頁面在自動化規則之上：租戶唯一的一條規則，事件「加入好友」（contact.followed）、
 * 固定條件「第一次加入等於是」、動作「發送優惠券」。api 以替身記錄送出的內容。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: () => null }));

import FollowGiftPage from '#src/app/dashboard/line/follow-gift/page.js';

const coupons = [
  { id: 'k-new', displayCode: 'CP-50NF', name: '新朋友 50 元折價券', purpose: 'MARKETING', status: 'ACTIVE' },
  { id: 'k-other', displayCode: 'CP-31B2', name: '小額致歉金', purpose: 'SERVICE', status: 'ACTIVE' },
];

type Rule = Record<string, unknown> & { id: string };
let rules: Rule[] = [];

beforeEach(() => {
  rules = [];
  api.post.mockReset().mockResolvedValue({ data: { success: true, data: { id: 'r-created' } } });
  api.patch.mockReset().mockResolvedValue({ data: { success: true, data: {} } });
  api.get.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/coupons')) return { data: { success: true, data: coupons, meta: { total: coupons.length, page: 1, limit: 100 } } };
    if (url.startsWith('/automation/rules?')) {
      assert.match(url, /trigger=contact\.followed/);
      return { data: { success: true, data: rules.map(({ actions: _a, conditions: _c, ...r }) => r), meta: { totalPages: 1 } } };
    }
    const detail = url.match(/^\/automation\/rules\/([^/?]+)$/);
    if (detail) {
      const rule = rules.find((r) => r.id === detail[1]);
      if (rule) return { data: { success: true, data: rule } };
    }
    throw new Error(`unexpected ${url}`);
  });
});
afterEach(cleanup);

const render = (ui: React.ReactElement) =>
  rtlRender(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

const FIRST_FOLLOW = { fact: 'follow.isFirst', operator: 'equal', value: true };
const LINE_ONLY = { fact: 'conversation.channelType', operator: 'equal', value: 'LINE' };

function existingRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'r-gift',
    name: '加好友禮',
    trigger: { type: 'contact.followed' },
    isActive: true,
    priority: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    conditions: { all: [FIRST_FOLLOW, LINE_ONLY] },
    actions: [{ type: 'issue_coupon', params: { couponId: 'k-new' } }],
    ...overrides,
  };
}

async function couponSelect() {
  const select = (await screen.findByLabelText('加好友時發送的優惠券')) as HTMLSelectElement;
  await screen.findByRole('option', { name: '新朋友 50 元折價券（CP-50NF）· 行銷' });
  return select;
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
}

test('加好友禮頁的條件不能移除：儲存時規則的條件為「第一次加入等於是」，頁面沒有移除這個條件的選項', async () => {
  render(<FollowGiftPage />);
  const select = await couponSelect();
  fireEvent.change(select, { target: { value: 'k-new' } });
  fireEvent.click(screen.getByRole('switch', { name: '啟用加好友禮' }));
  await save();

  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  const [url, body] = api.post.mock.calls[0]!;
  assert.equal(url, '/automation/rules');
  assert.deepEqual(body.trigger, { type: 'contact.followed' });
  assert.equal(body.isActive, true);
  assert.deepEqual(body.conditions, { all: [FIRST_FOLLOW, LINE_ONLY] });
  assert.deepEqual(body.actions, [{ type: 'issue_coupon', params: { couponId: 'k-new' } }]);

  // 條件以固定文字顯示，沒有移除或修改的控制項
  assert.ok(screen.getByText("只發給第一次加入好友的顧客（固定條件）"));
  assert.ok(screen.queryByRole('button', { name: /移除/ }) === null);
});

test('已有加好友禮的規則：更新同一條（租戶唯一），條件被移除時補回，保留規則上的其他動作與條件', async () => {
  const tagCondition = { fact: 'contact.tags', operator: 'contains', value: '會員' };
  rules = [
    existingRule({
      conditions: { all: [tagCondition] },
      actions: [
        { type: 'add_tag', params: { tagName: '新好友' } },
        { type: 'issue_coupon', params: { couponId: 'k-new', failureText: '舊文字' } },
      ],
    }),
  ];
  render(<FollowGiftPage />);
  const select = await couponSelect();
  await waitFor(() => assert.equal(select.value, 'k-new'));
  fireEvent.change(select, { target: { value: 'k-other' } });
  fireEvent.change(screen.getByLabelText('發不出時回覆顧客'), { target: { value: '這張券已經發完了' } });
  await save();

  await waitFor(() => assert.equal(api.patch.mock.calls.length, 1));
  assert.equal(api.post.mock.calls.length, 0);
  const [url, body] = api.patch.mock.calls[0]!;
  assert.equal(url, '/automation/rules/r-gift');
  assert.deepEqual(body.conditions, { all: [tagCondition, FIRST_FOLLOW, LINE_ONLY] });
  assert.deepEqual(body.actions, [
    { type: 'add_tag', params: { tagName: '新好友' } },
    { type: 'issue_coupon', params: { couponId: 'k-other', failureText: '這張券已經發完了' } },
  ]);
});

test('停用加好友禮：關閉啟用開關並儲存，規則停用', async () => {
  rules = [existingRule()];
  render(<FollowGiftPage />);
  const select = await couponSelect();
  await waitFor(() => assert.equal(select.value, 'k-new'));
  const toggle = screen.getByRole('switch', { name: '啟用加好友禮' });
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  fireEvent.click(toggle);
  await save();

  await waitFor(() => assert.equal(api.patch.mock.calls.length, 1));
  assert.equal(api.patch.mock.calls[0]![1].isActive, false);
});

test('啟用但沒有選券：提示要選券，不送出', async () => {
  render(<FollowGiftPage />);
  await couponSelect();
  fireEvent.click(screen.getByRole('switch', { name: '啟用加好友禮' }));
  await save();
  assert.ok(await screen.findByText('啟用加好友禮要選一張優惠券'));
  assert.equal(api.post.mock.calls.length, 0);
  assert.equal(api.patch.mock.calls.length, 0);
});
