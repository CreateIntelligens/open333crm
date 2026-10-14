'use client';

import React from 'react';
import Link from 'next/link';
import { BookOpen, Bot, LogOut, Menu, User } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { NotificationBell } from '@/components/notification/NotificationBell';

export function AppHeader({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { agent, logout } = useAuth();

  return (
    <header className="flex h-[50px] flex-none items-center gap-5 px-5">
      <button
        type="button"
        aria-label="開啟導覽選單"
        onClick={onOpenMenu}
        className="-ml-2 rounded-md p-2 text-foreground hover:bg-background lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <Link href="/dashboard/inbox" className="flex items-center gap-5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {/* 品牌深藍 #1E3A8A 取自設計稿，專案色票中沒有對應 token */}
        <span className="flex h-[30px] w-[30px] items-center justify-center rounded-md bg-[#1e3a8a] text-xs font-bold tracking-tight text-white">333</span>
        <span className="text-sm font-medium text-foreground">Admin Center</span>
      </Link>

      {/* 設計稿這裡有分隔線＋公司名稱；目前前端拿不到租戶名稱（/auth/me 沒有回傳），待後端提供後再補上 */}

      <div className="flex-1" />

      <NotificationBell />

      <DropdownMenu
        align="right"
        trigger={
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-border text-muted-foreground" title={agent?.name}>
            <User className="h-[15px] w-[15px]" strokeWidth={1.8} />
            <span className="sr-only">帳號選單</span>
          </span>
        }
      >
        <div role="presentation" className="px-2 py-2">
          <p className="text-sm font-medium">{agent?.name}</p>
          <p className="text-xs text-muted-foreground">{agent?.email}</p>
        </div>
        <DropdownMenuItem onClick={() => window.open('/manual/index.html', '_blank', 'noopener')}>
          <BookOpen className="mr-2 h-4 w-4" />
          <span>操作說明</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.open('/skill.md', '_blank', 'noopener')}>
          <Bot className="mr-2 h-4 w-4" />
          <span>LLM Skill 文件</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>登出</span>
        </DropdownMenuItem>
      </DropdownMenu>
    </header>
  );
}
