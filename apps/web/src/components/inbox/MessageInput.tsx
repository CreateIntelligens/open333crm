'use client';

import React, { useState, useRef } from 'react';
import { Send, Paperclip, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MessageInputProps {
  onSend: (content: string, contentType?: string, contentData?: Record<string, unknown>) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
  isBotHandled?: boolean;
  onTakeover?: () => void;
  onOpenTemplates?: () => void;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/gif,image/webp,application/pdf';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export function MessageInput({
  onSend,
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
    if (e.key === 'Enter' && !e.shiftKey) {
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

    if (file.size > MAX_FILE_SIZE) {
      alert('檔案大小超過 20MB 限制');
      return;
    }

    setSending(true);
    try {
      // Upload to storage service via FormData
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_URL}/files/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        // Fallback to base64 if storage service unavailable
        const dataUrl = await readFileAsDataUrl(file);
        const contentType = file.type.startsWith('image/') ? 'image' : 'file';
        await onSend(dataUrl, contentType, { url: dataUrl, fileName: file.name, mimeType: file.type });
        return;
      }

      const json = await res.json();
      const { url, key, mimeType } = json.data;
      const contentType = file.type.startsWith('image/') ? 'image' : 'file';
      await onSend(url, contentType, { url, key, fileName: file.name, mimeType: mimeType || file.type });
    } catch (err) {
      console.error('Failed to send file:', err);
    } finally {
      setSending(false);
      // Reset file input
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
    <div className="border-t bg-background">
      {/* Bot takeover CTA */}
      {isBotHandled && onTakeover && (
        <div className="flex items-center justify-center border-b bg-purple-50/50 px-4 py-2">
          <Button
            size="sm"
            variant="default"
            className="bg-purple-600 hover:bg-purple-700 text-white"
            onClick={onTakeover}
          >
            接管對話
          </Button>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-end gap-2">
          {/* Attachment button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            disabled={isDisabled}
            onClick={() => fileInputRef.current?.click()}
            title="附件"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Template button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            disabled={isDisabled}
            onClick={onOpenTemplates}
            title="模板"
          >
            <LayoutTemplate className="h-4 w-4" />
          </Button>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={placeholder}
            disabled={isDisabled}
            rows={1}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ minHeight: '40px', maxHeight: '120px' }}
          />

          {/* Send button */}
          <Button
            onClick={handleSend}
            disabled={!message.trim() || isDisabled}
            size="icon"
            className="shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
