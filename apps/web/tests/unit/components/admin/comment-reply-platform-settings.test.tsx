// @vitest-environment jsdom
/**
 * 平台後台 /admin/comment-reply（change add-comment-keyword-private-reply tasks 9.8；
 * spec comment-reply-platform-controls「平台留言自動私訊頁」「平台設定鍵有型別檢查」；design D21）。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { platformApi, settings } = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  platformApi: { get: vi.fn(), put: vi.fn() },
}));
vi.mock('#src/app/admin/lib/platform-api.js', () => ({ platformApi }));

import CommentReplyPlatformPage from '#src/app/admin/comment-reply/page.js';

function absent(el: Element | null, message = '元素不應存在') {
  assert.ok(el === null, `${message}：${el?.outerHTML.slice(0, 200)}`);
}

const health = {
  summary: { matched24h: 120, sent24h: 100, failureRate24h: 0.05, queue: { waiting: 2, active: 1, delayed: 0, failed: 0 }, oldestPendingAt: null },
  channels: [
    {
      tenantId: 't1', tenantName: '手搖飲品牌', channelId: 'ch1', channelType: 'FB', displayName: '品牌粉專', appMode: 'platform',
      subscription: { status: 'ok', checkedAt: '2026-11-13T05:00:00.000Z' }, tokenStatus: 'valid', lastCommentEventAt: '2026-11-13T05:55:00.000Z',
      activeRules: 3, sent24h: 95, failed24h: 5, pending24h: 1, topFailureReason: 'USER_UNAVAILABLE',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(settings)) delete settings[k];
  platformApi.get.mockImplementation(async (url: string) => {
    if (url === '/comment-reply/health') return { data: { data: health } };
    const m = url.match(/^\/settings\/(.+)$/);
    if (m) return { data: { data: settings[m[1]] ?? null } };
    throw new Error(`unexpected GET ${url}`);
  });
  platformApi.put.mockImplementation(async (url: string, body: { value: unknown }) => {
    settings[url.replace('/settings/', '')] = body.value;
    return { data: { data: { key: url, value: body.value } } };
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

async function renderPage() {
  await act(async () => {
    render(<CommentReplyPlatformPage />);
  });
}

describe('設定區', () => {
  test('沒有設定時顯示預設值：能力全關、測試階段開、限速 700／700／300、保存 180 天', async () => {
    await renderPage();
    for (const name of ['Facebook 留言私訊', 'Facebook 貼文挑選', 'Facebook 公開回覆', 'Instagram 留言私訊', 'Instagram 貼文挑選', 'Instagram 公開回覆']) {
      assert.equal((screen.getByRole('checkbox', { name }) as HTMLInputElement).checked, false, name);
    }
    assert.ok((screen.getByRole('checkbox', { name: 'Facebook 測試階段' }) as HTMLInputElement).checked);
    assert.ok((screen.getByRole('checkbox', { name: 'Instagram 測試階段' }) as HTMLInputElement).checked);
    assert.equal((screen.getByLabelText('Facebook 每小時私訊上限') as HTMLInputElement).value, '700');
    assert.equal((screen.getByLabelText('Instagram 每小時私訊上限') as HTMLInputElement).value, '700');
    assert.equal((screen.getByLabelText('公開回覆每小時上限') as HTMLInputElement).value, '300');
    assert.equal((screen.getByLabelText('觸發紀錄保存天數') as HTMLInputElement).value, '180');
  });

  test('從頁面存設定：打開 fbPrivateReply 後送出六個布林值，重新載入後維持開啟', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Facebook 留言私訊' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存能力開關' }));
    });
    assert.equal(platformApi.put.mock.calls[0][0], '/settings/commentReply.capabilities');
    assert.deepEqual(platformApi.put.mock.calls[0][1], {
      value: { fbPrivateReply: true, fbPostPicker: false, fbPublicReply: false, igPrivateReply: false, igPostPicker: false, igPublicReply: false },
    });
    await screen.findByText('已儲存能力開關');
    assert.ok(!/[✓✔✅]/.test(document.body.textContent ?? ''));

    // 重新載入頁面
    document.body.innerHTML = '';
    await renderPage();
    await waitFor(() => assert.ok((screen.getByRole('checkbox', { name: 'Facebook 留言私訊' }) as HTMLInputElement).checked));
  });

  test('緊急停止：開啟前確認，送出 stopped 與原因', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: '緊急停止所有租戶的留言自動私訊' }));
    fireEvent.change(screen.getByLabelText('暫停原因（選填）'), { target: { value: 'Meta 限制中' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存緊急停止' }));
    });
    assert.ok(vi.mocked(window.confirm).mock.calls.length === 1);
    assert.deepEqual(platformApi.put.mock.calls[0], ['/settings/commentReply.emergencyStop', { value: { stopped: true, reason: 'Meta 限制中' } }]);
  });

  test('限速超出範圍時顯示錯誤、不送出', async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText('Facebook 每小時私訊上限'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('公開回覆每小時上限'), { target: { value: '30001' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存限速' }));
    });
    assert.equal(screen.getAllByText('請輸入 1～30000 的整數').length, 2);
    assert.equal(platformApi.put.mock.calls.length, 0);
  });

  test('限速合法時送出三個整數', async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText('Instagram 每小時私訊上限'), { target: { value: '500' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存限速' }));
    });
    assert.deepEqual(platformApi.put.mock.calls[0], ['/settings/commentReply.rateLimits', { value: { fbPerHour: 700, igPerHour: 500, publicReplyPerHour: 300 } }]);
  });

  test('保存天數超出範圍時顯示錯誤、不送出', async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText('觸發紀錄保存天數'), { target: { value: '5' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存保存天數' }));
    });
    screen.getByText('請輸入 30～730 的整數');
    assert.equal(platformApi.put.mock.calls.length, 0);
  });

  test('後端拒絕時顯示錯誤', async () => {
    platformApi.put.mockRejectedValueOnce(Object.assign(new Error('bad'), { response: { status: 400, data: { error: { code: 'VALIDATION_ERROR', message: '設定值不合法' } } } }));
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存測試階段' }));
    });
    await screen.findByText('儲存失敗：設定值不合法');
  });
});

describe('健康區', () => {
  test('列出開啟接收的渠道與全平台 24 小時統計', async () => {
    await renderPage();
    const table = await screen.findByRole('table', { name: '開啟留言接收的渠道' });
    const row = within(table).getByText('品牌粉專').closest('tr') as HTMLElement;
    within(row).getByText('手搖飲品牌');
    within(row).getByText('95');
    within(row).getByText('顧客無法接收訊息（可能已封鎖粉專或關閉訊息功能）');
    screen.getByText('命中 120');
    screen.getByText('失敗率 5.0%');
  });

  test('沒有開啟接收的渠道時顯示空狀態', async () => {
    platformApi.get.mockImplementation(async (url: string) => {
      if (url === '/comment-reply/health') return { data: { data: { ...health, channels: [] } } };
      return { data: { data: null } };
    });
    await renderPage();
    await screen.findByText('目前沒有開啟留言接收的渠道');
    absent(screen.queryByRole('table', { name: '開啟留言接收的渠道' }));
  });
});
