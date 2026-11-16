'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { InboxIcon } from '@/components/icons/figma-icons';

interface EmptyStateProps {
  /** 20px 圖示；外層會統一尺寸，傳進來的圖示不用自己設大小 */
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** 主要操作，例如「新增標籤」按鈕 */
  action?: React.ReactNode;
  className?: string;
}

/**
 * 列表沒有資料時的空狀態。
 * Figma Design System 沒有 Empty State 元件，樣式依專案 token 訂定（2026-11 確認）：
 * 48px 淡藍圓底＋20px 圖示、16px 粗體標題、14px 灰色說明、選填操作按鈕。設計稿補上後改這裡即可全站套用。
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      <div
        aria-hidden="true"
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-subtle text-primary [--icon-cutout:hsl(var(--primary-subtle))] [&_svg]:h-5 [&_svg]:w-5"
      >
        {icon ?? <InboxIcon />}
      </div>
      <h3 className="text-base font-semibold leading-6 text-foreground">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm leading-5 text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
