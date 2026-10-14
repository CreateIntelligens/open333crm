'use client';

import React from 'react';
import Link from 'next/link';
import { BookOpen, Bot, LogOut, Menu, User } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { NotificationBell } from '@/components/notification/NotificationBell';

// 依 Figma 頂部列：高 51、右內距 24；logo 區寬 66（與左側圖示欄對齊）、logo 26px；右側鈴鐺與頭像各 24px
export function AppHeader({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { agent, logout } = useAuth();

  return (
    <header className="flex h-[51px] flex-none items-center justify-between bg-shell pr-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="開啟導覽選單"
          onClick={onOpenMenu}
          className="ml-3 rounded-md p-2 text-foreground hover:bg-black/5 lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link
          href="/dashboard/inbox"
          aria-label="回到收件匣"
          className="hidden h-[51px] w-[66px] items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:flex"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 26px 靜態 logo，不需要 next/image 最佳化 */}
          <img src="/brand/logo-333.png" alt="333" width={26} height={26} className="h-[26px] w-[26px]" />
        </Link>
        <div className="flex h-[51px] items-center gap-[15px]">
          <span className="text-sm font-medium leading-5 text-foreground">Admin Center</span>
          {/* Figma 這裡還有下拉箭頭、分隔線與公司名稱：切換功能和租戶名稱目前都沒有，待後端提供後補上 */}
        </div>
      </div>

      <div className="flex w-[70px] items-center justify-between">
        <NotificationBell />
        <DropdownMenu
          align="right"
          trigger={
            <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-border text-muted-foreground" title={agent?.name}>
              {agent?.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element -- 使用者頭像來自外部網址
                <img src={agent.avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <User className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
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
      </div>
    </header>
  );
}
