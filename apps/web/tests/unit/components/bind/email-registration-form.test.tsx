// @vitest-environment jsdom
/**
 * 顧客的 email 登記頁（change add-email-identity-merge，spec email-identity-merge）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { EmailRegistrationForm } from '#src/components/bind/EmailRegistrationForm.js';

const httpError = (status: number, code: string, message: string) =>
  Object.assign(new Error(String(status)), { response: { status, data: { success: false, error: { code, message } } } });

const TOKEN = 'A'.repeat(43);

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

function open() {
  api.get.mockResolvedValue({ data: { data: { channelType: 'LINE', channelLabel: 'LINE（@shop）', profileName: '小明' } } });
  render(<EmailRegistrationForm token={TOKEN} />);
}

async function submit(email: string) {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
}

test('開啟登記頁', async () => {
  open();
  await screen.findByText('LINE（@shop）');
  assert.ok(screen.getByText('小明'));
  assert.equal(api.get.mock.calls[0][0], `/public/email-registration/${TOKEN}`);
});

test('連結過期', async () => {
  api.get.mockRejectedValue(httpError(410, 'EMAIL_REGISTRATION_EXPIRED', '連結已失效，請回到對話重新取得'));
  render(<EmailRegistrationForm token={TOKEN} />);
  await screen.findByText('連結已失效，請回到對話重新取得');
  assert.ok(screen.queryByLabelText('Email') === null);
});

test('沒有相同 email：顯示登記完成', async () => {
  open();
  api.post.mockResolvedValue({ data: { data: { status: 'registered' } } });
  await submit(' amy@example.com ');
  await screen.findByText(/已登記您的 email/);
  assert.deepEqual(api.post.mock.calls[0], [`/public/email-registration/${TOKEN}`, { email: 'amy@example.com' }]);
});

test('不同渠道的同一個人：顯示已整合', async () => {
  open();
  api.post.mockResolvedValue({ data: { data: { status: 'merged' } } });
  await submit('amy@example.com');
  await screen.findByText(/已完成帳號整合/);
});

test('同一個 LINE OA 的兩個帳號：顯示請聯繫客服', async () => {
  open();
  api.post.mockResolvedValue({ data: { data: { status: 'channel_conflict' } } });
  await submit('amy@example.com');
  await screen.findByText(/無法自動整合/);
});

test('格式錯誤：顯示原因，可以改正後再送', async () => {
  open();
  api.post.mockRejectedValueOnce(httpError(400, 'INVALID_EMAIL', 'email 格式不正確'));
  await submit('amy@');
  await screen.findByText('email 格式不正確');
  assert.ok(screen.getByRole('button', { name: '送出' }));
});

test('短時間大量送出：顯示稍後再試', async () => {
  open();
  api.post.mockRejectedValueOnce(httpError(429, 'RATE_LIMITED', '操作太頻繁，請稍候再試'));
  await submit('amy@example.com');
  await screen.findByText('操作太頻繁，請稍候再試');
});

test('格式不符的連結不送出任何請求', async () => {
  render(<EmailRegistrationForm token="..%2F..%2Fcontacts%2Fabc" />);
  await screen.findByText('連結無法使用，請回到對話重新取得');
  assert.equal(api.get.mock.calls.length, 0);
});
