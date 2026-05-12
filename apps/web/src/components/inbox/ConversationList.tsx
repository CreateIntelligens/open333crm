'use client';

import React, { useState, useMemo } from 'react';
import { useConversations } from '@/hooks/useConversations';
import { useAuth } from '@/providers/AuthProvider';
import { ConversationListItem } from './ConversationListItem';
import { FilterDrawer, type FilterValues } from './FilterDrawer';
import { FilterChips } from './FilterChips';
import { EmptyState } from '@/components/shared/EmptyState';
import { MessageSquare, Loader2, Search, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConversationListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({ selectedId, onSelect }: ConversationListProps) {
  const [mainTab, setMainTab] = useState<'active' | 'closed'>('active');
  const [subTab, setSubTab] = useState<'all' | 'unread' | 'mine'>('all');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValues, setFilterValues] = useState<FilterValues>({
    statuses: [],
    channels: [],
    assignee: '',
  });
  const [closedRange, setClosedRange] = useState('30');
  const { agent } = useAuth();

  const apiFilters = useMemo(() => {
    const f: Record<string, string | undefined> = {};
    if (mainTab === 'closed') {
      f.status = 'CLOSED';
      const days = parseInt(closedRange, 10);
      const date = new Date();
      date.setDate(date.getDate() - days);
      f.closedAfter = date.toISOString();
    } else {
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

  let filtered = conversations;
  if (mainTab === 'active') {
    if (subTab === 'unread') {
      filtered = filtered.filter((c: { unreadCount?: number }) => (c.unreadCount || 0) > 0);
    }
    if (subTab === 'mine') {
      filtered = filtered.filter((c: { assignedToId?: string | null }) => c.assignedToId === agent?.id);
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
        return contactName.toLowerCase().includes(lowerSearch) || msgText.toLowerCase().includes(lowerSearch);
      },
    );
  }

  const totalCount = conversations.length;
  const unreadCount = conversations.filter((c: { unreadCount?: number }) => (c.unreadCount || 0) > 0).length;
  const myCount = conversations.filter((c: { assignedToId?: string | null }) => c.assignedToId === agent?.id).length;

  const subTabs: Array<{ key: 'all' | 'unread' | 'mine'; label: string; count: number }> = [
    { key: 'all', label: '全部', count: totalCount },
    { key: 'unread', label: '未讀', count: unreadCount },
    { key: 'mine', label: '我的', count: myCount },
  ];

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-white">
      {/* Sidebar Header — column gap 12, padding 16/16/0/16, shadow 0 1 4 */}
      <div className="flex flex-col gap-3 border-b border-surface-line px-4 pb-0 pt-4 shadow-[0_1px_4px_0_rgba(0,0,0,0.05)]">
        {/* Title row: 收件匣 + Filter button */}
        <div className="flex items-center justify-between gap-8">
          <h2 className="text-[20px] font-semibold leading-6 text-ink">收件匣</h2>
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] text-ink-subtle transition-colors hover:bg-neutral-20 hover:text-ink"
            aria-label="進階篩選"
            title="進階篩選"
          >
            <SlidersHorizontal className="h-5 w-5" />
          </button>
        </div>

        {/* Segmented Control: 進行中 / 已關閉 */}
        <div className="flex items-center gap-1 rounded-lg bg-surface-canvas p-1">
          {(['active', 'closed'] as const).map((key) => {
            const isActive = mainTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setMainTab(key)}
                className={cn(
                  'flex flex-1 items-center justify-center rounded-lg px-4 py-1 text-[14px] leading-5 text-ink transition',
                  isActive
                    ? 'bg-white font-semibold shadow-[0_0_4px_0_rgba(0,0,0,0.1)]'
                    : 'font-normal hover:bg-white/50',
                )}
              >
                {key === 'active' ? '進行中' : '已關閉'}
              </button>
            );
          })}
        </div>

        {/* Search bar */}
        <div className="flex items-center gap-1 rounded-lg border border-surface-line bg-surface-canvas px-3 py-2">
          <Search className="h-5 w-5 shrink-0 text-ink-subtle" strokeWidth={1.5} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋對話 ..."
            className="flex-1 bg-transparent text-[14px] leading-6 text-ink placeholder:text-ink-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-link/40 focus-visible:ring-offset-1"
          />
        </div>

        {/* Sub Tabs (only for active) */}
        {mainTab === 'active' && (
          <div className="flex items-center">
            {subTabs.map((tab) => {
              const isActive = subTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSubTab(tab.key)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 px-3 py-3 text-[14px] leading-5 transition-colors',
                    isActive
                      ? 'border-b-2 border-[#378ADD] font-semibold text-[#378ADD]'
                      : 'border-b-2 border-transparent font-medium text-ink-subtle hover:text-ink',
                  )}
                >
                  <span>{tab.label}</span>
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-[20px] items-center justify-center rounded-2xl px-2 text-[12px] font-semibold leading-5',
                      isActive ? 'bg-[#378ADD] text-white' : 'bg-surface-line text-ink-subtle',
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Closed range selector */}
        {mainTab === 'closed' && (
          <div className="pb-3">
            <select
              value={closedRange}
              onChange={(e) => setClosedRange(e.target.value)}
              className="w-full rounded-lg border border-surface-line bg-white px-3 py-2 text-[14px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-link/40 focus-visible:ring-offset-1"
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

      {/* List Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-ink-subtle" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-10 w-10" />}
            title="沒有對話"
            description={mainTab === 'closed' ? '此時間範圍內沒有已關閉的對話' : '新對話將會顯示在這裡'}
          />
        ) : (
          <div className="flex flex-col">
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
