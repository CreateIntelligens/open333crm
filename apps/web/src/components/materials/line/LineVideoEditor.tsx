'use client';

/**
 * LineVideoEditor — LINE 進階影片訊息編輯器。
 *
 * 目前支援：
 *   • 影片網址（mp4）
 *   • 縮圖網址
 *
 * ⚠️ 結束畫面（圖片 + CTA 按鈕 + action）的欄位已於 2026-09-23 移除。
 * 原因：這三個欄位在畫面上可編輯、也會存進 DB，但
 * `buildLineVideoWithEndCard`（packages/channel-plugins/src/line/builders.ts）
 * 只回傳 video 物件，整個 endCard 被丟棄——使用者設定了半天，客戶永遠看不到。
 * 決議先移除 UI 止血；LineVideoBody 的 endCard 型別與 DB 欄位保留，
 * 不做破壞性遷移，待補實作送出邏輯後再把欄位放回來。
 */

import React from 'react';
import { CompactImageField } from '../CompactImageField';
// ActionConfigEditor 目前未使用（結束畫面 UI 已移除），但 ActionConfig 型別
// 仍為 endCard 所需，故只保留型別匯入。
import type { ActionConfig } from './ActionConfigEditor';
import { LINE_VIDEO_PREVIEW_MAX_BYTES } from '@open333crm/shared';
import { CompactVideoField } from '../CompactVideoField';

export interface LineVideoBody {
  videoUrl?: string;
  previewImageUrl?: string;
  trackingId?: string;
  /**
   * ⚠️ 保留型別以相容既有資料，但目前「不會被送出」（見檔頭說明），
   * 因此編輯器不提供這組欄位。補實作 builders 的送出邏輯後再放回 UI。
   */
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
        影片需為 <strong>可直接下載的 mp4 檔案網址</strong>（結尾 .mp4）、HTTPS、200MB 以內。
        <br />
        YouTube、Vimeo 等分享連結<strong>無法播放</strong>——那是網頁不是影片檔。
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">影片 *</label>
        <CompactVideoField
          value={body.videoUrl ?? ''}
          onChange={(videoUrl) => onChange({ ...body, videoUrl })}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">縮圖 *</label>
        <CompactImageField
          value={body.previewImageUrl ?? ''}
          onChange={(previewImageUrl) => onChange({ ...body, previewImageUrl })}
          placeholder="影片預覽圖（jpg / png）"
          // LINE 對 previewImageUrl 的硬限制是 1MB
          maxBytes={LINE_VIDEO_PREVIEW_MAX_BYTES}
        />
      </div>
    </div>
  );
}
