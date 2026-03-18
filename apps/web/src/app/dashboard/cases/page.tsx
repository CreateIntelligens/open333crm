'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCases, useCaseStats } from '@/hooks/useCases';
import { CaseList } from '@/components/case/CaseList';
import { CaseDashboardStats } from '@/components/case/CaseDashboardStats';
import { CaseCreateModal } from '@/components/case/CaseCreateModal';
import { Topbar } from '@/components/layout/Topbar';
import { SearchInput } from '@/components/shared/SearchInput';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import api from '@/lib/api';

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
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [slaFilter, setSlaFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    api.get('/agents').then((res) => setAgents(res.data.data || [])).catch(() => {});
  }, []);

  const { stats } = useCaseStats();
  const statusCounts = (stats as Record<string, unknown>).statusCounts as Record<string, number> | undefined;

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, priorityFilter, categoryFilter, assigneeFilter, slaFilter]);

  const { cases, meta, isLoading } = useCases({
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

  return (
    <div className="flex h-full flex-col">
      <Topbar title="工單">
        <Button size="sm" onClick={() => setShowCreateModal(true)}>
          <Plus className="mr-1 h-4 w-4" />
          建立案件
        </Button>
      </Topbar>

      {/* Dashboard Stats */}
      <div className="border-b px-6 py-4">
        <CaseDashboardStats />
      </div>

      {/* Search + Filters */}
      <div className="border-b px-6 py-3 space-y-3">
        <SearchInput
          placeholder="搜尋工單標題或描述...（至少 2 個字）"
          onSearch={setSearch}
          className="max-w-sm"
        />
        <div className="flex flex-wrap gap-2">
          <Select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            options={[
              { value: '', label: '所有負責人' },
              ...agents.map((a) => ({ value: a.id, label: a.name })),
            ]}
            className="w-36"
          />
          <Select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            options={[
              { value: '', label: '所有優先級' },
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
            options={[
              { value: '', label: '所有分類' },
              { value: '維修', label: '維修' },
              { value: '查詢', label: '查詢' },
              { value: '投訴', label: '投訴' },
              { value: '其他', label: '其他' },
            ]}
            className="w-32"
          />
          <Select
            value={slaFilter}
            onChange={(e) => setSlaFilter(e.target.value)}
            options={[
              { value: '', label: '所有 SLA' },
              { value: 'breached', label: 'SLA 違規' },
              { value: 'warning', label: '即將到期' },
              { value: 'normal', label: '正常' },
            ]}
            className="w-32"
          />
        </div>
      </div>

      {/* Status Tabs */}
      <div className="border-b px-6 pt-2">
        <Tabs value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <TabsList>
            {statusTabs.map((tab) => {
              const count = getTabCount(tab.value);
              return (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                  {count !== undefined && count > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">({count})</span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      {/* Case List */}
      <div className="flex-1 overflow-auto">
        <CaseList cases={filteredCases} isLoading={isLoading} />
      </div>

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="border-t px-6 py-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            第 {rangeStart}-{rangeEnd} / 共 {totalCount} 筆
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2 text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create Modal (standalone mode - no conversation) */}
      <CaseCreateModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
      />
    </div>
  );
}
