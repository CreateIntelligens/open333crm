'use client';

/**
 * Rich Menu 預覽元件
 *
 * 版面依 Claude Design「即時預覽」：手機 LINE 聊天室外框，底部是背景圖＋區域格線與編號，
 * 最下方是聊天室底部按鈕（chatBarText）。點格子會呼叫 onAreaClick，讓編輯器跳到對應區域。
 */

import React, { useState } from 'react';
import { ChevronLeft, ChevronUp, Keyboard } from 'lucide-react';
import type { RichMenuArea } from '@/hooks/useRichMenus';

interface Props {
  imageUrl: string;
  size: { width: number; height: number };
  areas: RichMenuArea[];
  /** 容器目標寬度（px）；高度依比例計算 */
  containerWidth?: number;
  /** 聊天室底部按鈕文字 */
  chatBarText?: string;
  /** 目前展開編輯中的區域（高亮） */
  activeIndex?: number | null;
  onAreaClick?: (index: number) => void;
}

export function RichMenuPreview({
  imageUrl,
  size,
  areas,
  containerWidth = 300,
  chatBarText,
  activeIndex = null,
  onAreaClick,
}: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const scale = containerWidth / size.width;
  const containerHeight = size.height * scale;

  return (
    <div className="mx-auto w-fit overflow-hidden rounded-[28px] border-[6px] border-foreground bg-background">
      {/* 聊天室頂部 */}
      <div className="flex h-10 items-center gap-1.5 border-b border-border px-3 text-sm font-semibold text-foreground" aria-hidden="true">
        <ChevronLeft className="h-4 w-4" />
        LINE 官方帳號
      </div>
      {/* 聊天內容區 */}
      <div className="h-[150px] bg-[#C9D3E0]" aria-hidden="true" />

      {/* 選單 */}
      <div className="relative bg-muted" style={{ width: containerWidth, height: containerHeight }}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Rich Menu 預覽" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">尚未上傳背景圖</div>
        )}

        {areas.map((area, idx) => {
          const active = activeIndex === idx || hoverIdx === idx;
          const style = {
            left: area.bounds.x * scale,
            top: area.bounds.y * scale,
            width: area.bounds.width * scale,
            height: area.bounds.height * scale,
          };
          const className =
            'absolute flex items-center justify-center border transition-colors ' +
            (active ? 'border-2 border-primary bg-primary/20' : 'border-white/80 bg-white/10');
          const badge = (
            <span
              className={
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ' +
                (active ? 'bg-primary text-white' : 'bg-background text-foreground')
              }
            >
              {idx + 1}
            </span>
          );
          return onAreaClick ? (
            <button
              key={idx}
              type="button"
              onClick={() => onAreaClick(idx)}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              aria-label={`編輯區域 ${idx + 1}`}
              className={className + ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'}
              style={style}
            >
              {badge}
            </button>
          ) : (
            <div
              key={idx}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              className={className}
              style={style}
            >
              {badge}
            </div>
          );
        })}
      </div>

      {/* 聊天室底部按鈕 */}
      <div className="flex h-10 items-center justify-between border-t border-border px-3 text-muted-foreground" aria-hidden="true">
        <Keyboard className="h-4 w-4" />
        <span className="text-sm font-semibold text-foreground">{chatBarText || '選單'} ▾</span>
        <ChevronUp className="h-4 w-4" />
      </div>
    </div>
  );
}
