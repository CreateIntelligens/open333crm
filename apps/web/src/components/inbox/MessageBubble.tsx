'use client';

import React from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { AlertCircle, Bot, ExternalLink, FileText } from 'lucide-react';
import { describeMessageMedia } from '@/lib/inbox/message-media';
import { LinkifiedText } from '@/components/chatbox/LinkifiedText';

/** 把 contentType 講成人話，用在送出失敗的提示裡（「這則影片沒有送出」）。 */
function describeContentType(contentType: string): string {
  const map: Record<string, string> = {
    text: '訊息',
    line_text: '訊息',
    image: '圖片',
    line_image: '圖片',
    video: '影片',
    line_video: '影片',
    audio: '語音',
    file: '檔案',
    line_flex: 'Flex 訊息',
    line_imagemap: '圖文訊息',
    line_carousel: '輪播訊息',
    line_confirm: '確認訊息',
    line_buttons: '按鈕訊息',
  };
  return map[contentType] ?? '訊息';
}

/**
 * 綁定代碼、email／手機登記的系統訊息中，需要客服接手的結果（change add-phone-identity-merge）。
 * 系統無法自動整合，顧客被告知「客服會協助」，客服要看得出這則需要處理。
 */
const AGENT_ACTION_KINDS = new Set([
  'email_identity_conflict',
  'phone_identity_conflict',
  'email_channel_conflict',
  'phone_channel_conflict',
]);

function extractText(content: string | { text?: string } | unknown): string {
  if (typeof content === 'string') return content;
  if (typeof content === 'object' && content !== null && 'text' in (content as Record<string, unknown>)) {
    return (content as { text: string }).text;
  }
  // 物件但沒有 text（如 IG 貼圖/互動等 unknown 型別），避免顯示 [object Object]
  if (typeof content === 'object' && content !== null) return '[不支援的訊息類型]';
  return String(content ?? '');
}

interface MessageBubbleProps {
  /** 對方的名字，用來顯示頭像縮寫（Claude Design：對方訊息左側有圓形頭像） */
  contactName?: string;
  message: {
    id: string;
    direction: string;
    contentType: string;
    content: string | { text?: string; url?: string };
    senderType?: string;
    senderName?: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  };
}

export function MessageBubble({ message, contactName }: MessageBubbleProps) {
  const isInbound = message.direction.toLowerCase() === 'inbound';
  const isSystem = message.contentType === 'system' || message.senderType === 'SYSTEM';
  const isBot = message.senderType === 'BOT';
  const textContent = extractText(message.content);

  // Metadata
  const metadata = message.metadata || {};
  const confidence = typeof metadata.confidence === 'number' ? metadata.confidence : null;
  const triggerType = metadata.triggerType as string | undefined;
  const knowledgeRefs = (metadata.knowledgeRefs || metadata.kmRefs) as Array<{ id: string; title: string; url?: string }> | undefined;
  const sentiment = metadata.sentiment as { sentiment: string; score: number; confidence: number } | undefined;
  // 送出失敗的紀錄（worker 寫入）。這則訊息「沒有」真的送到使用者端，只給客服看。
  const deliveryFailed = metadata.deliveryFailed === true;
  const deliveryError = typeof metadata.deliveryError === 'string' ? metadata.deliveryError : '';

  // 綁定與登記流程自動送出的訊息（binding-common.ts 的 sendBindingMessage）：不是 AI 回覆
  const isIdentityNotice = metadata.source === 'identity_binding';
  const needsAgentAction = isIdentityNotice && typeof metadata.kind === 'string' && AGENT_ACTION_KINDS.has(metadata.kind);

  // 送出失敗仍顯示訊息內容（客服要知道沒送到的是什麼），泡泡下方標示沒有送出與原因。
  // ⚠️ 失敗紀錄不走 system 分支：contentType 可能是 line_video 這種沒有 text 的型別，
  // 走 system 分支會顯示成一條空白灰底，等於沒講。
  if (isSystem && !deliveryFailed) {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-lg bg-muted px-3 py-1 text-xs italic text-muted-foreground">
          {textContent}
        </span>
      </div>
    );
  }

  // 泡泡顏色依 Claude Design「收件匣 v4」：對方白底灰框（左上小圓角）、我方藍底白字（右上小圓角）。
  // Figma「Chat / Bubble」的我方為淡藍底深字（bg-primary-subtle text-foreground），要改回時換掉最後一行即可
  const getBubbleClasses = () => {
    if (isInbound || isBot) {
      return 'rounded-tl-[4px] border border-border bg-background text-foreground';
    }
    return 'rounded-tr-[4px] bg-primary text-white';
  };

  // Confidence badge color — tokens 語意色
  const getConfidenceColor = (val: number) => {
    if (val >= 0.8) return 'bg-success-subtle text-success';
    if (val >= 0.5) return 'bg-warning-subtle text-warning';
    return 'bg-destructive-subtle text-destructive';
  };

  // Trigger type label
  const getTriggerLabel = (type: string) => {
    const labels: Record<string, string> = {
      keyword: '關鍵字命中',
      semantic: 'KM 語意命中',
      faq: 'FAQ 匹配',
      fallback: '預設回覆',
    };
    return labels[type] || type;
  };

  // Sentiment helpers
  const getSentimentColor = (s: string) => {
    if (s === 'positive') return 'bg-success-subtle text-success';
    if (s === 'negative') return 'bg-destructive-subtle text-destructive';
    return 'bg-muted text-muted-foreground';
  };
  const getSentimentLabel = (s: string) => {
    if (s === 'positive') return '正面';
    if (s === 'negative') return '負面';
    return '中性';
  };

  const isLeft = isInbound || isBot;
  // 綁定、登記流程自動送出的訊息標示「系統自動發送」，不是 AI 回覆（取自 main）
  const author = isIdentityNotice ? '系統自動發送' : isBot ? 'AI 助理' : !isInbound ? message.senderName : undefined;

  return (
    <div className={cn('flex w-full gap-2.5 px-6 py-1.5', isLeft ? 'justify-start' : 'justify-end')}>
      {/* 對方／AI 的頭像 */}
      {isLeft && (
        isBot ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ai-subtle text-ai" aria-hidden="true">
            <Bot className="h-4 w-4" />
          </span>
        ) : (
          <Avatar alt={contactName || message.senderName} size="sm" />
        )
      )}

      <div className={cn('flex min-w-0 max-w-[70%] flex-col gap-1', isLeft ? 'items-start' : 'items-end')}>
        {author && <span className="text-xs text-muted-foreground">{author}</span>}

        <div
          className={cn(
            'max-w-full rounded-[14px] px-3.5 py-2.5 text-sm leading-5',
            getBubbleClasses(),
            deliveryFailed && 'border border-dashed border-destructive/50 opacity-80',
          )}
        >
          {/* Content */}
          {(() => {
            const media = describeMessageMedia(message.contentType, message.content);
            switch (media.kind) {
              case 'image':
                return (
                    <a href={media.url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={media.url}
                        alt="Image message"
                        className="max-w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                      />
                    </a>
                );
              case 'video':
                return (
                    <video src={media.url} controls className="max-w-full rounded-lg" style={{ maxHeight: '320px' }} />
                );
              case 'audio':
                return <audio src={media.url} controls className="max-w-full" />;
              case 'file':
                return (
                    <a
                      href={media.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={media.fileName}
                      className="flex items-center gap-2 text-sm underline-offset-2 hover:underline"
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="break-all">{media.fileName}</span>
                      {media.sizeLabel && <span className="shrink-0 text-xs opacity-70">{media.sizeLabel}</span>}
                    </a>
                );
              default:
                return (
                    <>
                      <LinkifiedText text={textContent} className="text-sm whitespace-pre-wrap break-words" />
                      {/* 媒體下載失敗要看得到，否則客服以為還在下載 */}
                      {media.error && <p className="mt-1 text-xs text-destructive">{media.error}</p>}
                    </>
                );
            }
          })()}

        </div>

        {/* AI 回覆的參考來源 */}
        {isBot && knowledgeRefs && knowledgeRefs.length > 0 && (
          <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
            <span>參考來源：</span>
            {knowledgeRefs.map((ref) => (
              <a
                key={ref.id}
                href={ref.url && /^https?:\/\//i.test(ref.url) ? ref.url : undefined}
                className="flex items-center gap-1 text-ai hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-2.5 w-2.5" />
                {ref.title}
              </a>
            ))}
          </div>
        )}

        {/* 時間在泡泡外（Claude Design）；情緒、信心值、觸發方式放在同一行，不擠在泡泡裡 */}
        <div className={cn('flex flex-wrap items-center gap-1.5 text-[11px] leading-4 text-muted-foreground', !isLeft && 'justify-end')}>
          <span className="tabular-nums">{format(new Date(message.createdAt), 'HH:mm')}</span>
          {isBot && confidence !== null && (
            <span className={cn('rounded px-1.5 py-px text-[10px] font-semibold', getConfidenceColor(confidence))}>
              信心值 {Math.round(confidence * 100)}%
            </span>
          )}
          {isBot && triggerType && (
            <span className="rounded bg-ai-subtle px-1.5 py-px text-[10px] font-medium text-ai">{getTriggerLabel(triggerType)}</span>
          )}
          {isInbound && !isBot && sentiment && (
            <span
              className={cn('rounded-full px-1.5 py-px text-[10px] font-medium', getSentimentColor(sentiment.sentiment))}
              title={sentiment.confidence != null ? `信心值 ${Math.round(sentiment.confidence * 100)}%` : undefined}
            >
              {getSentimentLabel(sentiment.sentiment)}
            </span>
          )}
        </div>

      {deliveryFailed && (
        <div role="alert" className="flex max-w-full items-start gap-1 px-1 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="break-words">
            這則{describeContentType(message.contentType)}沒有送出，對方並未收到
            {deliveryError && <span className="opacity-90">：{deliveryError}</span>}
          </span>
        </div>
      )}

      {needsAgentAction && (
        <div className="max-w-full rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2 text-xs text-warning">
          <p className="font-semibold">需要客服處理</p>
          <p className="mt-0.5">
            系統無法自動整合這位顧客的帳號，已請顧客等候客服。請確認是否為同一人，需要時到聯絡人頁手動合併。
          </p>
        </div>
      )}
      </div>
    </div>
  );
}
