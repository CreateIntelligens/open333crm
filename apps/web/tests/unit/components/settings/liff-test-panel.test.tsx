// @vitest-environment jsdom
/**
 * Bot 設定的 LIFF 測試區塊（change add-liff-config-test，spec channel-management「後台顯示 LIFF 測試狀態」）。
 * API 以替身取代，查詢結果的間隔縮短。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { LiffTestPanel } from '#src/components/settings/LiffTestPanel.js';

const LIFF_ID = '1660000000-abcdefgh';
const LOGIN_ID = '1660000001';
const TEST_ID = 'T'.repeat(43);
const saved = { liffId: LIFF_ID, loginChannelId: LOGIN_ID };

function renderPanel(props: Partial<Parameters<typeof LiffTestPanel>[0]> = {}) {
  return render(
    <LiffTestPanel channelId="ch-1" saved={saved} draft={saved} lastTest={null} pollMs={10} {...props} />,
  );
}

const testButton = () => screen.getByRole('button', { name: '測試 LIFF 設定' }) as HTMLButtonElement;

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({
    data: {
      data: {
        testId: TEST_ID,
        testUrl: `https://liff.line.me/${LIFF_ID}?lt=${TEST_ID}&lid=${LIFF_ID}`,
        qrCode: 'data:image/png;base64,QR',
        expiresAt: '2026-10-29T08:10:00.000Z',
      },
    },
  });
});

afterEach(() => {
  cleanup();
});

describe('LiffTestPanel', () => {
  test('設定改過但還沒存檔：按鈕停用並提示先儲存', () => {
    renderPanel({ draft: { liffId: '1660000000-zzzzzzzz', loginChannelId: LOGIN_ID } });
    assert.equal(testButton().disabled, true);
    assert.ok(screen.getByText(/請先儲存/));
  });

  test('沒填完整：按鈕停用', () => {
    renderPanel({ saved: { liffId: LIFF_ID, loginChannelId: '' }, draft: { liffId: LIFF_ID, loginChannelId: '' } });
    assert.equal(testButton().disabled, true);
  });

  test('收到結果：顯示 QR code 與連結，結果出來後顯示說明並停止查詢', async () => {
    api.get
      .mockResolvedValueOnce({ data: { data: { status: 'pending' } } })
      .mockResolvedValueOnce({ data: { data: { status: 'id_token_rejected', message: 'LINE 不接受這次登入的 ID token' } } });
    renderPanel();
    fireEvent.click(testButton());

    const qr = (await screen.findByAltText('LIFF 測試連結 QR code')) as HTMLImageElement;
    assert.equal(qr.getAttribute('src'), 'data:image/png;base64,QR');
    assert.ok(screen.getByRole('link', { name: /liff\.line\.me/ }));
    assert.deepEqual(api.post.mock.calls[0], ['/channels/ch-1/liff-test']);

    await screen.findByText('LINE 不接受這次登入的 ID token');
    const calls = api.get.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(api.get.mock.calls.length, calls, '收到結果後不再查詢');
    assert.deepEqual(api.get.mock.calls[0], [`/channels/ch-1/liff-test/${TEST_ID}`]);
  });

  test('過期仍未收到回報：說明沒收到結果，列出 LIFF App ID 與 Endpoint URL 兩個常見原因', async () => {
    api.get.mockResolvedValue({ data: { data: { status: 'expired' } } });
    renderPanel();
    fireEvent.click(testButton());
    const hint = await screen.findByText(/沒有收到手機的測試結果/);
    const text = hint.closest('[data-liff-test-result]')?.textContent ?? '';
    assert.match(text, /LIFF App ID/);
    assert.match(text, /Endpoint URL/);
  });

  test('產生測試連結失敗：顯示錯誤', async () => {
    api.post.mockRejectedValueOnce({ response: { data: { error: { message: '請先填好並儲存 LIFF App ID 與 LINE Login Channel ID，再測試' } } } });
    renderPanel();
    fireEvent.click(testButton());
    await screen.findByText('請先填好並儲存 LIFF App ID 與 LINE Login Channel ID，再測試');
  });

  test('上次測試成功的紀錄：設定值相同時顯示時間', () => {
    renderPanel({ lastTest: { verifiedAt: '2026-10-29T03:24:00.000Z', ...saved } });
    assert.ok(screen.getByText(/上次測試成功：2026-10-29 11:24/));
  });

  test('設定改過後不顯示舊紀錄', () => {
    renderPanel({ lastTest: { verifiedAt: '2026-10-29T03:24:00.000Z', liffId: LIFF_ID, loginChannelId: '1660000009' } });
    assert.ok(screen.queryByText(/上次測試成功/) === null);
  });
});

test('定時查詢在元件卸載後停止', async () => {
  api.get.mockResolvedValue({ data: { data: { status: 'pending' } } });
  const { unmount } = renderPanel();
  fireEvent.click(testButton());
  await waitFor(() => assert.ok(api.get.mock.calls.length > 0));
  unmount();
  const calls = api.get.mock.calls.length;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(api.get.mock.calls.length, calls);
});
