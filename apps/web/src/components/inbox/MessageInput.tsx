'use client';

import React, { useState, useRef } from 'react';
import { Send, Paperclip, LayoutTemplate, Zap, X, Plus, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import type { ChannelType } from '@open333crm/shared';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { useQuickReplyPresets } from '@/hooks/useQuickReplyPresets';

interface QuickReplyItem {
  label: string;
  text?: string;
}

// LINE 規格：最多 13 個 quick reply items；label ≤ 20 字
const MAX_QUICK_REPLIES = 13;
const QUICK_REPLY_LABEL_MAX = 20;

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
  const [quickReplies, setQuickReplies] = useState<QuickReplyItem[]>([]);
  const [quickReplyEditorOpen, setQuickReplyEditorOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftText, setDraftText] = useState('');
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDisabled = disabled || isBotHandled || sending;
  const supportsQuickReply = channelType === CHANNEL_TYPE.LINE;

  // 只在 LINE channel 載入 presets（避免其他 channel 多餘請求）
  const { presets } = useQuickReplyPresets();

  const handleApplyPreset = (preset: { items: QuickReplyItem[] }) => {
    setQuickReplies(preset.items.slice(0, MAX_QUICK_REPLIES));
    setPresetMenuOpen(false);
    setQuickReplyEditorOpen(true);
  };

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed || isDisabled) return;

    setSending(true);
    try {
      const contentData = quickReplies.length > 0 ? { quickReplies } : undefined;
      await onSend(trimmed, 'text', contentData);
      setMessage('');
      setQuickReplies([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleAddQuickReply = () => {
    const label = draftLabel.trim();
    if (!label) return;
    if (quickReplies.length >= MAX_QUICK_REPLIES) return;
    const text = draftText.trim() || undefined;
    setQuickReplies([...quickReplies, { label, text }]);
    setDraftLabel('');
    setDraftText('');
  };

  const handleRemoveQuickReply = (idx: number) => {
    setQuickReplies(quickReplies.filter((_, i) => i !== idx));
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

  // Fill message from template；可一併帶入 quick replies
  const setMessageFromTemplate = (text: string, qrs?: QuickReplyItem[]) => {
    setMessage(text);
    if (qrs && qrs.length > 0) {
      setQuickReplies(qrs.slice(0, MAX_QUICK_REPLIES));
      setQuickReplyEditorOpen(true);
    }
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
        <div className="flex items-center justify-center border-b bg-ai-subtle/50 px-4 py-2">
          <Button
            size="sm"
            variant="default"
            className="bg-ai hover:bg-ai/90 text-white"
            onClick={onTakeover}
          >
            接管對話
          </Button>
        </div>
      )}

      <div className="p-4">
        {/* Quick reply chips + editor (LINE only) */}
        {supportsQuickReply && (quickReplies.length > 0 || quickReplyEditorOpen) && (
          <div className="mb-2 rounded-md border border-dashed border-input bg-muted p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-muted-foreground">
                快速回覆按鈕（{quickReplies.length}/{MAX_QUICK_REPLIES}）
              </div>
              <div className="flex items-center gap-1">
                {presets.length > 0 && (
                  <div className="relative">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded border border-input bg-white px-2 py-0.5 text-xs text-foreground hover:bg-muted"
                      onClick={() => setPresetMenuOpen((v) => !v)}
                    >
                      <ListChecks className="h-3 w-3" />
                      套用預設組
                    </button>
                    {presetMenuOpen && (
                      <div className="absolute right-0 top-full z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border border-border bg-white py-1 shadow-md">
                        {presets.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                            onClick={() => handleApplyPreset(p)}
                            title={p.items.map((i) => i.label).join(' / ')}
                          >
                            <div className="truncate font-medium">{p.name}</div>
                            <div className="truncate text-[10px] text-muted-foreground">
                              {p.items.length} 個 · {p.items.slice(0, 3).map((i) => i.label).join(' / ')}
                              {p.items.length > 3 ? ' …' : ''}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setQuickReplyEditorOpen((v) => !v)}
                >
                  {quickReplyEditorOpen ? '收合' : '展開'}
                </button>
              </div>
            </div>
            {quickReplies.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {quickReplies.map((qr, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 rounded-full border border-input bg-white px-2.5 py-1 text-xs"
                    title={qr.text ? `送出文字：${qr.text}` : `送出文字：${qr.label}`}
                  >
                    <span className="font-medium">{qr.label}</span>
                    {qr.text && qr.text !== qr.label && (
                      <span className="text-muted-foreground">→ {qr.text}</span>
                    )}
                    <button
                      type="button"
                      className="ml-0.5 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveQuickReply(idx)}
                      title="移除"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {quickReplyEditorOpen && quickReplies.length < MAX_QUICK_REPLIES && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <input
                  type="text"
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value.slice(0, QUICK_REPLY_LABEL_MAX))}
                  placeholder="按鈕文字"
                  className="w-32 rounded-md border border-input bg-background px-2 py-1 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddQuickReply();
                    }
                  }}
                />
                <input
                  type="text"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="點擊後送出文字（可留空 = 同按鈕文字）"
                  className="flex-1 min-w-[180px] rounded-md border border-input bg-background px-2 py-1 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddQuickReply();
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={handleAddQuickReply}
                  disabled={!draftLabel.trim()}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  加入
                </Button>
              </div>
            )}
          </div>
        )}

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

          {/* Quick reply button (LINE only) */}
          {supportsQuickReply && (
            <Button
              variant={quickReplies.length > 0 ? 'default' : 'ghost'}
              size="icon"
              className="h-9 w-9 shrink-0"
              disabled={isDisabled}
              onClick={() => setQuickReplyEditorOpen((v) => !v)}
              title="加快速回覆按鈕"
            >
              <Zap className="h-4 w-4" />
            </Button>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            data-message-input
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

