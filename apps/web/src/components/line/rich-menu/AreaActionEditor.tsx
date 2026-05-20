'use client';

/**
 * 單一區域的 Action 編輯器
 *
 * 5 種 action：
 *   - postback：data + label + displayText
 *   - message：text + label
 *   - uri：uri + label + altUri.desktop
 *   - datetimepicker：data + mode + initial/min/max + label
 *   - richmenuswitch：richMenuAliasId + data + label（顯示警告）
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { RichMenuAction, RichMenuActionType } from '@/hooks/useRichMenus';

interface Props {
  action: RichMenuAction;
  onChange: (next: RichMenuAction) => void;
}

const ACTION_TYPE_OPTIONS = [
  { value: 'postback', label: '回傳資料（postback）' },
  { value: 'message', label: '傳送訊息（message）' },
  { value: 'uri', label: '開啟網址（uri）' },
  { value: 'datetimepicker', label: '日期時間選擇' },
  { value: 'richmenuswitch', label: '切換 Rich Menu' },
];

export function AreaActionEditor({ action, onChange }: Props) {
  const handleTypeChange = (newType: RichMenuActionType) => {
    // 切換 type 時保留 label，其餘清空
    onChange({ type: newType, label: action.label });
  };

  return (
    <div className="space-y-2 rounded-md bg-slate-50 p-3">
      <div>
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">動作類型</label>
        <Select
          value={action.type}
          onChange={(e) => handleTypeChange(e.target.value as RichMenuActionType)}
          options={ACTION_TYPE_OPTIONS}
        />
      </div>

      <div>
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">標籤（≤ 20 字，選填）</label>
        <Input
          value={action.label ?? ''}
          onChange={(e) => onChange({ ...action, label: e.target.value })}
          maxLength={20}
        />
      </div>

      {action.type === 'postback' && (
        <>
          <FieldLabel>Data（必填，≤ 300 字）</FieldLabel>
          <Input
            value={action.data ?? ''}
            onChange={(e) => onChange({ ...action, data: e.target.value })}
            maxLength={300}
            placeholder="例：menu=main"
          />
          <FieldLabel>對話顯示文字（選填，≤ 300 字）</FieldLabel>
          <Input
            value={action.displayText ?? ''}
            onChange={(e) => onChange({ ...action, displayText: e.target.value })}
            maxLength={300}
          />
        </>
      )}

      {action.type === 'message' && (
        <>
          <FieldLabel>訊息內容（必填，≤ 300 字）</FieldLabel>
          <Input
            value={action.text ?? ''}
            onChange={(e) => onChange({ ...action, text: e.target.value })}
            maxLength={300}
          />
        </>
      )}

      {action.type === 'uri' && (
        <>
          <FieldLabel>網址（必填）</FieldLabel>
          <Input
            value={action.uri ?? ''}
            onChange={(e) => onChange({ ...action, uri: e.target.value })}
            placeholder="https://..."
          />
          <FieldLabel>桌面端網址（選填）</FieldLabel>
          <Input
            value={action.altUri?.desktop ?? ''}
            onChange={(e) => onChange({ ...action, altUri: { desktop: e.target.value } })}
          />
        </>
      )}

      {action.type === 'datetimepicker' && (
        <>
          <FieldLabel>Data（必填）</FieldLabel>
          <Input
            value={action.data ?? ''}
            onChange={(e) => onChange({ ...action, data: e.target.value })}
          />
          <FieldLabel>選擇模式</FieldLabel>
          <Select
            value={action.mode ?? 'datetime'}
            onChange={(e) => onChange({ ...action, mode: e.target.value as 'date' | 'time' | 'datetime' })}
            options={[
              { value: 'date', label: '日期' },
              { value: 'time', label: '時間' },
              { value: 'datetime', label: '日期 + 時間' },
            ]}
          />
          <FieldLabel>初始值（選填）</FieldLabel>
          <Input
            value={action.initial ?? ''}
            onChange={(e) => onChange({ ...action, initial: e.target.value })}
            placeholder="如 2026-01-01"
          />
        </>
      )}

      {action.type === 'richmenuswitch' && (
        <>
          <div className="flex items-start gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>目標 Rich Menu 需先 publish 並設 alias 後此 action 才會生效。</span>
          </div>
          <FieldLabel>Rich Menu Alias ID（必填）</FieldLabel>
          <Input
            value={action.richMenuAliasId ?? ''}
            onChange={(e) => onChange({ ...action, richMenuAliasId: e.target.value })}
            placeholder="例：alias-member-menu"
          />
          <FieldLabel>Data（必填）</FieldLabel>
          <Input
            value={action.data ?? ''}
            onChange={(e) => onChange({ ...action, data: e.target.value })}
          />
        </>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mt-1 mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{children}</label>;
}
