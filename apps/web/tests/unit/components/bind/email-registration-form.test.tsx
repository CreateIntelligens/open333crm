// @vitest-environment jsdom
/**
 * 顧客的 email 登記頁（change add-email-identity-merge，spec email-identity-merge）。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
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

test('兩邊的手機不同：顯示需要客服確認', async () => {
  open();
  api.post.mockResolvedValue({ data: { data: { status: 'identity_conflict' } } });
  await submit('amy@example.com');
  await screen.findByText(/需要客服確認/);
});

describe('驗證碼（design D15）', () => {
  async function toCodeStep(email = 'amy@example.com') {
    open();
    api.post.mockResolvedValueOnce({ data: { data: { status: 'code_sent' } } });
    await submit(email);
    return screen.findByLabelText('驗證碼');
  }

  test('送出 email 後要求輸入驗證碼，並說明寄到哪個信箱', async () => {
    await toCodeStep();
    assert.ok(screen.getByText(/已寄出驗證碼到 amy@example.com/));
    assert.ok(screen.getByRole('button', { name: '重新寄送' }));
  });

  test('驗證碼正確：顯示登記完成', async () => {
    const input = await toCodeStep();
    api.post.mockResolvedValueOnce({ data: { data: { status: 'registered' } } });
    fireEvent.change(input, { target: { value: ' 123456 ' } });
    fireEvent.click(screen.getByRole('button', { name: '驗證' }));
    await screen.findByText(/已登記您的 email/);
    assert.deepEqual(api.post.mock.calls[1], [`/public/email-registration/${TOKEN}/verify`, { code: '123456' }]);
  });

  test('驗證碼錯誤：顯示剩餘次數，可再輸入', async () => {
    const input = await toCodeStep();
    api.post.mockRejectedValueOnce(httpError(400, 'INVALID_VERIFICATION_CODE', '驗證碼不正確，還可以再試 4 次'));
    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: '驗證' }));
    await screen.findByText('驗證碼不正確，還可以再試 4 次');
    assert.ok(screen.getByLabelText('驗證碼'));
  });

  test('驗證碼過期或錯太多次：回到填 email，並說明原因', async () => {
    const input = await toCodeStep();
    api.post.mockRejectedValueOnce(httpError(429, 'VERIFICATION_CODE_LOCKED', '驗證碼錯誤次數過多，請重新送出 email 取得新的驗證碼'));
    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: '驗證' }));
    await screen.findByText('驗證碼錯誤次數過多，請重新送出 email 取得新的驗證碼');
    assert.equal((screen.getByLabelText('Email') as HTMLInputElement).value, 'amy@example.com');
  });

  test('重新寄送：再送出同一個 email', async () => {
    await toCodeStep();
    api.post.mockResolvedValueOnce({ data: { data: { status: 'code_sent' } } });
    fireEvent.click(screen.getByRole('button', { name: '重新寄送' }));
    await screen.findByText('已重新寄出驗證碼');
    assert.deepEqual(api.post.mock.calls[1], [`/public/email-registration/${TOKEN}`, { email: 'amy@example.com' }]);
  });

  test('寄信失敗：留在填 email，顯示原因', async () => {
    open();
    api.post.mockRejectedValueOnce(httpError(502, 'VERIFICATION_EMAIL_FAILED', '驗證信寄送失敗，請確認 email 是否正確後再試一次'));
    await submit('amy@example.com');
    await screen.findByText('驗證信寄送失敗，請確認 email 是否正確後再試一次');
    assert.ok(screen.queryByLabelText('驗證碼') === null);
  });
});

test('從票券頁登記的 email 已屬於其他帳號：請顧客在對話中完成整合', async () => {
  open();
  api.post.mockResolvedValue({ data: { data: { status: 'merge_requires_chat' } } });
  await submit('amy@example.com');
  await screen.findByText('需要在對話中完成整合');
  assert.ok(screen.getByText(/請回到對話依說明操作/));
});
