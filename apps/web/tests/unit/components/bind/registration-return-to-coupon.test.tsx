// @vitest-environment jsdom
/**
 * 登記頁送出後回到優惠券（design D12：票券連結要求驗證時，登記頁網址帶 next=/coupon/open/{token}）。
 * next 只接受票券入口的相對路徑，避免成為開放式轉址。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { PhoneRegistrationForm } from '#src/components/bind/PhoneRegistrationForm.js';
import { EmailRegistrationForm } from '#src/components/bind/EmailRegistrationForm.js';
import { safeCouponReturnPath } from '#src/lib/safe-return-path.js';

const TOKEN = 'A'.repeat(43);

function visit(next: string | null) {
  const query = next === null ? '' : `?next=${encodeURIComponent(next)}`;
  window.history.replaceState({}, '', `/bind/phone/${TOKEN}${query}`);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockResolvedValue({ data: { data: { channelType: 'LINE', channelLabel: 'LINE（@shop）', profileName: '小明' } } });
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

async function registerPhone(status: string) {
  api.post.mockResolvedValue({ data: { data: { status } } });
  render(<PhoneRegistrationForm token={TOKEN} />);
  fireEvent.change(await screen.findByLabelText('手機號碼'), { target: { value: '0912345678' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
}

test('登記完成且帶合法 next：出現回到優惠券', async () => {
  visit('/coupon/open/tok_abc');
  await registerPhone('registered');
  await screen.findByText(/已登記您的手機號碼/);
  const link = screen.getByRole('link', { name: '回到優惠券' });
  assert.equal(link.getAttribute('href'), '/coupon/open/tok_abc');
});

test('帳號整合完成也可回到優惠券', async () => {
  visit('/coupon/open/tok_abc');
  await registerPhone('merged');
  await screen.findByText(/已完成帳號整合/);
  assert.ok(screen.getByRole('link', { name: '回到優惠券' }));
});

test('email 登記完成也可回到優惠券', async () => {
  visit('/coupon/open/tok_abc');
  api.post.mockResolvedValue({ data: { data: { status: 'registered' } } });
  render(<EmailRegistrationForm token={TOKEN} />);
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@b.co' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText(/已登記您的/);
  assert.ok(screen.getByRole('link', { name: '回到優惠券' }));
});

test('衝突結果不導回優惠券', async () => {
  visit('/coupon/open/tok_abc');
  await registerPhone('identity_conflict');
  await screen.findByText(/需要客服確認/);
  assert.ok(screen.queryByRole('link', { name: '回到優惠券' }) === null);
});

for (const bad of ['https://evil.com', '//evil.com', '/admin', '/coupon/open//evil.com', '/coupon/open/x:y']) {
  test(`不接受 next=${bad}`, async () => {
    visit(bad);
    await registerPhone('registered');
    await screen.findByText(/已登記您的手機號碼/);
    assert.ok(screen.queryByRole('link', { name: '回到優惠券' }) === null);
  });
}

test('沒有 next：維持原本的完成畫面', async () => {
  visit(null);
  await registerPhone('registered');
  await screen.findByText(/已登記您的手機號碼/);
  assert.ok(screen.queryByRole('link', { name: '回到優惠券' }) === null);
});

test('safeCouponReturnPath 只接受票券入口的相對路徑', () => {
  assert.equal(safeCouponReturnPath('/coupon/open/abc_DEF-1'), '/coupon/open/abc_DEF-1');
  for (const bad of [null, '', 'https://evil.com', '//evil.com', '/admin', '/coupon/open/', '/coupon/open/a//b', 'javascript:alert(1)', '/coupon/open/a\\b', ' /coupon/open/a', '/coupon/open/a b']) {
    assert.equal(safeCouponReturnPath(bad), null, String(bad));
  }
});
