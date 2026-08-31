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
import { LineFlexTemplateEditor } from './line/LineFlexTemplateEditor';
import { MaterialPreview } from './MaterialPreview';
import { QuickReplyEditor, type QuickReplyItem } from './QuickReplyEditor';
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
  /** 右欄預覽下方的額外內容（如分類/標籤/狀態治理面板），一起收進 sticky 右欄 */
  rightPanelExtra?: React.ReactNode;
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
  line_video: 'LINE 影片',
  line_carousel: 'LINE 卡片訊息',
  line_imagemap: 'LINE 圖文訊息',
  line_flex_showcase: 'LINE 精選範本',
  line_flex_template: 'LINE Flex 匯入素材',
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
  if (contentType === 'line_flex_template') return LineFlexTemplateEditor;
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

export function MaterialEditor({ draft, templateName, saving, onChange, onSave, onCancel, rightPanelExtra }: Props) {
  const BodyEditor = useMemo(() => bodyEditorFor(draft.contentType), [draft.contentType]);
  const [showPreview, setShowPreview] = useState(true);
  const handleBodyChange = (nextBody: Record<string, unknown>) => {
    onChange({
      ...draft,
      body: nextBody,
      variables: variablesForBody(draft.contentType, nextBody, draft.variables),
    });
  };

  return (
    <div>
      {/* 頂部操作列：標題 + 渠道 chip 左，操作按鈕右 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <h1 className="text-lg font-bold">編輯素材{templateName ? `．${templateName}` : ''}</h1>
          <span className="rounded-md bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-primary-border">
            {CHANNEL_LABEL[draft.channelType] ?? draft.channelType}．{CONTENT_TYPE_LABEL[draft.contentType] ?? draft.contentType}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button variant="outline" onClick={() => setShowPreview((v) => !v)}>
            <Eye className="mr-1 h-4 w-4" />{showPreview ? '隱藏預覽' : '顯示預覽'}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            <Save className="mr-1 h-4 w-4" />{saving ? '儲存中…' : '存為素材'}
          </Button>
        </div>
      </div>

      {/* 二欄：左編輯流（細分隔線分區，不用灰底卡）+ 右預覽/治理 sticky */}
      <div className={`grid gap-8 pt-5 ${showPreview ? 'lg:grid-cols-[1fr_360px]' : ''}`}>
        <div>
          {/* 基本資訊 */}
          <section className="border-b border-border/60 pb-6">
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">基本資訊</div>
            <div className="space-y-3.5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-foreground">素材名稱 <span className="text-primary">*</span></label>
                <Input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="如：母親節新品推播" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">分類</label>
                  <Input value={draft.category ?? ''} onChange={(e) => onChange({ ...draft, category: e.target.value })} placeholder="行銷類 / 服務類 …" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">描述 <span className="font-normal text-muted-foreground">（選填）</span></label>
                  <Input value={draft.description ?? ''} onChange={(e) => onChange({ ...draft, description: e.target.value })} placeholder="簡短描述用途" />
                </div>
              </div>
            </div>
          </section>

          {/* 內容編輯 */}
          <section className="border-b border-border/60 py-6">
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">訊息內容</div>
            {BodyEditor ? (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <BodyEditor body={draft.body as any} onChange={(next: any) => handleBodyChange(next)} />
            ) : (
              <div className="text-xs text-muted-foreground">此版型暫無視覺化編輯器</div>
            )}
          </section>

          {/* Quick Reply（LINE 專用） */}
          {draft.channelType === 'line' && (
            <section className="pt-6">
              <div className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                快速回覆按鈕 <span className="font-normal normal-case tracking-normal text-muted-foreground">（選填）</span>
              </div>
              <QuickReplyEditor
                value={(draft.body.quickReplies as QuickReplyItem[] | undefined) ?? []}
                onChange={(next) =>
                  onChange({
                    ...draft,
                    body: { ...draft.body, quickReplies: next.length > 0 ? next : undefined },
                  })
                }
              />
            </section>
          )}
        </div>

        {showPreview && (
          <aside>
            <div className="sticky top-4 space-y-5">
              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">即時預覽</div>
                <MaterialPreview channelType={draft.channelType} contentType={draft.contentType} body={draft.body} />
              </div>
              {rightPanelExtra}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function variablesForBody(
  contentType: string,
  body: Record<string, unknown>,
  fallback: MaterialVariable[],
): MaterialVariable[] {
  if (contentType !== 'line_flex_template') return fallback;
  return [];
}
