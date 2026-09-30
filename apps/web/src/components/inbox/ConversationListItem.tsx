'use client';

import React from 'react';
import { differenceInCalendarDays, format, isSameYear, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { ChannelLogo, channelTypeName } from '@/components/shared/ChannelLogo';
import { AlertCircle, FileText, Star } from 'lucide-react';
import type { ConversationRow } from '@/hooks/useConversations';

interface ConversationListItemProps {
  conversation: ConversationRow;
  isSelected: boolean;
  onClick: () => void;
  showCsat?: boolean;
}

/** 最後一則是否為「送出失敗」的紀錄（worker 寫入，對方其實沒收到）。 */
function isDeliveryFailed(msg?: ConversationRow['lastMessage']): boolean {
  return msg?.metadata?.deliveryFailed === true;
}

function formatMessagePreview(msg?: ConversationRow['lastMessage']): string {
  if (!msg) return '尚無訊息';

  // 非文字型別沒有 text，底下的取值會落到「尚無訊息」——對 LINE 素材尤其明顯
  // （line_video / line_flex 等原本全都顯示成「尚無訊息」）。
  const typeLabels: Record<string, string> = {
    image: '[圖片]',
    line_image: '[圖片]',
    file: '[檔案]',
    flex: '[卡片訊息]',
    template: '[卡片訊息]',
    line_flex: '[卡片訊息]',
    sticker: '[貼圖]',
    video: '[影片]',
    line_video: '[影片]',
    audio: '[語音]',
    location: '[位置]',
    line_imagemap: '[圖文訊息]',
    line_carousel: '[輪播訊息]',
  };
  const label = msg.contentType ? typeLabels[msg.contentType] : undefined;
  if (label) return label;

  const rawContent = msg.content;
  if (typeof rawContent === 'object' && rawContent !== null) {
    return (rawContent as { text?: string }).text || '尚無訊息';
  }
  return String(rawContent || '尚無訊息');
}

/** 列表時間：當天「14:05」、昨天「昨天」、一週內「週一」、更早「9/28」，跨年加年份——字短，把空間留給渠道名稱 */
const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
function formatListTime(value: string | Date): string {
  const date = new Date(value);
  if (!isValid(date)) return '';
  const now = new Date();
  const days = differenceInCalendarDays(now, date);
  if (days === 0) return format(date, 'HH:mm');
  // 本機時鐘比伺服器慢一天以上時是「未來」時間，只顯示時分會看不出是哪天
  if (days < 0) return format(date, 'M/d HH:mm');
  if (days === 1) return '昨天';
  if (days < 7) return WEEKDAYS[date.getDay()];
  return isSameYear(date, now) ? format(date, 'M/d') : format(date, 'yyyy/M/d');
}

export function ConversationListItem({
  conversation,
  isSelected,
  onClick,
  showCsat,
}: ConversationListItemProps) {
  const contactName = conversation.contact?.name || conversation.contact?.displayName || '未知聯絡人';
  const lastMessageContent = formatMessagePreview(conversation.lastMessage);
  const lastMessageFailed = isDeliveryFailed(conversation.lastMessage);
  const lastMessageTime = conversation.lastMessage?.createdAt || conversation.updatedAt;
  const unreadCount = conversation.unreadCount || 0;
  const isBotHandled = conversation.status === 'BOT_HANDLED';
  const channelName = conversation.channel?.displayName?.trim();

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent',
        isSelected && 'bg-primary-subtle ring-1 ring-primary-border',
        unreadCount > 0 && !isSelected && 'bg-primary-subtle/40'
      )}
    >
      <span className="relative shrink-0">
        <Avatar
          alt={contactName}
          src={conversation.contact?.avatar || conversation.contact?.avatarUrl}
          size="md"
        />
        <ChannelLogo
          channelType={conversation.channelType}
          className="absolute -bottom-0.5 -right-0.5 h-4 w-4 ring-2 ring-background"
        />
      </span>
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'min-w-0 truncate text-sm',
              unreadCount > 0 ? 'font-semibold' : 'font-medium'
            )}
          >
            {contactName}
          </span>
          <span
            className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
            title={isValid(new Date(lastMessageTime)) ? format(new Date(lastMessageTime), 'yyyy/M/d HH:mm') : undefined}
          >
            {formatListTime(lastMessageTime)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p
            className={cn(
              'truncate text-xs',
              lastMessageFailed
                ? 'text-destructive'
                : unreadCount > 0
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground',
            )}
            title={lastMessageFailed ? '最後一則訊息沒有送出，對方並未收到' : undefined}
          >
            {lastMessageFailed && (
              <AlertCircle className="mr-1 inline-block h-3 w-3 shrink-0 align-[-2px]" />
            )}
            {lastMessageContent}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {conversation.lastMessageSentiment === 'positive' && (
              <span className="inline-block h-2 w-2 rounded-full bg-success" title="正面情緒" />
            )}
            {conversation.lastMessageSentiment === 'negative' && (
              <span className="inline-block h-2 w-2 rounded-full bg-destructive" title="負面情緒" />
            )}
            {conversation.caseId && (
              <FileText className="h-3 w-3 text-warning" aria-label="已建立案件" />
            )}
            {isBotHandled && (
              <span
                className="whitespace-nowrap rounded bg-ai-subtle px-1 text-[10px] font-medium leading-4 text-ai"
                title="目前由 Bot 處理中"
              >
                Bot
              </span>
            )}
            {showCsat && conversation.csatScore != null && (
              <span className="flex items-center gap-0.5 text-[10px] text-warning">
                <Star className="h-3 w-3 fill-warning" />
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
        {/* 渠道名稱獨立一行：同類型可能接多個 LINE OA／粉專，給整行寬度才看得清楚；類型由頭像角落 logo 表示 */}
        <p
          className="mt-0.5 truncate text-[11px] text-muted-foreground"
          title={[channelTypeName(conversation.channelType), channelName].filter(Boolean).join('：')}
        >
          {channelName || channelTypeName(conversation.channelType)}
        </p>
      </div>
    </button>
  );
}
