'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useCases, useCaseStats } from '@/hooks/useCases';
import { CaseList } from '@/components/case/CaseList';
import { CaseCreateModal } from '@/components/case/CaseCreateModal';
import { CaseDashboardStats } from '@/components/case/CaseDashboardStats';
import { Topbar } from '@/components/layout/Topbar';
import { Pagination } from '@/components/shared/Pagination';
import { AddIcon } from '@/components/icons/figma-icons';
import { SearchInput } from '@/components/shared/SearchInput';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import api from '@/lib/api';
import { CASE_CATEGORIES } from '@open333crm/shared';

const PAGE_SIZE = 20;

const statusTabs = [
  { value: 'all', label: '全部' },
  { value: 'OPEN', label: '開啟' },
  { value: 'IN_PROGRESS', label: '處理中' },
  { value: 'PENDING', label: '待處理' },
  { value: 'ESCALATED', label: '已升級' },
  { value: 'RESOLVED', label: '已解決' },
  { value: 'CLOSED', label: '已關閉' },
];

export default function CasesPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [slaFilter, setSlaFilter] = useState('');
  const [page, setPage] = useState(1);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [deletingCaseId, setDeletingCaseId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    api.get('/agents').then((res) => setAgents(res.data.data || [])).catch(() => {});
  }, []);

  const { stats, mutate: mutateStats } = useCaseStats();
  const statusCounts = (stats as Record<string, unknown>).statusCounts as Record<string, number> | undefined;

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, priorityFilter, categoryFilter, assigneeFilter, slaFilter]);

  const { cases, meta, isLoading, mutate: mutateCases } = useCases({
    status: statusFilter === 'all' ? undefined : statusFilter,
    priority: priorityFilter || undefined,
    category: categoryFilter || undefined,
    assigneeId: assigneeFilter || undefined,
    slaStatus: (slaFilter || undefined) as 'normal' | 'warning' | 'breached' | undefined,
    sortBy: 'slaDueAt',
    sortOrder: 'asc',
    page,
    limit: PAGE_SIZE,
  });

  // Client-side search filter (only filter if >= 2 chars)
  const filteredCases = useMemo(() => {
    const trimmed = search.trim();
    if (trimmed.length < 2) return cases;
    const keyword = trimmed.toLowerCase();
    return cases.filter(
      (c: { title?: string; description?: string }) =>
        c.title?.toLowerCase().includes(keyword) ||
        c.description?.toLowerCase().includes(keyword)
    );
  }, [cases, search]);

  const totalCount = meta?.total ?? cases.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const rangeStart = (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, totalCount);

  // Compute tab count label
  const getTabCount = (tabValue: string): number | undefined => {
    if (!statusCounts) return undefined;
    if (tabValue === 'all') {
      return Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
    }
    return statusCounts[tabValue];
  };

  const handleDeleteCase = async (caseId: string) => {
    setDeletingCaseId(caseId);
    setDeleteError('');
    try {
      await api.delete(`/cases/${caseId}`);
      await Promise.all([mutateCases(), mutateStats()]);
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setDeleteError(axiosError.response?.data?.message || '刪除工單失敗');
    } finally {
      setDeletingCaseId(null);
    }
  };

  // 搜尋框的文字由 SearchInput 自己管理，清除篩選只清下拉選單
  const hasFilters = Boolean(priorityFilter || categoryFilter || assigneeFilter || slaFilter);
  const clearFilters = () => {
    setPriorityFilter(''); setCategoryFilter(''); setAssigneeFilter(''); setSlaFilter(''); setPage(1);
  };
  const activeStat = slaFilter === 'breached' ? 'breached' : slaFilter === 'warning' ? 'warning' : null;

  // 版面依 Claude Design「工單管理」：標題列＋建立工單、統計卡（可點擊篩選）、搜尋與篩選、狀態分頁、列表、分頁
  return (
    <div className="flex h-full flex-col">
      <Topbar title="工單" description="追蹤所有服務工單的處理進度與 SLA 達成狀況">
        {/* 建立入口：原本 CaseCreateModal 只掛在收件匣的聯絡人面板，導致無法開立「不來自對話」的工單 */}
        <Button size="lg" className="w-[140px]" onClick={() => setCreateOpen(true)}>
          <AddIcon />
          建立工單
        </Button>
      </Topbar>

      <div className="flex flex-1 flex-col gap-5 overflow-auto px-8 pb-8">
        <CaseDashboardStats
          active={activeStat}
          onSelect={(key) => {
            setStatusFilter('all');
            setSlaFilter(key === 'breached' ? 'breached' : key === 'warning' ? 'warning' : '');
            setPage(1);
          }}
        />

        {/* 搜尋與篩選 */}
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput placeholder="搜尋工單標題或描述（至少 2 個字）" onSearch={setSearch} className="w-[320px]" />
          <Select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            aria-label="負責人"
            options={[{ value: '', label: '全部負責人' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]}
            className="w-36"
          />
          <Select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            aria-label="優先級"
            options={[
              { value: '', label: '全部優先級' },
              { value: 'URGENT', label: '緊急' },
              { value: 'HIGH', label: '高' },
              { value: 'MEDIUM', label: '中' },
              { value: 'LOW', label: '低' },
            ]}
            className="w-32"
          />
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="分類"
            options={[{ value: '', label: '全部分類' }, ...CASE_CATEGORIES.map((c) => ({ value: c, label: c }))]}
            className="w-32"
          />
          <Select
            value={slaFilter}
            onChange={(e) => setSlaFilter(e.target.value)}
            aria-label="SLA"
            options={[
              { value: '', label: '全部 SLA' },
              { value: 'breached', label: '已違規' },
              { value: 'warning', label: '即將到期' },
              { value: 'normal', label: '正常' },
            ]}
            className="w-32"
          />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>清除篩選</Button>
          )}
        </div>

        {/* 狀態分頁（附數量） */}
        <Tabs value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <TabsList className="w-fit">
            {statusTabs.map((tab) => {
              const count = getTabCount(tab.value);
              return (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                  {count !== undefined && <span className="font-mono text-xs text-muted-foreground">{count}</span>}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {deleteError && (
          <div role="alert" className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-destructive">
            {deleteError}
          </div>
        )}

        <CaseList
          cases={filteredCases}
          isLoading={isLoading}
          onDelete={handleDeleteCase}
          deletingCaseId={deletingCaseId}
        />

        {totalCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-7 pl-3">
            <span className="text-base font-medium text-muted-foreground">
              顯示 {rangeStart}-{rangeEnd}，共 {totalCount} 張工單
            </span>
            {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
          </div>
        )}
      </div>

      {/* 不帶 conversationId：視窗會走「獨立建單」分支，
          顯示聯絡人搜尋與「建立新聯絡人」選項（收件匣模式則是 prefill + disabled）。
          建立成功後視窗自己會導向該工單詳情頁。 */}
      <CaseCreateModal
        asPage
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          // 關閉時重整列表與統計卡：使用者可能建完又返回列表
          if (!open) {
            mutateCases();
            mutateStats();
          }
        }}
      />
    </div>
  );
}
