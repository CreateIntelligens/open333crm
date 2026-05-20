'use client';

/**
 * 兩步驟選擇器：先選 channel（LINE / FB），再選具體類型。
 *
 * 自 add-line-fb-split-materials change 起，不再從版型 fork 建立 Material。
 * 此元件直接呼叫 onPick(channelType, contentType)，由父層做後續導向。
 */

import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
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
  { value: 'fb', label: 'FB Messenger', color: '#0084ff', desc: 'Facebook Messenger 訊息' },
];

type ContentTypeOption = {
  value: string;
  label: string;
  desc: string;
};

const LINE_TYPES: ContentTypeOption[] = [
  { value: 'line_text', label: '純文字', desc: '一則純文字訊息' },
  { value: 'line_image', label: '單張圖片', desc: '發送一張圖片給顧客' },
  { value: 'line_video', label: '進階影片', desc: '影片 + 結束畫面 CTA 按鈕' },
  { value: 'line_carousel', label: '多頁訊息', desc: '多張卡片輪播（商品 / 地點 / 人物 / 圖文）' },
  { value: 'line_imagemap', label: '圖文訊息', desc: '一張大圖切割成多個可點擊區域' },
  { value: 'line_flex_showcase', label: '精選範本', desc: '直接套用官方設計範本（餐廳 / 服飾 / 房地產 / 票券 ...）' },
];

const FB_TYPES: ContentTypeOption[] = [
  { value: 'fb_text', label: '純文字', desc: '一則純文字訊息' },
  { value: 'fb_image', label: '單張圖片', desc: '發送一張圖片給顧客' },
  { value: 'fb_video', label: '影片', desc: '發送一段影片給顧客' },
  { value: 'fb_generic', label: '商品輪播', desc: '多商品橫向滑動展示' },
  { value: 'fb_button', label: '按鈕選單', desc: '文字 + 1-3 顆按鈕引導下一步' },
  { value: 'fb_media', label: '大圖／影片廣告', desc: '大圖或影片 + 1 顆 CTA 按鈕' },
  { value: 'fb_coupon', label: '優惠券', desc: 'Messenger 專屬優惠券模板' },
  { value: 'fb_receipt', label: '訂單收據', desc: '電商訂單明細' },
  { value: 'fb_feedback', label: '滿意度調查', desc: 'CSAT / NPS 評分量表' },
];

export function TemplatePickerGrid({ onPick }: Props) {
  const [step, setStep] = useState<'channel' | 'content'>('channel');
  const [channel, setChannel] = useState<'line' | 'fb' | null>(null);

  if (step === 'channel') {
    return (
      <div className="space-y-4">
        <div className="text-sm text-slate-600">先選擇要建立哪個平台的素材：</div>
        <div className="grid grid-cols-2 gap-4">
          {CHANNELS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setChannel(opt.value);
                setStep('content');
              }}
              className="rounded-xl border border-slate-200 bg-white p-6 text-left transition-all hover:border-slate-900 hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded-full"
                  style={{ backgroundColor: opt.color }}
                />
                <div>
                  <div className="text-lg font-semibold">{opt.label}</div>
                  <div className="text-xs text-slate-500">{opt.desc}</div>
                </div>
              </div>
            </button>
          ))}
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
        className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        回到平台選擇
      </button>

      <div className="flex items-center gap-2 text-sm text-slate-600">
        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: channelOpt.color }} />
        <strong>{channelOpt.label}</strong>
        <span className="text-slate-400">— 選擇訊息類型</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-3">
        {types.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onPick(channel!, t.value)}
            className="group overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition-all hover:border-slate-900 hover:shadow-md"
          >
            <TemplateThumb contentType={t.value} />
            <div className="p-3">
              <div className="text-sm font-semibold text-slate-900">{t.label}</div>
              <div className="mt-1 line-clamp-2 text-xs text-slate-500">{t.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
