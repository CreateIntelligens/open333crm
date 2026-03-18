'use client';

import React, { useState, useMemo } from 'react';
import { useConversations } from '@/hooks/useConversations';
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

  const { conversations, isLoading } = useConversations(apiFilters);

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
      (c: { contact?: { name?: string; displayName?: string }; lastMessage?: { content: string | { text?: string } } }) => {
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
      {/* Header */}
      <div className="border-b px-4 py-3">
        <h2 className="text-lg font-semibold">收件匣</h2>

        {/* Main tabs: Active / Closed */}
        <div className="mt-2">
          <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as 'active' | 'closed')}>
            <TabsList className="w-full">
              <TabsTrigger value="active" className="flex-1">進行中</TabsTrigger>
              <TabsTrigger value="closed" className="flex-1">已關閉</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Search + Filter */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1">
            <SearchInput
              placeholder="搜尋對話..."
              onSearch={setSearch}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => setFilterOpen(true)}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>

        {/* Sub-tabs for active */}
        {mainTab === 'active' && (
          <div className="mt-2">
            <Tabs value={subTab} onValueChange={setSubTab}>
              <TabsList className="w-full">
                <TabsTrigger value="all">全部</TabsTrigger>
                <TabsTrigger value="unread">未讀</TabsTrigger>
                <TabsTrigger value="mine">我的</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}

        {/* Closed range selector */}
        {mainTab === 'closed' && (
          <div className="mt-2">
            <select
              value={closedRange}
              onChange={(e) => setClosedRange(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="7">最近 7 天</option>
              <option value="30">最近 30 天</option>
              <option value="90">最近 90 天</option>
            </select>
          </div>
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
          <div className="space-y-0.5 p-2">
            {filtered.map((conversation: { id: string; contact?: { id: string; name?: string; displayName?: string; avatar?: string; avatarUrl?: string }; channelType: string; lastMessage?: { content: string | { text?: string }; contentType?: string; createdAt: string; senderType?: string }; unreadCount?: number; status: string; updatedAt: string; assignedToId?: string | null; caseId?: string | null; csatScore?: number | null }) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                isSelected={selectedId === conversation.id}
                onClick={() => onSelect(conversation.id)}
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
