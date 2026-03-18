'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import {
  MessageSquare,
  Briefcase,
  Users,
  Zap,
  Loader2,
  ArrowRight,
  Clock,
  User,
} from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChannelBadge } from '@/components/shared/ChannelBadge';
import { CaseStatusBadge } from '@/components/case/CaseStatusBadge';
import { CasePriorityBadge } from '@/components/case/CasePriorityBadge';
import { Separator } from '@/components/ui/separator';
import api from '@/lib/api';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface StatsData {
  unreadConversations: number;
  openCases: number;
  totalContacts: number;
  activeRules: number;
}

interface Conversation {
  id: string;
  contact?: {
    id: string;
    name?: string;
    displayName?: string;
  };
  channelType: string;
  lastMessage?: {
    content: string | { text?: string };
    createdAt: string;
  };
  unreadCount?: number;
  status: string;
  updatedAt: string;
}

interface CaseItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee?: { id: string; name: string };
  assignedTo?: { id: string; name: string };
  contact?: { id: string; name: string };
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function extractMessageText(content: string | { text?: string } | null | undefined): string {
  if (!content) return '尚無訊息';
  if (typeof content === 'string') return content;
  return content.text || '尚無訊息';
}

function formatRelativeTime(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), {
      addSuffix: true,
      locale: zhTW,
    });
  } catch {
    return '';
  }
}

/* -------------------------------------------------------------------------- */
/*  Stat Card Component                                                       */
/* -------------------------------------------------------------------------- */

interface StatCardProps {
  icon: React.ReactNode;
  title: string;
  value: number | null;
  isLoading: boolean;
  color: string;
}

function StatCard({ icon, title, value, isLoading, color }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${color}`}>
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{title}</p>
            {isLoading ? (
              <Loader2 className="mt-1 h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <p className="text-2xl font-bold">{value ?? '-'}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Page                                                                 */
/* -------------------------------------------------------------------------- */

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsData>({
    unreadConversations: 0,
    openCases: 0,
    totalContacts: 0,
    activeRules: 0,
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingCases, setIsLoadingCases] = useState(true);

  /* ---- Fetch statistics ---- */
  useEffect(() => {
    async function fetchStats() {
      try {
        const [unreadRes, casesRes, contactsRes, rulesRes] = await Promise.allSettled([
          api.get('/conversations', { params: { unread: true, limit: 1 } }),
          api.get('/cases', { params: { status: 'open', limit: 1 } }),
          api.get('/contacts', { params: { limit: 1 } }),
          api.get('/automation/rules', { params: { limit: 1 } }),
        ]);

        setStats({
          unreadConversations:
            unreadRes.status === 'fulfilled'
              ? unreadRes.value.data?.meta?.total ?? 0
              : 0,
          openCases:
            casesRes.status === 'fulfilled'
              ? casesRes.value.data?.meta?.total ?? 0
              : 0,
          totalContacts:
            contactsRes.status === 'fulfilled'
              ? contactsRes.value.data?.meta?.total ?? 0
              : 0,
          activeRules:
            rulesRes.status === 'fulfilled'
              ? (rulesRes.value.data?.meta?.total ?? rulesRes.value.data?.data?.length ?? 0)
              : 0,
        });
      } catch {
        // 靜默處理，保持預設值 0
      } finally {
        setIsLoadingStats(false);
      }
    }

    fetchStats();
  }, []);

  /* ---- Fetch recent conversations ---- */
  useEffect(() => {
    async function fetchConversations() {
      try {
        const res = await api.get('/conversations', { params: { limit: 5 } });
        setConversations(res.data?.data ?? []);
      } catch {
        // 靜默處理
      } finally {
        setIsLoadingConversations(false);
      }
    }

    fetchConversations();
  }, []);

  /* ---- Fetch recent cases ---- */
  useEffect(() => {
    async function fetchCases() {
      try {
        const res = await api.get('/cases', { params: { limit: 5 } });
        setCases(res.data?.data ?? []);
      } catch {
        // 靜默處理
      } finally {
        setIsLoadingCases(false);
      }
    }

    fetchCases();
  }, []);

  /* ---- Stat card definitions ---- */
  const statCards = [
    {
      icon: <MessageSquare className="h-6 w-6 text-blue-600" />,
      title: '未讀對話',
      value: stats.unreadConversations,
      color: 'bg-blue-100',
    },
    {
      icon: <Briefcase className="h-6 w-6 text-orange-600" />,
      title: '開啟中工單',
      value: stats.openCases,
      color: 'bg-orange-100',
    },
    {
      icon: <Users className="h-6 w-6 text-emerald-600" />,
      title: '聯繫人總數',
      value: stats.totalContacts,
      color: 'bg-emerald-100',
    },
    {
      icon: <Zap className="h-6 w-6 text-purple-600" />,
      title: '活躍自動化規則',
      value: stats.activeRules,
      color: 'bg-purple-100',
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <Topbar title="總覽" />
      <div className="flex-1 overflow-auto p-6">
        {/* ---- Statistics cards ---- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((card) => (
            <StatCard
              key={card.title}
              icon={card.icon}
              title={card.title}
              value={card.value}
              isLoading={isLoadingStats}
              color={card.color}
            />
          ))}
        </div>

        {/* ---- Two-column layout for lists ---- */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ---- Recent conversations ---- */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-semibold">最近對話</CardTitle>
              <Link
                href="/dashboard/inbox"
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                查看全部
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              {isLoadingConversations ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <MessageSquare className="mb-2 h-8 w-8" />
                  <p className="text-sm">暫無對話</p>
                </div>
              ) : (
                <ul className="divide-y">
                  {conversations.map((conv) => {
                    const contactName =
                      conv.contact?.displayName ||
                      conv.contact?.name ||
                      '未知聯繫人';
                    const messageText = extractMessageText(conv.lastMessage?.content);
                    const timeStr = conv.lastMessage?.createdAt || conv.updatedAt;

                    return (
                      <li key={conv.id}>
                        <Link
                          href={`/dashboard/inbox?conv=${conv.id}`}
                          className="flex items-start gap-3 px-6 py-3 transition-colors hover:bg-muted/50"
                        >
                          {/* 聯繫人圖示 */}
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <User className="h-4 w-4" />
                          </div>

                          {/* 內容 */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">
                                {contactName}
                              </span>
                              <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {formatRelativeTime(timeStr)}
                              </div>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2">
                              <ChannelBadge channel={conv.channelType} />
                              {(conv.unreadCount ?? 0) > 0 && (
                                <Badge variant="default" className="h-5 min-w-[20px] justify-center px-1.5 text-[10px]">
                                  {(conv.unreadCount ?? 0) > 99
                                    ? '99+'
                                    : conv.unreadCount}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {messageText}
                            </p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ---- Recent cases ---- */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-semibold">最近工單</CardTitle>
              <Link
                href="/dashboard/cases"
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                查看全部
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              {isLoadingCases ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : cases.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Briefcase className="mb-2 h-8 w-8" />
                  <p className="text-sm">暫無工單</p>
                </div>
              ) : (
                <ul className="divide-y">
                  {cases.map((c) => {
                    const assigneeName =
                      c.assignee?.name || c.assignedTo?.name || '未指派';

                    return (
                      <li key={c.id}>
                        <Link
                          href={`/dashboard/cases/${c.id}`}
                          className="flex items-start gap-3 px-6 py-3 transition-colors hover:bg-muted/50"
                        >
                          {/* 工單圖示 */}
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <Briefcase className="h-4 w-4" />
                          </div>

                          {/* 內容 */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">
                                {c.title}
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {formatRelativeTime(c.createdAt)}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <CaseStatusBadge status={c.status} />
                              <CasePriorityBadge priority={c.priority} />
                            </div>
                            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <User className="h-3 w-3" />
                              <span>{assigneeName}</span>
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
