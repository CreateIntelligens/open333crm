'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, Lightbulb, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

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
  } | null;
  onShowAiSuggest?: () => void;
  showAiSuggest?: boolean;
  /** Optional inline AI Suggest panel rendered between message list and input */
  aiSuggestSlot?: React.ReactNode;
}

export function ChatWindow({ conversation, onShowAiSuggest, showAiSuggest, aiSuggestSlot }: ChatWindowProps) {
  const { messages, isLoading, sendMessage } = useMessages(
    conversation?.id || null
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateText, setTemplateText] = useState<string | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [closing, setClosing] = useState(false);

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
    if (!conversation) return;
    const value = e.target.value || null;
    await api.patch(`/conversations/${conversation.id}`, { assignedToId: value });
    globalMutate(`/conversations/${conversation.id}`);
  };

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!conversation) return;
    await api.patch(`/conversations/${conversation.id}`, { status: e.target.value });
    globalMutate(`/conversations/${conversation.id}`);
  };

  const handleReopen = async () => {
    if (!conversation) return;
    await api.patch(`/conversations/${conversation.id}`, { status: 'ACTIVE' });
    globalMutate(`/conversations/${conversation.id}`);
  };

  const handleTakeover = async () => {
    if (!conversation) return;
    try {
      await api.post(`/conversations/${conversation.id}/handoff`, {});
      globalMutate(`/conversations/${conversation.id}`);
    } catch (err) {
      console.error('Handoff failed:', err);
    }
  };

  const handleClaim = async () => {
    if (!conversation) return;
    try {
      await api.post(`/conversations/${conversation.id}/claim`);
      toast.success('已認領該對話');
      globalMutate(`/conversations/${conversation.id}`);
    } catch (err: any) {
      if (err?.response?.status === 409) {
        toast.error('該對話已被其他成員認領');
      } else {
        toast.error('認領失敗');
        console.error('Claim failed:', err);
      }
      globalMutate(`/conversations/${conversation.id}`);
    }
  };

  const handleCloseConfirm = async () => {
    if (!conversation) return;
    setClosing(true);
    try {
      const body: { reason?: string } = {};
      const trimmed = closeReason.trim();
      if (trimmed) body.reason = trimmed;
      await api.post(`/conversations/${conversation.id}/close`, body);
      setCloseDialogOpen(false);
      setCloseReason('');
      globalMutate(`/conversations/${conversation.id}`);
    } catch (err) {
      console.error('Close conversation failed:', err);
      alert('結案失敗，請稍後再試');
    } finally {
      setClosing(false);
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
    ACTIVE: 'bg-f-green-10 text-f-green-80',
    BOT_HANDLED: 'bg-brand-10 text-brand-80',
    AGENT_HANDLED: 'bg-surface-active text-link',
    CLOSED: 'bg-neutral-30 text-ink-subtle',
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

  const lastMessageTime = sortedMessages.length > 0
    ? sortedMessages[sortedMessages.length - 1].createdAt
    : null;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-white">
      {/* Chat Header — Figma 909:31347, padding 12/16, bottom border */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-surface-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[20px] font-semibold leading-7 text-ink">
            {conversation.contact?.name || conversation.contact?.displayName || '未知聯繫人'}
          </h3>
          <div className="flex items-center gap-1 text-ink-subtle">
            <ChannelBadge channel={conversation.channelType} />
            <span className="text-[14px] leading-5 text-ink/60">．</span>
            {lastMessageTime && (
              <span className="text-[14px] leading-5 text-ink">
                {formatDistanceToNow(new Date(lastMessageTime), { addSuffix: false, locale: zhTW })}前
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Status pill */}
          <span
            className={`inline-flex items-center rounded-chip px-2 py-0.5 text-[11px] font-semibold ${
              statusColor[conversation.status] || 'bg-f-green-10 text-f-green-80'
            }`}
          >
            {statusLabel[conversation.status] || conversation.status}
          </span>

          {/* Claim button only when needed */}
          {conversation.status === 'AGENT_HANDLED' && !conversation.assignedToId && (
            <Button
              size="sm"
              variant="default"
              className="h-8"
              onClick={handleClaim}
            >
              認領
            </Button>
          )}

          {!isClosed && (
            <Button
              variant={showAiSuggest ? 'default' : 'ghost'}
              size="icon"
              className="h-8 w-8"
              onClick={onShowAiSuggest}
              title="AI 建議回覆"
            >
              <Lightbulb className="h-4 w-4" />
            </Button>
          )}

          {!isClosed && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setCloseDialogOpen(true)}
              title="結案此對話"
            >
              <XCircle className="h-4 w-4" />
              <span className="text-xs">結案</span>
            </Button>
          )}
        </div>
      </div>

      {/* Status Banner */}
      <StatusBanner
        status={conversation.status}
        onReopen={handleReopen}
        onTakeover={handleTakeover}
      />

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-canvas">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-ink-subtle" />
          </div>
        ) : sortedMessages.length === 0 ? (
          <EmptyState
            title="尚無訊息"
            description="傳送訊息開始對話"
            className="h-full"
          />
        ) : (
          <div className="flex flex-col gap-4 p-4">
            {sortedMessages.map((msg: { id: string; direction: string; contentType: string; content: string | { text?: string }; senderType?: string; senderName?: string; createdAt: string; metadata?: Record<string, unknown> }) => {
              // Render CSAT survey card for csat messages
              if (msg.contentType === 'csat') {
                const score = typeof msg.metadata?.csatScore === 'number' ? msg.metadata.csatScore : undefined;
                const msgContent = typeof msg.content === 'object' ? msg.content : {};
                const csatCaseId = (msg.metadata?.caseId as string) || (msgContent as Record<string, unknown>).caseId as string | undefined;
                return <CsatMessage key={msg.id} score={score} readonly={isClosed || !!score} caseId={csatCaseId} />;
              }
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  contactName={conversation.contact?.name || conversation.contact?.displayName}
                />
              );
            })}
            {conversation && (
              <TypingIndicator conversationId={conversation.id} />
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* AI Suggestion (inline, between messages and input) */}
      {aiSuggestSlot}

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

      {/* Close Conversation Dialog */}
      <Dialog
        open={closeDialogOpen}
        onOpenChange={(open) => {
          if (!closing) setCloseDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>結案此對話</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-ink-subtle">
              結案後此對話將從 Inbox 列表移出。客戶若再次傳訊將自動開新對話。
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-medium">
                結案原因（選填）
              </label>
              <Textarea
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                placeholder="例：問題已解決 / 客戶未回覆 / 重複對話..."
                rows={3}
                disabled={closing}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCloseDialogOpen(false)}
              disabled={closing}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleCloseConfirm}
              disabled={closing}
            >
              {closing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  結案中…
                </>
              ) : (
                '確認結案'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
