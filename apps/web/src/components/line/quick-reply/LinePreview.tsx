'use client';

/**
 * 模擬 LINE 聊天視窗的 Quick Reply 樣子
 * 上方顯示一則範例訊息、下方是水平捲動的按鈕泡泡（仿 LINE 真實 UI）
 */

import React from 'react';

interface QuickReplyItem {
  label: string;
  text?: string;
}

interface Props {
  message?: string;
  items: QuickReplyItem[];
}

export function LinePreview({ message = '請選擇：', items }: Props) {
  return (
    <div className="rounded-xl bg-[#8caab1] p-3">
      {/* LINE OA 頭像 + bubble */}
      <div className="flex items-start gap-2">
        <div className="h-8 w-8 shrink-0 rounded-full bg-white shadow-sm" />
        <div className="max-w-[80%] rounded-2xl bg-white px-3 py-2 text-sm text-foreground shadow-sm">
          {message}
        </div>
      </div>

      {/* Quick reply 按鈕列（水平捲動） */}
      {items.length > 0 ? (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 pl-10">
          {items.map((it, idx) => (
            <button
              key={idx}
              type="button"
              className="shrink-0 rounded-full border border-white bg-transparent px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-white/10"
              title={it.text ? `點擊後送出：${it.text}` : `點擊後送出：${it.label}`}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-2 pl-10 text-[11px] text-white/70">
          （新增按鈕後會顯示在這裡）
        </div>
      )}
    </div>
  );
}
