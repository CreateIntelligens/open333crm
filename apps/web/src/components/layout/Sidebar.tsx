'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, CreditCard } from 'lucide-react';
import {
  AutomationIcon, ChannelsIcon, ContactsIcon, InboxIcon, KnowledgeIcon, LinkIcon, LogoutIcon,
  MarketingIcon, PortalIcon, ReportIcon, SettingIcon, WorkCaseIcon,
} from '@/components/icons/figma-icons';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';

// ─── 導覽資料 ────────────────────────────────────────────────
// 順序、圖示、子選單文字依 Figma「12.1.1 渠道管理」；Figma 沒有的項目（方案／帳務、跨渠道綁定）先保留以免頁面失去入口。

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
  icon: React.ComponentType<{ className?: string }>;
  /** 有子頁的區塊，進入後在內容區左側顯示子選單 */
  sections?: NavGroup[];
}

const RAIL: RailItem[] = [
  { id: 'inbox', label: '收件匣', href: '/dashboard/inbox', icon: InboxIcon },
  { id: 'cases', label: '工單', href: '/dashboard/cases', icon: WorkCaseIcon },
  { id: 'contacts', label: '聯繫人', href: '/dashboard/contacts', icon: ContactsIcon },
  { id: 'automation', label: '自動化', href: '/dashboard/automation', perm: 'automation.view', icon: AutomationIcon },
  {
    id: 'knowledge', label: '知識庫', href: '/dashboard/knowledge', perm: 'knowledge.view', icon: KnowledgeIcon,
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
    id: 'marketing', label: '行銷', href: '/dashboard/marketing', perm: 'marketing.view', icon: MarketingIcon,
    sections: [{ label: '', items: [
      { id: 'marketing-campaigns', label: '行銷活動', href: '/dashboard/marketing/campaigns' },
      { id: 'marketing-broadcasts', label: '廣播', href: '/dashboard/marketing/broadcasts' },
      { id: 'marketing-segments', label: '受眾分群', href: '/dashboard/marketing/segments' },
      { id: 'marketing-materials', label: '素材庫', href: '/dashboard/marketing/materials' },
    ] }],
  },
  {
    id: 'channels', label: '渠道', href: '/dashboard/line/rich-menus', match: '/dashboard/line', perm: 'richmenu.manage', icon: ChannelsIcon,
    sections: [{ label: 'LINE', items: [
      { id: 'line-rich-menus', label: 'Rich Menu', href: '/dashboard/line/rich-menus' },
      { id: 'line-keywords', label: '關鍵字回覆', href: '/dashboard/line/keyword-replies' },
      { id: 'line-quick-replies', label: '快速回覆', href: '/dashboard/line/quick-replies' },
    ] }],
  },
  {
    id: 'portal', label: '粉絲活動', href: '/dashboard/portal', perm: 'portal.view', icon: PortalIcon,
    sections: [{ label: '', items: [
      { id: 'portal-activities', label: '活動管理', href: '/dashboard/portal/activities' },
      { id: 'portal-submissions', label: '提交紀錄', href: '/dashboard/portal/submissions' },
      { id: 'portal-points', label: '積分管理', href: '/dashboard/portal/points' },
    ] }],
  },
  {
    id: 'shortlinks', label: '短連結', href: '/dashboard/shortlinks', perm: 'shortlink.view', icon: LinkIcon,
    sections: [{ label: '', items: [
      { id: 'shortlinks-links', label: '連結管理', href: '/dashboard/shortlinks/links' },
      { id: 'shortlinks-stats', label: '統計分析', href: '/dashboard/shortlinks/stats' },
    ] }],
  },
  {
    id: 'analytics', label: '報表', href: '/dashboard/analytics', perm: 'analytics.view', icon: ReportIcon,
    sections: [{ label: '', items: [
      { id: 'analytics-overview', label: '總覽', href: '/dashboard/analytics' },
      { id: 'analytics-my', label: '我的績效', href: '/dashboard/analytics/my' },
    ] }],
  },
  // Figma 的圖示欄沒有「方案／帳務」，暫放在報表和設定之間
  { id: 'plan', label: '方案／帳務', href: '/dashboard/plan', perm: 'settings.manage', icon: CreditCard },
  {
    id: 'settings', label: '設定', href: '/dashboard/settings', icon: SettingIcon,
    sections: [{ label: '', items: [
      { id: 'settings-general', label: '一般設定', href: '/dashboard/settings/general' },
      { id: 'settings-channels', label: '渠道管理', href: '/dashboard/settings/channels' },
      { id: 'settings-agents', label: '人員管理', href: '/dashboard/settings/agents' },
      { id: 'settings-roles', label: '角色權限', href: '/dashboard/settings/roles', perm: 'role.view' },
      { id: 'settings-tags', label: '標籤管理', href: '/dashboard/settings/tags' },
      { id: 'settings-sla', label: 'SLA 政策', href: '/dashboard/settings/sla' },
      { id: 'settings-office-hours', label: '營業時間', href: '/dashboard/settings/office-hours' },
      { id: 'settings-tracking', label: '追蹤設定', href: '/dashboard/settings/tracking' },
      { id: 'settings-identity-binding', label: '跨渠道綁定', href: '/dashboard/settings/identity-binding', perm: 'settings.manage' },
      { id: 'settings-api-keys', label: 'API 金鑰', href: '/dashboard/settings/api-keys' },
      { id: 'settings-cli', label: 'CLI 連線', href: '/dashboard/settings/cli-sessions' },
      { id: 'settings-passkeys', label: 'Passkey 登入', href: '/dashboard/settings/passkeys' },
      { id: 'settings-a2a', label: 'A2A', href: '/dashboard/settings/a2a', perm: 'settings.manage' },
    ] }],
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

/** 點圖示時要去的頁面：有子選單的區塊直接進第一個（有權限的）子頁，沒有子選單就是區塊本身 */
function entryHref(item: RailItem) {
  return item.sections?.[0]?.items[0]?.href ?? item.href;
}

/**
 * 子選單中目前所在的連結：取路徑最長的那個，避免「總覽」和「我的績效」同時亮起。
 * 網址剛好停在區塊首頁（例如 /dashboard/knowledge）時，視為第一個子頁，讓第一項呈現選中。
 */
function activeLinkId(groups: NavGroup[], pathname: string, sectionHref?: string) {
  let best: NavLink | undefined;
  for (const link of groups.flatMap((g) => g.items)) {
    if (under(pathname, link.href) && (!best || link.href.length > best.href.length)) best = link;
  }
  if (!best && sectionHref && pathname === sectionHref) best = groups[0]?.items[0];
  return best?.id;
}

function RailIcon({ item, className }: { item: RailItem; className?: string }) {
  const Icon = item.icon;
  return <Icon className={className} aria-hidden="true" />;
}

// ─── 目前位置（給頁面標題列的麵包屑用） ────────────────────

export interface NavTrail {
  section?: { label: string; href: string };
  link?: { label: string; href: string };
  /** 目前網址剛好就是子選單那一頁（列表頁），而不是更深的詳情／新增頁 */
  atLink: boolean;
}

export function useNavTrail(): NavTrail {
  const rail = useVisibleRail();
  const active = useActiveItem(rail);
  const pathname = usePathname();
  if (!active) return { atLink: false };
  const section = { label: active.label, href: active.href };
  if (!active.sections?.length) return { section, atLink: pathname === active.href };
  const id = activeLinkId(active.sections, pathname, active.href);
  const found = active.sections.flatMap((g) => g.items).find((l) => l.id === id);
  if (!found) return { section, atLink: false };
  return {
    section,
    link: { label: found.label, href: found.href },
    atLink: pathname === found.href || pathname === active.href,
  };
}

// ─── 版面寬度規則 ────────────────────────────────────────────
// 圖示欄永遠顯示；子選單只在寬度 ≥ 1024px（Tailwind lg）時常駐，
// 較窄時收起，點有子頁的圖示會從圖示欄旁彈出子選單。要調整切換點只改這裡和下方 SectionNav 的 lg: class。
const SUBMENU_QUERY = '(min-width: 1024px)';

function useWideScreen() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(SUBMENU_QUERY);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return wide;
}

// ─── 子選單內容（常駐的 SectionNav 與彈出的子選單共用） ─────────

function SectionLinks({ item, current, onNavigate }: { item: RailItem; current?: string; onNavigate?: () => void }) {
  return (
    <>
      <p className="px-2 text-xl font-semibold leading-6 text-foreground">{item.label}</p>
      {item.sections?.map((group, i) => (
        <div key={i} className="flex flex-col gap-2">
          {group.label && <p className="px-3 text-xs text-muted-foreground">{group.label}</p>}
          {group.items.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              onClick={onNavigate}
              aria-current={link.id === current ? 'page' : undefined}
              className={cn(
                'flex items-center rounded-md px-3 py-2 text-sm font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                link.id === current ? 'bg-primary-hover text-white' : 'text-tertiary-foreground hover:bg-black/5 hover:text-foreground',
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}

// ─── 左側圖示欄（依 Figma Sidebar：寬 66、上內距 12、項目間距 12、項目內距 8、圓角 8） ──

export function Sidebar() {
  const rail = useVisibleRail();
  const active = useActiveItem(rail);
  const pathname = usePathname();
  const wide = useWideScreen();
  const { logout, permissionsError, reloadPermissions } = useAuth();
  // 窄螢幕時彈出的子選單（記住是哪一區）
  const [flyoutId, setFlyoutId] = useState<string | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const flyout = rail.find((i) => i.id === flyoutId);

  // 換頁、變寬螢幕時收起彈出選單
  useEffect(() => { setFlyoutId(null); }, [pathname, wide]);

  // 點外面或按 Esc 關閉
  useEffect(() => {
    if (!flyoutId) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (flyoutRef.current?.contains(target) || target.closest('[data-rail-trigger]')) return;
      setFlyoutId(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFlyoutId(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [flyoutId]);

  const itemCls = (isActive: boolean) =>
    cn(
      'flex h-9 w-9 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      isActive
        ? 'bg-primary-hover text-white [--icon-cutout:hsl(var(--primary-hover))]'
        : 'text-tertiary-foreground hover:bg-black/5 [--icon-cutout:hsl(var(--shell))]',
    );

  return (
    <nav aria-label="主要導覽" className="relative flex w-[66px] flex-none flex-col items-center bg-shell pt-3">
      {permissionsError && (
        <button
          type="button"
          onClick={() => void reloadPermissions()}
          title="無法載入你的權限，部分選單沒有顯示。按此重試"
          aria-label="無法載入你的權限，重試"
          className="mb-3 flex h-9 w-9 items-center justify-center rounded-md text-destructive hover:bg-destructive-subtle"
        >
          <AlertTriangle className="h-5 w-5" />
        </button>
      )}
      <ul className="flex flex-col items-center gap-3 py-1">
        {rail.map((item) => {
          const isActive = item.id === active?.id || item.id === flyoutId;
          const collapsible = !wide && Boolean(item.sections?.length);
          return (
            <li key={item.id}>
              {collapsible ? (
                // 窄螢幕：有子頁的圖示改成按鈕，點了彈出子選單
                <button
                  type="button"
                  data-rail-trigger
                  onClick={() => setFlyoutId((id) => (id === item.id ? null : item.id))}
                  title={item.label}
                  aria-label={item.label}
                  aria-expanded={flyoutId === item.id}
                  aria-controls="rail-flyout"
                  aria-current={item.id === active?.id ? 'page' : undefined}
                  className={itemCls(isActive)}
                >
                  <RailIcon item={item} className="h-5 w-5" />
                </button>
              ) : (
                <Link
                  href={entryHref(item)}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={item.id === active?.id ? 'page' : undefined}
                  className={itemCls(isActive)}
                >
                  <RailIcon item={item} className="h-5 w-5" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-6 h-px w-full bg-border" aria-hidden="true" />
      <div className="flex-1" />
      <button
        type="button"
        onClick={logout}
        title="登出"
        aria-label="登出"
        className="mb-6 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogoutIcon className="h-5 w-5" />
      </button>

      {/* 窄螢幕彈出的子選單：貼在圖示欄右側，蓋在內容上 */}
      {flyout?.sections?.length ? (
        <div
          id="rail-flyout"
          ref={flyoutRef}
          role="dialog"
          aria-label={`${flyout.label}選單`}
          className="absolute left-full top-0 z-40 flex h-full w-[230px] flex-col gap-3.5 overflow-y-auto border-r border-border bg-shell py-5 pl-2 pr-4 shadow-[4px_0_16px_rgba(0,0,0,0.08)]"
        >
          <SectionLinks
            item={flyout}
            current={activeLinkId(flyout.sections, pathname, flyout.href)}
            onNavigate={() => setFlyoutId(null)}
          />
        </div>
      ) : null}
    </nav>
  );
}

// ─── 區塊子選單（寬螢幕常駐；依 Figma Sidebar Menu：寬 230、左 8 右 16 上下 20） ──

export function SectionNav() {
  const rail = useVisibleRail();
  const active = useActiveItem(rail);
  const pathname = usePathname();
  if (!active?.sections?.length) return null;

  return (
    <nav aria-label={`${active.label}選單`} className="hidden w-[230px] flex-none flex-col gap-3.5 overflow-y-auto py-5 pl-2 pr-4 lg:flex">
      <SectionLinks item={active} current={activeLinkId(active.sections, pathname, active.href)} />
    </nav>
  );
}
