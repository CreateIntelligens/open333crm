// @vitest-environment jsdom
/**
 * 活動表單的「每次提交積分」不送出負數（主規格 portal-activity「活動設定在入口驗證，不合法的舊值採用安全的預設值」）。
 *
 * 修正前：`<input min={0}>` 擋不住手動輸入，parseInt 照樣送出 -5，
 * 後端改為驗證之後，使用者要到存檔時才看到 400。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { post: vi.fn(), patch: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { ActivityFormDialog } from '#src/components/portal/ActivityFormDialog.js';

beforeEach(() => {
  api.post.mockReset().mockResolvedValue({ data: { data: {} } });
});
afterEach(cleanup);

test('每次提交積分輸入負數時，送出 0', async () => {
  render(<ActivityFormDialog open onClose={() => {}} onSaved={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('活動標題'), { target: { value: '投票' } });
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-5' } });
  fireEvent.click(screen.getByRole('button', { name: '建立' }));

  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.deepEqual(api.post.mock.calls[0][1].settings, { pointsPerSubmit: 0 });
});
