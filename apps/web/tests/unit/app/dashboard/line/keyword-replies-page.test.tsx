// @vitest-environment jsdom
/**
 * 關鍵字回覆列表的渠道欄、渠道篩選與啟用開關（change add-fb-ig-keyword-coupon；spec coupon-management
 * 「關鍵字回覆列表標示渠道」「關鍵字回覆列表在切換或存檔後立即更新」）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { KeywordReply } from '#src/hooks/useKeywordReplies.js';

const state = vi.hoisted(() => ({ replies: [] as KeywordReply[] }));
const toggleKeywordReply = vi.hoisted(() => vi.fn());

vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: () => null }));
vi.mock('#src/hooks/useMaterials.js', () => ({ useMaterials: () => ({ materials: [] }) }));
vi.mock('#src/components/coupons/CouponSelectField.js', () => ({
  UNAVAILABLE_COUPON_LABEL: '已暫停、已結束或找不到的券',
  couponOptionLabel: (c: { name: string }) => c.name,
  useCouponOptions: () => ({ coupons: [] }),
}));
vi.mock('#src/components/line/keyword-reply/KeywordReplyEditDialog.js', () => ({ KeywordReplyEditDialog: () => null }));
vi.mock('#src/hooks/useKeywordReplies.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#src/hooks/useKeywordReplies.js')>();
  const ReactLib = await import('react');
  return {
    ...actual,
    // 與真的 hook 相同：mutate 重新載入後才顯示新資料
    useKeywordReplies: () => {
      const [replies, setReplies] = ReactLib.useState(state.replies);
      const mutate = ReactLib.useCallback(async () => setReplies([...state.replies]), []);
      return { replies, isLoading: false, mutate };
    },
    createKeywordReply: vi.fn(),
    updateKeywordReply: vi.fn(),
    deleteKeywordReply: vi.fn(),
    toggleKeywordReply,
  };
});

import KeywordRepliesPage from '#src/app/dashboard/line/keyword-replies/page.js';

function reply(overrides: Partial<KeywordReply>): KeywordReply {
  return {
    id: 'r', name: '規則', keywords: ['領券'], matchMode: 'any', materialId: null, couponId: 'k-1', failureText: '',
    isActive: true, createdAt: '2026-10-01T00:00:00.000Z', actions: [], conditions: null,
    channel: 'LINE', defaultChannel: 'LINE',
    ...overrides,
  };
}

beforeEach(() => {
  state.replies = [
    reply({ id: 'r-line', name: 'LINE 領券', channel: 'LINE', defaultChannel: 'LINE' }),
    reply({ id: 'r-fb', name: '粉專領券', channel: 'FB', defaultChannel: 'FB' }),
    reply({ id: 'r-ig', name: 'IG 領券', channel: 'THREADS', defaultChannel: 'THREADS' }),
    reply({ id: 'r-none', name: '舊規則', channel: null, defaultChannel: 'LINE' }),
    reply({ id: 'r-web', name: '網站規則', channel: null, channelIssue: true, defaultChannel: 'LINE' }),
  ];
  toggleKeywordReply.mockReset().mockImplementation(async (id: string, isActive: boolean) => {
    state.replies = state.replies.map((r) => (r.id === id ? { ...r, isActive } : r));
  });
});
afterEach(cleanup);

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

test('列表顯示每條規則的渠道：LINE、Facebook、Instagram、未限定渠道，頁面沒有 THREADS', () => {
  render(<KeywordRepliesPage />);
  assert.ok(within(rowOf('LINE 領券')).getByText('LINE'));
  assert.ok(within(rowOf('粉專領券')).getByText('Facebook'));
  assert.ok(within(rowOf('IG 領券')).getByText('Instagram'));
  assert.ok(within(rowOf('舊規則')).getByText('未限定渠道'));
  assert.ok(within(rowOf('網站規則')).getByText('渠道條件請到自動化規則編輯'));
  assert.doesNotMatch(document.body.textContent ?? '', /THREADS/);
  screen.getByRole('heading', { name: '關鍵字回覆' });
});

test('依渠道篩選：點選 Facebook 只剩 Facebook 的規則', () => {
  render(<KeywordRepliesPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Facebook' }));
  assert.ok(screen.getByText('粉專領券'));
  for (const name of ['LINE 領券', 'IG 領券', '舊規則', '網站規則']) {
    assert.ok(screen.queryByText(name) === null, name);
  }
  fireEvent.click(screen.getByRole('button', { name: '全部' }));
  assert.ok(screen.getByText('舊規則'));
});

test('停用後列表顯示停用：按下開關後重新載入，顯示後端的新狀態', async () => {
  render(<KeywordRepliesPage />);
  const toggle = within(rowOf('LINE 領券')).getByRole('button', { name: /啟用/ });
  await act(async () => {
    fireEvent.click(toggle);
  });
  assert.deepEqual(toggleKeywordReply.mock.calls[0], ['r-line', false]);
  assert.ok(within(rowOf('LINE 領券')).getByRole('button', { name: /停用/ }));
});
