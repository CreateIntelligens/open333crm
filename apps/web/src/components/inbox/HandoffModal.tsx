'use client';

import React, { useState, useEffect } from 'react';
import { X, Loader2, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import useSWR from 'swr';

interface HandoffModalProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  onConfirm: () => void;
}

export function HandoffModal({ open, onClose, conversationId, onConfirm }: HandoffModalProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [assignToId, setAssignToId] = useState('');
  const [handoffMessage, setHandoffMessage] = useState('稍等，正在為您轉接客服人員');
  const [submitting, setSubmitting] = useState(false);

  // Fetch agent list
  const { data: agentsData } = useSWR(open ? '/agents' : null, (url: string) =>
    api.get(url).then((res) => res.data.data)
  );
  const agents: { id: string; name: string }[] = agentsData || [];

  // Fetch bot messages for this conversation
  const { data: messagesData } = useSWR(
    open ? `/conversations/${conversationId}/messages?limit=100` : null,
    (url: string) => api.get(url).then((res) => res.data.data)
  );
  const botMessages = (messagesData || []).filter(
    (m: { senderType: string }) => m.senderType === 'BOT'
  );

  // Load AI summary
  useEffect(() => {
    if (!open) { return; }
    setSummaryLoading(true);
    setSummary(null);
    api
      .post('/ai/summarize', { conversationId })
      .then((res) => setSummary(res.data.data.summary))
      .catch(() => setSummary('無法取得摘要'))
      .finally(() => setSummaryLoading(false));
  }, [open, conversationId]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await api.post(`/conversations/${conversationId}/handoff`, {
        assignToId: assignToId || undefined,
        handoffMessage,
      });
      onConfirm();
      onClose();
    } catch (err) {
      console.error('Handoff failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) { return null; }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-lg bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="text-lg font-semibold">接管 Bot 對話</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body */}
          <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-4">
            {/* Summary */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Bot 對話摘要</h3>
              {summaryLoading ? (
                <div className="flex items-center gap-2 rounded-md bg-muted p-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">正在生成摘要...</span>
                </div>
              ) : (
                <div className="rounded-md bg-muted p-3 text-sm">
                  {summary}
                </div>
              )}
            </div>

            {/* Bot message history */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                Bot 回覆記錄（{botMessages.length} 則）
              </h3>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
                {botMessages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">沒有 Bot 回覆記錄</p>
                ) : (
                  botMessages.map((msg: { id: string; content: { text?: string } | string; createdAt: string }) => {
                    const text = typeof msg.content === 'object' && msg.content !== null
                      ? (msg.content as { text?: string }).text || ''
                      : String(msg.content);
                    return (
                      <div key={msg.id} className="flex items-start gap-2 text-xs">
                        <Bot className="mt-0.5 h-3 w-3 shrink-0 text-purple-500" />
                        <p className="text-muted-foreground">{text}</p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Assign agent */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground">指派客服</h3>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  指派策略：最少負荷
                </span>
              </div>
              <select
                value={assignToId}
                onChange={(e) => setAssignToId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">自動指派（我自己）</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            {/* Handoff message */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">銜接訊息</h3>
              <textarea
                value={handoffMessage}
                onChange={(e) => setHandoffMessage(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                placeholder="發送給客戶的銜接訊息..."
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleConfirm} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  處理中...
                </>
              ) : (
                '確認接管'
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
