'use client';

/**
 * LineVideoEditor — LINE 進階影片訊息編輯器。
 *
 * 對齊 LINE OA 後台「進階影片訊息」：
 *   • 影片網址（mp4）
 *   • 縮圖網址
 *   • 結束畫面（圖片 + CTA 按鈕 + action）
 */

import React from 'react';
import { Input } from '@/components/ui/input';
import { CompactImageField } from '../CompactImageField';
import { ActionConfigEditor, type ActionConfig } from './ActionConfigEditor';

export interface LineVideoBody {
  videoUrl?: string;
  previewImageUrl?: string;
  trackingId?: string;
  endCard?: {
    imageUrl?: string;
    label?: string;
    action?: ActionConfig;
  };
}

interface Props {
  body: LineVideoBody;
  onChange: (next: LineVideoBody) => void;
}

export function LineVideoEditor({ body, onChange }: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        影片需為 mp4 格式、長度建議 60 秒以內。請填入可公開存取的網址。
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">影片網址 *</label>
        <Input
          value={body.videoUrl ?? ''}
          onChange={(e) => onChange({ ...body, videoUrl: e.target.value })}
          placeholder="https://...mp4"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">縮圖 *</label>
        <CompactImageField
          value={body.previewImageUrl ?? ''}
          onChange={(previewImageUrl) => onChange({ ...body, previewImageUrl })}
          placeholder="影片預覽圖（jpg / png）"
        />
      </div>

      <div className="rounded-md border border-slate-200 p-3 space-y-2">
        <div className="text-sm font-semibold">影片結束畫面</div>
        <div className="text-xs text-slate-500">影片播完後顯示，可加 CTA 按鈕引導下一步</div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">結束畫面圖片</label>
          <CompactImageField
            value={body.endCard?.imageUrl ?? ''}
            onChange={(imageUrl) => onChange({ ...body, endCard: { ...body.endCard, imageUrl } })}
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">CTA 按鈕文字</label>
          <Input
            value={body.endCard?.label ?? ''}
            onChange={(e) => onChange({ ...body, endCard: { ...body.endCard, label: e.target.value } })}
            maxLength={15}
            placeholder="如：立即購買"
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1 block">按鈕動作</label>
          <ActionConfigEditor
            action={body.endCard?.action}
            onChange={(action) => onChange({ ...body, endCard: { ...body.endCard, action } })}
            labelLimit={15}
          />
        </div>
      </div>
    </div>
  );
}
