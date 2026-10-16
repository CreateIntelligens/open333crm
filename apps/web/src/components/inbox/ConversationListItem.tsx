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

// 處理狀態標籤（Claude Design：等待客服＝橘、機器人處理中＝藍、客服處理中＝綠、已關閉＝灰），顏色用 token
function handlingOf(status?: string): { label: string; cls: string } | null {
  switch (status) {
    case 'ACTIVE':
      return { label: '等待客服', cls: 'bg-orange-50 text-amber-800' };
    case 'BOT_HANDLED':
      return { label: '機器人處理中', cls: 'bg-primary-subtle text-primary-hover' };
    case 'AGENT_HANDLED':
      return { label: '客服處理中', cls: 'bg-success-subtle text-success' };
    case 'CLOSED':
      return { label: '已關閉', cls: 'bg-surface-hover text-muted-foreground' };
    default:
      return null;
  }
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
  const channelName = conversation.channel?.displayName?.trim();

  const handling = handlingOf(conversation.status);

  const channelLabel = channelName || channelTypeName(conversation.channelType);

  // 版面依 Claude Design「收件匣 v4」：
  // 第一行 名字＋時間；第二行 處理狀態＋渠道；第三行 最後一則訊息＋紅色未讀數。選中時整列藍框淡藍底
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isSelected ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-2.5 border-b border-border/60 px-4 py-[13px] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        isSelected ? 'bg-primary-subtle ring-2 ring-inset ring-primary' : 'bg-background hover:bg-surface-hover',
      )}
    >
      <span className="relative mt-0.5 shrink-0">
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

      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        {/* 第一行：名字＋時間 */}
        <div className="flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-sm leading-5 text-foreground', unreadCount > 0 ? 'font-bold' : 'font-semibold')}>
            {contactName}
          </span>
          <span
            className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
            title={isValid(new Date(lastMessageTime)) ? format(new Date(lastMessageTime), 'yyyy/M/d HH:mm') : undefined}
          >
            {formatListTime(lastMessageTime)}
          </span>
        </div>

        {/* 第二行：處理狀態＋渠道（同類型可能接多個 LINE OA／粉專，顯示渠道名稱） */}
        <div className="flex min-w-0 items-center gap-2">
          {handling && (
            <span className={cn('shrink-0 whitespace-nowrap rounded-[5px] px-[7px] py-px text-[10px] font-semibold leading-[15px]', handling.cls)}>
              {handling.label}
            </span>
          )}
          <span
            className="min-w-0 truncate text-xs text-muted-foreground"
            title={[channelTypeName(conversation.channelType), channelName].filter(Boolean).join('：')}
          >
            {channelLabel}
          </span>
          {conversation.caseId && <FileText className="h-3 w-3 shrink-0 text-warning" aria-label="已建立案件" />}
          {conversation.lastMessageSentiment === 'positive' && (
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-success" title="正面情緒" />
          )}
          {conversation.lastMessageSentiment === 'negative' && (
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-destructive" title="負面情緒" />
          )}
          {showCsat && conversation.csatScore != null && (
            <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-warning">
              <Star className="h-3 w-3 fill-warning" />
              {conversation.csatScore}
            </span>
          )}
        </div>

        {/* 第三行：最後一則訊息＋未讀數 */}
        <div className="flex min-w-0 items-center gap-2">
          <p
            className={cn(
              'min-w-0 flex-1 truncate text-sm leading-5',
              lastMessageFailed ? 'text-destructive' : unreadCount > 0 ? 'text-foreground' : 'text-muted-foreground',
            )}
            title={lastMessageFailed ? '最後一則訊息沒有送出，對方並未收到' : undefined}
          >
            {lastMessageFailed && <AlertCircle className="mr-1 inline-block h-3 w-3 shrink-0 align-[-2px]" />}
            {lastMessageContent}
          </p>
          {unreadCount > 0 && (
            <span
              className="flex h-5 min-w-[22px] shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-white"
              aria-label={`${unreadCount} 則未讀`}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
