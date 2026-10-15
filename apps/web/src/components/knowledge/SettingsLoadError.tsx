'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { getApiErrorMessage } from '@/lib/api-error';

/**
 * 依讀取錯誤決定要顯示的文字。
 * 403 時明確說「沒有權限」，其他錯誤顯示後端原因。
 * 讀取失敗時不可顯示前端寫死的預設值，否則使用者會以為那是目前設定。
 */
export function describeSettingsLoadError(err: unknown, fallback: string): { forbidden: boolean; message: string } {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  if (status === 403) {
    return { forbidden: true, message: '你沒有權限檢視這個設定頁，需要「系統設定」權限，請洽管理員。' };
  }
  return { forbidden: false, message: getApiErrorMessage(err, fallback) };
}

/** 設定頁讀取失敗時取代整個表單的區塊。 */
export function SettingsLoadError({
  forbidden,
  message,
  onRetry,
}: {
  forbidden: boolean;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="max-w-3xl rounded-lg border border-destructive/40 bg-destructive-subtle p-5">
      <h3 className="text-sm font-semibold text-destructive">{forbidden ? '沒有權限' : '設定載入失敗'}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      {!forbidden && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          重新載入
        </Button>
      )}
    </div>
  );
}
