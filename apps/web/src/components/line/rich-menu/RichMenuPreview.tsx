'use client';

/**
 * Rich Menu 預覽元件
 *
 * 背景圖 + 區域熱區疊層（半透明邊框）+ 中央區域編號 badge。
 * hover 區域時高亮（emerald 半透明）。
 */

import React, { useState } from 'react';
import type { RichMenuArea } from '@/hooks/useRichMenus';

interface Props {
  imageUrl: string;
  size: { width: number; height: number };
  areas: RichMenuArea[];
  /** 容器目標寬度（px）；高度依比例計算 */
  containerWidth?: number;
}

export function RichMenuPreview({ imageUrl, size, areas, containerWidth = 360 }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const scale = containerWidth / size.width;
  const containerHeight = size.height * scale;

  return (
    <div
      className="relative overflow-hidden rounded-md border border-slate-300 bg-slate-100"
      style={{ width: containerWidth, height: containerHeight }}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="Rich Menu 預覽"
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-slate-400">尚未上傳背景圖</div>
      )}

      {areas.map((area, idx) => {
        const left = area.bounds.x * scale;
        const top = area.bounds.y * scale;
        const width = area.bounds.width * scale;
        const height = area.bounds.height * scale;
        const isHover = hoverIdx === idx;
        return (
          <div
            key={idx}
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
            className={
              'absolute flex items-center justify-center border-2 transition-colors ' +
              (isHover
                ? 'border-emerald-500 bg-emerald-500/30'
                : 'border-blue-400 bg-blue-400/10')
            }
            style={{ left, top, width, height }}
          >
            <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white">
              {idx + 1}
            </span>
          </div>
        );
      })}
    </div>
  );
}
