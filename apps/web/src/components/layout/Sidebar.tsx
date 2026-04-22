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
}

export function Sidebar() {
  const pathname = usePathname();
  const { agent, logout } = useAuth();

  const navItems: NavItem[] = [
    {
      label: '收件匣',
      href: '/dashboard/inbox',
      icon: <MessageSquare className="h-5 w-5" />,
      badge: 12,
    },
    {
      label: '工單',
      href: '/dashboard/cases',
      icon: <Briefcase className="h-5 w-5" />,
      badge: 5,
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
    },
    {
      label: '知識庫',
      href: '/dashboard/knowledge',
      icon: <BookOpen className="h-5 w-5" />,
    },
    {
      label: '行銷',
      href: '/dashboard/marketing',
      icon: <Send className="h-5 w-5" />,
    },
    {
      label: '粉絲活動',
      href: '/dashboard/portal',
      icon: <Trophy className="h-5 w-5" />,
    },
    {
      label: '短連結',
      href: '/dashboard/shortlinks',
      icon: <Link2 className="h-5 w-5" />,
    },
    {
      label: '報表',
      href: '/dashboard/analytics',
      icon: <BarChart3 className="h-5 w-5" />,
    },
    {
      label: '設定',
      href: '/dashboard/settings',
      icon: <Settings className="h-5 w-5" />,
    },
  ];

  return (
    <aside className="flex h-screen w-16 flex-col items-center border-r bg-background py-4 lg:w-[248px] lg:items-stretch">
      {/* Logo */}
      <div className="flex items-center justify-center px-4 pb-4 lg:justify-start">
        <Link href="/dashboard/inbox" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
            O3
          </div>
          <span className="hidden text-lg font-bold lg:inline">Open333CRM</span>
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
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[#f8eaf6] text-[#cb74c1]'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {item.icon}
              <span className="hidden lg:inline">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="ml-auto hidden rounded-full bg-[#cb74c1] px-2 py-0.5 text-xs text-white lg:inline">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <Separator />

      {/* Pro plan block */}
      <div className="mx-3 mb-2 hidden rounded-lg border border-[#fee685] bg-[#fffbeb] p-3 lg:block">
        <p className="text-xs font-semibold text-[#bb4d00]">Pro 方案</p>
        <p className="mt-0.5 text-xs text-[#4a5565]">解鎖全部功能</p>
        <button className="mt-2 w-full rounded bg-[#cb74c1] px-3 py-1.5 text-xs font-medium text-white">
          升級
        </button>
      </div>

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
