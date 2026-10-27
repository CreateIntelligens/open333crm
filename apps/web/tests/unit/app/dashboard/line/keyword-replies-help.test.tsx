// @vitest-environment jsdom
/**
 * 關鍵字回覆頁的說明要與實際行為一致（M11，2026-10-15 手冊盤點發現）。
 *
 * 修正前說明寫「只在 bot 模式（BOT_HANDLED）觸發、客服接管後不回、每人每小時最多 3 次」，
 * 但 automation.worker.ts 的 checkKeywordTriggers() 不看對話狀態，也沒有任何次數限制。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: () => null }));
vi.mock('#src/hooks/useMaterials.js', () => ({ useMaterials: () => ({ materials: [] }) }));
vi.mock('#src/components/coupons/CouponSelectField.js', () => ({
  UNAVAILABLE_COUPON_LABEL: '',
  couponOptionLabel: () => '',
  useCouponOptions: () => ({ coupons: [] }),
}));
vi.mock('#src/hooks/useKeywordReplies.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useKeywordReplies: () => ({ replies: [], isLoading: false, mutate: vi.fn() }),
  createKeywordReply: vi.fn(),
  updateKeywordReply: vi.fn(),
  deleteKeywordReply: vi.fn(),
  toggleKeywordReply: vi.fn(),
}));
vi.mock('#src/components/line/keyword-reply/KeywordReplyEditDialog.js', () => ({ KeywordReplyEditDialog: () => null }));

import KeywordRepliesPage from '#src/app/dashboard/line/keyword-replies/page.js';

afterEach(cleanup);

test('說明不再宣稱只在 Bot 處理中觸發或有每小時次數上限', () => {
  render(<KeywordRepliesPage />);
  const help = screen.getByText(/怎麼用/).closest('section')!.textContent ?? '';
  assert.doesNotMatch(help, /BOT_HANDLED|1 小時最多觸發 3 次|已被客服接管的對話不會自動回/);
  assert.match(help, /客服接手的對話也會/);
  assert.match(help, /沒有次數上限/);
});
