'use client';

/**
 * ActionConfigEditor — 三種 action（訊息 / 網址 / Postback）的小型編輯器。
 *
 * 對齊 LINE OA 後台「動作」設定欄位，UI 為「類型下拉 + 動作內容輸入」兩格。
 */

import React from 'react';
import { Input } from '@/components/ui/input';

export type ActionConfig =
  | { type: 'message'; label: string; text: string }
  | { type: 'uri'; label: string; uri: string; altUriDesktop?: string }
  | { type: 'postback'; label: string; data: string; displayText?: string };

const ACTION_TYPE_OPTIONS: Array<{ value: ActionConfig['type']; label: string }> = [
  { value: 'message', label: '文字訊息' },
  { value: 'uri', label: '網址連結' },
  { value: 'postback', label: 'Postback（觸發事件）' },
];

interface Props {
  action: ActionConfig | undefined;
  onChange: (next: ActionConfig | undefined) => void;
  /** 是否顯示「移除動作」按鈕（給選填欄位用） */
  optional?: boolean;
  /** 顯示在 label 欄位的最大字數限制（多頁訊息 15 / 圖文 imagemap 不限） */
  labelLimit?: number;
  /**
   * 可用的 action 型別白名單。imagemap 傳入不含 'postback' 的清單——
   * LINE imagemap 官方只支援 uri/message/clipboard，postback 會被降級，故不給選。
   * 未傳則全部可選。
   */
  allowedTypes?: Array<ActionConfig['type']>;
}

export function ActionConfigEditor({ action, onChange, optional, labelLimit = 20, allowedTypes }: Props) {
  const cur = action ?? ({ type: 'uri', label: '', uri: '' } as ActionConfig);
  const typeOptions = allowedTypes
    ? ACTION_TYPE_OPTIONS.filter((o) => allowedTypes.includes(o.value))
    : ACTION_TYPE_OPTIONS;

  const updateType = (type: ActionConfig['type']) => {
    if (type === 'message') onChange({ type: 'message', label: cur.label, text: '' });
    else if (type === 'uri') onChange({ type: 'uri', label: cur.label, uri: '' });
    else onChange({ type: 'postback', label: cur.label, data: '' });
  };

  const updateLabel = (label: string) => {
    if (!action) onChange({ ...cur, label });
    else onChange({ ...action, label });
  };

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3 bg-slate-50">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">動作標籤的說明</span>
        <Input
          value={cur.label}
          maxLength={labelLimit}
          onChange={(e) => updateLabel(e.target.value)}
          placeholder="輸入動作標籤"
          className="flex-1 bg-white"
        />
        <span className="text-slate-400 tabular-nums w-12 text-right">{cur.label.length}/{labelLimit}</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500 w-16">類型</span>
        <select
          value={cur.type}
          onChange={(e) => updateType(e.target.value as ActionConfig['type'])}
          className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          {typeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <ActionContentInput action={cur} onChange={onChange} />
      {optional && action && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="text-xs text-red-600 hover:underline"
        >
          移除此動作
        </button>
      )}
    </div>
  );
}

function ActionContentInput({ action, onChange }: { action: ActionConfig; onChange: (next: ActionConfig) => void }) {
  if (action.type === 'message') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500 w-16">訊息內容</span>
        <Input
          value={action.text}
          maxLength={300}
          onChange={(e) => onChange({ ...action, text: e.target.value })}
          placeholder="點擊後送出的文字"
          className="flex-1 bg-white"
        />
      </div>
    );
  }
  if (action.type === 'uri') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500 w-16">網址</span>
        <Input
          value={action.uri}
          onChange={(e) => onChange({ ...action, uri: e.target.value })}
          placeholder="https://... 或 tel:0912345678"
          className="flex-1 bg-white"
        />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-500 w-16">回傳資料</span>
      <Input
        value={action.data}
        maxLength={300}
        onChange={(e) => onChange({ ...action, data: e.target.value })}
        placeholder="webhook 收到的 payload"
        className="flex-1 bg-white"
      />
    </div>
  );
}
