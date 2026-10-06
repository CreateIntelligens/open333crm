"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import {
  MessageSquare,
  Briefcase,
  Users,
  Zap,
  Loader2,
  ArrowRight,
  Clock,
  User,
  RefreshCw,
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChannelBadge } from "@/components/shared/ChannelBadge";
import { CaseStatusBadge } from "@/components/case/CaseStatusBadge";
import { CasePriorityBadge } from "@/components/case/CasePriorityBadge";
import { Separator } from "@/components/ui/separator";
import api from "@/lib/api";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface StatsData {
  unreadConversations: number;
  openCases: number;
  totalContacts: number;
  activeRules: number;
}

type StatKey = keyof StatsData;

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

function extractMessageText(
  content: string | { text?: string } | null | undefined,
): string {
  if (!content) return "尚無訊息";
  if (typeof content === "string") return content;
  return content.text || "尚無訊息";
}

function formatRelativeTime(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), {
      addSuffix: true,
      locale: zhTW,
    });
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------- */
/*  Stat Card Component                                                       */
/* -------------------------------------------------------------------------- */

function RequestError({
  onRetry,
  isLoading,
}: {
  onRetry: () => void;
  isLoading: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 px-6 py-8 text-sm"
    >
      <p className="text-muted-foreground">
        資料載入失敗，請檢查連線後再試一次。
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={isLoading}
        className="inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshCw
          className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
        {isLoading ? "重新載入中" : "重試"}
      </button>
    </div>
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
  const [failedStats, setFailedStats] = useState<Set<StatKey>>(new Set());
  const [conversationsError, setConversationsError] = useState(false);
  const [casesError, setCasesError] = useState(false);

  /* ---- Fetch statistics ---- */
  const fetchStats = useCallback(async () => {
    setIsLoadingStats(true);
    const results = await Promise.allSettled([
      api.get("/conversations", { params: { unread: true, limit: 1 } }),
      api.get("/cases", { params: { status: "OPEN", limit: 1 } }),
      api.get("/contacts", { params: { limit: 1 } }),
      api.get("/automation/rules", { params: { limit: 1 } }),
    ]);
    const keys: StatKey[] = [
      "unreadConversations",
      "openCases",
      "totalContacts",
      "activeRules",
    ];
    const values: Partial<StatsData> = {};
    const failures = new Set<StatKey>();

    results.forEach((result, index) => {
      const key = keys[index];
      if (!key) return;
      if (result.status === "rejected") {
        failures.add(key);
        return;
      }

      const responseData = result.value.data;
      values[key] =
        key === "activeRules"
          ? (responseData?.meta?.total ?? responseData?.data?.length ?? 0)
          : (responseData?.meta?.total ?? 0);
    });

    setStats((current) => ({ ...current, ...values }));
    setFailedStats(failures);
    setIsLoadingStats(false);
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  /* ---- Fetch the unread conversation queue ---- */
  const fetchConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      const res = await api.get("/conversations", {
        params: { unread: true, limit: 5 },
      });
      setConversations(res.data?.data ?? []);
      setConversationsError(false);
    } catch {
      setConversationsError(true);
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  /* ---- Fetch recent cases ---- */
  const fetchCases = useCallback(async () => {
    setIsLoadingCases(true);
    try {
      const res = await api.get("/cases", { params: { limit: 5 } });
      setCases(res.data?.data ?? []);
      setCasesError(false);
    } catch {
      setCasesError(true);
    } finally {
      setIsLoadingCases(false);
    }
  }, []);

  useEffect(() => {
    void fetchCases();
  }, [fetchCases]);

  return (
    <div className="flex h-full flex-col">
      <Topbar title="總覽" />
      <div className="flex-1 overflow-auto p-6">
        <section aria-labelledby="pending-conversations-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2
                id="pending-conversations-title"
                className="text-xl font-semibold tracking-tight"
              >
                待處理對話
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                先回覆未讀訊息，掌握需要跟進的顧客。
              </p>
            </div>
            <Link
              href="/dashboard/inbox"
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              開啟收件匣
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">
                  未讀對話
                </CardTitle>
                {isLoadingStats ? (
                  <Loader2
                    className="h-4 w-4 animate-spin text-muted-foreground"
                    aria-label="載入未讀數量"
                  />
                ) : failedStats.has("unreadConversations") ? (
                  <span className="text-xs text-destructive">數量載入失敗</span>
                ) : (
                  <Badge variant="secondary">{stats.unreadConversations}</Badge>
                )}
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              {conversationsError ? (
                <RequestError
                  onRetry={() => void fetchConversations()}
                  isLoading={isLoadingConversations}
                />
              ) : isLoadingConversations ? (
                <div
                  role="status"
                  aria-label="正在載入待處理對話"
                  className="flex items-center justify-center py-12"
                >
                  <Loader2
                    className="h-6 w-6 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <MessageSquare className="mb-2 h-8 w-8" />
                  <p className="text-sm">目前沒有未讀對話</p>
                  <Link
                    href="/dashboard/inbox"
                    className="mt-2 text-sm font-medium text-primary hover:underline"
                  >
                    前往收件匣
                  </Link>
                </div>
              ) : (
                <ul className="divide-y">
                  {conversations.map((conv) => {
                    const contactName =
                      conv.contact?.displayName ||
                      conv.contact?.name ||
                      "未知聯絡人";
                    const messageText = extractMessageText(
                      conv.lastMessage?.content,
                    );
                    const timeStr =
                      conv.lastMessage?.createdAt || conv.updatedAt;

                    return (
                      <li key={conv.id}>
                        <Link
                          href={`/dashboard/inbox?conv=${conv.id}`}
                          className="flex items-start gap-3 px-6 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          {/* 聯絡人圖示 */}
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
                                <Badge
                                  variant="default"
                                  className="h-5 min-w-[20px] justify-center px-1.5 text-[10px]"
                                >
                                  {(conv.unreadCount ?? 0) > 99
                                    ? "99+"
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
        </section>

        <section aria-label="營運概況" className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            營運概況
          </h2>
          <>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-y py-4 sm:grid-cols-3">
              {[
                {
                  key: "openCases" as const,
                  label: "開啟中工單",
                  value: stats.openCases,
                  icon: <Briefcase className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: "totalContacts" as const,
                  label: "聯絡人總數",
                  value: stats.totalContacts,
                  icon: <Users className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: "activeRules" as const,
                  label: "活躍自動化規則",
                  value: stats.activeRules,
                  icon: <Zap className="h-4 w-4" aria-hidden="true" />,
                },
              ].map((item) => (
                <div key={item.label}>
                  <dt>
                    <span className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground">
                      {item.icon}
                      {item.label}
                    </span>
                  </dt>
                  <dd
                    className="pl-6 text-lg font-semibold tabular-nums"
                    aria-live="polite"
                  >
                    {isLoadingStats ? (
                      <Loader2
                        className="h-4 w-4 animate-spin text-muted-foreground"
                        aria-label="載入中"
                      />
                    ) : failedStats.has(item.key) ? (
                      <span className="text-sm font-normal text-destructive">
                        載入失敗
                      </span>
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {failedStats.size > 0 && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-3 pt-3 text-sm"
              >
                <span className="text-muted-foreground">
                  部分概況無法載入，成功的資料仍可使用。
                </span>
                <button
                  type="button"
                  onClick={() => void fetchStats()}
                  disabled={isLoadingStats}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isLoadingStats ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  {isLoadingStats ? "重新載入中" : "重試統計"}
                </button>
              </div>
            )}
          </>
        </section>

        <section aria-labelledby="recent-cases-title" className="mt-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle
                id="recent-cases-title"
                className="text-base font-semibold"
              >
                最近工單
              </CardTitle>
              <Link
                href="/dashboard/cases"
                className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                查看全部
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              {casesError ? (
                <RequestError
                  onRetry={() => void fetchCases()}
                  isLoading={isLoadingCases}
                />
              ) : isLoadingCases ? (
                <div
                  role="status"
                  aria-label="正在載入工單"
                  className="flex items-center justify-center py-12"
                >
                  <Loader2
                    className="h-6 w-6 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
              ) : cases.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Briefcase className="mb-2 h-8 w-8" aria-hidden="true" />
                  <p className="text-sm">目前沒有工單</p>
                  <Link
                    href="/dashboard/cases"
                    className="mt-2 text-sm font-medium text-primary hover:underline"
                  >
                    前往工單
                  </Link>
                </div>
              ) : (
                <ul className="divide-y">
                  {cases.map((c) => {
                    const assigneeName =
                      c.assignee?.name || c.assignedTo?.name || "未指派";
                    return (
                      <li key={c.id}>
                        <Link
                          href={`/dashboard/cases/${c.id}`}
                          className="flex items-start gap-3 px-6 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <Briefcase className="h-4 w-4" aria-hidden="true" />
                          </div>
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
                              <User className="h-3 w-3" aria-hidden="true" />
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
        </section>
      </div>
    </div>
  );
}
