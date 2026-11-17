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
 *
 * 版面依 Claude Design「Rich Menu 編輯器」區域卡片：動作類型與標籤並排，其餘欄位依類型顯示。
 */

import React, { useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { RichMenuAction, RichMenuActionType } from '@/hooks/useRichMenus';

interface Props {
  action: RichMenuAction;
  onChange: (next: RichMenuAction) => void;
}

export const ACTION_TYPE_OPTIONS = [
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
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="動作類型" required>
          {(id) => (
            <Select
              id={id}
              value={action.type}
              onChange={(e) => handleTypeChange(e.target.value as RichMenuActionType)}
              options={ACTION_TYPE_OPTIONS}
            />
          )}
        </Field>
        <Field label="標籤" optional counter={`${(action.label ?? '').length} / 20`}>
          {(id) => (
            <Input
              id={id}
              value={action.label ?? ''}
              onChange={(e) => onChange({ ...action, label: e.target.value })}
              maxLength={20}
            />
          )}
        </Field>
      </div>

      {action.type === 'postback' && (
        <>
          <Field label="Data" required hint="最多 300 字，好友點擊後會回傳給系統">
            {(id) => (
              <Input
                id={id}
                value={action.data ?? ''}
                onChange={(e) => onChange({ ...action, data: e.target.value })}
                maxLength={300}
                placeholder="例：menu=main"
              />
            )}
          </Field>
          <Field label="對話顯示文字" optional hint="最多 300 字，點擊後以好友身分顯示在聊天室">
            {(id) => (
              <Input
                id={id}
                value={action.displayText ?? ''}
                onChange={(e) => onChange({ ...action, displayText: e.target.value })}
                maxLength={300}
              />
            )}
          </Field>
        </>
      )}

      {action.type === 'message' && (
        <Field label="訊息內容" required hint="最多 300 字">
          {(id) => (
            <Input
              id={id}
              value={action.text ?? ''}
              onChange={(e) => onChange({ ...action, text: e.target.value })}
              maxLength={300}
            />
          )}
        </Field>
      )}

      {action.type === 'uri' && (
        <>
          <Field label="網址" required>
            {(id) => (
              <Input
                id={id}
                value={action.uri ?? ''}
                onChange={(e) => onChange({ ...action, uri: e.target.value })}
                placeholder="https://..."
              />
            )}
          </Field>
          <Field label="桌面端網址" optional hint="在電腦版 LINE 點擊時改開這個網址；未填則開上方網址">
            {(id) => (
              <Input
                id={id}
                value={action.altUri?.desktop ?? ''}
                onChange={(e) => onChange({ ...action, altUri: { desktop: e.target.value } })}
                placeholder="https://"
              />
            )}
          </Field>
        </>
      )}

      {action.type === 'datetimepicker' && (
        <>
          <Field label="Data" required>
            {(id) => (
              <Input
                id={id}
                value={action.data ?? ''}
                onChange={(e) => onChange({ ...action, data: e.target.value })}
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="選擇模式">
              {(id) => (
                <Select
                  id={id}
                  value={action.mode ?? 'datetime'}
                  onChange={(e) => onChange({ ...action, mode: e.target.value as 'date' | 'time' | 'datetime' })}
                  options={[
                    { value: 'date', label: '日期' },
                    { value: 'time', label: '時間' },
                    { value: 'datetime', label: '日期 + 時間' },
                  ]}
                />
              )}
            </Field>
            <Field label="初始值" optional>
              {(id) => (
                <Input
                  id={id}
                  value={action.initial ?? ''}
                  onChange={(e) => onChange({ ...action, initial: e.target.value })}
                  placeholder="如 2026-01-01"
                />
              )}
            </Field>
          </div>
        </>
      )}

      {action.type === 'richmenuswitch' && (
        <>
          <div role="note" className="flex items-start gap-2 rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
            <span>目標 Rich Menu 需先 publish 並設 alias 後此 action 才會生效。</span>
          </div>
          <Field label="Rich Menu Alias ID" required>
            {(id) => (
              <Input
                id={id}
                value={action.richMenuAliasId ?? ''}
                onChange={(e) => onChange({ ...action, richMenuAliasId: e.target.value })}
                placeholder="例：alias-member-menu"
              />
            )}
          </Field>
          <Field label="Data" required>
            {(id) => (
              <Input
                id={id}
                value={action.data ?? ''}
                onChange={(e) => onChange({ ...action, data: e.target.value })}
              />
            )}
          </Field>
        </>
      )}
    </div>
  );
}

/** 欄位：標籤（必填星號／選填）、右側字數、下方說明 */
export function Field({
  label,
  required,
  optional,
  counter,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  counter?: string;
  hint?: React.ReactNode;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-foreground">
          {label}
          {required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
          {required && <span className="sr-only">（必填）</span>}
          {optional && <span className="ml-1 font-normal text-muted-foreground">（選填）</span>}
        </label>
        {counter && <span className="text-xs tabular-nums text-muted-foreground">{counter}</span>}
      </div>
      {children(id)}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
