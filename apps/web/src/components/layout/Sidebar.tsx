'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3, Bell, BookOpen, Briefcase, ChevronDown, ChevronRight, CreditCard,
  FileText, FlaskConical, Gauge, Link2, LogOut, Menu, MessageSquare,
  Network, PanelLeftClose, PanelLeftOpen, PieChart, Send, Settings,
  Smartphone, Tags, Trophy, Users, X, Zap, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';

interface NavNode {
  id: string;
  label: string;
  href?: string;
  icon: LucideIcon;
  perm?: string;
  children?: NavNode[];
}

const NAV_TREE: NavNode[] = [
  { id: 'inbox', label: '收件匣', href: '/dashboard/inbox', icon: MessageSquare },
  { id: 'cases', label: '工單', href: '/dashboard/cases', icon: Briefcase },
  { id: 'contacts', label: '聯絡人', href: '/dashboard/contacts', icon: Users },
  { id: 'notifications', label: '通知', href: '/dashboard/notifications', icon: Bell },
  { id: 'automation', label: '自動化', href: '/dashboard/automation', icon: Zap, perm: 'automation.view' },
  {
    id: 'knowledge', label: '知識庫', href: '/dashboard/knowledge', icon: BookOpen, perm: 'knowledge.view', children: [
      { id: 'knowledge-articles', label: '文章管理', href: '/dashboard/knowledge/articles', icon: FileText },
      { id: 'knowledge-search', label: '語義搜尋', href: '/dashboard/knowledge/search', icon: Gauge },
      { id: 'knowledge-feedback', label: '回報調教', href: '/dashboard/knowledge/feedback', icon: FlaskConical },
      {
        id: 'knowledge-ai', label: 'AI 設定', icon: Network, children: [
          { id: 'knowledge-embedding', label: 'Embedding', href: '/dashboard/knowledge/embedding', icon: Network },
          { id: 'knowledge-chat', label: 'Chat & Prompt', href: '/dashboard/knowledge/chat-prompt', icon: MessageSquare },
        ],
      },
    ],
  },
  {
    id: 'marketing', label: '行銷', href: '/dashboard/marketing', icon: Send, perm: 'marketing.view', children: [
      { id: 'marketing-campaigns', label: '行銷活動', href: '/dashboard/marketing/campaigns', icon: Send },
      { id: 'marketing-broadcasts', label: '廣播', href: '/dashboard/marketing/broadcasts', icon: Send },
      { id: 'marketing-segments', label: '受眾分群', href: '/dashboard/marketing/segments', icon: Users },
      { id: 'marketing-materials', label: '素材庫', href: '/dashboard/marketing/materials', icon: FileText },
    ],
  },
  {
    id: 'channels', label: '渠道', href: '/dashboard/line/rich-menus', icon: Smartphone, perm: 'richmenu.manage', children: [
      { id: 'line-rich-menus', label: 'LINE Rich Menu', href: '/dashboard/line/rich-menus', icon: Smartphone },
      { id: 'line-keywords', label: 'LINE 關鍵字回覆', href: '/dashboard/line/keyword-replies', icon: MessageSquare },
      { id: 'line-quick-replies', label: 'LINE 快速回覆', href: '/dashboard/line/quick-replies', icon: MessageSquare },
    ],
  },
  {
    id: 'portal', label: '粉絲活動', href: '/dashboard/portal', icon: Trophy, perm: 'portal.view', children: [
      { id: 'portal-activities', label: '活動管理', href: '/dashboard/portal/activities', icon: Trophy },
      { id: 'portal-submissions', label: '提交紀錄', href: '/dashboard/portal/submissions', icon: FileText },
      { id: 'portal-points', label: '積分管理', href: '/dashboard/portal/points', icon: CreditCard },
    ],
  },
  {
    id: 'shortlinks', label: '短連結', href: '/dashboard/shortlinks', icon: Link2, perm: 'shortlink.view', children: [
      { id: 'shortlinks-links', label: '連結管理', href: '/dashboard/shortlinks/links', icon: Link2 },
      { id: 'shortlinks-stats', label: '統計分析', href: '/dashboard/shortlinks/stats', icon: BarChart3 },
    ],
  },
  {
    id: 'analytics', label: '報表', href: '/dashboard/analytics', icon: BarChart3, perm: 'analytics.view', children: [
      { id: 'analytics-overview', label: '總覽', href: '/dashboard/analytics', icon: PieChart },
      { id: 'analytics-my', label: '我的績效', href: '/dashboard/analytics/my', icon: BarChart3 },
    ],
  },
  { id: 'plan', label: '方案／帳務', href: '/dashboard/plan', icon: CreditCard, perm: 'settings.manage' },
  {
    id: 'settings', label: '設定', href: '/dashboard/settings', icon: Settings, children: [
      { id: 'settings-general', label: '一般設定', href: '/dashboard/settings/general', icon: Settings },
      { id: 'settings-channels', label: '渠道管理', href: '/dashboard/settings/channels', icon: Smartphone },
      { id: 'settings-agents', label: '人員管理', href: '/dashboard/settings/agents', icon: Users },
      { id: 'settings-roles', label: '角色與權限', href: '/dashboard/settings/roles', icon: Users, perm: 'role.view' },
      { id: 'settings-tags', label: '標籤管理', href: '/dashboard/settings/tags', icon: Tags },
      { id: 'settings-sla', label: 'SLA 政策', href: '/dashboard/settings/sla', icon: Gauge },
      { id: 'settings-office-hours', label: '營業時間', href: '/dashboard/settings/office-hours', icon: Gauge },
      { id: 'settings-tracking', label: '追蹤設定', href: '/dashboard/settings/tracking', icon: Network },
      { id: 'settings-api-keys', label: 'API 金鑰', href: '/dashboard/settings/api-keys', icon: Network },
      { id: 'settings-cli', label: 'CLI 連線', href: '/dashboard/settings/cli-sessions', icon: Link2 },
      { id: 'settings-passkeys', label: 'Passkey 登入', href: '/dashboard/settings/passkeys', icon: Network },
      {
        id: 'settings-integrations', label: '整合', icon: Network, children: [
          { id: 'settings-a2a', label: 'A2A', href: '/dashboard/settings/a2a', icon: Network, perm: 'settings.manage' },
        ],
      },
    ],
  },
];

function filterTree(nodes: NavNode[], hasPermission: (code: string) => boolean): NavNode[] {
  return nodes.flatMap((node) => {
    if (node.perm && !hasPermission(node.perm)) return [];
    const children = node.children ? filterTree(node.children, hasPermission) : undefined;
    if (node.children && children?.length === 0 && !node.href) return [];
    return [{ ...node, children }];
  });
}

function nodeContainsPath(node: NavNode, pathname: string): boolean {
  if (node.href && (pathname === node.href || pathname.startsWith(`${node.href}/`))) return true;
  return node.children?.some((child) => nodeContainsPath(child, pathname)) ?? false;
}

function collectActiveAncestors(nodes: NavNode[], pathname: string, ids = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (nodeContainsPath(node, pathname)) {
      ids.add(node.id);
      if (node.children) collectActiveAncestors(node.children, pathname, ids);
    }
  }
  return ids;
}

function TreeNode({ node, pathname, depth, expanded, onToggle, onNavigate }: {
  node: NavNode;
  pathname: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: () => void;
}) {
  const Icon = node.icon;
  const hasChildren = Boolean(node.children?.length);
  const isExact = node.href ? pathname === node.href : false;
  const isChildActive = node.children?.some((child) => nodeContainsPath(child, pathname)) ?? false;
  const isDescendant = node.href ? pathname.startsWith(`${node.href}/`) : false;

  const isDirectActive = hasChildren ? isExact : (isExact || isDescendant);
  const isAncestorActive = hasChildren && (isChildActive || isDescendant);

  const isExpanded = expanded.has(node.id);
  const padding = depth === 0 ? 'px-3' : 'pl-10 pr-3';

  return (
    <li>
      <div className="flex items-center gap-1">
        {hasChildren ? (
          <button type="button" aria-label={`${isExpanded ? '收合' : '展開'}${node.label}`} aria-expanded={isExpanded} onClick={() => onToggle(node.id)} className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : <span className="w-8 shrink-0" aria-hidden="true" />}
        {node.href ? (
          <Link
            href={node.href}
            onClick={onNavigate}
            aria-current={isDirectActive ? 'page' : undefined}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              padding,
              isDirectActive
                ? 'bg-primary text-primary-foreground'
                : isAncestorActive
                  ? 'bg-accent/40 text-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{node.label}</span>
          </Link>
        ) : (
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => onToggle(node.id)}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              padding,
              isAncestorActive ? 'text-foreground font-semibold' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{node.label}</span>
          </button>
        )}
      </div>
      {hasChildren && isExpanded && <ul className="space-y-0.5" aria-label={`${node.label}子選單`}>{node.children!.map((child) => <TreeNode key={child.id} node={child} pathname={pathname} depth={depth + 1} expanded={expanded} onToggle={onToggle} onNavigate={onNavigate} />)}</ul>}
    </li>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { agent, logout, hasPermission } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navTree = useMemo(() => filterTree(NAV_TREE, hasPermission), [hasPermission]);
  const activeAncestors = useMemo(() => collectActiveAncestors(navTree, pathname), [navTree, pathname]);
  const [expanded, setExpanded] = useState<Set<string>>(activeAncestors);

  useEffect(() => {
    setExpanded((current) => new Set([...current, ...activeAncestors]));
  }, [activeAncestors]);

  useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <>
      <button type="button" aria-label="開啟導覽選單" onClick={() => setMobileOpen(true)} className="fixed left-3 top-3 z-40 inline-flex h-10 w-10 items-center justify-center rounded-md border bg-background shadow-sm lg:hidden"><Menu className="h-5 w-5" /></button>
      {mobileOpen && <button type="button" aria-label="關閉導覽選單" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-black/30 lg:hidden" />}
      <aside className={cn('fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r bg-background py-4 shadow-xl transition-transform lg:relative lg:z-auto lg:w-64 lg:shadow-none', mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0', collapsed && 'lg:w-20')}>
        <div className="flex items-center justify-between px-4 pb-4">
          <Link href="/dashboard/inbox" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">O3</div>{!collapsed && <span className="text-lg font-bold">open333CRM</span>}</Link>
          <button type="button" aria-label="關閉導覽選單" onClick={() => setMobileOpen(false)} className="rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"><X className="h-4 w-4" /></button>
          <button type="button" aria-label={collapsed ? '展開側欄' : '收合側欄'} onClick={() => setCollapsed((value) => !value)} className="hidden rounded-md p-2 text-muted-foreground hover:bg-accent lg:block">{collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</button>
        </div>
        <Separator />
        <nav aria-label="主要導覽" className="flex-1 overflow-y-auto px-2 py-4">
          {collapsed ? (
            <ul className="space-y-1">{navTree.map((node) => { const Icon = node.icon; const active = nodeContainsPath(node, pathname); const href = node.href ?? node.children?.find((child) => child.href)?.href ?? '/dashboard/inbox'; return <li key={node.id}><Link href={href} aria-label={node.label} title={node.label} className={cn('flex h-10 items-center justify-center rounded-md', active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}><Icon className="h-4 w-4" /></Link></li>; })}</ul>
          ) : <ul className="space-y-1">{navTree.map((node) => <TreeNode key={node.id} node={node} pathname={pathname} depth={0} expanded={expanded} onToggle={toggle} onNavigate={() => setMobileOpen(false)} />)}</ul>}
        </nav>
        <Separator />
        <div className="px-2 py-4"><div className="flex items-center gap-3 rounded-md px-3 py-2"><Avatar alt={agent?.name || '使用者'} size="sm" />{!collapsed && <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{agent?.name}</p><p className="truncate text-xs text-muted-foreground">{agent?.role}</p></div>}<button onClick={logout} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground" title="登出" aria-label="登出"><LogOut className="h-4 w-4" /></button></div></div>
      </aside>
    </>
  );
}
