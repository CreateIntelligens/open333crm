'use client';

/**
 * 各 contentType 的視覺化編輯器集合。
 *
 * 自 add-line-fb-split-materials change 起：
 *   - 廢棄 LineFlexEditor / Universal*Editor / BubbleQuickEdit / ButtonsField
 *   - 新增 LineTextEditor / LineImageEditor（簡易類型）
 *   - LineCarouselEditor / LineImagemapEditor / LineVideoEditor 各自獨立檔案
 *     位於 ./line/ 子資料夾
 *   - 保留 FB 6 個編輯器
 */

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CompactImageField } from './CompactImageField';

interface EditorProps<T = Record<string, unknown>> {
  body: T;
  onChange: (next: T) => void;
}

// ─── LINE 基礎類型 ──────────────────────────────────────────

interface LineTextBody {
  text?: string;
}

export function LineTextEditor({ body, onChange }: EditorProps<LineTextBody>) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">訊息內容</label>
      <Textarea
        value={body.text ?? ''}
        onChange={(e) => onChange({ ...body, text: e.target.value })}
        rows={5}
        placeholder="輸入要發送的文字訊息"
        maxLength={5000}
      />
      <div className="text-[11px] text-slate-400">{(body.text ?? '').length} / 5000</div>
    </div>
  );
}

interface LineMediaBody {
  mediaUrl?: string;
  previewUrl?: string;
}

export function LineImageEditor({ body, onChange }: EditorProps<LineMediaBody>) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">圖片</label>
        <CompactImageField value={body.mediaUrl ?? ''} onChange={(mediaUrl) => onChange({ ...body, mediaUrl })} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">縮圖（選填，預設使用圖片）</label>
        <CompactImageField value={body.previewUrl ?? ''} onChange={(previewUrl) => onChange({ ...body, previewUrl })} />
      </div>
    </div>
  );
}

// ─── FB 編輯器（既有 6 個 + 新增基礎 3 個）─────────────────

export function FbTextEditor({ body, onChange }: EditorProps<{ text?: string }>) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">訊息內容</label>
      <Textarea
        value={body.text ?? ''}
        onChange={(e) => onChange({ ...body, text: e.target.value })}
        rows={5}
        placeholder="輸入要發送的文字訊息"
        maxLength={2000}
      />
      <div className="text-[11px] text-slate-400">{(body.text ?? '').length} / 2000</div>
    </div>
  );
}

export function FbImageEditor({ body, onChange }: EditorProps<{ url?: string; mediaUrl?: string }>) {
  return (
    <div className="space-y-2">
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">圖片</label>
      <CompactImageField value={(body.url ?? body.mediaUrl) ?? ''} onChange={(url) => onChange({ ...body, url })} />
    </div>
  );
}

export function FbVideoEditor({ body, onChange }: EditorProps<{ url?: string; mediaUrl?: string }>) {
  // 影片格只貼 URL（mp4），不適合上傳；保留 URL 輸入
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">影片網址</label>
      <Input value={(body.url ?? body.mediaUrl) ?? ''} onChange={(e) => onChange({ ...body, url: e.target.value })} placeholder="https://...mp4" />
    </div>
  );
}

// ─── FB 既有 6 個版型編輯器 ──────────────────────────────

interface FbGenericBody {
  elements?: Array<{
    title: string;
    subtitle?: string;
    image_url?: string;
    buttons?: Array<{ type: string; title: string; url?: string; payload?: string }>;
  }>;
}

export function FbGenericEditor({ body, onChange }: EditorProps<FbGenericBody>) {
  const elements = body.elements ?? [];
  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500">FB 商品輪播 · 最多 10 張卡片</div>
      {elements.map((el, idx) => (
        <div key={idx} className="rounded-md border border-slate-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <strong className="text-sm">卡片 {idx + 1}</strong>
            <Button variant="ghost" size="sm" onClick={() => onChange({ ...body, elements: elements.filter((_, i) => i !== idx) })}>
              <Trash2 className="h-3 w-3 text-red-600" />
            </Button>
          </div>
          <Input
            placeholder="商品標題"
            value={el.title ?? ''}
            onChange={(e) => {
              const newElements = [...elements];
              newElements[idx] = { ...el, title: e.target.value };
              onChange({ ...body, elements: newElements });
            }}
          />
          <Input
            placeholder="副標題（選填）"
            value={el.subtitle ?? ''}
            onChange={(e) => {
              const newElements = [...elements];
              newElements[idx] = { ...el, subtitle: e.target.value };
              onChange({ ...body, elements: newElements });
            }}
          />
          <div>
            <label className="mb-1 block text-[11px] text-slate-500">圖片（選填）</label>
            <CompactImageField
              value={el.image_url ?? ''}
              onChange={(image_url) => {
                const newElements = [...elements];
                newElements[idx] = { ...el, image_url };
                onChange({ ...body, elements: newElements });
              }}
            />
          </div>
        </div>
      ))}
      {elements.length < 10 && (
        <Button variant="outline" onClick={() => onChange({ ...body, elements: [...elements, { title: '新卡片' }] })}>
          <Plus className="mr-1 h-3 w-3" />新增卡片（{elements.length}/10）
        </Button>
      )}
    </div>
  );
}

interface FbButtonBody {
  text?: string;
  buttons?: Array<{ type: string; title: string; url?: string; payload?: string }>;
}

export function FbButtonEditor({ body, onChange }: EditorProps<FbButtonBody>) {
  const buttons = body.buttons ?? [];
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">主要訊息 *</label>
        <Textarea value={body.text ?? ''} onChange={(e) => onChange({ ...body, text: e.target.value })} rows={3} />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1 block">按鈕（1-3 顆）</label>
        {buttons.map((btn, idx) => (
          <div key={idx} className="mb-2 flex items-center gap-2">
            <Input
              placeholder="按鈕文字"
              value={btn.title ?? ''}
              onChange={(e) => {
                const newButtons = [...buttons];
                newButtons[idx] = { ...btn, title: e.target.value };
                onChange({ ...body, buttons: newButtons });
              }}
              className="flex-1"
            />
            <Input
              placeholder={btn.type === 'web_url' ? '網址' : '回傳資料'}
              value={(btn.url ?? btn.payload) ?? ''}
              onChange={(e) => {
                const newButtons = [...buttons];
                const key = btn.type === 'web_url' ? 'url' : 'payload';
                newButtons[idx] = { ...btn, [key]: e.target.value };
                onChange({ ...body, buttons: newButtons });
              }}
              className="flex-1"
            />
            <Button variant="ghost" size="sm" onClick={() => onChange({ ...body, buttons: buttons.filter((_, i) => i !== idx) })}>
              <Trash2 className="h-3 w-3 text-red-600" />
            </Button>
          </div>
        ))}
        {buttons.length < 3 && (
          <Button variant="outline" size="sm" onClick={() => onChange({ ...body, buttons: [...buttons, { type: 'web_url', title: '', url: '' }] })}>
            <Plus className="mr-1 h-3 w-3" />新增按鈕（{buttons.length}/3）
          </Button>
        )}
      </div>
    </div>
  );
}

export function FbMediaEditor({ body, onChange }: EditorProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any;
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        FB 大圖／影片廣告須使用 Facebook 託管的素材 ID 或 URL，不接受外部網址。
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">媒體類型</label>
        <Input value={b.media_type ?? 'image'} onChange={(e) => onChange({ ...b, media_type: e.target.value })} placeholder="image / video" />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">attachment_id（建議）</label>
        <Input value={b.attachment_id ?? ''} onChange={(e) => onChange({ ...b, attachment_id: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">媒體網址</label>
        <CompactImageField value={b.url ?? ''} onChange={(url) => onChange({ ...b, url })} />
      </div>
    </div>
  );
}

export function FbCouponEditor({ body, onChange }: EditorProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any;
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">優惠券標題 * <span className="text-slate-400">≤ 80 字</span></label>
        <Input value={b.title ?? ''} onChange={(e) => onChange({ ...b, title: e.target.value })} maxLength={80} />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">副標題 <span className="text-slate-400">≤ 80 字</span></label>
        <Input value={b.subtitle ?? ''} onChange={(e) => onChange({ ...b, subtitle: e.target.value })} maxLength={80} />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">優惠券前訊息</label>
        <Input value={b.coupon_pre_message ?? ''} onChange={(e) => onChange({ ...b, coupon_pre_message: e.target.value })} />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">折扣碼（不可含空格）</label>
        <Input value={b.coupon_code ?? ''} onChange={(e) => onChange({ ...b, coupon_code: e.target.value.replace(/\s/g, '') })} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">優惠券圖片</label>
        <CompactImageField value={b.image_url ?? ''} onChange={(image_url) => onChange({ ...b, image_url })} />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">webhook 回傳資料</label>
        <Input value={b.payload ?? ''} onChange={(e) => onChange({ ...b, payload: e.target.value })} />
      </div>
    </div>
  );
}

export function FbReceiptEditor({ body, onChange }: EditorProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any;
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        訂單收據結構較複雜，目前開放主要欄位編輯；商品列表後續迭代。
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">收件人 *</label>
          <Input value={b.recipient_name ?? ''} onChange={(e) => onChange({ ...b, recipient_name: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">訂單編號 *</label>
          <Input value={b.order_number ?? ''} onChange={(e) => onChange({ ...b, order_number: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">幣別</label>
          <Input value={b.currency ?? 'TWD'} onChange={(e) => onChange({ ...b, currency: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">付款方式</label>
          <Input value={b.payment_method ?? ''} onChange={(e) => onChange({ ...b, payment_method: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">商家名稱</label>
          <Input value={b.merchant_name ?? ''} onChange={(e) => onChange({ ...b, merchant_name: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">總金額</label>
          <Input
            type="number"
            value={b.summary?.total_cost ?? 0}
            onChange={(e) => onChange({ ...b, summary: { ...(b.summary ?? {}), total_cost: Number(e.target.value) } })}
          />
        </div>
      </div>
    </div>
  );
}

export function FbFeedbackEditor({ body, onChange }: EditorProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any;
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">標題</label>
        <Input value={b.title ?? ''} onChange={(e) => onChange({ ...b, title: e.target.value })} />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">副標題</label>
        <Input value={b.subtitle ?? ''} onChange={(e) => onChange({ ...b, subtitle: e.target.value })} />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">問題類型</label>
        <select
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          value={b.question_type ?? 'csat'}
          onChange={(e) => onChange({ ...b, question_type: e.target.value })}
        >
          <option value="csat">滿意度 CSAT（5 等級）</option>
          <option value="nps">推薦度 NPS（11 等級）</option>
          <option value="ces">費力度 CES（7 等級）</option>
        </select>
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">有效天數</label>
        <Input
          type="number"
          value={b.expires_in_days ?? 7}
          onChange={(e) => onChange({ ...b, expires_in_days: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}
