'use client';

/**
 * 兩步驟選擇器：先選 channel（LINE / FB），再選具體類型。
 *
 * 自 add-line-fb-split-materials change 起，不再從版型 fork 建立 Material。
 * 此元件直接呼叫 onPick(channelType, contentType)，由父層做後續導向。
 *
 * 視覺（改版方案 A）：縮圖為主體、去大色塊；類型依「基礎 / 進階 / 匯入」分組；
 * 平台選擇卡帶類型 chip 預覽；全數改用 design token（亮暗色對齊）。
 */

import React, { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { TemplateThumb } from './TemplateThumb';

interface Props {
  /** 選定 channelType / contentType 後通知父層 */
  onPick: (channelType: 'line' | 'fb', contentType: string) => void;
}

type ChannelTypeOption = {
  value: 'line' | 'fb';
  label: string;
  color: string;
  desc: string;
};

const CHANNELS: ChannelTypeOption[] = [
  { value: 'line', label: 'LINE', color: '#06c755', desc: 'LINE 官方帳號訊息' },
  { value: 'fb', label: 'FB Messenger', color: '#0866ff', desc: 'Facebook Messenger 訊息' },
];

type ContentTypeOption = {
  value: string;
  label: string;
  desc: string;
  /** 分組：基礎訊息 / 進階版型 / 匯入 */
  group: 'basic' | 'advanced' | 'import';
};

const GROUP_LABEL: Record<ContentTypeOption['group'], string> = {
  basic: '基礎訊息',
  advanced: '進階版型',
  import: '進階（開發者）',
};
const GROUP_ORDER: ContentTypeOption['group'][] = ['basic', 'advanced', 'import'];

const LINE_TYPES: ContentTypeOption[] = [
  { value: 'line_text', label: '純文字', desc: '一則純文字訊息', group: 'basic' },
  { value: 'line_image', label: '單張圖片', desc: '發送一張圖片給顧客', group: 'basic' },
  { value: 'line_video', label: '進階影片', desc: '影片 + 結束畫面 CTA 按鈕', group: 'basic' },
  { value: 'line_carousel', label: '多頁訊息', desc: '多張卡片輪播（商品 / 地點 / 人物 / 圖文）', group: 'advanced' },
  { value: 'line_imagemap', label: '圖文訊息', desc: '一張大圖切割成多個可點擊區域', group: 'advanced' },
  { value: 'line_flex_showcase', label: '精選範本', desc: '直接套用官方設計範本（餐廳 / 服飾 / 房地產 / 票券 ...）', group: 'advanced' },
  { value: 'line_flex_template', label: '匯入 Flex JSON', desc: '貼上 LINE Flex Simulator 產出的 JSON', group: 'import' },
];

const FB_TYPES: ContentTypeOption[] = [
  { value: 'fb_text', label: '純文字', desc: '一則純文字訊息', group: 'basic' },
  { value: 'fb_image', label: '單張圖片', desc: '發送一張圖片給顧客', group: 'basic' },
  { value: 'fb_video', label: '影片', desc: '發送一段影片給顧客', group: 'basic' },
  { value: 'fb_generic', label: '商品輪播', desc: '多商品橫向滑動展示', group: 'advanced' },
  { value: 'fb_button', label: '按鈕選單', desc: '文字 + 1-3 顆按鈕引導下一步', group: 'advanced' },
  { value: 'fb_media', label: '大圖／影片廣告', desc: '大圖或影片 + 1 顆 CTA 按鈕', group: 'advanced' },
  { value: 'fb_coupon', label: '優惠券', desc: 'Messenger 專屬優惠券模板', group: 'advanced' },
  { value: 'fb_receipt', label: '訂單收據', desc: '電商訂單明細', group: 'advanced' },
  { value: 'fb_feedback', label: '滿意度調查', desc: 'CSAT / NPS 評分量表', group: 'advanced' },
];

export function TemplatePickerGrid({ onPick }: Props) {
  const [step, setStep] = useState<'channel' | 'content'>('channel');
  const [channel, setChannel] = useState<'line' | 'fb' | null>(null);

  if (step === 'channel') {
    return (
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">先選擇要建立哪個平台的素材：</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CHANNELS.map((opt) => {
            const types = opt.value === 'line' ? LINE_TYPES : FB_TYPES;
            const chips = types.slice(0, 4);
            const extra = types.length - chips.length;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setChannel(opt.value);
                  setStep('content');
                }}
                className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg hover:shadow-primary/10"
              >
                <ArrowRight className="absolute right-5 top-5 h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-base font-extrabold text-white"
                  style={{ backgroundColor: opt.color }}
                >
                  {opt.value === 'line' ? 'L' : 'f'}
                </div>
                <div className="mt-3.5 text-base font-bold text-foreground">{opt.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {opt.desc} · {types.length} 種類型
                </div>
                <div className="mt-3.5 flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <span
                      key={c.value}
                      className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {c.label}
                    </span>
                  ))}
                  {extra > 0 && (
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      +{extra}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // step: content
  const types = channel === 'line' ? LINE_TYPES : FB_TYPES;
  const channelOpt = CHANNELS.find((c) => c.value === channel)!;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => {
          setStep('channel');
          setChannel(null);
        }}
        className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        回到平台選擇
      </button>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: channelOpt.color }} />
        <strong className="text-foreground">{channelOpt.label}</strong>
        <span className="text-muted-foreground/70">— 選擇訊息類型</span>
      </div>

      {GROUP_ORDER.map((group) => {
        const groupTypes = types.filter((t) => t.group === group);
        if (groupTypes.length === 0) return null;
        return (
          <div key={group} className="space-y-2.5">
            <div className="pt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {GROUP_LABEL[group]}
            </div>
            <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-3">
              {groupTypes.map((t) => (
                <div
                  key={t.value}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPick(channel!, t.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onPick(channel!, t.value);
                    }
                  }}
                  className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-card text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg hover:shadow-primary/10"
                >
                  <TemplateThumb contentType={t.value} />
                  <div className="border-t border-border/60 p-3">
                    <div className="text-sm font-semibold text-foreground">{t.label}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
