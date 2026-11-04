// @vitest-environment jsdom
/**
 * 編輯草稿以完整活動帶入選項（#424，AUDIT PORTAL-03；change fix-portal-edit-keeps-content）。
 *
 * 修正前：對話框拿列表項（不含 options／fields）當編輯資料，選項欄只剩空白的「選項 1」，
 * 只改標題就儲存會送出 `options: []`，後端刪光選項與正確答案。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { ActivityFormDialog } from '#src/components/portal/ActivityFormDialog.js';

const ID = '11111111-1111-4111-8111-111111111111';
// 列表項：listActivities 不 include options／fields
const listItem = { id: ID, type: 'QUIZ', status: 'DRAFT', title: '下午茶競猜', settings: {}, _count: { submissions: 0 } };
const fullActivity = {
  ...listItem,
  options: [
    { id: 'o1', label: '紅茶', isCorrect: true, sortOrder: 0 },
    { id: 'o2', label: '綠茶', isCorrect: false, sortOrder: 1 },
  ],
  fields: [],
};

beforeEach(() => {
  api.get.mockReset();
  api.patch.mockReset().mockResolvedValue({ data: { data: {} } });
});
afterEach(cleanup);

test('編輯對話框帶出完整活動的選項', async () => {
  let resolveGet!: (v: unknown) => void;
  api.get.mockReturnValue(new Promise((r) => { resolveGet = r; }));

  render(<ActivityFormDialog open onClose={() => {}} onSaved={() => {}} editData={listItem} />);

  // 載入完成前不能儲存
  assert.ok((screen.getByRole('button', { name: '儲存' }) as HTMLButtonElement).disabled);
  assert.equal(api.get.mock.calls[0][0], `/portal/activities/${ID}`);

  resolveGet({ data: { success: true, data: fullActivity } });
  await waitFor(() => assert.ok(screen.queryByDisplayValue('紅茶') !== null));
  assert.ok(screen.queryByDisplayValue('綠茶') !== null);

  fireEvent.change(screen.getByPlaceholderText('活動標題'), { target: { value: '下午茶競猜（改）' } });
  const save = screen.getByRole('button', { name: '儲存' }) as HTMLButtonElement;
  await waitFor(() => assert.equal(save.disabled, false));
  fireEvent.click(save);

  await waitFor(() => assert.equal(api.patch.mock.calls.length, 1));
  const [url, payload] = api.patch.mock.calls[0];
  assert.equal(url, `/portal/activities/${ID}`);
  assert.equal(payload.title, '下午茶競猜（改）');
  assert.deepEqual(
    payload.options.map((o: { label: string; isCorrect?: boolean }) => [o.label, o.isCorrect]),
    [['紅茶', true], ['綠茶', false]],
  );
});

test('完整活動載入失敗時顯示錯誤且不能儲存', async () => {
  api.get.mockRejectedValue({ response: { status: 500, data: { error: { code: 'INTERNAL_ERROR', message: '伺服器暫時無法回應' } } } });

  render(<ActivityFormDialog open onClose={() => {}} onSaved={() => {}} editData={listItem} />);

  const alert = await screen.findByRole('alert');
  assert.ok(alert.textContent?.includes('伺服器暫時無法回應'));
  const save = screen.getByRole('button', { name: '儲存' }) as HTMLButtonElement;
  assert.ok(save.disabled);
  fireEvent.click(save);
  assert.equal(api.patch.mock.calls.length, 0);
});
