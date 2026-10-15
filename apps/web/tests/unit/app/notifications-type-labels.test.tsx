// @vitest-environment jsdom
/**
 * 通知列表的類型徽章（S02）：workers 發的 SLA 與自動化通知要有對應的中文類型，不是一律「通知」。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const list = [
  { id: 'n1', type: 'first_response_breached', title: '首次回應已逾期', body: 'b1', isRead: false, createdAt: new Date().toISOString() },
  { id: 'n2', type: 'first_response_warning', title: '首次回應即將逾期', body: 'b2', isRead: false, createdAt: new Date().toISOString() },
  { id: 'n3', type: 'customer_waiting_breached', title: '客戶等待過久', body: 'b3', isRead: false, createdAt: new Date().toISOString() },
  { id: 'n4', type: 'sla_rule', title: '自動化規則通知', body: 'b4', isRead: false, createdAt: new Date().toISOString() },
];
const noop = () => undefined;
const stable = { mutate: noop };
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: noop }) }));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('#src/hooks/useNotifications.js', () => ({
  useNotifications: () => ({ notifications: list, meta: { total: list.length }, isLoading: false, mutate: noop }),
  useUnreadCount: () => stable,
  useNotificationActions: () => ({ markAsRead: noop, markAllAsRead: noop }),
}));

import NotificationsPage from '#src/app/dashboard/notifications/page.js';

test('SLA 與自動化通知顯示對應的類型徽章', () => {
  render(<NotificationsPage />);
  for (const label of ['首次回應逾期', '首次回應警告', '客戶等待逾時', '自動化通知']) {
    assert.ok(screen.queryByText(label) !== null, `應顯示類型「${label}」`);
  }
  assert.ok(screen.queryAllByText('通知').length === 0, '不應退回通用的「通知」徽章');
});
