// @vitest-environment jsdom
/**
 * 顧客的手機登記頁（change add-phone-identity-merge，spec phone-identity-merge「手機登記頁顯示登記的帳號」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { PhoneRegistrationForm } from '#src/components/bind/PhoneRegistrationForm.js';

const httpError = (status: number, code: string, message: string) =>
  Object.assign(new Error(String(status)), { response: { status, data: { success: false, error: { code, message } } } });

const TOKEN = 'A'.repeat(43);

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

function open() {
  api.get.mockResolvedValue({ data: { data: { channelType: 'LINE', channelLabel: 'LINE（@shop）', profileName: '小明' } } });
  render(<PhoneRegistrationForm token={TOKEN} />);
}

async function submit(phone: string) {
  fireEvent.change(await screen.findByLabelText('手機號碼'), { target: { value: phone } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
}

test('開啟登記頁', async () => {
  open();
  await screen.findByText('LINE（@shop）');
  assert.ok(screen.getByText('小明'));
  assert.equal(api.get.mock.calls[0][0], `/public/phone-registration/${TOKEN}`);
  const input = screen.getByLabelText('手機號碼') as HTMLInputElement;
  assert.equal(input.type, 'tel');
  assert.equal(input.value, '', '不預先填入聯絡人目前的電話');
});

test('沒有相同號碼：顯示登記完成', async () => {
  open();
  api.post.mockResolvedValue({ data: { data: { status: 'registered' } } });
  await submit(' 0912-345-678 ');
  await screen.findByText(/已登記您的手機號碼/);
  assert.deepEqual(api.post.mock.calls[0], [`/public/phone-registration/${TOKEN}`, { phone: '0912-345-678' }]);
});

test('相同號碼：顯示已整合', async () => {
  open();
  api.post.mockResolvedValue({ data: { data: { status: 'merged' } } });
  await submit('0912345678');
  await screen.findByText(/已完成帳號整合/);
  assert.ok(screen.getByText(/相同手機號碼/));
});

test('市話：顯示原因，可以改正後再送', async () => {
  open();
  api.post.mockRejectedValueOnce(httpError(400, 'INVALID_PHONE', '請輸入台灣手機號碼，例如 0912345678'));
  await submit('02-2345-6789');
  await screen.findByText('請輸入台灣手機號碼，例如 0912345678');
  assert.ok(screen.getByRole('button', { name: '送出' }));
});

test('連結過期', async () => {
  api.get.mockRejectedValue(httpError(410, 'PHONE_REGISTRATION_EXPIRED', '連結已失效，請回到對話重新取得'));
  render(<PhoneRegistrationForm token={TOKEN} />);
  await screen.findByText('連結已失效，請回到對話重新取得');
  assert.ok(screen.queryByLabelText('手機號碼') === null);
});

test('兩邊的 email 不同：顯示需要客服確認', async () => {
  open();
  api.post.mockResolvedValue({ data: { data: { status: 'identity_conflict' } } });
  await submit('0912345678');
  await screen.findByText(/需要客服確認/);
});
