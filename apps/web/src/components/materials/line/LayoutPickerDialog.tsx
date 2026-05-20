'use client';

/**
 * LayoutPickerDialog — 圖文訊息「選擇版型」dialog
 *
 * 對齊 LINE OA 後台版型選擇 UI：
 *   • 左側：類別 tabs（正方形 / 橫長 / 縱長 / 自訂）
 *   • 右側：依類別顯示版型縮圖網格，分尺寸群組
 */

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  IMAGEMAP_LAYOUTS,
  groupLayoutsByHeight,
  type ImagemapLayout,
  type LayoutCategory,
} from './imagemap-layouts';

interface Props {
  open: boolean;
  currentLayoutId?: string;
  onClose: () => void;
  onSelect: (layout: ImagemapLayout) => void;
}

const CATEGORIES: LayoutCategory[] = ['正方形', '橫長', '縱長', '自訂'];

export function LayoutPickerDialog({ open, currentLayoutId, onClose, onSelect }: Props) {
  const [category, setCategory] = useState<LayoutCategory>('正方形');
  const [selected, setSelected] = useState<string | undefined>(currentLayoutId);

  const groupsByHeight = groupLayoutsByHeight(category);
  const heights = Array.from(groupsByHeight.keys());

  const handleSelect = () => {
    const layout = IMAGEMAP_LAYOUTS.find((l) => l.id === selected);
    if (layout) onSelect(layout);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>選擇版型</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4" style={{ minHeight: 480 }}>
          {/* 左側類別 */}
          <aside className="w-32 shrink-0 space-y-1 rounded-md border border-slate-200 p-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`w-full rounded px-3 py-2 text-left text-sm ${
                  category === cat ? 'bg-slate-900 font-semibold text-white' : 'hover:bg-slate-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </aside>

          {/* 右側版型網格 */}
          <main className="flex-1 overflow-y-auto rounded-md border border-slate-200 p-4">
            {category === '自訂' ? (
              <CustomCategory selected={selected} onSelect={setSelected} />
            ) : (
              heights.map((h) => (
                <div key={h} className="mb-6 last:mb-0">
                  <div className="mb-3 text-sm font-semibold">寬 1040px × 高 {h}px</div>
                  <div className="grid grid-cols-4 gap-3">
                    {groupsByHeight.get(h)!.map((layout) => (
                      <LayoutThumb
                        key={layout.id}
                        layout={layout}
                        active={selected === layout.id}
                        onClick={() => setSelected(layout.id)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </main>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSelect} disabled={!selected}>選擇</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LayoutThumb({ layout, active, onClick }: { layout: ImagemapLayout; active: boolean; onClick: () => void }) {
  // 用 grid-template-areas 渲染縮圖（依 layout.thumbGrid）
  const ratio = layout.height / layout.width;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block rounded-md border p-1.5 transition-colors ${
        active ? 'border-green-500 ring-2 ring-green-200 bg-green-50' : 'border-slate-200 hover:border-slate-400'
      }`}
    >
      <div
        className="grid w-full bg-white"
        style={{
          gridTemplateColumns: `repeat(${layout.thumbGrid.cols}, 1fr)`,
          gridTemplateRows: `repeat(${layout.thumbGrid.rows}, 1fr)`,
          gridTemplateAreas: layout.thumbGrid.areas,
          gap: 2,
          aspectRatio: 1 / ratio,
        }}
      >
        {uniqueAreas(layout.thumbGrid.areas).map((name) => (
          <div
            key={name}
            className="bg-slate-100"
            style={{ gridArea: name }}
          />
        ))}
      </div>
    </button>
  );
}

function uniqueAreas(areasStr: string): string[] {
  const set = new Set<string>();
  for (const tok of areasStr.replace(/"/g, '').split(/\s+/)) {
    if (tok && !set.has(tok)) set.add(tok);
  }
  return Array.from(set);
}

function CustomCategory({ selected, onSelect }: { selected: string | undefined; onSelect: (id: string) => void }) {
  const customLayout = IMAGEMAP_LAYOUTS.find((l) => l.id === 'custom')!;
  return (
    <div>
      <div className="mb-3 text-sm font-semibold">自訂（寬 1040px × 高 520px～2080px）</div>
      <button
        type="button"
        onClick={() => onSelect('custom')}
        className={`flex h-48 w-32 items-center justify-center rounded-md border ${
          selected === 'custom' ? 'border-green-500 ring-2 ring-green-200 bg-green-50' : 'border-slate-200 hover:border-slate-400'
        }`}
      >
        <span className="text-xs text-slate-500">自訂大小</span>
      </button>
      <p className="mt-3 text-xs text-slate-500">
        上傳任意尺寸的圖片（寬 1040、高 520-2080），自行用切割工具定義可點擊區域。
      </p>
    </div>
  );
}
