'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, AlertTriangle, MessageSquare, UserCheck, Clock, CheckCheck } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { useNotifications, useUnreadCount, useNotificationActions } from '@/hooks/useNotifications';

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  case_assigned: { icon: UserCheck, color: 'text-blue-500' },
  case_escalated: { icon: AlertTriangle, color: 'text-orange-500' },
  sla_warning: { icon: Clock, color: 'text-yellow-500' },
  sla_breached: { icon: AlertTriangle, color: 'text-red-500' },
  new_message: { icon: MessageSquare, color: 'text-green-500' },
};

export function NotificationBell() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { count } = useUnreadCount();
  const { notifications, mutate: mutateList } = useNotifications({ limit: 10 });
  const { markAsRead, markAllAsRead } = useNotificationActions();
  const { mutate: mutateCount } = useUnreadCount();

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

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
    setIsOpen(false);
    if (notification.clickUrl) {
      router.push(notification.clickUrl);
    }
  };

  const handleMarkAllAsRead = async () => {
    await markAllAsRead();
    mutateList();
    mutateCount();
  };

  const displayCount = count > 99 ? '99+' : count;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="relative rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {displayCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border bg-background shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">通知</h3>
            {count > 0 && (
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleMarkAllAsRead}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                全部已讀
              </button>
            )}
          </div>

          {/* Notification List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                目前沒有通知
              </div>
            ) : (
              notifications.map(
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
                    color: 'text-muted-foreground',
                  };
                  const Icon = config.icon;

                  return (
                    <button
                      key={n.id}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/50 ${
                        !n.isRead ? 'bg-accent/20' : ''
                      }`}
                      onClick={() => handleNotificationClick(n)}
                    >
                      <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${config.color}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{n.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{n.body}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(n.createdAt), {
                            addSuffix: true,
                            locale: zhTW,
                          })}
                        </p>
                      </div>
                      {!n.isRead && (
                        <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                      )}
                    </button>
                  );
                },
              )
            )}
          </div>

          {/* Footer */}
          <div className="border-t">
            <button
              className="w-full px-4 py-2.5 text-center text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                setIsOpen(false);
                router.push('/dashboard/notifications');
              }}
            >
              查看全部通知
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
