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
    const f: Record<string, string | undefined> = {};

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

    return f;
  }, [mainTab, filterValues, closedRange, agent?.id]);

  const { conversations, isLoading, markConversationRead } = useConversations(apiFilters, {
    selectedId,
  });

  const handleSelectConversation = (conversation: ConversationRow) => {
    if ((conversation.unreadCount ?? 0) > 0) {
      markConversationRead(conversation.id);
    }

    onSelect(conversation.id);
  };

  // Client-side filter for sub-tabs and search
  let filtered = conversations;
  if (mainTab === 'active') {
    if (subTab === 'unread') {
      filtered = filtered.filter(
        (c: { unreadCount?: number }) => (c.unreadCount || 0) > 0
      );
    }
    if (subTab === 'mine') {
      filtered = filtered.filter(
        (c: { assignedToId?: string | null }) => c.assignedToId === agent?.id
      );
    }
  }
  if (search) {
    const lowerSearch = search.toLowerCase();
    filtered = filtered.filter(
      (c: ConversationRow) => {
        const contactName = c.contact?.name || c.contact?.displayName || '';
        const rawContent = c.lastMessage?.content;
        const msgText = typeof rawContent === 'object' && rawContent !== null
          ? (rawContent as { text?: string }).text || ''
          : String(rawContent || '');
        return contactName.toLowerCase().includes(lowerSearch) ||
          msgText.toLowerCase().includes(lowerSearch);
      }
    );
  }

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

        {/* Sub-tabs for active：快速篩選 */}
        {mainTab === 'active' && (
          <Tabs value={subTab} onValueChange={setSubTab}>
            <TabsList className="w-full">
              <TabsTrigger value="all" className="flex-1">全部</TabsTrigger>
              <TabsTrigger value="unread" className="flex-1">未讀</TabsTrigger>
              <TabsTrigger value="mine" className="flex-1">我的</TabsTrigger>
            </TabsList>
          </Tabs>
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
        resultCount={filtered.length}
      />

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-10 w-10" />}
            title="沒有對話"
            description={mainTab === 'closed' ? '此時間範圍內沒有已關閉的對話' : '新對話將會顯示在這裡'}
          />
        ) : (
          <div>
            {filtered.map((conversation: ConversationRow) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                isSelected={selectedId === conversation.id}
                onClick={() => handleSelectConversation(conversation)}
                showCsat={mainTab === 'closed'}
              />
            ))}
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
