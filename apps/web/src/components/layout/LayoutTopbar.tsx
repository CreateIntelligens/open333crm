'use client';

import React from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useSocket } from '@/providers/SocketProvider';
import { NotificationBell } from '@/components/notification/NotificationBell';

interface LayoutTopbarProps {
  /** Brand text shown in the left chip. Defaults to a generic CRM label. */
  brandName?: string;
}

/**
 * Global Topbar mounted in dashboard layout. Shows brand + connection status + notifications + user dropdown.
 * Per-page tools (page title, search, action buttons) belong in the legacy `Topbar` component below this header.
 */
export function LayoutTopbar({ brandName = 'open333CRM 客服系統' }: LayoutTopbarProps) {
  const { agent, logout } = useAuth();
  const { isConnected } = useSocket();

  return (
    <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-surface-line bg-white px-6">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 rounded-lg border border-surface-line bg-neutral-30 px-3 py-2">
          <span className="text-[14px] font-medium leading-5 text-ink">{brandName}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div
            className={`h-2 w-2 rounded-full ${
              isConnected ? 'bg-f-green-60' : 'bg-f-red-60'
            }`}
          />
          <span className="text-[12px] text-ink-subtle">
            {isConnected ? '已連線' : '未連線'}
          </span>
        </div>

        <NotificationBell />

        <DropdownMenu
          align="right"
          trigger={
            <div className="flex cursor-pointer items-center gap-1 rounded-lg border border-surface-line bg-white px-2 py-1.5 hover:bg-neutral-20">
              <Avatar alt={agent?.name || '使用者'} size="sm" />
              <span className="hidden text-[14px] font-medium text-ink sm:inline">{agent?.name}</span>
            </div>
          }
        >
          <DropdownMenuItem>
            <span className="text-[12px] text-ink-subtle">{agent?.email}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>登出</span>
          </DropdownMenuItem>
        </DropdownMenu>
      </div>
    </header>
  );
}
