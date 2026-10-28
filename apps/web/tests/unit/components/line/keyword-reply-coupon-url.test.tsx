// @vitest-environment jsdom
/**
 * 關鍵字回覆選到含顧客專屬券連結的素材：提醒並擋下存檔（change improve-coupon-url-insert-ux，
 * spec automation-engine「傳送素材動作不可使用含顧客專屬券連結的素材」）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { KeywordReplyEditDialog } from '#src/components/line/keyword-reply/KeywordReplyEditDialog.js';

beforeEach(() => {
  api.get.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/marketing/materials')) {
      return {
        data: {
          data: [
            { id: 'm-url', name: '領券訊息', contentType: 'line_text', channelType: 'line', body: { text: '領券：{{coupon.url}}' } },
            { id: 'm-plain', name: '營業時間', contentType: 'line_text', channelType: 'line', body: { text: '10:00-20:00' } },
          ],
          meta: { totalPages: 1 },
        },
      };
    }
    if (url.startsWith('/coupons')) return { data: { success: true, data: [], meta: { total: 0, page: 1, limit: 100 } } };
    throw new Error(`unexpected ${url}`);
  });
});
afterEach(cleanup);

test('關鍵字回覆對話框提醒並擋下存檔', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <KeywordReplyEditDialog open reply={null} onClose={() => {}} onSave={onSave} />
    </SWRConfig>,
  );
  fireEvent.change(screen.getByPlaceholderText(/例：詢問營業時間/), { target: { value: '領券' } });
  fireEvent.change(screen.getByPlaceholderText(/輸入關鍵字後按 Enter/), { target: { value: '領券' } });
  fireEvent.click(screen.getByRole('button', { name: /加入/ }));
  await screen.findByRole('option', { name: /領券訊息/ });
  fireEvent.change(screen.getByLabelText('回覆素材'), { target: { value: 'm-url' } });

  const alert = screen.getAllByRole('alert').find((el) => /顧客專屬券連結/.test(el.textContent ?? ''));
  assert.ok(alert !== undefined, '應顯示含「顧客專屬券連結」的提醒');

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.equal(onSave.mock.calls.length, 0, '不送出請求');
  assert.ok(screen.getAllByText(/顧客專屬券連結/).length >= 2, '存檔時顯示同樣原因');

  // 改選沒有券連結的素材就能存
  fireEvent.change(screen.getByLabelText('回覆素材'), { target: { value: 'm-plain' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
  assert.equal(onSave.mock.calls.length, 1);
});
