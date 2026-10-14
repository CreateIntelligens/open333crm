'use client';

import React, { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, LogOut, Smartphone, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';

// ─── 導覽資料 ────────────────────────────────────────────────
// 圖示路徑取自 Claude Design 稿（方案帳務.html 的 RAIL）；設計稿沒有的項目用 lucide 圖示。

interface NavLink {
  id: string;
  label: string;
  href: string;
  perm?: string;
}
interface NavGroup {
  label: string;
  items: NavLink[];
}
interface RailItem {
  id: string;
  label: string;
  href: string;
  /** 這個路徑底下的頁面都算這一區（預設等於 href） */
  match?: string;
  perm?: string;
  d?: string;
  icon?: LucideIcon;
  /** 有子頁的區塊，進入後在內容區左側顯示子選單 */
  sections?: NavGroup[];
}

const RAIL: RailItem[] = [
  { id: 'inbox', label: '收件匣', href: '/dashboard/inbox', d: 'M4 4h16v10H15l-3 4-3-4H4z' },
  { id: 'cases', label: '工單', href: '/dashboard/cases', d: 'M8 4h8v3H8zM6 7h12v13H6z' },
  { id: 'contacts', label: '聯絡人', href: '/dashboard/contacts', d: 'M4 20a5 5 0 0 1 10 0M9 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6M17 20a4 4 0 0 0-3-3.9' },
  { id: 'automation', label: '自動化', href: '/dashboard/automation', perm: 'automation.view', d: 'M8 8h8v8H8zM12 4v4M6 12H3M21 12h-3' },
  {
    id: 'knowledge', label: '知識庫', href: '/dashboard/knowledge', perm: 'knowledge.view', d: 'M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z',
    sections: [
      { label: '', items: [
        { id: 'knowledge-articles', label: '文章管理', href: '/dashboard/knowledge/articles' },
        { id: 'knowledge-search', label: '語義搜尋', href: '/dashboard/knowledge/search' },
        { id: 'knowledge-feedback', label: '回報調教', href: '/dashboard/knowledge/feedback' },
      ] },
      { label: 'AI 設定', items: [
        { id: 'knowledge-embedding', label: 'Embedding', href: '/dashboard/knowledge/embedding' },
        { id: 'knowledge-chat', label: 'Chat & Prompt', href: '/dashboard/knowledge/chat-prompt' },
      ] },
    ],
  },
  {
    id: 'marketing', label: '行銷', href: '/dashboard/marketing', perm: 'marketing.view', d: 'M4 11 20 4l-6 16-2.5-6.5z',
    sections: [{ label: '', items: [
      { id: 'marketing-campaigns', label: '行銷活動', href: '/dashboard/marketing/campaigns' },
      { id: 'marketing-broadcasts', label: '廣播', href: '/dashboard/marketing/broadcasts' },
      { id: 'marketing-segments', label: '受眾分群', href: '/dashboard/marketing/segments' },
      { id: 'marketing-materials', label: '素材庫', href: '/dashboard/marketing/materials' },
    ] }],
  },
  {
    // 設計稿的側欄沒有這一項，先保留，避免 LINE 相關頁面找不到入口
    id: 'channels', label: '渠道', href: '/dashboard/line/rich-menus', match: '/dashboard/line', perm: 'richmenu.manage', icon: Smartphone,
    sections: [{ label: 'LINE', items: [
      { id: 'line-rich-menus', label: 'Rich Menu', href: '/dashboard/line/rich-menus' },
      { id: 'line-keywords', label: '關鍵字回覆', href: '/dashboard/line/keyword-replies' },
      { id: 'line-quick-replies', label: '快速回覆', href: '/dashboard/line/quick-replies' },
    ] }],
  },
  {
    id: 'portal', label: '粉絲活動', href: '/dashboard/portal', perm: 'portal.view', d: 'M12 4l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1L4.5 9.5l5.2-.8z',
    sections: [{ label: '', items: [
      { id: 'portal-activities', label: '活動管理', href: '/dashboard/portal/activities' },
      { id: 'portal-submissions', label: '提交紀錄', href: '/dashboard/portal/submissions' },
      { id: 'portal-points', label: '積分管理', href: '/dashboard/portal/points' },
    ] }],
  },
  {
    id: 'shortlinks', label: '短連結', href: '/dashboard/shortlinks', perm: 'shortlink.view', d: 'M9.5 14.5 5.8 18.2a3.4 3.4 0 0 0 4.8 4.8M14.5 9.5l3.7-3.7a3.4 3.4 0 0 0-4.8-4.8M9.5 14.5l5-5',
    sections: [{ label: '', items: [
      { id: 'shortlinks-links', label: '連結管理', href: '/dashboard/shortlinks/links' },
      { id: 'shortlinks-stats', label: '統計分析', href: '/dashboard/shortlinks/stats' },
    ] }],
  },
  { id: 'plan', label: '方案／帳務', href: '/dashboard/plan', perm: 'settings.manage', d: 'M3 7h18v12H3zM3 11h18M7 15h4' },
  {
    id: 'analytics', label: '報表', href: '/dashboard/analytics', perm: 'analytics.view', d: 'M5 4h14v16H5zM8 14l3-3 2 2 3-4',
    sections: [{ label: '', items: [
      { id: 'analytics-overview', label: '總覽', href: '/dashboard/analytics' },
      { id: 'analytics-my', label: '我的績效', href: '/dashboard/analytics/my' },
    ] }],
  },
  {
    id: 'settings', label: '設定', href: '/dashboard/settings', d: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M19 12a7 7 0 0 0-.2-1.5l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.5-1.4L13.5 2h-4l-.5 2.6a7 7 0 0 0-2.5 1.4l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 4 12',
    sections: [
      { label: '', items: [
        { id: 'settings-general', label: '一般設定', href: '/dashboard/settings/general' },
        { id: 'settings-channels', label: '渠道管理', href: '/dashboard/settings/channels' },
        { id: 'settings-agents', label: '人員管理', href: '/dashboard/settings/agents' },
        { id: 'settings-roles', label: '角色與權限', href: '/dashboard/settings/roles', perm: 'role.view' },
        { id: 'settings-tags', label: '標籤管理', href: '/dashboard/settings/tags' },
        { id: 'settings-sla', label: 'SLA 政策', href: '/dashboard/settings/sla' },
        { id: 'settings-office-hours', label: '營業時間', href: '/dashboard/settings/office-hours' },
        { id: 'settings-tracking', label: '追蹤設定', href: '/dashboard/settings/tracking' },
        { id: 'settings-identity-binding', label: '跨渠道綁定', href: '/dashboard/settings/identity-binding', perm: 'settings.manage' },
      ] },
      { label: '開發與整合', items: [
        { id: 'settings-api-keys', label: 'API 金鑰', href: '/dashboard/settings/api-keys' },
        { id: 'settings-cli', label: 'CLI 連線', href: '/dashboard/settings/cli-sessions' },
        { id: 'settings-passkeys', label: 'Passkey 登入', href: '/dashboard/settings/passkeys' },
        { id: 'settings-a2a', label: 'A2A', href: '/dashboard/settings/a2a', perm: 'settings.manage' },
      ] },
    ],
  },
];

// ─── 工具函式 ────────────────────────────────────────────────

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function useVisibleRail() {
  const { hasPermission } = useAuth();
  return useMemo(() => RAIL.flatMap((item) => {
    if (item.perm && !hasPermission(item.perm)) return [];
    const sections = item.sections
      ?.map((g) => ({ ...g, items: g.items.filter((l) => !l.perm || hasPermission(l.perm)) }))
      .filter((g) => g.items.length > 0);
    return [{ ...item, sections }];
  }), [hasPermission]);
}

/** 目前所在的區塊 */
function useActiveItem(rail: RailItem[]) {
  const pathname = usePathname();
  return rail.find((item) => under(pathname, item.match ?? item.href));
}

/** 子選單中目前所在的連結：取路徑最長的那個，避免「總覽」和「我的績效」同時亮起 */
function activeLinkId(groups: NavGroup[], pathname: string) {
  let best: NavLink | undefined;
  for (const link of groups.flatMap((g) => g.items)) {
    if (under(pathname, link.href) && (!best || link.href.length > best.href.length)) best = link;
  }
  return best?.id;
}

function RailIcon({ item, className }: { item: RailItem; className?: string }) {
  if (item.icon) {
    const Icon = item.icon;
    return <Icon className={className} strokeWidth={1.8} aria-hidden="true" />;
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={item.d} />
    </svg>
  );
}

// ─── 左側圖示欄（桌機） ──────────────────────────────────────

export function Sidebar() {
  const rail = useVisibleRail();
  const active = useActiveItem(rail);
  const { logout, permissionsError, reloadPermissions } = useAuth();

  return (
    <nav aria-label="主要導覽" className="hidden w-16 flex-none flex-col items-center gap-3 py-3.5 lg:flex">
      {permissionsError && (
        <button
          type="button"
          onClick={() => void reloadPermissions()}
          title="無法載入你的權限，部分選單沒有顯示。按此重試"
          aria-label="無法載入你的權限，重試"
          className="flex h-9 w-9 items-center justify-center rounded-md text-destructive hover:bg-destructive-subtle"
        >
          <AlertTriangle className="h-[18px] w-[18px]" />
        </button>
      )}
      <ul className="flex flex-col items-center gap-3">
        {rail.map((item) => {
          const isActive = item.id === active?.id;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-background hover:text-foreground',
                )}
              >
                <RailIcon item={item} className="h-[18px] w-[18px]" />
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex-1" />
      <button
        type="button"
        onClick={logout}
        title="登出"
        aria-label="登出"
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
    </nav>
  );
}

// ─── 區塊子選單（灰底上、白色內容區左側，只在有子頁的區塊出現；樣式依 Claude Design 短連結稿） ──

export function SectionNav() {
  const rail = useVisibleRail();
  const active = useActiveItem(rail);
  const pathname = usePathname();
  if (!active?.sections?.length) return null;
  const current = activeLinkId(active.sections, pathname);

  return (
    <nav aria-label={`${active.label}選單`} className="hidden w-[248px] flex-none flex-col gap-4 overflow-y-auto pb-6 pr-4 pt-6 lg:flex">
      <p className="px-3 text-2xl font-bold leading-8 text-foreground">{active.label}</p>
      {active.sections.map((group, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {group.label && <p className="px-3.5 pb-1 text-xs text-muted-foreground">{group.label}</p>}
          {group.items.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              aria-current={link.id === current ? 'page' : undefined}
              className={cn(
                'flex h-10 items-center rounded-md px-3.5 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                link.id === current ? 'bg-primary font-medium text-primary-foreground' : 'text-foreground hover:bg-background/70',
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

// ─── 手機版抽屜選單 ──────────────────────────────────────────

export function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rail = useVisibleRail();
  const active = useActiveItem(rail);
  const pathname = usePathname();
  const { logout } = useAuth();

  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button type="button" aria-label="關閉導覽選單" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <nav aria-label="主要導覽" className="absolute inset-y-0 left-0 flex w-72 flex-col bg-background shadow-xl">
        <div className="flex h-[50px] items-center justify-between px-4">
          <span className="text-sm font-medium">Admin Center</span>
          <button type="button" aria-label="關閉導覽選單" onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto px-2 pb-4">
          {rail.map((item) => {
            const isActive = item.id === active?.id;
            const current = isActive && item.sections ? activeLinkId(item.sections, pathname) : undefined;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={isActive && !current ? 'page' : undefined}
                  className={cn('flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium', isActive ? 'text-primary' : 'text-foreground hover:bg-muted')}
                >
                  <RailIcon item={item} className="h-[18px] w-[18px]" />
                  {item.label}
                </Link>
                {isActive && item.sections?.flatMap((g) => g.items).map((link) => (
                  <Link
                    key={link.id}
                    href={link.href}
                    aria-current={link.id === current ? 'page' : undefined}
                    className={cn('ml-9 flex h-9 items-center rounded-md px-3 text-sm', link.id === current ? 'bg-primary-subtle font-medium text-primary' : 'text-muted-foreground hover:bg-muted')}
                  >
                    {link.label}
                  </Link>
                ))}
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={logout} className="m-2 flex h-10 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted">
          <LogOut className="h-[18px] w-[18px]" /> 登出
        </button>
      </nav>
    </div>
  );
}
