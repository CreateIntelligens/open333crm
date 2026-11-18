// @vitest-environment jsdom
/**
 * 聯絡人詳情顯示渠道封鎖狀態（change fix-line-follow-unfollow-events，spec contact-management
 * 「聯絡人詳情顯示渠道封鎖狀態」）。從頁面渲染：API 回應到渠道身分清單之間的欄位對應也一起測。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('next/navigation', () => ({ useParams: () => ({ contactId: 'c1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: () => true }));

import ContactDetailPage from '#src/app/dashboard/contacts/[contactId]/page.js';

const identity = (id: string, channelName: string, blockedAt: string | null) => ({
  id,
  channelType: 'LINE',
  uid: `U-${id}`,
  profileName: `好友 ${id}`,
  blockedAt,
  channel: { id: `ch-${id}`, displayName: channelName, channelType: 'LINE' },
});

function mockContact(channelIdentities: unknown[]) {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/contacts/c1') return { data: { data: { id: 'c1', displayName: '王小美', channelIdentities, tags: [] } } };
    return { data: { data: [] } };
  });
}

/** 渠道身分清單中，渠道名稱所在的那一列 */
async function rowOf(channelName: string) {
  const name = await screen.findByText(channelName);
  const row = name.closest('[data-testid="channel-identity"]');
  assert.ok(row instanceof HTMLElement, `找得到「${channelName}」那一列`);
  return row;
}

beforeEach(() => {
  api.get.mockReset();
});

test('顧客封鎖了其中一個官方帳號：只有封鎖的那一列顯示「已封鎖官方帳號」', async () => {
  mockContact([identity('a', '總店 LINE', '2026-11-13T02:00:00.000Z'), identity('b', '分店 LINE', null)]);
  render(<ContactDetailPage />);

  assert.ok(within(await rowOf('總店 LINE')).queryByText('已封鎖官方帳號') !== null, '封鎖的渠道顯示');
  assert.ok(within(await rowOf('分店 LINE')).queryByText('已封鎖官方帳號') === null, '沒封鎖的渠道不顯示');
});

test('顧客重新加入好友後不再顯示', async () => {
  mockContact([identity('a', '總店 LINE', null)]);
  render(<ContactDetailPage />);

  await rowOf('總店 LINE');
  assert.ok(screen.queryByText('已封鎖官方帳號') === null);
});
