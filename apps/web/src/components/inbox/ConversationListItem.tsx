'use client';

import React from 'react';
import { format, isToday, isYesterday, formatDistanceToNowStrict } from 'date-fns';
import { zhTW } from 'date-fns/locale';
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

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return '昨天';
  // Within last 7 days → relative
  const diffDays = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 7) return formatDistanceToNowStrict(d, { addSuffix: false, locale: zhTW });
  return format(d, 'MM/dd');
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
  const isUnread = unreadCount > 0;
  const isBotHandled = conversation.status === 'BOT_HANDLED';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 py-5 pl-2 pr-4 text-left transition-colors',
        isSelected
          ? 'bg-surface-active hover:bg-surface-active'
          : 'border-b border-surface-line/60 hover:bg-neutral-20',
      )}
    >
      <Avatar
        alt={contactName}
        src={conversation.contact?.avatar || conversation.contact?.avatarUrl}
        size="md"
        className="h-10 w-10 shrink-0 ring-1 ring-neutral-30"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* Header: name + channel chip + timestamp */}
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-[14px] font-medium leading-5 text-ink">
              {contactName}
            </span>
            <ChannelBadge channel={conversation.channelType} />
            {isBotHandled && (
              <span className="inline-flex h-[18px] items-center rounded-chip bg-brand-10 px-2 text-[11px] font-medium text-brand-80">
                Bot
              </span>
            )}
          </div>
          <span className="shrink-0 text-right text-[12px] leading-5 text-ink-subtle">
            {formatTimestamp(lastMessageTime)}
          </span>
        </div>

        {/* Message preview + unread count badge */}
        <div className="flex items-center gap-3">
          <p
            className={cn(
              'flex-1 truncate text-[14px] leading-5',
              isUnread || isSelected ? 'font-medium text-ink' : 'font-normal text-ink-subtle',
            )}
          >
            {lastMessageContent}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.lastMessageSentiment === 'positive' && (
              <span className="inline-block h-2 w-2 rounded-full bg-f-green-60" title="正面情緒" />
            )}
            {conversation.lastMessageSentiment === 'negative' && (
              <span className="inline-block h-2 w-2 rounded-full bg-f-red-60" title="負面情緒" />
            )}
            {conversation.caseId && (
              <FileText className="h-3 w-3 text-f-orange-60" />
            )}
            {showCsat && conversation.csatScore != null && (
              <span className="flex items-center gap-0.5 text-[11px] text-f-orange-60">
                <Star className="h-3 w-3 fill-f-orange-60" />
                {conversation.csatScore}
              </span>
            )}
            {isUnread && (
              <span className="inline-flex h-[18px] min-w-[24px] items-center justify-center rounded-chip bg-[#378ADD] px-2 text-[12px] font-semibold leading-5 text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
