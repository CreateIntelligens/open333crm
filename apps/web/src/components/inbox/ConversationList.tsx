'use client';

import React, { useState, useMemo } from 'react';
import { useConversations, type ConversationRow } from '@/hooks/useConversations';
import { useAuth } from '@/providers/AuthProvider';
import { ConversationListItem } from './ConversationListItem';
import { FilterDrawer, type FilterValues } from './FilterDrawer';
import { FilterChips } from './FilterChips';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchInput } from '@/components/shared/SearchInput';
import { EmptyState } from '@/components/shared/EmptyState';
import { MessageSquare, Loader2, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';

interface ConversationListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({ selectedId, onSelect }: ConversationListProps) {
  const [mainTab, setMainTab] = useState<'active' | 'closed'>('active');
  const [subTab, setSubTab] = useState('all');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValues, setFilterValues] = useState<FilterValues>({
    statuses: [],
    channels: [],
    assignee: '',
  });
  const [closedRange, setClosedRange] = useState('30'); // days
  const { agent } = useAuth();

  // Build API filters
  const apiFilters = useMemo(() => {
    const f: { status?: string; channelType?: string; assigneeId?: string; closedAfter?: string; unread?: boolean; search?: string } = {};

    if (mainTab === 'closed') {
      f.status = 'CLOSED';
      const days = parseInt(closedRange, 10);
      const date = new Date();
      date.setDate(date.getDate() - days);
      f.closedAfter = date.toISOString();
    } else {
      // Active tab: default to non-closed unless filters override
      if (filterValues.statuses.length > 0) {
        f.status = filterValues.statuses.join(',');
      } else {
        f.status = '!CLOSED';
      }
    }

    if (filterValues.channels.length > 0) {
      f.channelType = filterValues.channels.join(',');
    }

    if (filterValues.assignee === 'mine' && agent?.id) {
      f.assigneeId = agent.id;
    } else if (filterValues.assignee === 'unassigned') {
      f.assigneeId = 'unassigned';
    }

    // 「未讀」「我的」交給後端篩選，不只過濾已載入的資料（#422）；
    // 「我的」覆蓋進階篩選的負責人（design D4）
    if (mainTab === 'active' && subTab === 'unread') {
      f.unread = true;
    }
    if (mainTab === 'active' && subTab === 'mine' && agent?.id) {
      f.assigneeId = agent.id;
    }

    const keyword = search.trim();
    if (keyword) f.search = keyword;

    return f;
  }, [mainTab, subTab, search, filterValues, closedRange, agent?.id]);

  const {
    conversations,
    total,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    loadMore,
    mutate,
    markConversationRead,
  } = useConversations(apiFilters, { selectedId });

  const handleSelectConversation = (conversation: ConversationRow) => {
    if ((conversation.unreadCount ?? 0) > 0) {
      markConversationRead(conversation.id);
    }

    onSelect(conversation.id);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header：版面依 Claude Design「收件匣 v4」— 標題列＋進階篩選、狀態分頁、搜尋、快速篩選；依 Figma 微調 */}
      <div className="flex flex-none flex-col gap-3 border-b border-border px-[18px] pb-3.5 pt-5">
        <div className="flex items-center gap-2.5">
          <h2 className="flex-1 text-lg font-bold leading-[26px] text-foreground">收件匣</h2>
          <Button
            variant="subtle"
            size="icon-sm"
            onClick={() => setFilterOpen(true)}
            aria-label="進階篩選"
            title="進階篩選"
          >
            <SlidersHorizontal />
          </Button>
        </div>

        {/* Main tabs: Active / Closed */}
        <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as 'active' | 'closed')}>
          <TabsList className="w-full">
            <TabsTrigger value="active" className="flex-1">進行中</TabsTrigger>
            <TabsTrigger value="closed" className="flex-1">已關閉</TabsTrigger>
          </TabsList>
        </Tabs>

        <SearchInput placeholder="搜尋對話、聯繫人" onSearch={setSearch} />

        {/* 快速篩選：Claude Design 為膠囊按鈕附數量。
            篩選改由後端處理（#422，取自 main），只知道目前篩選的總數，所以只在選中的膠囊顯示數量 */}
        {mainTab === 'active' && (
          <div role="group" aria-label="快速篩選" className="flex flex-wrap items-center gap-2">
            {([
              ['all', '全部'],
              ['unread', '未讀'],
              ['mine', '我的'],
            ] as const).map(([value, label]) => (
              <Chip
                key={value}
                size="lg"
                tone={subTab === value ? 'primary' : 'outline'}
                selected={subTab === value}
                onClick={() => setSubTab(value)}
              >
                {label}
                {subTab === value && total != null && <span className="ml-1 text-white/80">{total}</span>}
              </Chip>
            ))}
          </div>
        )}

        {/* Closed range selector */}
        {mainTab === 'closed' && (
          <select
            value={closedRange}
            onChange={(e) => setClosedRange(e.target.value)}
            aria-label="關閉時間範圍"
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-muted px-3 text-sm font-medium text-foreground focus-visible:border-primary focus-visible:outline-none"
          >
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
            <option value="90">最近 90 天</option>
          </select>
        )}
      </div>

      {/* Filter Chips */}
      <FilterChips
        filters={filterValues}
        onChange={setFilterValues}
        resultCount={total ?? conversations.length}
      />

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error && conversations.length === 0 ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <p className="text-sm font-medium text-destructive">對話列表載入失敗</p>
            <p className="text-xs text-muted-foreground">請檢查網路連線後再試一次</p>
            <Button variant="outline" size="sm" onClick={() => void mutate()}>
              重試
            </Button>
          </div>
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-10 w-10" />}
            title="沒有對話"
            description={
              search.trim()
                ? '沒有符合搜尋的對話'
                : mainTab === 'closed'
                  ? '此時間範圍內沒有已關閉的對話'
                  : '新對話將會顯示在這裡'
            }
          />
        ) : (
          <div>
            {conversations.map((conversation: ConversationRow) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                isSelected={selectedId === conversation.id}
                onClick={() => handleSelectConversation(conversation)}
                showCsat={mainTab === 'closed'}
              />
            ))}
            {error && (
              <div role="alert" className="flex items-center justify-center gap-2 px-2 py-2 text-xs text-destructive">
                <span>對話列表載入失敗</span>
                <Button variant="outline" size="sm" onClick={() => (hasMore ? loadMore() : void mutate())}>
                  重試
                </Button>
              </div>
            )}
            {hasMore && !error && (
              <div className="flex justify-center py-2">
                <Button variant="ghost" size="sm" onClick={loadMore} disabled={isLoadingMore}>
                  {isLoadingMore && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  載入更多對話
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filter Drawer */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        values={filterValues}
        onChange={setFilterValues}
        agentId={agent?.id}
      />
    </div>
  );
}
