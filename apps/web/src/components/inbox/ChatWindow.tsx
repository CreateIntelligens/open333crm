'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, Lightbulb } from 'lucide-react';
import useSWR, { mutate as globalMutate } from 'swr';
import { useMessages } from '@/hooks/useMessages';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { StatusBanner } from './StatusBanner';
import { TemplatePicker } from './TemplatePicker';
import { TypingIndicator } from './TypingIndicator';
import { CsatMessage } from './CsatMessage';
import { ChannelBadge } from '@/components/shared/ChannelBadge';
import { EmptyState } from '@/components/shared/EmptyState';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { MessageSquare } from 'lucide-react';
import { AiSuggestPanel } from './AiSuggestPanel';

interface ChatWindowProps {
  conversation: {
    id: string;
    contact?: {
      id: string;
      name?: string;
      displayName?: string;
      avatar?: string;
      avatarUrl?: string;
    };
    channelType: string;
    status: string;
    assignedToId?: string | null;
    createdAt?: string;
    updatedAt?: string;
  } | null;
  showAiSuggest?: boolean;
  onAiSuggestToggle?: () => void;
}

export function ChatWindow({ conversation, showAiSuggest, onAiSuggestToggle }: ChatWindowProps) {
  const { messages, isLoading, sendMessage } = useMessages(
    conversation?.id || null
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateText, setTemplateText] = useState<string | null>(null);

  // Agent list
  const { data: agentsData } = useSWR('/agents', (url: string) =>
    api.get(url).then((res) => res.data.data)
  );
  const agents: { id: string; name: string }[] = agentsData || [];

  const agentOptions = [
    { value: '', label: '未指派' },
    ...agents.map((a) => ({ value: a.id, label: a.name })),
  ];

  const statusOptions = [
    { value: 'ACTIVE', label: '進行中' },
    { value: 'AGENT_HANDLED', label: '已處理' },
    { value: 'CLOSED', label: '已關閉' },
  ];

  const handleAssign = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!conversation) { return; }
    const value = e.target.value || null;
    await api.patch(`/conversations/${conversation.id}`, { assignedToId: value });
    globalMutate(`/conversations/${conversation.id}`);
  };

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!conversation) { return; }
    await api.patch(`/conversations/${conversation.id}`, { status: e.target.value });
    globalMutate(`/conversations/${conversation.id}`);
  };

  const handleReopen = async () => {
    if (!conversation) { return; }
    await api.patch(`/conversations/${conversation.id}`, { status: 'ACTIVE' });
    globalMutate(`/conversations/${conversation.id}`);
  };

  const handleTakeover = async () => {
    if (!conversation) { return; }
    try {
      await api.post(`/conversations/${conversation.id}/handoff`, {});
      globalMutate(`/conversations/${conversation.id}`);
    } catch (err) {
      console.error('Handoff failed:', err);
    }
  };

  const handleSend = useCallback(async (content: string, contentType?: string, contentData?: Record<string, unknown>) => {
    if (contentType === 'image' || contentType === 'file') {
      await sendMessage(JSON.stringify({ url: contentData?.url, fileName: contentData?.fileName }), contentType);
    } else {
      await sendMessage(content);
    }
  }, [sendMessage]);

  const handleTemplateSelect = (text: string) => {
    setTemplateText(text);
  };

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Clear template text after it's consumed
  useEffect(() => {
    if (templateText !== null) {
      setTemplateText(null);
    }
  }, [templateText]);

  if (!conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <EmptyState
          icon={<MessageSquare className="h-16 w-16" />}
          title="選擇對話"
          description="從左側面板選擇一個對話開始傳訊"
        />
      </div>
    );
  }

  const isBotHandled = conversation.status === 'BOT_HANDLED';
  const isClosed = conversation.status === 'CLOSED';

  const statusColor: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-700',
    BOT_HANDLED: 'bg-purple-100 text-purple-700',
    AGENT_HANDLED: 'bg-blue-100 text-blue-700',
    CLOSED: 'bg-gray-100 text-gray-700',
  };

  const statusLabel: Record<string, string> = {
    ACTIVE: '進行中',
    BOT_HANDLED: 'Bot 處理中',
    AGENT_HANDLED: '已處理',
    CLOSED: '已關閉',
  };

  const sortedMessages = [...messages].sort(
    (a: { createdAt: string }, b: { createdAt: string }) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const timeAgo = (() => {
  const ts = conversation.updatedAt || conversation.createdAt || new Date().toISOString();
  const diff = Date.now() - new Date(ts).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes}分鐘前`;
  if (hours < 24) return `${hours}小時前`;
  return `${days}天前`;
})();

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="flex flex-1 items-center gap-2">
          <h3 className="font-semibold text-[#1e2939]">
            {conversation.contact?.name || conversation.contact?.displayName || '未知聯繫人'}
          </h3>
          <ChannelBadge channel={conversation.channelType} />
          <span className="text-xs text-muted-foreground">{timeAgo}</span>
        </div>
        {!isClosed && (
          <Button
            variant={showAiSuggest ? 'default' : 'ghost'}
            size="icon"
            className="h-8 w-8"
            onClick={onAiSuggestToggle}
            title="AI 建議回覆"
          >
            <Lightbulb className="h-4 w-4" />
          </Button>
        )}
      </div>

      <StatusBanner
        status={conversation.status}
        onReopen={handleReopen}
        onTakeover={handleTakeover}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-muted/30">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sortedMessages.length === 0 ? (
          <EmptyState
            title="尚無訊息"
            description="傳送訊息開始對話"
            className="h-full"
          />
        ) : (
          <div className="py-4">
            {sortedMessages.map((msg: { id: string; direction: string; contentType: string; content: string | { text?: string }; senderType?: string; senderName?: string; createdAt: string; metadata?: Record<string, unknown> }) => {
              // Render CSAT survey card for csat messages
              if (msg.contentType === 'csat') {
                const score = typeof msg.metadata?.csatScore === 'number' ? msg.metadata.csatScore : undefined;
                const msgContent = typeof msg.content === 'object' ? msg.content : {};
                const csatCaseId = (msg.metadata?.caseId as string) || (msgContent as Record<string, unknown>).caseId as string | undefined;
                return <CsatMessage key={msg.id} score={score} readonly={isClosed || !!score} caseId={csatCaseId} />;
              }
              return <MessageBubble key={msg.id} message={msg} />;
            })}
            {conversation && (
              <TypingIndicator conversationId={conversation.id} />
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {showAiSuggest && conversation && (
        <AiSuggestPanel
          open={showAiSuggest}
          onClose={onAiSuggestToggle || (() => {})}
          conversationId={conversation.id}
          onAdopt={(text) => {
            onAiSuggestToggle?.();
            window.dispatchEvent(new CustomEvent('ai-adopt', { detail: { text } }));
          }}
        />
      )}

      {/* Message Input */}
      <MessageInput
        onSend={handleSend}
        conversationId={conversation.id}
        channelType={conversation.channelType}
        disabled={isClosed}
        disabledReason={isClosed ? '對話已關閉，無法回覆' : undefined}
        isBotHandled={isBotHandled}
        onTakeover={handleTakeover}
        onOpenTemplates={() => setTemplatePickerOpen(true)}
      />

      {/* Template Picker */}
      <TemplatePicker
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        onSelect={handleTemplateSelect}
        channelType={conversation.channelType}
      />
    </div>
  );
}
