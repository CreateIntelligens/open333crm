// @vitest-environment jsdom
/**
 * CLI 連線頁（G14）：
 * - 選「永不過期」時前端不送 expiresInDays，後端套用預設 30 天，畫面卻寫永不過期。
 * - 「使用方式」叫人執行 open333 login 再貼上 token，但 CLI 的 login 是以 Email/密碼登入、自行產生另一個 token。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { CliSessionManagement } from '#src/components/settings/CliSessionManagement.js';

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockResolvedValue({ data: { data: [] } });
});
afterEach(cleanup);

async function openCreateDialog() {
  render(<CliSessionManagement />);
  await screen.findByText('尚未產生任何 CLI Token');
  fireEvent.click(screen.getAllByRole('button', { name: /產生 Token/ })[0]);
  return screen.getByRole('dialog');
}

test('過期時間沒有「永不過期」', async () => {
  const dialog = await openCreateDialog();
  assert.equal(within(dialog).queryAllByRole('option', { name: '永不過期' }).length, 0);
});

test('使用方式不叫人把 token 貼給 open333 login', async () => {
  const dialog = await openCreateDialog();
  fireEvent.change(within(dialog).getByPlaceholderText(/Claude Code/), { target: { value: 'LLM' } });
  api.post.mockResolvedValueOnce({
    data: {
      data: {
        token: 'tok_abc',
        session: { id: 's1', name: 'LLM', tokenPrefix: 'tok', tokenSuffix: 'abc', scopes: [], expiresAt: '2026-11-14T00:00:00Z', createdAt: '2026-10-15T00:00:00Z' },
      },
    },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '產生 Token' }));
  await screen.findByText('Token 已產生');
  assert.equal(screen.queryAllByText(/然後貼上 token/).length, 0);
  assert.ok(screen.queryAllByText(/以 Email 與密碼登入/).length > 0);
});
