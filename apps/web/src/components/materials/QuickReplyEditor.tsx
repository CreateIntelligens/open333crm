'use client';

import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface QuickReplyItem {
  label: string;
  text?: string;
}

interface Props {
  value: QuickReplyItem[];
  onChange: (next: QuickReplyItem[]) => void;
}

const MAX_QUICK_REPLIES = 13;
const LABEL_MAX = 20;

export function QuickReplyEditor({ value, onChange }: Props) {
  const [draftLabel, setDraftLabel] = useState('');
  const [draftText, setDraftText] = useState('');

  const handleAdd = () => {
    const label = draftLabel.trim();
    if (!label) return;
    if (value.length >= MAX_QUICK_REPLIES) return;
    onChange([...value, { label, text: draftText.trim() || undefined }]);
    setDraftLabel('');
    setDraftText('');
  };

  const handleRemove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-500">
        最多 {MAX_QUICK_REPLIES} 個按鈕，會顯示在訊息底部供用戶點擊（{value.length}/{MAX_QUICK_REPLIES}）
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((qr, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs"
              title={qr.text ? `送出文字：${qr.text}` : `送出文字：${qr.label}`}
            >
              <span className="font-medium">{qr.label}</span>
              {qr.text && qr.text !== qr.label && (
                <span className="text-slate-400">→ {qr.text}</span>
              )}
              <button
                type="button"
                className="ml-0.5 text-slate-400 hover:text-red-500"
                onClick={() => handleRemove(idx)}
                title="移除"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {value.length < MAX_QUICK_REPLIES && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value.slice(0, LABEL_MAX))}
            placeholder="例：同意"
            className="w-32 h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <Input
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="例：我同意（可留空 = 直接送「同意」）"
            className="flex-1 min-w-[200px] h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            onClick={handleAdd}
            disabled={!draftLabel.trim()}
          >
            <Plus className="mr-1 h-3 w-3" />
            加入
          </Button>
        </div>
      )}
    </div>
  );
}
