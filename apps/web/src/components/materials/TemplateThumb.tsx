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

  // 方案 A：柔和漸層聊天底（亮暗色皆自然）+ 顯示「完整」縮圖不裁切。
  //
  // 關鍵：用 `zoom`（會縮放盒模型、影響版面高度）而非 `transform: scale`
  // （scale 不改變佔位空間，會導致固定高度容器裁切內容）。容器不設固定高度，
  // 高度自然 = 內容高度 × zoom → 較高的版型(商品卡/showcase/flex)完整呈現、
  // 較矮的(純文字/小圖)則卡片較矮，同列不等高但都不裁切、不留白。
  return (
    <div className="relative flex justify-center overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 p-3 dark:from-slate-800 dark:to-slate-900">
      <div
        className="pointer-events-none"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style={{ zoom: 0.55 } as any}
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
