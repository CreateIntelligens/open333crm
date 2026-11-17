'use client';

/**
 * Rich Menu 版型選擇器
 *
 * 顯示 10 種官方版型，分大選單 / 小選單兩組。
 * 版面依 Claude Design「建立 Rich Menu · 步驟 1 選擇版型」：
 * 卡片上方是格線示意（格子編號用圓形標記），下方是名稱、格數與一行說明。
 * 點卡片直接進入步驟 2（設定內容）。
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
    <div className="space-y-7">
      <section aria-labelledby="layout-large">
        <h2 id="layout-large" className="mb-3 flex items-baseline gap-2">
          <span className="text-base font-semibold text-foreground">大選單</span>
          <span className="text-sm text-muted-foreground">2500 × 1686 · 佔聊天室下半部</span>
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {large.map((l) => (
            <LayoutCard key={l.id} layout={l} onClick={() => onPick(l)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="layout-compact">
        <h2 id="layout-compact" className="mb-3 flex items-baseline gap-2">
          <span className="text-base font-semibold text-foreground">小選單</span>
          <span className="text-sm text-muted-foreground">2500 × 843 · 只佔一條，聊天內容看得較多</span>
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {compact.map((l) => (
            <LayoutCard key={l.id} layout={l} onClick={() => onPick(l)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function LayoutCard({ layout, onClick }: { layout: RichMenuLayout; onClick: () => void }) {
  const isLarge = layout.category === 'large';

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary hover:bg-primary-subtle/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* 格線示意：依版型比例縮放 */}
      <div className={`flex w-full items-center justify-center ${isLarge ? 'h-[130px]' : 'h-[76px]'}`}>
        <div
          className="relative h-full max-w-full overflow-hidden rounded bg-muted"
          style={{ aspectRatio: `${layout.size.width} / ${layout.size.height}` }}
          aria-hidden="true"
        >
          {layout.defaultAreas.map((area, idx) => (
            <div
              key={idx}
              className="absolute flex items-center justify-center border border-background bg-shell transition-colors group-hover:bg-primary-subtle"
              style={{
                left: `${(area.bounds.x / layout.size.width) * 100}%`,
                top: `${(area.bounds.y / layout.size.height) * 100}%`,
                width: `${(area.bounds.width / layout.size.width) * 100}%`,
                height: `${(area.bounds.height / layout.size.height) * 100}%`,
              }}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-background text-xs font-semibold text-foreground">
                {idx + 1}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">{layout.label}</span>
          <span className="whitespace-nowrap text-xs text-muted-foreground">{layout.defaultAreas.length} 格</span>
        </div>
        <p className="text-sm text-muted-foreground">{layout.description}</p>
      </div>
    </button>
  );
}

/** 建立流程的步驟指示：① 選擇版型 → ② 設定內容 */
export function RichMenuSteps({ current }: { current: 1 | 2 }) {
  const steps = ['選擇版型', '設定內容'];
  return (
    <ol className="flex items-center gap-3" aria-label="建立步驟">
      {steps.map((label, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        return (
          <li key={label} className="flex items-center gap-3">
            {i > 0 && <span className="h-px w-10 bg-border" aria-hidden="true" />}
            <span className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
              <span
                className={
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ' +
                  (active || done ? 'bg-primary text-white' : 'border border-border text-muted-foreground')
                }
              >
                {n}
              </span>
              <span className={'text-sm font-medium ' + (active ? 'text-primary' : 'text-muted-foreground')}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
