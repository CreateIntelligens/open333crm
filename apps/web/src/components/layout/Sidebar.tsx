'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageSquare,
  Briefcase,
  Users,
  Zap,
  BookOpen,
  Send,
  Trophy,
  Link2,
  BarChart3,
  Settings,
  LogOut,
  Smartphone,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
  /** 需要的權限碼；未設代表登入即可 */
  perm?: string;
}

export function Sidebar() {
  const pathname = usePathname();
  const { agent, logout, hasPermission } = useAuth();

  const allNavItems: NavItem[] = [
    {
      label: '收件匣',
      href: '/dashboard/inbox',
      icon: <MessageSquare className="h-5 w-5" />,
    },
    {
      label: '工單',
      href: '/dashboard/cases',
      icon: <Briefcase className="h-5 w-5" />,
    },
    {
      label: '聯繫人',
      href: '/dashboard/contacts',
      icon: <Users className="h-5 w-5" />,
    },
    {
      label: '自動化',
      href: '/dashboard/automation',
      icon: <Zap className="h-5 w-5" />,
      perm: 'automation.view',
    },
    {
      label: '知識庫',
      href: '/dashboard/knowledge',
      icon: <BookOpen className="h-5 w-5" />,
      perm: 'knowledge.view',
    },
    {
      label: '行銷',
      href: '/dashboard/marketing',
      icon: <Send className="h-5 w-5" />,
      perm: 'marketing.view',
    },
    {
      label: 'LINE 管理',
      href: '/dashboard/line/rich-menus',
      icon: <Smartphone className="h-5 w-5" />,
      perm: 'richmenu.manage',
    },
    {
      label: '粉絲活動',
      href: '/dashboard/portal',
      icon: <Trophy className="h-5 w-5" />,
      perm: 'portal.view',
    },
    {
      label: '短連結',
      href: '/dashboard/shortlinks',
      icon: <Link2 className="h-5 w-5" />,
      perm: 'shortlink.view',
    },
    {
      label: '報表',
      href: '/dashboard/analytics',
      icon: <BarChart3 className="h-5 w-5" />,
      perm: 'analytics.view',
    },
    {
      label: '設定',
      href: '/dashboard/settings',
      icon: <Settings className="h-5 w-5" />,
    },
  ];

  // 依權限過濾：無 perm 一律顯示；有 perm 需持有該權限
  const navItems = allNavItems.filter((item) => !item.perm || hasPermission(item.perm));

  return (
    <aside className="flex h-screen w-16 flex-col items-center border-r bg-background py-4 lg:w-56 lg:items-stretch">
      {/* Logo */}
      <div className="flex items-center justify-center px-4 pb-4 lg:justify-start">
        <Link href="/dashboard/inbox" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
            O3
          </div>
          <span className="hidden text-lg font-bold lg:inline">open333CRM</span>
        </Link>
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {item.icon}
              <span className="hidden lg:inline">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={cn(
                    'ml-auto hidden min-w-[20px] rounded-full px-1.5 py-0.5 text-center text-xs font-semibold lg:inline',
                    isActive
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-destructive text-destructive-foreground'
                  )}
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <Separator />

      {/* User section */}
      <div className="px-2 py-4">
        <div className="flex items-center gap-3 rounded-md px-3 py-2">
          <Avatar
            alt={agent?.name || '使用者'}
            size="sm"
          />
          <div className="hidden flex-1 overflow-hidden lg:block">
            <p className="truncate text-sm font-medium">{agent?.name}</p>
            <p className="truncate text-xs text-muted-foreground">{agent?.role}</p>
          </div>
          <button
            onClick={logout}
            className="hidden rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground lg:block"
            title="登出"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
