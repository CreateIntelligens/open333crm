'use client';

import React, { useMemo, useState } from 'react';
import { Save, Eye } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  LineTextEditor,
  LineImageEditor,
  FbTextEditor,
  FbImageEditor,
  FbVideoEditor,
  FbGenericEditor,
  FbButtonEditor,
  FbMediaEditor,
  FbCouponEditor,
  FbReceiptEditor,
  FbFeedbackEditor,
} from './editors';
import { LineCarouselEditor } from './line/LineCarouselEditor';
import { LineImagemapEditor } from './line/LineImagemapEditor';
import { LineVideoEditor } from './line/LineVideoEditor';
import { LineFlexShowcaseEditor } from './line/showcase/LineFlexShowcaseEditor';
import { MaterialPreview } from './MaterialPreview';
import type { MaterialVariable } from '@/hooks/useMaterials';

export interface MaterialDraft {
  name: string;
  description?: string;
  category?: string;
  channelType: string;
  contentType: string;
  body: Record<string, unknown>;
  variables: MaterialVariable[];
  targetChannels?: string[];
}

interface Props {
  draft: MaterialDraft;
  templateName?: string;
  saving?: boolean;
  onChange: (next: MaterialDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}

// channel / contentType 對使用者顯示的中文名稱
const CHANNEL_LABEL: Record<string, string> = {
  line: 'LINE',
  fb: 'FB Messenger',
};

const CONTENT_TYPE_LABEL: Record<string, string> = {
  // LINE
  line_text: 'LINE 純文字',
  line_image: 'LINE 單張圖片',
  line_video: 'LINE 進階影片',
  line_carousel: 'LINE 多頁訊息',
  line_imagemap: 'LINE 圖文訊息',
  line_flex_showcase: 'LINE 精選範本',
  // FB
  fb_text: 'FB 純文字',
  fb_image: 'FB 單張圖片',
  fb_video: 'FB 影片',
  fb_generic: 'FB 商品輪播',
  fb_button: 'FB 按鈕選單',
  fb_media: 'FB 大圖／影片廣告',
  fb_coupon: 'FB 優惠券',
  fb_receipt: 'FB 訂單收據',
  fb_feedback: 'FB 滿意度調查',
};

// 依 contentType 找對應的 body editor
function bodyEditorFor(contentType: string) {
  // LINE
  if (contentType === 'line_text') return LineTextEditor;
  if (contentType === 'line_image') return LineImageEditor;
  if (contentType === 'line_video') return LineVideoEditor;
  if (contentType === 'line_carousel') return LineCarouselEditor;
  if (contentType === 'line_imagemap') return LineImagemapEditor;
  if (contentType === 'line_flex_showcase') return LineFlexShowcaseEditor;
  // FB
  if (contentType === 'fb_text') return FbTextEditor;
  if (contentType === 'fb_image') return FbImageEditor;
  if (contentType === 'fb_video') return FbVideoEditor;
  if (contentType === 'fb_generic') return FbGenericEditor;
  if (contentType === 'fb_button') return FbButtonEditor;
  if (contentType === 'fb_media') return FbMediaEditor;
  if (contentType === 'fb_coupon') return FbCouponEditor;
  if (contentType === 'fb_receipt') return FbReceiptEditor;
  if (contentType === 'fb_feedback') return FbFeedbackEditor;
  return null;
}

export function MaterialEditor({ draft, templateName, saving, onChange, onSave, onCancel }: Props) {
  const BodyEditor = useMemo(() => bodyEditorFor(draft.contentType), [draft.contentType]);
  const [showPreview, setShowPreview] = useState(true);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex-1">
          <h1 className="text-lg font-bold">編輯素材{templateName ? `．${templateName}` : ''}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <span className="rounded bg-slate-100 px-2 py-0.5">
              {CHANNEL_LABEL[draft.channelType] ?? draft.channelType}．{CONTENT_TYPE_LABEL[draft.contentType] ?? draft.contentType}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button variant="outline" onClick={() => setShowPreview((v) => !v)}>
            <Eye className="mr-1 h-4 w-4" />{showPreview ? '隱藏預覽' : '顯示預覽'}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            <Save className="mr-1 h-4 w-4" />{saving ? '儲存中…' : '存為素材'}
          </Button>
        </div>
      </div>

      <div className={`grid gap-6 ${showPreview ? 'lg:grid-cols-[1fr,360px]' : ''}`}>
        <div className="space-y-5">
          {/* 基本資訊 */}
          <section className="space-y-3 rounded-lg border border-slate-200 p-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">素材名稱 *</label>
              <Input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="如：母親節新品推播" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">分類</label>
                <Input value={draft.category ?? ''} onChange={(e) => onChange({ ...draft, category: e.target.value })} placeholder="行銷類 / 服務類 …" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">描述</label>
                <Input value={draft.description ?? ''} onChange={(e) => onChange({ ...draft, description: e.target.value })} />
              </div>
            </div>
          </section>

          {/* 內容編輯 */}
          <section className="space-y-3 rounded-lg border border-slate-200 p-4">
            <div className="text-sm font-semibold">內容</div>
            {BodyEditor ? (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <BodyEditor body={draft.body as any} onChange={(next: any) => onChange({ ...draft, body: next })} />
            ) : (
              <div className="text-xs text-slate-500">此版型暫無視覺化編輯器</div>
            )}
          </section>
        </div>

        {showPreview && (
          <aside className="space-y-3">
            <div className="sticky top-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">即時預覽</div>
              <MaterialPreview channelType={draft.channelType} contentType={draft.contentType} body={draft.body} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
