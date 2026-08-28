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

export function TemplateThumb({ contentType }: Props) {
  const isLine = contentType.startsWith('line_');
  const isFb = contentType.startsWith('fb_');
  const body = DEFAULT_BODY_FOR_TYPE[contentType] ?? {};
  const channelType = isLine ? 'line' : isFb ? 'fb' : '';

  // 方案 A：去掉刺眼的 LINE 藍大色塊，改用柔和漸層聊天底（亮暗色皆自然）；
  // 預覽放大到 scale(0.58) 讓縮圖更飽滿、不再小小浮中央。
  // 內容從頂部對齊（items-start）：較高的版型（商品卡/showcase）上緣才不會被裁切。
  return (
    <div className="relative flex h-36 items-start justify-center overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 px-3 pt-3 dark:from-slate-800 dark:to-slate-900">
      <div
        className="pointer-events-none origin-top"
        style={{ transform: 'scale(0.58)', transformOrigin: 'top center' }}
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
