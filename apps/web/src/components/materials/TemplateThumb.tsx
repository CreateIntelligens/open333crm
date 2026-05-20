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

const LINE_CHAT_BG = '#8CABD8';

export function TemplateThumb({ contentType }: Props) {
  const isLine = contentType.startsWith('line_');
  const isFb = contentType.startsWith('fb_');
  const body = DEFAULT_BODY_FOR_TYPE[contentType] ?? {};
  const channelType = isLine ? 'line' : isFb ? 'fb' : '';
  const bgColor = isLine ? LINE_CHAT_BG : '#ffffff';

  return (
    <div
      className="relative flex h-44 items-center justify-center overflow-hidden"
      style={{ backgroundColor: bgColor }}
    >
      <div
        className="origin-center pointer-events-none"
        style={{ transform: 'scale(0.45)', transformOrigin: 'center center' }}
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
