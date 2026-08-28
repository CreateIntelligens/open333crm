'use client';

/**
 * TemplateThumb — 在類型選擇卡片內顯示縮圖
 *
 * 直接用 MaterialPreview + DEFAULT_BODY_FOR_TYPE 的預設範例 body 縮放呈現，
 * 所見即所得 — 使用者選之前就看到實際成品長相。
 */

import React from 'react';
import { MaterialPreview } from './MaterialPreview';
import { DEFAULT_BODY_FOR_TYPE } from './default-bodies';

interface Props {
  contentType: string;
}

// 每種版型的預覽原始高度差很多（純文字很矮、Flex bubble 很高）。要「卡片等高 + 縮圖完整」，
// 就讓內容越高的版型用越小的 zoom，各自剛好塞進同一個固定高度容器 → 高度一致、皆不裁切。
// 值為經驗調校（對照實際預覽高度），落在同一 THUMB_BOX 內。
const ZOOM_BY_TYPE: Record<string, number> = {
  // 矮：純文字 / 單圖 / 影片
  line_text: 0.62,
  line_image: 0.62,
  line_video: 0.62,
  fb_text: 0.62,
  fb_image: 0.62,
  fb_video: 0.62,
  // 中：圖文訊息 / 按鈕選單 / 大圖廣告 / 優惠券
  line_imagemap: 0.5,
  fb_button: 0.5,
  fb_media: 0.5,
  fb_coupon: 0.5,
  // 高：多頁輪播 / 精選範本 / 商品輪播 / 收據 / 滿意度
  line_carousel: 0.4,
  line_flex_showcase: 0.34,
  fb_generic: 0.4,
  fb_receipt: 0.34,
  fb_feedback: 0.4,
  // 很高：Flex 匯入（整張 bubble + 輸入框）
  line_flex_template: 0.34,
};
const DEFAULT_ZOOM = 0.5;

export function TemplateThumb({ contentType }: Props) {
  const isLine = contentType.startsWith('line_');
  const isFb = contentType.startsWith('fb_');
  const body = DEFAULT_BODY_FOR_TYPE[contentType] ?? {};
  const channelType = isLine ? 'line' : isFb ? 'fb' : '';
  const zoom = ZOOM_BY_TYPE[contentType] ?? DEFAULT_ZOOM;

  // 方案 A：柔和漸層聊天底（亮暗色皆自然）。容器固定高度 h-40 讓所有卡片等高，
  // 內容置中；每種版型用各自 zoom（見上）縮到剛好放進此高度 → 完整不裁切。
  return (
    <div className="relative flex h-40 items-center justify-center overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 p-3 dark:from-slate-800 dark:to-slate-900">
      <div
        className="pointer-events-none"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style={{ zoom } as any}
      >
        <MaterialPreviewWithoutFrame
          channelType={channelType}
          contentType={contentType}
          body={body}
        />
      </div>
    </div>
  );
}

/**
 * 去掉 MaterialPreview 外殼（rounded-2xl border 等），只留實際預覽內容。
 * 因為類型卡片自己有外框 / 背景，不需要 MaterialPreview 那層。
 */
function MaterialPreviewWithoutFrame({
  channelType,
  contentType,
  body,
}: {
  channelType: string;
  contentType: string;
  body: Record<string, unknown>;
}) {
  // 用 MaterialPreview 本身渲染，但隱藏外部的 LINE · xxx 標頭。
  // 簡單做法：直接呼叫 MaterialPreview，再用 CSS 隱藏外框
  return (
    <div className="[&_.flex.justify-center]:!justify-start [&>div]:!rounded-none [&>div]:!border-none [&>div]:!bg-transparent [&>div]:!p-0 [&>div>div:first-child]:!hidden">
      <MaterialPreview channelType={channelType} contentType={contentType} body={body} />
    </div>
  );
}
