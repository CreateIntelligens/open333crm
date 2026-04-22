'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  AlertTriangle,
  MessageSquare,
  UserCheck,
  Clock,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Topbar } from '@/components/layout/Topbar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNotifications, useUnreadCount, useNotificationActions } from '@/hooks/useNotifications';

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  case_assigned: { icon: UserCheck, color: 'bg-blue-100 text-blue-700', label: '工單指派' },
  case_escalated: { icon: AlertTriangle, color: 'bg-orange-100 text-orange-700', label: '工單升級' },
  sla_warning: { icon: Clock, color: 'bg-yellow-100 text-yellow-700', label: 'SLA 警告' },
  sla_breached: { icon: AlertTriangle, color: 'bg-red-100 text-red-700', label: 'SLA 逾期' },
  new_message: { icon: MessageSquare, color: 'bg-green-100 text-green-700', label: '新訊息' },
};

type TabFilter = 'all' | 'unread' | 'read';

export default function NotificationsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabFilter>('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  const isReadFilter = tab === 'unread' ? false : tab === 'read' ? true : undefined;

  const { notifications, meta, isLoading, mutate: mutateList } = useNotifications({
    isRead: isReadFilter,
    page,
    limit,
  });
  const { mutate: mutateCount } = useUnreadCount();
  const { markAsRead, markAllAsRead } = useNotificationActions();

  const handleTabChange = (value: string) => {
    setTab(value as TabFilter);
    setPage(1);
  };

  const handleMarkAllAsRead = async () => {
    await markAllAsRead();
    mutateList();
    mutateCount();
  };

  const handleNotificationClick = async (notification: {
    id: string;
    isRead: boolean;
    clickUrl?: string | null;
  }) => {
    if (!notification.isRead) {
      await markAsRead(notification.id);
      mutateList();
      mutateCount();
    }
    if (notification.clickUrl) {
      router.push(notification.clickUrl);
    }
  };

  const handleMarkSingleRead = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await markAsRead(id);
    mutateList();
    mutateCount();
  };

  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="flex flex-col h-full">
      <Topbar title="通知">
        <button
          className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
          onClick={handleMarkAllAsRead}
        >
          <CheckCheck className="h-3.5 w-3.5" />
          全部已讀
        </button>
      </Topbar>

      <div className="flex-1 overflow-auto p-6">
        {/* Tabs */}
        <Tabs value={tab} onValueChange={handleTabChange} className="mb-4">
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="unread">未讀</TabsTrigger>
            <TabsTrigger value="read">已讀</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Notification List */}
        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">載入中...</div>
        ) : notifications.length === 0 ? (
          <div className="py-12 text-center">
            <Bell className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <p className="mt-4 text-sm text-muted-foreground">
              {tab === 'unread' ? '沒有未讀通知' : tab === 'read' ? '沒有已讀通知' : '目前沒有通知'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {notifications.map(
              (n: {
                id: string;
                type: string;
                title: string;
                body: string;
                isRead: boolean;
                clickUrl?: string | null;
                createdAt: string;
              }) => {
                const config = TYPE_CONFIG[n.type] || {
                  icon: Bell,
                  color: 'bg-gray-100 text-gray-700',
                  label: '通知',
                };
                const Icon = config.icon;

                return (
                  <button
                    key={n.id}
                    className={`flex items-start gap-4 rounded-lg border p-4 cursor-pointer hover:bg-accent/50 transition-colors text-left w-full ${
                      !n.isRead ? 'bg-accent/20 border-accent' : ''
                    }`}
                    onClick={() => handleNotificationClick(n)}
                  >
                    <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full ${config.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${config.color}`}>
                          {config.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(n.createdAt), {
                            addSuffix: true,
                            locale: zhTW,
                          })}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium">{n.title}</p>
                      <p className="text-sm text-muted-foreground">{n.body}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!n.isRead && (
                        <>
                          <span className="h-2 w-2 rounded-full bg-blue-500" />
                          <button
                            className="rounded-md p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={(e) => handleMarkSingleRead(e, n.id)}
                            title="標記已讀"
                          >
                            <CheckCheck className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </button>
                );
              },
            )}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-4">
            <button
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              上一頁
            </button>
            <span className="text-sm text-muted-foreground">
              第 {page} / {totalPages} 頁
            </span>
            <button
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一頁
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
