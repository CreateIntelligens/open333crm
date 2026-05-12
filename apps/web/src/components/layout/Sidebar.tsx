'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Trophy, Link2, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  InboxIcon,
  CaseIcon,
  ContactIcon,
  AutomationIcon,
  KnowledgeIcon,
  MarketingIcon,
  SettingIcon,
  LogoutIcon,
} from '@/components/icons/figma-icons';

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
    { label: '收件匣', href: '/dashboard/inbox', icon: <InboxIcon className="h-5 w-5" /> },
    { label: '工單', href: '/dashboard/cases', icon: <CaseIcon className="h-5 w-5" /> },
    { label: '聯繫人', href: '/dashboard/contacts', icon: <ContactIcon className="h-5 w-5" /> },
    { label: '自動化', href: '/dashboard/automation', icon: <AutomationIcon className="h-5 w-5" /> },
    { label: '知識庫', href: '/dashboard/knowledge', icon: <KnowledgeIcon className="h-5 w-5" /> },
    { label: '行銷', href: '/dashboard/marketing', icon: <MarketingIcon className="h-5 w-5" /> },
    { label: '粉絲活動', href: '/dashboard/portal', icon: <Trophy className="h-5 w-5" /> },
    { label: '短連結', href: '/dashboard/shortlinks', icon: <Link2 className="h-5 w-5" /> },
    { label: '報表', href: '/dashboard/analytics', icon: <BarChart3 className="h-5 w-5" /> },
    { label: '設定', href: '/dashboard/settings', icon: <SettingIcon className="h-5 w-5" /> },
  ];

  return (
    <aside className="flex h-screen w-16 shrink-0 flex-col items-center border-r border-surface-line bg-white lg:w-[248px] lg:items-stretch">
      {/* Logo header — 248×68, padding 16/24/16/12, gap 4 per Figma */}
      <div className="flex items-center justify-center pb-4 lg:justify-start lg:gap-1 lg:py-4 lg:pl-3 lg:pr-6">
        <Link href="/dashboard/inbox" className="flex items-center gap-3">
          <Image
            src="/figma/logo/logo-full.png"
            alt="open333CRM"
            width={36}
            height={36}
            className="h-9 w-9 rounded-lg object-cover"
            priority
          />
          <span className="hidden text-[18px] font-semibold leading-6 text-ink lg:inline">
            open333CRM
          </span>
        </Link>
      </div>

      <Separator className="bg-surface-line" />

      {/* Navigation — Figma padding 0/16, gap 8 */}
      <nav className="flex-1 space-y-2 overflow-y-auto py-4 lg:px-4">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-lg p-2 text-[14px] font-medium leading-5 transition-colors',
                isActive
                  ? 'bg-surface-active text-link'
                  : 'text-ink-subtle hover:bg-neutral-20',
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              {item.icon}
              <span className="hidden lg:inline">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={cn(
                    'ml-auto hidden h-[18px] min-w-[24px] items-center justify-center rounded-chip px-2 text-[14px] font-semibold leading-4 lg:inline-flex',
                    isActive ? 'bg-link/10 text-link' : 'bg-neutral-30 text-ink-subtle',
                  )}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <Separator className="bg-surface-line" />

      {/* User section — padding 16 per Figma */}
      <div className="lg:p-4">
        <div className="flex items-center justify-between gap-2 rounded-lg">
          <Avatar alt={agent?.name || '使用者'} size="sm" />
          <div className="hidden flex-1 overflow-hidden lg:block">
            <p className="truncate text-[14px] font-medium leading-5 text-ink">{agent?.name}</p>
            <p className="truncate text-[12px] leading-5 text-ink-subtle">{agent?.role}</p>
          </div>
          <button
            onClick={logout}
            className="hidden rounded-lg p-1.5 text-ink-subtle transition-colors hover:bg-neutral-20 hover:text-ink lg:block"
            title="登出"
            aria-label="登出"
          >
            <LogoutIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
