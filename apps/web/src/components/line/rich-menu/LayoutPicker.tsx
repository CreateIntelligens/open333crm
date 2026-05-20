'use client';

/**
 * Rich Menu 版型選擇器
 *
 * 顯示 10 種官方版型，分大選單 / 小選單兩組。
 * 每張卡片用 CSS Grid 畫線稿（不依賴外部圖示）。
 */

import React from 'react';
import { RICH_MENU_LAYOUTS, type RichMenuLayout } from './layouts';

interface Props {
  onPick: (layout: RichMenuLayout) => void;
}

export function LayoutPicker({ onPick }: Props) {
  const large = RICH_MENU_LAYOUTS.filter((l) => l.category === 'large');
  const compact = RICH_MENU_LAYOUTS.filter((l) => l.category === 'compact');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">大選單（2500 × 1686）</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {large.map((l) => (
            <LayoutCard key={l.id} layout={l} onClick={() => onPick(l)} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">小選單（2500 × 843）</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {compact.map((l) => (
            <LayoutCard key={l.id} layout={l} onClick={() => onPick(l)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LayoutCard({ layout, onClick }: { layout: RichMenuLayout; onClick: () => void }) {
  // 用比例縮放繪製版型結構圖
  const cardAspect = layout.category === 'large' ? '2500 / 1686' : '2500 / 843';

  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-lg border border-slate-200 bg-white p-3 text-left transition-all hover:border-emerald-400 hover:shadow-md"
    >
      <div
        className="relative w-full overflow-hidden rounded-md bg-slate-100"
        style={{ aspectRatio: cardAspect }}
      >
        {layout.defaultAreas.map((area, idx) => {
          const left = (area.bounds.x / layout.size.width) * 100;
          const top = (area.bounds.y / layout.size.height) * 100;
          const width = (area.bounds.width / layout.size.width) * 100;
          const height = (area.bounds.height / layout.size.height) * 100;
          return (
            <div
              key={idx}
              className="absolute flex items-center justify-center border border-slate-400 bg-white/70 text-[10px] font-medium text-slate-600 group-hover:border-emerald-400 group-hover:text-emerald-700"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
              }}
            >
              {idx + 1}
            </div>
          );
        })}
      </div>
      <div className="mt-2">
        <div className="text-sm font-semibold text-slate-900">{layout.label}</div>
        <div className="mt-0.5 text-[11px] text-slate-500">{layout.description}</div>
      </div>
    </button>
  );
}
