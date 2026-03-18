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
  };
  isSelected: boolean;
  onClick: () => void;
  showCsat?: boolean;
}

function formatMessagePreview(msg?: { content: string | { text?: string }; contentType?: string }): string {
  if (!msg) return '尚無訊息';

  if (msg.contentType === 'image') return '[圖片]';
  if (msg.contentType === 'file') return '[檔案]';
  if (msg.contentType === 'flex' || msg.contentType === 'template') return '[卡片訊息]';
  if (msg.contentType === 'sticker') return '[貼圖]';
  if (msg.contentType === 'video') return '[影片]';
  if (msg.contentType === 'audio') return '[語音]';
  if (msg.contentType === 'location') return '[位置]';

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
  showCsat,
}: ConversationListItemProps) {
  const contactName = conversation.contact?.name || conversation.contact?.displayName || '未知聯繫人';
  const lastMessageContent = formatMessagePreview(conversation.lastMessage);
  const lastMessageTime = conversation.lastMessage?.createdAt || conversation.updatedAt;
  const unreadCount = conversation.unreadCount || 0;
  const isBotHandled = conversation.status === 'BOT_HANDLED';

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition-colors hover:bg-accent',
        isSelected && 'bg-accent',
        unreadCount > 0 && !isSelected && 'bg-blue-50/50'
      )}
    >
      <Avatar
        alt={contactName}
        src={conversation.contact?.avatar || conversation.contact?.avatarUrl}
        size="md"
      />
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm',
              unreadCount > 0 ? 'font-semibold' : 'font-medium'
            )}
          >
            {contactName}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(lastMessageTime), { addSuffix: false })}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <ChannelBadge channel={conversation.channelType} />
          {isBotHandled && (
            <span className="inline-flex items-center rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
              Bot 中
            </span>
          )}
          {conversation.caseId && (
            <FileText className="h-3 w-3 text-orange-500" />
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
          <div className="flex items-center gap-1.5 shrink-0">
            {showCsat && conversation.csatScore != null && (
              <span className="flex items-center gap-0.5 text-[10px] text-amber-500">
                <Star className="h-3 w-3 fill-amber-400" />
                {conversation.csatScore}
              </span>
            )}
            {unreadCount > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
