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
import { ChannelLabel } from '@/components/shared/ChannelLabel';
import { EmptyState } from '@/components/shared/EmptyState';
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
import { getApiErrorMessage } from '@/lib/api-error';

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
    channel?: { id: string; displayName: string; channelType: string } | null;
    status: string;
    assignedToId?: string | null;
  } | null;
  onShowAiSuggest?: () => void;
  showAiSuggest?: boolean;
}

export function ChatWindow({ conversation, onShowAiSuggest, showAiSuggest }: ChatWindowProps) {
  const { messages, isLoading, sendMessage } = useMessages(
    conversation?.id || null
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateText, setTemplateText] = useState<string | null>(null);
  const [templateQuickReplies, setTemplateQuickReplies] = useState<Array<{ label: string; text?: string }> | null>(null);
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

  // 狀態名稱與列表的處理狀態標籤一致（Claude Design：等待客服／客服處理中／已關閉）
  const statusOptions = [
    { value: 'ACTIVE', label: '等待客服' },
    { value: 'AGENT_HANDLED', label: '客服處理中' },
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
      alert(getApiErrorMessage(err, '轉接失敗，請稍後重試'));
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
      // 純文字訊息：可帶 quickReplies 等額外 content 欄位
      const extra = contentData?.quickReplies
        ? { quickReplies: contentData.quickReplies }
        : undefined;
      await sendMessage(content, 'text', extra);
    }
  }, [sendMessage]);

  const handleTemplateSelect = (
    text: string,
    extra?: { quickReplies?: Array<{ label: string; text?: string }> },
  ) => {
    setTemplateText(text);
    setTemplateQuickReplies(extra?.quickReplies ?? null);
  };

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Apply selected template into MessageInput (text + optional quick replies)
  useEffect(() => {
    if (templateText === null) return;
    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[data-message-input]',
    );
    const setter = textarea && (textarea as unknown as { __setMessage?: (t: string, q?: unknown) => void }).__setMessage;
    if (setter) {
      setter(templateText, templateQuickReplies ?? undefined);
    }
    setTemplateText(null);
    setTemplateQuickReplies(null);
  }, [templateText, templateQuickReplies]);

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
    ACTIVE: 'bg-orange-50 text-amber-800',
    BOT_HANDLED: 'bg-primary-subtle text-primary-hover',
    AGENT_HANDLED: 'bg-success-subtle text-success',
    CLOSED: 'bg-surface-hover text-muted-foreground',
  };

  const statusLabel: Record<string, string> = {
    ACTIVE: '等待客服',
    BOT_HANDLED: '機器人處理中',
    AGENT_HANDLED: '客服處理中',
    CLOSED: '已關閉',
  };

  const sortedMessages = [...messages].sort(
    (a: { createdAt: string }, b: { createdAt: string }) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="relative flex h-full flex-col">
      {/* Chat Header：版面依 Claude Design「收件匣 v4」
          第一行 名字＋渠道＋狀態標籤；第二行 負責人、狀態；右側主要操作。依 Figma 微調 */}
      {/* 收件匣在 1280 寬時聊天區只剩約 400px：允許換行、名稱截斷，避免撐寬把右側面板擠出畫面 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-6 py-3.5">
        <div className="flex min-w-[180px] flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 max-w-full truncate text-xl font-bold leading-7 text-foreground">
              {conversation.contact?.name || conversation.contact?.displayName || '未知聯絡人'}
            </h3>
            <ChannelLabel
              channelType={conversation.channelType}
              channelName={conversation.channel?.displayName}
              nameClassName="max-w-[12rem] text-xs text-muted-foreground"
            />
            <span
              className={`inline-flex items-center rounded-[5px] px-[7px] py-px text-xs font-semibold ${
                statusColor[conversation.status] || 'bg-surface-hover text-muted-foreground'
              }`}
            >
              {statusLabel[conversation.status] || conversation.status}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <label className="flex items-center gap-1.5">
              負責人
              <select
                value={conversation.assignedToId || ''}
                onChange={handleAssign}
                className="h-7 cursor-pointer rounded-md border border-transparent bg-transparent pr-1 text-xs font-medium text-foreground hover:border-border focus-visible:border-primary focus-visible:outline-none"
              >
                {agentOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <span aria-hidden="true">·</span>
            <label className="flex items-center gap-1.5">
              狀態
              <select
                value={conversation.status}
                onChange={handleStatusChange}
                className="h-7 cursor-pointer rounded-md border border-transparent bg-transparent pr-1 text-xs font-medium text-foreground hover:border-border focus-visible:border-primary focus-visible:outline-none"
              >
                {/* Bot 處理中只能由系統切換，但要能顯示目前值 */}
                {conversation.status === 'BOT_HANDLED' && <option value="BOT_HANDLED">機器人處理中</option>}
                {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2">
          {!isClosed && (
            <Button
              variant={showAiSuggest ? 'secondary' : 'subtle'}
              size="sm"
              onClick={onShowAiSuggest}
              title="AI 建議回覆"
              aria-pressed={showAiSuggest}
            >
              <Lightbulb />
              AI 建議
            </Button>
          )}
          {!isClosed && (
            <Button size="sm" onClick={() => setCloseDialogOpen(true)} title="結案此對話">
              結束對話
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
      <div className="flex-1 overflow-y-auto bg-muted">
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
            <p className="text-muted-foreground">
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
