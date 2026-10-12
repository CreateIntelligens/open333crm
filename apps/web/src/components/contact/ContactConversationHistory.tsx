'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { Button } from '@/components/ui/button';
import { ChannelLabel } from '@/components/shared/ChannelLabel';

interface HistoryMessage {
  id: string;
  channelType: string;
  channelName?: string | null;
  direction: string;
  senderType: string;
  contentType: string;
  content?: { text?: string } | null;
  createdAt: string;
}

interface HistoryPage {
  messages: HistoryMessage[];
  hiddenConversationCount: number;
  nextCursor: string | null;
}

const PAGE_SIZE = 50;

const SENDER_LABEL: Record<string, string> = { CONTACT: '顧客', AGENT: '客服', BOT: 'AI', SYSTEM: '系統' };

function messageText(m: HistoryMessage): string {
  if (m.content?.text) return m.content.text;
  const labels: Record<string, string> = { image: '[圖片]', video: '[影片]', audio: '[語音]', file: '[檔案]', sticker: '[貼圖]' };
  return labels[m.contentType] ?? '[非文字訊息]';
}

/**
 * 聯絡人頁「對話紀錄」：所有可見渠道的訊息依時間排成一條（change add-email-identity-merge）。
 * 對應 API：GET /contacts/:id/messages（看不到的渠道只回傳數量）
 */
export function ContactConversationHistory({ contactId }: { contactId: string }) {
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const query = `limit=${PAGE_SIZE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
        const res = await api.get(`/contacts/${contactId}/messages?${query}`);
        const page = res.data.data as HistoryPage;
        // 更早的一頁接在前面；以 id 去重，避免重複點擊時同一則出現兩次
        setMessages((prev) => {
          const base = before ? prev : [];
          const seen = new Set(base.map((m) => m.id));
          return [...page.messages.filter((m) => !seen.has(m.id)), ...base];
        });
        setHiddenCount(page.hiddenConversationCount);
        setCursor(page.nextCursor);
      } catch (err) {
        setError(getApiErrorMessage(err, '請稍後重試'));
      } finally {
        setLoading(false);
      }
    },
    [contactId],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  return (
    <div className="space-y-3">
      {cursor && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={loading} onClick={() => load(cursor)}>
            載入更早的訊息
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">對話紀錄載入失敗：{error}</p>}
      {loading && messages.length === 0 && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {!loading && !error && messages.length === 0 && <p className="text-sm text-muted-foreground">沒有對話紀錄</p>}
      <div className="space-y-2">
        {messages.map((m) => {
          const inbound = m.direction === 'INBOUND';
          return (
            <div key={m.id} data-testid="history-message" className={`flex flex-col ${inbound ? 'items-start' : 'items-end'}`}>
              <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ChannelLabel channelType={m.channelType} channelName={m.channelName} nameClassName="max-w-[10rem]" />
                <span>{SENDER_LABEL[m.senderType] ?? (inbound ? '顧客' : '客服')}</span>
                <span>{new Date(m.createdAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <div
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
                  inbound ? 'bg-muted' : 'bg-primary-subtle'
                }`}
              >
                {messageText(m)}
              </div>
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 && <p className="text-xs text-muted-foreground">另有 {hiddenCount} 段其他渠道的對話，你沒有權限查看</p>}
    </div>
  );
}
