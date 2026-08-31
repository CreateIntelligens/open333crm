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
import { Check } from 'lucide-react';
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

/** 平台官方 logo（LINE / FB Messenger），內嵌 simple-icons 官方品牌 SVG path。 */
function ChannelLogo({ channel }: { channel: 'line' | 'fb' }) {
  if (channel === 'line') {
    return (
      <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: '#06C755' }}>
        {/* LINE 官方品牌 logo（simple-icons, 24×24），白色鋪滿於綠底 */}
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="#fff" aria-label="LINE">
          <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
        </svg>
      </div>
    );
  }
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'radial-gradient(circle at 30% 100%, #0099FF 0%, #A033FF 60%, #FF5280 90%, #FF7061 100%)' }}>
      {/* Facebook Messenger 官方品牌 logo（simple-icons, 24×24），白色鋪滿於漸層底 */}
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="#fff" aria-label="Messenger">
        <path d="M.001 11.639C.001 4.949 5.241 0 12.001 0S24 4.95 24 11.639c0 6.689-5.24 11.638-12 11.638-1.21 0-2.371-.16-3.462-.46a.956.956 0 0 0-.641.05l-2.381 1.05a.96.96 0 0 1-1.35-.85l-.061-2.141a.958.958 0 0 0-.322-.68C1.021 17.66.001 14.809.001 11.639zm8.311-2.16l-3.525 5.591c-.331.53.111 1.16.653.85l3.79-2.87a.717.717 0 0 1 .862 0l2.809 2.09c.85.63 2.049.4 2.6-.5l3.525-5.581c.331-.53-.111-1.16-.653-.85l-3.79 2.87a.717.717 0 0 1-.862 0l-2.809-2.1c-.85-.63-2.049-.4-2.6.5z" />
      </svg>
    </div>
  );
}

type ContentTypeOption = {
  value: string;
  label: string;
  desc: string;
  /** 分組：基礎訊息 / 進階版型 / 匯入 */
  group: 'basic' | 'advanced' | 'import';
  /** 暫時隱藏此類型（保留定義，之後移除此旗標即可恢復顯示） */
  hidden?: boolean;
  /** 標記為常用（右上角顯示「常用」pill） */
  hot?: boolean;
};

const GROUP_LABEL: Record<ContentTypeOption['group'], string> = {
  basic: '基礎訊息',
  advanced: '進階版型',
  import: '進階（開發者）',
};
const GROUP_ORDER: ContentTypeOption['group'][] = ['basic', 'advanced', 'import'];

const LINE_TYPES: ContentTypeOption[] = [
  { value: 'line_text', label: '純文字', desc: '一則純文字訊息', group: 'basic', hot: true },
  { value: 'line_image', label: '單張圖片', desc: '發送一張圖片給顧客', group: 'basic' },
  { value: 'line_video', label: '影片', desc: '影片 + 結束畫面 CTA 按鈕', group: 'basic' },
  { value: 'line_carousel', label: '卡片訊息', desc: '多張卡片輪播（商品 / 地點 / 人物 / 圖文）', group: 'advanced', hot: true },
  { value: 'line_imagemap', label: '圖文訊息', desc: '一張大圖切割成多個可點擊區域', group: 'advanced' },
  { value: 'line_flex_showcase', label: '精選範本', desc: '直接套用官方設計範本（餐廳 / 服飾 / 房地產 / 票券 ...）', group: 'advanced', hidden: true },
  { value: 'line_flex_template', label: '匯入 Flex JSON', desc: '貼上 LINE Flex Simulator 產出的 JSON', group: 'import', hidden: true },
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
  // 單頁 master-detail：上方平台 selector（預設 LINE）+ 下方即時顯示該平台類型卡。
  const [channel, setChannel] = useState<'line' | 'fb'>('line');
  const types = channel === 'line' ? LINE_TYPES : FB_TYPES;
  const channelOpt = CHANNELS.find((c) => c.value === channel)!;

  return (
    <div className="space-y-6">
      {/* ① 平台 selector：一排緊湊選項卡（官方 logo + 名 + 型數），點擊切換 */}
      <div>
        <div className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">選擇平台</div>
        <div className="flex flex-wrap gap-3">
          {CHANNELS.map((opt) => {
            const optTypes = (opt.value === 'line' ? LINE_TYPES : FB_TYPES).filter((t) => !t.hidden);
            const active = channel === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setChannel(opt.value)}
                aria-pressed={active}
                className={`flex w-[260px] items-center gap-3 rounded-lg border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
                  active
                    ? 'border-primary bg-primary-subtle shadow-sm ring-1 ring-primary'
                    : 'border-border bg-card hover:border-primary/50 hover:shadow-sm'
                }`}
              >
                <ChannelLogo channel={opt.value} />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-foreground">{opt.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{opt.desc} · {optTypes.length} 種</div>
                </div>
                {active && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ② 該平台的類型卡（wireframe），選平台後即時顯示 */}
      {GROUP_ORDER.map((group) => {
        const groupTypes = types.filter((t) => t.group === group && !t.hidden);
        if (groupTypes.length === 0) return null;
        return (
          <div key={group} className="space-y-2.5">
            <div className="pt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {GROUP_LABEL[group]}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
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
                  className="group relative cursor-pointer overflow-hidden rounded-lg border border-border bg-card text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                >
                  {/* 渠道 badge（左上）*/}
                  <span
                    className="absolute left-2 top-2 z-10 rounded-sm px-1.5 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: channelOpt.color }}
                  >
                    {channelOpt.value === 'fb' ? 'FB' : channelOpt.label}
                  </span>
                  {/* 常用 pill（右上）*/}
                  {t.hot && (
                    <span className="absolute right-2 top-2 z-10 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                      常用
                    </span>
                  )}
                  <TemplateThumb contentType={t.value} />
                  <div className="p-3">
                    <div className="text-sm font-semibold text-foreground">{t.label}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.desc}</div>
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
