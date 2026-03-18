'use client';

import React, { useState } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export function SimulatorPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [channel, setChannel] = useState('LINE');
  const [contactName, setContactName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Only show in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    setStatus(null);

    try {
      await api.post('/simulator/send-message', {
        channelType: channel,
        contactName: contactName.trim() || undefined,
        externalId: externalId.trim() || undefined,
        content: message.trim(),
        contentType: 'text',
      });
      setStatus({ type: 'success', text: '訊息已傳送！' });
      setMessage('');
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setStatus({
        type: 'error',
        text: axiosError.response?.data?.message || '傳送失敗',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
          title="開啟模擬器"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* Panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-80 rounded-lg border bg-background shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">訊息模擬器</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded p-1 hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="space-y-3 p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                渠道
              </label>
              <Select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                options={[
                  { value: 'LINE', label: 'LINE' },
                  { value: 'FACEBOOK', label: 'Facebook' },
                  { value: 'WEBCHAT', label: 'WebChat' },
                ]}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                聯繫人名稱（選填）
              </label>
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="例：王小明"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                外部 ID（選填）
              </label>
              <Input
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="e.g. U1234567890"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                訊息
              </label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="輸入客戶訊息..."
                rows={3}
              />
            </div>

            {status && (
              <p
                className={cn(
                  'text-xs',
                  status.type === 'success' ? 'text-green-600' : 'text-destructive'
                )}
              >
                {status.text}
              </p>
            )}

            <Button
              className="w-full"
              onClick={handleSend}
              disabled={!message.trim() || sending}
            >
              <Send className="mr-2 h-4 w-4" />
              {sending ? '傳送中...' : '以客戶身份傳送'}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
