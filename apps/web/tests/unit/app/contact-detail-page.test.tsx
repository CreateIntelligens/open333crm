// @vitest-environment jsdom
/**
 * 聯絡人詳情頁右欄的「活動時間軸／對話紀錄」分頁（change add-email-identity-merge）。
 * 只測元件會漏掉分頁沒接上的問題：Tabs 只把選中的值傳給直接子元件。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
