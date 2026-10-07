// @vitest-environment jsdom
/**
 * 聯絡人詳情頁右欄的「活動時間軸／對話紀錄」分頁（change add-email-identity-merge）。
 * 只測元件會漏掉分頁沒接上的問題：Tabs 只把選中的值傳給直接子元件。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('next/navigation', () => ({ useParams: () => ({ contactId: 'c1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: () => true }));

import ContactDetailPage from '#src/app/dashboard/contacts/[contactId]/page.js';

test('切換到「對話紀錄」顯示跨渠道訊息', async () => {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/contacts/c1') return { data: { data: { id: 'c1', displayName: '王小美', channelIdentities: [], tags: [] } } };
    if (url === '/contacts/c1/timeline') return { data: { data: [] } };
    if (url.startsWith('/contacts/c1/messages')) {
      return {
        data: {
          data: {
            messages: [
              { id: 'm1', channelType: 'FB', channelName: '粉專', direction: 'INBOUND', senderType: 'CONTACT', contentType: 'text', content: { text: '冷氣漏水' }, createdAt: '2026-10-05T03:00:00.000Z' },
            ],
            hiddenConversationCount: 0,
            nextCursor: null,
          },
        },
      };
    }
    return { data: { data: [] } };
  });
  render(<ContactDetailPage />);
  fireEvent.click(await screen.findByRole('button', { name: '對話紀錄' }));
  await screen.findByText('冷氣漏水');
});

// ── 修改 email 與他人重複 → 合併 → 寫入 email（spec email-identity-merge「選擇合併」）──

const conflict = Object.assign(new Error('409'), {
  response: {
    status: 409,
    data: { success: false, error: { code: 'EMAIL_IN_USE', message: '此 email 已由其他聯絡人使用', details: { contactId: 'b', displayName: '王小美' } } },
  },
});
const side = (id: string, name: string) => ({
  id, displayName: name, channelIdentities: [], tags: [], attributes: [], conversationsCount: 0, casesCount: 0,
});

function mockContactApi() {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/contacts/c1') return { data: { data: { id: 'c1', displayName: '林大同', channelIdentities: [], tags: [] } } };
    if (url.startsWith('/contacts/merge-preview')) {
      return {
        data: {
          data: {
            primary: side('c1', '林大同'),
            secondary: side('b', '王小美'),
            diff: { newChannelIdentities: [], newTags: [], newAttributes: [], totalConversations: 0, totalCases: 0 },
          },
        },
      };
    }
    return { data: { data: [] } };
  });
}

async function mergeViaEmailConflict() {
  render(<ContactDetailPage />);
  fireEvent.click(await screen.findByRole('button', { name: '編輯 email' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'amy@demo.test' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  fireEvent.click(await screen.findByRole('button', { name: '與「王小美」合併' }));
  fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
  const next = await screen.findByRole('button', { name: '下一步' });
  await waitFor(() => assert.ok(!(next as HTMLButtonElement).disabled, '預覽載入後才能下一步'));
  fireEvent.click(next);
  fireEvent.click(await screen.findByRole('checkbox', { name: '我已確認並瞭解' }));
  fireEvent.click(screen.getByRole('button', { name: '確認合併' }));
}

beforeEach(() => {
  api.get.mockReset();
  api.patch.mockReset();
  api.post.mockReset();
});

test('選擇合併：合併後寫入 email，欄位回到一般顯示', async () => {
  mockContactApi();
  api.patch.mockRejectedValueOnce(conflict).mockResolvedValueOnce({ data: { data: {} } });
  api.post.mockResolvedValue({ data: { data: {} } });
  await mergeViaEmailConflict();
  await waitFor(() => assert.equal(api.patch.mock.calls.length, 2));
  assert.deepEqual(api.post.mock.calls[0], ['/contacts/merge', { primaryContactId: 'c1', secondaryContactId: 'b' }]);
  assert.deepEqual(api.patch.mock.calls[1], ['/contacts/c1', { email: 'amy@demo.test' }]);
  await waitFor(() => assert.ok(screen.queryByText(/已由聯絡人「王小美」使用/) === null, '衝突提示要消失'));
  assert.ok(screen.queryByRole('button', { name: '與「王小美」合併' }) === null);
});

test('合併後寫入 email 失敗時顯示原因', async () => {
  mockContactApi();
  api.patch.mockRejectedValueOnce(conflict).mockRejectedValueOnce(
    Object.assign(new Error('500'), { response: { status: 500, data: { success: false, error: { message: '系統錯誤' } } } }),
  );
  api.post.mockResolvedValue({ data: { data: {} } });
  await mergeViaEmailConflict();
  await screen.findByText('系統錯誤');
});
