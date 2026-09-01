'use client';

/**
 * ActionConfigEditor — 三種 action（訊息 / 網址 / Postback）的小型編輯器。
 *
 * 對齊 LINE OA 後台「動作」設定欄位，UI 為「類型下拉 + 動作內容輸入」兩格。
 */

import React from 'react';
import { Input } from '@/components/ui/input';
import { useContactTags } from '@/hooks/useContactTags';

export type ActionConfig =
  | { type: 'message'; label: string; text: string }
  // uri 的 tagOnClick：點擊後貼標的 tagId（送出時灌進素材短連結，不進 LINE payload）
  | { type: 'uri'; label: string; uri: string; altUriDesktop?: string; tagOnClick?: string }
  | { type: 'postback'; label: string; data: string; displayText?: string };

/** 從 postback data 反解「點擊後貼標」的 tagId（格式 tag:<uuid>）。 */
function tagIdFromPostbackData(data: string): string {
  const m = data.match(/^tag:([0-9a-f-]{36})$/i);
  return m ? m[1] : '';
}

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
      {/* 點擊後貼標籤：postback（寫 data=tag:id）與 uri（寫 tagOnClick）支援；message 型不支援 */}
      {cur.type !== 'message' && <TagOnClickSelect action={cur} onChange={onChange} />}
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

/** 「點擊後貼標籤」下拉。postback 型 → data=tag:<id>；uri 型 → action.tagOnClick。 */
function TagOnClickSelect({ action, onChange }: { action: ActionConfig; onChange: (next: ActionConfig) => void }) {
  const { tags, isLoading } = useContactTags();

  // 目前選中的 tagId：postback 從 data 反解、uri 讀 tagOnClick
  const currentTagId =
    action.type === 'postback'
      ? tagIdFromPostbackData(action.data)
      : action.type === 'uri'
        ? action.tagOnClick ?? ''
        : '';

  const setTag = (tagId: string) => {
    if (action.type === 'postback') {
      // 選標籤即接管 postback data
      onChange({ ...action, data: tagId ? `tag:${tagId}` : '' });
    } else if (action.type === 'uri') {
      onChange({ ...action, tagOnClick: tagId || undefined });
    }
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-slate-500">點擊後貼標</span>
      <select
        value={currentTagId}
        onChange={(e) => setTag(e.target.value)}
        disabled={isLoading}
        className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
      >
        <option value="">不貼標</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      {action.type === 'postback' && currentTagId && (
        <span className="w-24 text-[10px] text-slate-400">（接管回傳資料）</span>
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
