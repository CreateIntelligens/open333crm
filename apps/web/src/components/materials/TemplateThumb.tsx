'use client';

/**
 * TemplateThumb — 類型選擇卡片的縮圖（改版方案 B：抽象 wireframe 版型示意）
 *
 * 不再用「zoom 縮真實預覽」（會因各版型高度不一而大小不均、留白過多），
 * 改畫統一尺寸的抽象線框：灰塊＝圖、細線＝文字、藍塊＝按鈕。
 * 天生等高等寬 → 網格整齊；又能傳達「這是什麼版型」。
 *
 * 圓角對齊產品 token：外層縮圖區 rounded-lg、線框卡 rounded-md、內部小塊 2-3px。
 */

import React from 'react';

// ── wireframe 積木（用 design token 顏色）──────────────────────
function Img({ className = '', children }: { className?: string; children?: React.ReactNode }) {
  return <div className={`rounded-[3px] bg-primary/15 ${className}`}>{children}</div>;
}
function Line({ w = 'w-full', dark = false }: { w?: string; dark?: boolean }) {
  return <div className={`h-1 rounded-full ${w} ${dark ? 'bg-slate-400 dark:bg-slate-500' : 'bg-slate-200 dark:bg-slate-600'}`} />;
}
function Btn({ className = '' }: { className?: string }) {
  return <div className={`h-2.5 rounded-[3px] bg-primary/35 ${className}`} />;
}

/** 一張「訊息卡」外框，統一寬度、白底、細邊、小圓角。 */
function WFCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex w-[130px] flex-col gap-1.5 rounded-md border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-800 ${className}`}>
      {children}
    </div>
  );
}

function PlayGlyph() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-primary/70">
        <path d="M8 5v14l11-7z" />
      </svg>
    </div>
  );
}

// ── 各 contentType 對應的 wireframe ───────────────────────────
function wireframe(contentType: string): React.ReactNode {
  switch (contentType) {
    // 純文字：一顆聊天泡泡、三行文字
    case 'line_text':
    case 'fb_text':
      return (
        <WFCard className="rounded-tl-[4px]">
          <Line w="w-3/4" dark />
          <Line />
          <Line w="w-1/2" />
        </WFCard>
      );

    // 單張圖片：一整塊圖
    case 'line_image':
    case 'fb_image':
      return (
        <WFCard>
          <Img className="h-[62px]" />
        </WFCard>
      );

    // 影片：圖塊 + play + 底部按鈕
    case 'line_video':
    case 'fb_video':
      return (
        <WFCard>
          <div className="h-[48px]">
            <Img className="h-full w-full">
              <PlayGlyph />
            </Img>
          </div>
          <Btn />
        </WFCard>
      );

    // 卡片訊息 / 商品輪播：圖 + 標題 + 價/文 + 按鈕（帶第二張卡露一角表示輪播）
    case 'line_carousel':
    case 'fb_generic':
      return (
        <div className="relative">
          <div className="absolute -right-2 top-1.5 h-[92%] w-[120px] rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800" />
          <WFCard className="relative">
            <Img className="h-9" />
            <Line w="w-2/3" dark />
            <Line w="w-1/2" />
            <Btn className="mt-0.5" />
          </WFCard>
        </div>
      );

    // 圖文訊息 imagemap：一大圖切成左右兩塊
    case 'line_imagemap':
      return (
        <WFCard>
          <div className="flex gap-1.5">
            <Img className="h-[52px] flex-1" />
            <Img className="h-[52px] flex-1" />
          </div>
        </WFCard>
      );

    // FB 按鈕選單：一行文字 + 三顆按鈕
    case 'fb_button':
      return (
        <WFCard>
          <Line w="w-3/4" dark />
          <Line w="w-1/2" />
          <Btn className="mt-1" />
          <Btn />
        </WFCard>
      );

    // FB 大圖/影片廣告：大圖 + 單顆 CTA
    case 'fb_media':
      return (
        <WFCard>
          <Img className="h-[50px]" />
          <Btn className="mt-0.5" />
        </WFCard>
      );

    // FB 優惠券：圖 + 折扣碼塊 + 按鈕
    case 'fb_coupon':
      return (
        <WFCard>
          <Img className="h-8" />
          <div className="h-4 rounded-[3px] border border-dashed border-primary/50 bg-primary/5" />
          <Btn className="mt-0.5" />
        </WFCard>
      );

    // FB 訂單收據：標題 + 多行明細
    case 'fb_receipt':
      return (
        <WFCard>
          <Line w="w-1/2" dark />
          <Line />
          <Line />
          <Line w="w-2/3" />
          <div className="mt-0.5 flex justify-between">
            <Line w="w-1/3" dark />
            <Line w="w-1/4" dark />
          </div>
        </WFCard>
      );

    // FB 滿意度調查：問題 + 評分列
    case 'fb_feedback':
      return (
        <WFCard>
          <Line w="w-3/4" dark />
          <div className="mt-1 flex justify-between gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 flex-1 rounded-[3px] bg-primary/20" />
            ))}
          </div>
        </WFCard>
      );

    default:
      return (
        <WFCard>
          <Line w="w-3/4" dark />
          <Line />
        </WFCard>
      );
  }
}

interface Props {
  contentType: string;
}

export function TemplateThumb({ contentType }: Props) {
  // 固定高度縮圖區 + wireframe 置中；淡色底 wash，圓角對齊 rounded-lg。
  return (
    <div className="flex h-[104px] items-center justify-center overflow-hidden rounded-t-lg border-b border-slate-100 bg-gradient-to-br from-slate-50 to-slate-100/70 dark:border-slate-800 dark:from-slate-800/60 dark:to-slate-900/60">
      {wireframe(contentType)}
    </div>
  );
}
