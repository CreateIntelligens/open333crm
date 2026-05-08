'use client';

import React from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Bot, ExternalLink } from 'lucide-react';

function extractText(content: string | { text?: string } | unknown): string {
  if (typeof content === 'string') return content;
  if (typeof content === 'object' && content !== null && 'text' in (content as Record<string, unknown>)) {
    return (content as { text: string }).text;
  }
  return String(content ?? '');
}

function extractMediaUrl(content: string | { url?: string; text?: string } | unknown): string | null {
  if (typeof content === 'object' && content !== null) {
    const obj = content as Record<string, unknown>;
    if (obj.url && typeof obj.url === 'string') return obj.url as string;
  }
  const text = extractText(content);
  if (text.startsWith('data:image') || text.startsWith('http')) return text;
  return null;
}

interface MessageBubbleProps {
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
  /** Fallback inbound contact name (when message.senderName is not set) */
  contactName?: string;
}

export function MessageBubble({ message, contactName }: MessageBubbleProps) {
  const isInbound = message.direction.toLowerCase() === 'inbound';
  const isSystem = message.contentType === 'system' || message.senderType === 'SYSTEM';
  const isBot = message.senderType === 'BOT';
  const textContent = extractText(message.content);

  const metadata = message.metadata || {};
  const confidence = typeof metadata.confidence === 'number' ? metadata.confidence : null;
  const triggerType = metadata.triggerType as string | undefined;
  const knowledgeRefs = (metadata.knowledgeRefs || metadata.kmRefs) as Array<{ id: string; title: string; url?: string }> | undefined;
  const sentiment = metadata.sentiment as { sentiment: string; score: number; confidence: number } | undefined;

  // System message — render as centered pill or expanded card (handoff summary)
  if (isSystem) {
    const meta = (message.metadata || {}) as { type?: string; reason?: string; summary?: string };
    const isHandoff = meta.type === 'auto_handoff';

    if (isHandoff) {
      // Multi-line handoff summary card
      return (
        <div className="flex justify-center py-2">
          <div className="flex w-full max-w-[640px] flex-col gap-2 rounded-card border border-surface-line bg-neutral-20 px-4 py-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <span>📋</span>
              <span>自動轉接人工客服</span>
              {meta.reason && (
                <span className="text-[12px] font-normal text-ink-subtle">·{meta.reason}</span>
              )}
            </div>
            {meta.summary && (
              <div className="rounded-chip bg-white px-3 py-2 text-[13px] leading-5 text-ink-subtle">
                <p className="mb-1 text-[11px] font-semibold uppercase text-ink-subtle/80">Bot 對話摘要</p>
                <p className="whitespace-pre-wrap break-words">{meta.summary}</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Default short system pill
    return (
      <div className="flex justify-center py-2">
        <span className="inline-flex max-w-[80%] items-center rounded-card border border-surface-line bg-white px-4 py-1 text-center text-[12px] leading-4 text-ink-subtle">
          {textContent}
        </span>
      </div>
    );
  }

  const senderName = isInbound
    ? (message.senderName || contactName || '客戶')
    : (isBot ? 'Bot' : (message.senderName || '客服'));
  const timeStr = format(new Date(message.createdAt), 'HH:mm');

  // Confidence color helper
  const getConfidenceColor = (val: number) => {
    if (val >= 0.8) return 'bg-f-green-10 text-f-green-80';
    if (val >= 0.5) return 'bg-f-orange-10 text-f-orange-80';
    return 'bg-f-red-10 text-f-red-80';
  };
  const getTriggerLabel = (type: string) => {
    const labels: Record<string, string> = {
      keyword: '關鍵字命中',
      semantic: 'KM 語意命中',
      faq: 'FAQ 匹配',
      fallback: '預設回覆',
    };
    return labels[type] || type;
  };
  const getSentimentColor = (s: string) => {
    if (s === 'positive') return 'bg-f-green-10 text-f-green-80';
    if (s === 'negative') return 'bg-f-red-10 text-f-red-80';
    return 'bg-neutral-30 text-ink-subtle';
  };
  const getSentimentEmoji = (s: string) => (s === 'positive' ? '😊' : s === 'negative' ? '😟' : '😐');
  const getSentimentLabel = (s: string) => (s === 'positive' ? '正面' : s === 'negative' ? '負面' : '中性');

  // Body content (re-used inside bubble)
  const body =
    message.contentType === 'image' ? (
      (() => {
        const url = extractMediaUrl(message.content);
        return url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt="Image message"
              className="max-w-full cursor-pointer rounded-chip transition-opacity hover:opacity-90"
            />
          </a>
        ) : (
          <p className="whitespace-pre-wrap break-words text-[14px] leading-6 text-ink">
            {textContent}
          </p>
        );
      })()
    ) : message.contentType === 'video' ? (
      (() => {
        const url = extractMediaUrl(message.content);
        return url ? (
          <video src={url} controls className="max-w-full rounded-chip" style={{ maxHeight: '320px' }} />
        ) : (
          <p className="whitespace-pre-wrap break-words text-[14px] leading-6 text-ink">
            {textContent}
          </p>
        );
      })()
    ) : (
      <p className="whitespace-pre-wrap break-words text-[14px] leading-6 text-ink">
        {textContent}
      </p>
    );

  return (
    <div className={cn('flex w-full', isInbound ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'flex max-w-[480px] flex-col gap-1',
          isInbound ? 'items-start' : 'items-end',
        )}
      >
        {/* Header (outside bubble): name + time */}
        <div
          className={cn(
            'flex items-center gap-1',
            isInbound ? 'justify-start' : 'justify-end',
          )}
        >
          {!isInbound && (
            <span className="text-[12px] leading-4 text-ink-subtle">{timeStr}</span>
          )}
          <span className="text-[14px] font-medium leading-5 text-ink">
            {isBot && <Bot className="mr-0.5 inline h-3.5 w-3.5 align-middle text-link" />}
            {senderName}
          </span>
          {isInbound && (
            <span className="text-[12px] leading-4 text-ink-subtle">{timeStr}</span>
          )}
        </div>

        {/* Bubble (auto-fit width, max already capped by parent) */}
        <div
          className={cn(
            'inline-block max-w-full px-3 py-2 shadow-[0_0_6px_0_rgba(0,0,0,0.15)]',
            isInbound
              ? 'rounded-[0_16px_16px_16px] bg-white'
              : 'rounded-[16px_0_16px_16px] bg-surface-active',
          )}
        >
          {body}

          {/* Knowledge base refs (only Bot — kept inside bubble per Figma) */}
          {isBot && knowledgeRefs && knowledgeRefs.length > 0 && (
            <div className="mt-2 border-t border-link/20 pt-1.5">
              <p className="mb-0.5 text-[11px] text-ink-subtle">參考來源：</p>
              {knowledgeRefs.map((ref) => (
                <a
                  key={ref.id}
                  href={ref.url || '#'}
                  className="flex items-center gap-1 text-[11px] text-link hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  {ref.title}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Metadata row OUTSIDE bubble (per Figma) */}
        {(isBot && (confidence !== null || triggerType)) ||
        (isInbound && !isBot && sentiment) ? (
          <div
            className={cn(
              'flex flex-wrap items-center gap-1.5',
              isInbound ? 'justify-start' : 'justify-end',
            )}
          >
            {/* Bot confidence */}
            {isBot && confidence !== null && (
              <span
                className={cn(
                  'inline-flex items-center rounded-chip px-2 py-0.5 text-[11px] font-semibold',
                  getConfidenceColor(confidence),
                )}
              >
                {confidence >= 0.8 ? `${Math.round(confidence * 100)}% 高信心` : `信心值 ${Math.round(confidence * 100)}%`}
              </span>
            )}
            {/* Bot trigger type */}
            {isBot && triggerType && (
              <span className="inline-flex items-center rounded-chip bg-neutral-30 px-2 py-0.5 text-[11px] text-ink-subtle">
                {getTriggerLabel(triggerType)}
              </span>
            )}
            {/* Inbound sentiment */}
            {isInbound && !isBot && sentiment && (
              <>
                <span
                  className={cn(
                    'inline-flex items-center rounded-chip px-2 py-0.5 text-[11px] font-semibold',
                    getSentimentColor(sentiment.sentiment),
                  )}
                >
                  {getSentimentEmoji(sentiment.sentiment)} {getSentimentLabel(sentiment.sentiment)}
                </span>
                {sentiment.confidence != null && (
                  <span className="text-[11px] text-ink-subtle">
                    信心值 {Math.round(sentiment.confidence * 100)}%
                  </span>
                )}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
