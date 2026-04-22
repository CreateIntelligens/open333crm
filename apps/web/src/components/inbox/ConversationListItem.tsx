'use client';

import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { ChannelBadge } from '@/components/shared/ChannelBadge';
import { FileText, Star } from 'lucide-react';

interface ConversationListItemProps {
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
    lastMessage?: {
      content: string | { text?: string };
      contentType?: string;
      createdAt: string;
      senderType?: string;
    };
    unreadCount?: number;
    status: string;
    updatedAt: string;
    caseId?: string | null;
    csatScore?: number | null;
    lastMessageSentiment?: string;
  };
  isSelected: boolean;
  onClick: () => void;
  showCsat?: boolean;
}

function formatMessagePreview(msg?: { content: string | { text?: string }; contentType?: string }): string {
  if (!msg) { return '尚無訊息'; }

  if (msg.contentType === 'image') { return '[圖片]'; }
  if (msg.contentType === 'file') { return '[檔案]'; }
  if (msg.contentType === 'flex' || msg.contentType === 'template') { return '[卡片訊息]'; }
  if (msg.contentType === 'sticker') { return '[貼圖]'; }
  if (msg.contentType === 'video') { return '[影片]'; }
  if (msg.contentType === 'audio') { return '[語音]'; }
  if (msg.contentType === 'location') { return '[位置]'; }

  const rawContent = msg.content;
  if (typeof rawContent === 'object' && rawContent !== null) {
    return (rawContent as { text?: string }).text || '尚無訊息';
  }
  return String(rawContent || '尚無訊息');
}

export function ConversationListItem({
  conversation,
  isSelected,
  onClick,
}: ConversationListItemProps) {
  const contactName = conversation.contact?.name || conversation.contact?.displayName || '未知聯繫人';
  const lastMessageContent = formatMessagePreview(conversation.lastMessage);
  const lastMessageTime = conversation.lastMessage?.createdAt || conversation.updatedAt;
  const unreadCount = conversation.unreadCount || 0;
  const isBotHandled = conversation.status === 'BOT_HANDLED';

  const timeLabel = (() => {
    const diff = Date.now() - new Date(lastMessageTime).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    return `${days}d`;
  })();

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-[#f8eaf6]',
        isSelected && 'bg-[#f8eaf6] border-l-2 border-[#cb74c1]'
      )}
    >
      {unreadCount > 0 && !isSelected && (
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-[#cb74c1]" />
      )}
      <div className="ml-2 flex-shrink-0">
        <Avatar
          alt={contactName}
          src={conversation.contact?.avatar || conversation.contact?.avatarUrl}
          size="md"
        />
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm',
              unreadCount > 0 ? 'font-semibold text-[#1e2939]' : 'font-medium text-[#4a5565]'
            )}
          >
            {contactName}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {timeLabel}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <ChannelBadge channel={conversation.channelType} />
          {isBotHandled && (
            <span className="inline-flex items-center rounded-full bg-[#f8eaf6] px-1.5 py-0.5 text-[10px] font-medium text-[#cb74c1]">
              Bot
            </span>
          )}
          {conversation.lastMessageSentiment === 'positive' && (
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" title="正面情緒" />
          )}
          {conversation.lastMessageSentiment === 'negative' && (
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" title="負面情緒" />
          )}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p
            className={cn(
              'truncate text-xs',
              unreadCount > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}
          >
            {lastMessageContent}
          </p>
          {conversation.caseId && (
            <FileText className="h-3 w-3 shrink-0 text-orange-500" />
          )}
        </div>
      </div>
    </button>
  );
}
