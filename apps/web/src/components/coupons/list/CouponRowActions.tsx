'use client';

/**
 * 列表每一列的「⋯」操作選單。
 * Esc 關閉後焦點回到「⋯」由 DropdownMenu 處理。
 * 無編輯權限時項目以 aria-disabled 停用而不隱藏，仍可用鍵盤聚焦，聚焦或滑過時顯示「需主管權限」。
 */
import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { CouponStatus } from '@/hooks/useCoupons';
import { NEED_MANAGE_HINT, rowActionsFor, type RowActionKey } from './row-actions';

interface Props {
  name: string;
  status: CouponStatus;
  canManage: boolean;
  onAction: (key: RowActionKey) => void;
}

export function CouponRowActions({ name, status, canManage, onAction }: Props) {
  const items = rowActionsFor(status).map((action) => {
    const disabled = action.requiresManage && !canManage;
    return (
      <DropdownMenuItem
        key={action.key}
        data-label={action.label}
        destructive={action.destructive}
        aria-disabled={disabled || undefined}
        title={disabled ? NEED_MANAGE_HINT : undefined}
        className={cn(
          'group justify-between gap-4',
          disabled && 'cursor-not-allowed text-muted-foreground opacity-60 hover:bg-transparent hover:text-muted-foreground',
        )}
        onClick={() => {
          if (!disabled) onAction(action.key);
        }}
      >
        <span>{action.label}</span>
        {/* 平時只給螢幕閱讀器，滑過或聚焦時才顯示 */}
        {disabled && (
          <span className="sr-only text-xs text-muted-foreground group-hover:not-sr-only group-focus:not-sr-only">
            {NEED_MANAGE_HINT}
          </span>
        )}
      </DropdownMenuItem>
    );
  });

  return (
    // 選單在可點擊的列裡：擋下事件冒泡，避免開選單或按項目時同時開啟該列
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DropdownMenu
        align="right"
        className="[&>[role=menu]]:min-w-[11rem]"
        trigger={
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{`${name} 的更多操作`}</span>
          </span>
        }
      >
        {items}
      </DropdownMenu>
    </div>
  );
}
