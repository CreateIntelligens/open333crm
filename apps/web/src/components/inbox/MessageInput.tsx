'use client';

import React, { useState, useRef } from 'react';
import { Send, Paperclip, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import type { ChannelType } from '@open333crm/shared';
import { CHANNEL_TYPE } from '@open333crm/shared';

interface MessageInputProps {
  onSend: (content: string, contentType?: string, contentData?: Record<string, unknown>) => Promise<void>;
  conversationId: string;
  channelType: ChannelType | string;
  disabled?: boolean;
  disabledReason?: string;
  isBotHandled?: boolean;
  onTakeover?: () => void;
  onOpenTemplates?: () => void;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ACCEPTED_TYPES = 'image/png,image/jpeg';
export function MessageInput({
  onSend,
  conversationId,
  channelType,
  disabled,
  disabledReason,
  isBotHandled,
  onTakeover,
  onOpenTemplates,
}: MessageInputProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDisabled = disabled || isBotHandled || sending;

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed || isDisabled) return;

    setSending(true);
    try {
      await onSend(trimmed);
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === 'Enter'
      && !e.shiftKey
      && !e.nativeEvent.isComposing
      && e.nativeEvent.keyCode !== 229
    ) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      alert('只支援 PNG / JPG 圖片');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      alert('檔案大小超過 20MB 限制');
      return;
    }

    setSending(true);
    try {
      if ([CHANNEL_TYPE.LINE, CHANNEL_TYPE.FB, CHANNEL_TYPE.WEBCHAT].includes(channelType as any)) {
        const formData = new FormData();
        formData.append('file', file);

        await api.post(`/conversations/${conversationId}/send-image`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        alert('目前僅支援 LINE / FB / Webchat 聊天室傳送圖片');
      }
    } catch (err: any) {
      console.error('Failed to send image:', err);
      alert(`傳送失敗：${err?.response?.data?.message ?? err?.message ?? '未知錯誤'}`);
    } finally {
      setSending(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Fill message from template
  const setMessageFromTemplate = (text: string) => {
    setMessage(text);
    // Focus textarea
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  };

  // Expose setMessageFromTemplate via a ref callback attached to a data attribute
  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      (textarea as any).__setMessage = setMessageFromTemplate;
    }
  });

  const placeholder = disabledReason
    || (isBotHandled ? 'Bot 處理中，點擊「接管對話」以開始回覆' : '輸入訊息...（Enter 傳送，Shift+Enter 換行）');

  return (
    <div className="shrink-0 border-t border-surface-line bg-white">
      {/* Bot takeover CTA */}
      {isBotHandled && onTakeover && (
        <div className="flex items-center justify-center border-b border-surface-line bg-brand-10/40 px-4 py-2">
          <Button
            size="sm"
            variant="default"
            className="bg-brand text-white hover:bg-brand-70"
            onClick={onTakeover}
          >
            接管對話
          </Button>
        </div>
      )}

      {/* Input row — Figma 922:33188, padding 16, gap 8 */}
      <div className="flex items-center gap-2 p-4">
        {/* Template button (50x50 icon button) */}
        <button
          type="button"
          onClick={onOpenTemplates}
          disabled={isDisabled}
          title="範本"
          className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-card border border-surface-line bg-white text-ink transition-colors hover:bg-neutral-20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LayoutTemplate className="h-5 w-5" />
        </button>

        {/* Attachment button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isDisabled}
          title="附件"
          className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-card border border-surface-line bg-white text-ink transition-colors hover:bg-neutral-20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Input bar (#F8FAFC bg, border, radius 8, padding 12) */}
        <div className="flex flex-1 items-center gap-1 rounded-lg border border-surface-line bg-surface-canvas px-3 py-2.5">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={placeholder}
            disabled={isDisabled}
            rows={1}
            className="w-full resize-none bg-transparent text-[14px] leading-6 text-ink placeholder:text-ink-subtle focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            style={{ minHeight: '24px', maxHeight: '120px' }}
          />
        </div>

        {/* Send button — primary blue 50x50 */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!message.trim() || isDisabled}
          title="傳送"
          className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-card bg-[#378ADD] text-white transition-colors hover:bg-[#2876C4] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

