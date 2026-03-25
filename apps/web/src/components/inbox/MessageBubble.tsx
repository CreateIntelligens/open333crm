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

function extractImageUrl(content: string | { url?: string; text?: string } | unknown): string | null {
  if (typeof content === 'object' && content !== null) {
    const obj = content as Record<string, unknown>;
    if (obj.url && typeof obj.url === 'string') return obj.url;
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
}

export function MessageBubble({ message }: MessageBubbleProps) {
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

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-muted px-3 py-1 text-xs italic text-muted-foreground">
          {textContent}
        </span>
      </div>
    );
  }

  // Determine bubble color
  const getBubbleClasses = () => {
    if (isBot) {
      return 'rounded-bl-md bg-purple-100 text-purple-900';
    }
    if (isInbound) {
      return 'rounded-bl-md bg-muted text-foreground';
    }
    return 'rounded-br-md bg-primary text-primary-foreground';
  };

  const getTimeClasses = () => {
    if (isBot) return 'text-purple-500';
    if (isInbound) return 'text-muted-foreground';
    return 'text-primary-foreground/70';
  };

  // Confidence badge color
  const getConfidenceColor = (val: number) => {
    if (val >= 0.8) return 'bg-green-100 text-green-700';
    if (val >= 0.5) return 'bg-orange-100 text-orange-700';
    return 'bg-red-100 text-red-700';
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
    if (s === 'positive') return 'bg-green-100 text-green-700';
    if (s === 'negative') return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-600';
  };
  const getSentimentEmoji = (s: string) => {
    if (s === 'positive') return '😊';
    if (s === 'negative') return '😟';
    return '😐';
  };
  const getSentimentLabel = (s: string) => {
    if (s === 'positive') return '正面';
    if (s === 'negative') return '負面';
    return '中性';
  };

  return (
    <div
      className={cn('flex w-full gap-2 px-4 py-1', isInbound || isBot ? 'justify-start' : 'justify-end')}
    >
      <div className={cn('max-w-[70%] rounded-2xl px-4 py-2', getBubbleClasses())}>
        {/* Bot label */}
        {isBot && (
          <div className="mb-1 flex items-center gap-1">
            <Bot className="h-3 w-3 text-purple-600" />
            <span className="text-[10px] font-medium text-purple-600">Bot</span>
          </div>
        )}

        {/* Sender name for inbound */}
        {message.senderName && isInbound && !isBot && (
          <p className="mb-0.5 text-xs font-medium opacity-70">{message.senderName}</p>
        )}

        {/* Content */}
        {message.contentType === 'image' ? (
          <img
            src={extractImageUrl(message.content) || textContent}
            alt="Image message"
            className="max-w-full rounded-lg"
          />
        ) : (
          <p className="text-sm whitespace-pre-wrap break-words">{textContent}</p>
        )}

        {/* Bot extras: confidence + trigger type */}
        {isBot && (confidence !== null || triggerType) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {confidence !== null && (
              <span className={cn('inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium', getConfidenceColor(confidence))}>
                信心值 {Math.round(confidence * 100)}%
              </span>
            )}
            {triggerType && (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                {getTriggerLabel(triggerType)}
              </span>
            )}
          </div>
        )}

        {/* Knowledge base refs */}
        {isBot && knowledgeRefs && knowledgeRefs.length > 0 && (
          <div className="mt-1.5 border-t border-purple-200 pt-1.5">
            <p className="text-[10px] text-purple-500 mb-0.5">參考來源：</p>
            {knowledgeRefs.map((ref) => (
              <a
                key={ref.id}
                href={ref.url || '#'}
                className="flex items-center gap-1 text-[10px] text-purple-600 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-2.5 w-2.5" />
                {ref.title}
              </a>
            ))}
          </div>
        )}

        {/* Sentiment badge for inbound messages */}
        {isInbound && !isBot && sentiment && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className={cn('inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium', getSentimentColor(sentiment.sentiment))}>
              {getSentimentEmoji(sentiment.sentiment)} {getSentimentLabel(sentiment.sentiment)}
            </span>
            {sentiment.confidence != null && (
              <span className="text-[10px] text-muted-foreground">
                信心值 {Math.round(sentiment.confidence * 100)}%
              </span>
            )}
          </div>
        )}

        {/* Timestamp */}
        <p className={cn('mt-1 text-[10px]', getTimeClasses())}>
          {format(new Date(message.createdAt), 'HH:mm')}
        </p>
      </div>
    </div>
  );
}
