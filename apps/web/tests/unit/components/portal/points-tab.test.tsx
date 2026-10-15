// @vitest-environment jsdom
/**
 * 積分管理搜尋與手動調整（M08，2026-10-15 手冊盤點發現）。
 *
 * 修正前：搜尋只取第一筆（limit=1），同名或部分相符時直接選到別人，接著「手動調整」
 * 就加扣到錯的客戶；搜尋與調整失敗只寫 console，畫面沒有任何訊息。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/hooks/usePortal.js', () => ({
  usePoints: () => ({ transactions: [], mutate: vi.fn() }),
  usePointBalance: () => ({ balance: 10, mutate: vi.fn() }),
}));

import { PointsTab } from '#src/components/portal/PointsTab.js';

const TWO = [
  { id: 'c-1', displayName: '王小明', phone: '0911000111', email: null },
  { id: 'c-2', displayName: '王小明', phone: '0922000222', email: 'ming2@example.com' },
];

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});
afterEach(cleanup);

function search(term: string) {
  fireEvent.change(screen.getByPlaceholderText('搜尋聯絡人（名稱、電話、Email）'), { target: { value: term } });
  fireEvent.keyDown(screen.getByPlaceholderText('搜尋聯絡人（名稱、電話、Email）'), { key: 'Enter' });
}

test('多筆符合時列出候選人讓使用者挑，不自動選第一筆', async () => {
  api.get.mockResolvedValue({ data: { data: TWO } });
  render(<PointsTab />);
  search('王小明');
  await screen.findByText(/0922000222/);
  assert.ok(!String(api.get.mock.calls[0][0]).includes('limit=1&') && !String(api.get.mock.calls[0][0]).endsWith('limit=1'), '不可只取 1 筆');
  assert.ok(screen.queryByRole('button', { name: '手動調整' }) === null, '還沒挑人前不能調整');

  fireEvent.click(screen.getByRole('button', { name: /0922000222/ }));
  fireEvent.click(await screen.findByRole('button', { name: '手動調整' }));
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
  api.post.mockResolvedValue({ data: { data: {} } });
  fireEvent.click(screen.getByRole('button', { name: '確認調整' }));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.equal(api.post.mock.calls[0][1].contactId, 'c-2');
});

test('搜尋不到時顯示訊息', async () => {
  api.get.mockResolvedValue({ data: { data: [] } });
  render(<PointsTab />);
  search('不存在');
  await screen.findByText(/找不到符合的聯絡人/);
});

test('搜尋失敗時顯示後端訊息', async () => {
  api.get.mockRejectedValue({ response: { data: { error: { message: '沒有檢視聯絡人的權限' } } } });
  render(<PointsTab />);
  search('王');
  await screen.findByText(/沒有檢視聯絡人的權限/);
});

test('調整失敗時在對話框顯示後端訊息', async () => {
  api.get.mockResolvedValue({ data: { data: [TWO[0]] } });
  api.post.mockRejectedValue({ response: { data: { error: { message: '調整金額超出範圍' } } } });
  render(<PointsTab />);
  search('0911000111');
  fireEvent.click(await screen.findByRole('button', { name: '手動調整' }));
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: '確認調整' }));
  await screen.findByText(/調整金額超出範圍/);
});
