// @vitest-environment jsdom
/**
 * 滿意度問卷送出失敗時客服看得到（issue #416，change fix-csat-line-flex-416）：
 * 收件匣的問卷卡片顯示「沒有送出」與原因。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('#src/lib/api.js', () => ({ default: { post: vi.fn() } }));

const { CsatMessage } = await import('#src/components/inbox/CsatMessage.js');

afterEach(cleanup);

test('問卷送出失敗時客服看得到：卡片顯示沒有送出與原因', () => {
  render(<CsatMessage readonly caseId="case-1" deliveryError="找不到這位聯絡人在此渠道的帳號，問卷沒有送到客人" />);

  const alert = screen.getByRole('alert');
  assert.match(alert.textContent ?? '', /這份問卷沒有送出，客人並未收到/);
  assert.match(alert.textContent ?? '', /找不到這位聯絡人/);
});

test('問卷送出成功：卡片沒有失敗提示', () => {
  render(<CsatMessage readonly caseId="case-1" />);

  assert.ok(screen.queryByRole('alert') === null);
});
