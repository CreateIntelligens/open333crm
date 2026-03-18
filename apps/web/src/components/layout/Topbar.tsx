'use client';

import React from 'react';
import { LogOut, Bell } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useSocket } from '@/providers/SocketProvider';

interface TopbarProps {
  title: string;
  children?: React.ReactNode;
}

export function Topbar({ title, children }: TopbarProps) {
  const { agent, logout } = useAuth();
  const { isConnected } = useSocket();

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children}
      </div>

      <div className="flex items-center gap-3">
        {/* Connection status indicator */}
        <div className="flex items-center gap-1.5">
          <div
            className={`h-2 w-2 rounded-full ${
              isConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-muted-foreground">
            {isConnected ? '已連線' : '未連線'}
          </span>
        </div>

        {/* Notifications */}
        <button className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground">
          <Bell className="h-5 w-5" />
        </button>

        {/* User dropdown */}
        <DropdownMenu
          align="right"
          trigger={
            <div className="flex items-center gap-2 cursor-pointer">
              <Avatar alt={agent?.name || '使用者'} size="sm" />
              <span className="text-sm font-medium hidden sm:inline">{agent?.name}</span>
            </div>
          }
        >
          <DropdownMenuItem>
            <span className="text-sm text-muted-foreground">{agent?.email}</span>
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
