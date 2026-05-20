'use client';

/**
 * ShowcasePickerDialog — 仿 LINE Flex Simulator「サンプルメッセージから作成」
 *
 * 9 個官方範本縮圖網格。縮圖用真實 Flex JSON 縮放渲染，所見即所得。
 */

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FlexPreview } from '../../MaterialPreview';
import { SHOWCASE_SAMPLES, type ShowcaseSample } from './samples';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (sample: ShowcaseSample) => void;
}

const THUMB_WIDTH = 240;
const THUMB_HEIGHT = 220;

export function ShowcasePickerDialog({ open, onClose, onSelect }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleConfirm = () => {
    const sample = SHOWCASE_SAMPLES.find((s) => s.id === selectedId);
    if (sample) onSelect(sample);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>從範本建立</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-4 py-3 max-h-[70vh] overflow-y-auto">
          {SHOWCASE_SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => setSelectedId(sample.id)}
              className={`overflow-hidden rounded-lg border bg-white text-left transition-all ${
                selectedId === sample.id
                  ? 'border-emerald-500 ring-2 ring-emerald-200'
                  : 'border-slate-200 hover:border-slate-400'
              }`}
            >
              {/* 縮圖：LINE 聊天底色 + 真實 Flex 縮放 */}
              <div
                className="relative flex items-center justify-center overflow-hidden bg-[#8CABD8]"
                style={{ height: THUMB_HEIGHT }}
              >
                <div
                  className="origin-center"
                  style={{ transform: 'scale(0.5)', transformOrigin: 'center center' }}
                >
                  <FlexPreview flex={sample.json} />
                </div>
              </div>
              <div className="px-3 py-2 text-center">
                <div className="text-sm font-semibold text-slate-900">{sample.name}</div>
                <div className="mt-0.5 text-[11px] text-slate-500 line-clamp-2">{sample.description}</div>
              </div>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleConfirm} disabled={!selectedId}>選擇</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
