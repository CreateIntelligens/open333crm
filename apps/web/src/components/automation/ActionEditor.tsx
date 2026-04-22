'use client';

import React, { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const ACTION_TYPES = [
  { value: 'send_message', label: '傳送訊息' },
  { value: 'llm_reply', label: 'LLM 智能回覆' },
  { value: 'kb_auto_reply', label: 'KB 知識庫回覆' },
  { value: 'create_case', label: '建立工單' },
  { value: 'update_case_status', label: '更新工單狀態' },
  { value: 'escalate_case', label: '升級工單' },
  { value: 'add_tag', label: '新增標籤' },
  { value: 'remove_tag', label: '移除標籤' },
  { value: 'assign_agent', label: '指派客服' },
  { value: 'assign_bot', label: '指派機器人' },
  { value: 'notify', label: '傳送通知' },
  { value: 'notify_supervisor', label: '通知主管' },
];

const CASE_STATUSES = [
  { value: 'OPEN', label: '開啟' },
  { value: 'IN_PROGRESS', label: '處理中' },
  { value: 'ESCALATED', label: '已升級' },
  { value: 'RESOLVED', label: '已解決' },
  { value: 'CLOSED', label: '已關閉' },
];

const CASE_PRIORITIES = [
  { value: 'LOW', label: '低' },
  { value: 'MEDIUM', label: '中' },
  { value: 'HIGH', label: '高' },
  { value: 'URGENT', label: '緊急' },
];

interface ActionEditorProps {
  action: { type: string; payload: Record<string, unknown> };
  onChange: (action: { type: string; payload: Record<string, unknown> }) => void;
  onRemove: () => void;
}

function PayloadField({
  label,
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm"
      />
    </div>
  );
}

function ActionParamsForm({
  type,
  payload: rawPayload,
  onChange,
}: {
  type: string;
  payload: Record<string, unknown>;
  onChange: (payload: Record<string, unknown>) => void;
}) {
  const payload = rawPayload || {};
  const updateParam = (key: string, value: unknown) => {
    onChange({ ...payload, [key]: value });
  };

  switch (type) {
    case 'send_message':
      return (
        <PayloadField
          label="訊息內容"
          value={(payload.text as string) || ''}
          onChange={(v) => updateParam('text', v)}
          placeholder="輸入要發送的訊息..."
        />
      );

    case 'llm_reply':
      return (
        <PayloadField
          label="系統提示（選填）"
          value={(payload.systemPrompt as string) || ''}
          onChange={(v) => updateParam('systemPrompt', v)}
          placeholder="自訂 LLM 系統提示，留空使用預設..."
        />
      );

    case 'kb_auto_reply':
    case 'assign_bot':
      return (
        <p className="text-xs text-muted-foreground">此動作無需額外參數</p>
      );

    case 'add_tag':
    case 'remove_tag':
      return (
        <PayloadField
          label="標籤名稱"
          value={(payload.tagName as string) || ''}
          onChange={(v) => updateParam('tagName', v)}
          placeholder="輸入標籤名稱..."
        />
      );

    case 'create_case':
      return (
        <div className="space-y-2">
          <PayloadField
            id="case-title"
            label="工單標題"
            value={(payload.title as string) || ''}
            onChange={(v) => updateParam('title', v)}
            placeholder="自動建立的工單標題..."
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="case-priority" className="mb-1 block text-xs font-medium text-muted-foreground">
                優先級
              </label>
              <Select
                id="case-priority"
                options={CASE_PRIORITIES}
                value={(payload.priority as string) || 'MEDIUM'}
                onChange={(e) => updateParam('priority', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <PayloadField
              id="case-category"
              label="分類"
              value={(payload.category as string) || ''}
              onChange={(v) => updateParam('category', v)}
              placeholder="工單分類..."
            />
          </div>
        </div>
      );

    case 'update_case_status':
      return (
        <div>
          <label htmlFor="case-status" className="mb-1 block text-xs font-medium text-muted-foreground">
            目標狀態
          </label>
          <Select
            id="case-status"
            options={CASE_STATUSES}
            value={(payload.status as string) || 'OPEN'}
            onChange={(e) => updateParam('status', e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      );

    case 'escalate_case':
      return (
        <div className="space-y-2">
          <PayloadField
            id="escalate-reason"
            label="升級原因"
            value={(payload.reason as string) || ''}
            onChange={(v) => updateParam('reason', v)}
            placeholder="升級原因..."
          />
          <div>
            <label htmlFor="escalate-priority" className="mb-1 block text-xs font-medium text-muted-foreground">
              新優先級
            </label>
            <Select
              id="escalate-priority"
              options={CASE_PRIORITIES}
              value={(payload.newPriority as string) || ''}
              onChange={(e) => updateParam('newPriority', e.target.value)}
              className="h-8 text-sm"
              placeholder="留空自動提升一級"
            />
          </div>
        </div>
      );

    case 'assign_agent':
      return (
        <PayloadField
          label="Agent UUID"
          value={(payload.agentId as string) || ''}
          onChange={(v) => updateParam('agentId', v)}
          placeholder="輸入客服 Agent ID..."
        />
      );

    case 'notify':
    case 'notify_supervisor':
      return (
        <PayloadField
          label="通知訊息"
          value={(payload.message as string) || ''}
          onChange={(v) => updateParam('message', v)}
          placeholder="輸入通知內容..."
        />
      );

    default: {
      // Fallback: raw JSON editor for unknown types
      return <JsonFallbackEditor payload={payload} onChange={onChange} />;
    }
  }
}

function JsonFallbackEditor({
  payload,
  onChange,
}: {
  payload: Record<string, unknown>;
  onChange: (payload: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(JSON.stringify(payload, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(JSON.stringify(payload, null, 2));
  }, [payload]);

  const handleBlur = () => {
    try {
      const parsed = JSON.parse(text);
      setError(null);
      onChange(parsed);
    } catch {
      setError('JSON 格式無效');
    }
  };

  return (
    <div>
      <label htmlFor="payload-json" className="mb-1 block text-xs font-medium text-muted-foreground">
        承載資料 (JSON)
      </label>
      <textarea
        id="payload-json"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onBlur={handleBlur}
        rows={4}
        spellCheck={false}
        className="w-full rounded-md border border-input bg-background p-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function ActionEditor({ action, onChange, onRemove }: ActionEditorProps) {
  // Normalize: backend may use "params" instead of "payload"
  const payload = action.payload || (action as any).params || {};

  return (
    <div className="flex gap-3 rounded-md border border-input bg-muted/30 p-3">
      <div className="flex flex-1 flex-col gap-2">
        <div>
          <label htmlFor="action-type" className="mb-1 block text-xs font-medium text-muted-foreground">
            動作類型
          </label>
          <Select
            id="action-type"
            options={ACTION_TYPES}
            value={action.type}
            onChange={(e) => onChange({ type: e.target.value, payload: {} })}
            placeholder="選擇動作類型..."
            className="h-9 text-sm"
          />
        </div>
        <ActionParamsForm
          type={action.type}
          payload={payload}
          onChange={(p) => onChange({ ...action, payload: p })}
        />
      </div>
      <div className="pt-5">
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
