'use client';

import React, { useState, useMemo } from 'react';
import { useConversations } from '@/hooks/useConversations';
import { useAuth } from '@/providers/AuthProvider';
import { ConversationListItem } from './ConversationListItem';
import { FilterDrawer, type FilterValues } from './FilterDrawer';
import { SearchInput } from '@/components/shared/SearchInput';
import { EmptyState } from '@/components/shared/EmptyState';
import { MessageSquare, Loader2, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConversationListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type TabValue = 'all' | 'active' | 'bot' | 'closed';

const TAB_CONFIG: Record<TabValue, { label: string; statusFilter?: string; excludeStatus?: boolean }> = {
  all: { label: '全部' },
  active: { label: '進行中', statusFilter: 'ACTIVE,AGENT_HANDLED' },
  bot: { label: 'Bot', statusFilter: 'BOT_HANDLED' },
  closed: { label: '已關', statusFilter: 'CLOSED' },
};

export function ConversationList({ selectedId, onSelect }: ConversationListProps) {
  const [activeTab, setActiveTab] = useState<TabValue>('all');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValues, setFilterValues] = useState<FilterValues>({
    statuses: [],
    channels: [],
    assignee: '',
  });
  const { agent } = useAuth();

  const apiFilters = useMemo(() => {
    const f: Record<string, string | undefined> = {};
    const tabConfig = TAB_CONFIG[activeTab];

    if (tabConfig.statusFilter) {
      f.status = tabConfig.statusFilter;
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
  }, [activeTab, filterValues, agent?.id]);

  const { conversations, isLoading } = useConversations(apiFilters);

  let filtered = conversations;
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

  const tabCounts = useMemo(() => {
    const counts: Record<TabValue, number> = { all: 0, active: 0, bot: 0, closed: 0 };
    conversations.forEach((c: { status: string }) => {
      if (c.status === 'CLOSED') counts.closed++;
      else if (c.status === 'BOT_HANDLED') counts.bot++;
      else if (c.status === 'ACTIVE' || c.status === 'AGENT_HANDLED') counts.active++;
    });
    counts.all = conversations.length;
    return counts;
  }, [conversations]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">收件匣</h2>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setFilterOpen(true)}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#f3f4f6] px-3 py-2">
          <SearchInput
            placeholder="搜尋對話..."
            onSearch={setSearch}
          />
        </div>

        <div className="mt-3 flex items-center gap-1 border-b border-gray-200">
          {(Object.keys(TAB_CONFIG) as TabValue[]).map((tab) => {
            const config = TAB_CONFIG[tab];
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative flex items-center gap-1 px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'text-[#cb74c1]' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {config.label}
                <span className={`text-xs ${isActive ? 'text-[#cb74c1]' : 'text-muted-foreground'}`}>
                  {tabCounts[tab]}
                </span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#cb74c1]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-10 w-10" />}
            title="沒有對話"
            description="新對話將會顯示在這裡"
          />
        ) : (
          <div className="space-y-0.5 p-2">
            {filtered.map((conversation: { id: string; contact?: { id: string; name?: string; displayName?: string; avatar?: string; avatarUrl?: string }; channelType: string; lastMessage?: { content: string | { text?: string }; contentType?: string; createdAt: string; senderType?: string }; unreadCount?: number; status: string; updatedAt: string; assignedToId?: string | null; caseId?: string | null; csatScore?: number | null }) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                isSelected={selectedId === conversation.id}
                onClick={() => onSelect(conversation.id)}
                showCsat={activeTab === 'closed'}
              />
            ))}
          </div>
        )}
      </div>

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
