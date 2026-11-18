'use client';

/**
 * LINE OA 切換器
 *
 * 列出 tenant 內所有 active LINE channels，使用者選擇後：
 * - 呼叫 onChange(channelId)
 * - 上層頁面負責更新 URL `?channelId=xxx`（讓使用者複製 URL / refresh 後保持選擇）
 *
 * 若 tenant 內無 LINE channel → 顯示提示訊息
 * 版面依 Claude Design「Rich Menu 列表」：標題列下方的小型篩選器（標籤＋固定寬度下拉）。
 */

import React, { useId } from 'react';
import { useChannels } from '@/hooks/useChannels';
import { Select } from '@/components/ui/select';

interface Props {
  value: string | null;
  onChange: (channelId: string) => void;
}

export function OaSwitcher({ value, onChange }: Props) {
  const { channels, isLoading } = useChannels();
  const selectId = useId();

  // 只列 LINE 且 active 的渠道
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineChannels = (channels as any[]).filter(
    (c) => c.channelType === 'LINE' && c.isActive,
  );

  if (isLoading) {
    return <div className="h-10 w-full animate-pulse sm:w-[280px] rounded-lg bg-muted" aria-label="載入官方帳號中" />;
  }

  if (lineChannels.length === 0) {
    return (
      <div role="status" className="rounded-md border border-warning/30 bg-warning-subtle px-3 py-2 text-sm text-warning">
        尚未設定任何 LINE 官方帳號。請先到「設定 &gt; 渠道」新增 LINE 渠道。
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-3 sm:w-auto">
      <label htmlFor={selectId} className="whitespace-nowrap text-sm text-muted-foreground">官方帳號</label>
      <Select
        id={selectId}
        className="min-w-0 flex-1 sm:w-[280px] sm:flex-none"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { value: '', label: '請選擇官方帳號' },
          ...lineChannels.map((c) => ({
            value: c.id,
            label: c.displayName,
          })),
        ]}
      />
    </div>
  );
}
