'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

/**
 * 讀取失敗的提示與「重新載入」。
 * 讀取失敗時不可顯示「尚未建立」之類的空狀態或預設值表單：使用者會重複建立，或以空值蓋掉設定（G13）。
 */
export function LoadErrorNotice({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="max-w-2xl space-y-3 rounded-md border border-destructive/30 bg-destructive-subtle p-4">
      <p className="text-sm text-destructive">
        {title}：{message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        重新載入
      </Button>
    </div>
  );
}
