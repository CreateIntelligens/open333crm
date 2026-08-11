'use client';

/**
 * LINE OA 切換器
 *
 * 列出 tenant 內所有 active LINE channels，使用者選擇後：
 * - 呼叫 onChange(channelId)
 * - 上層頁面負責更新 URL `?channelId=xxx`（讓使用者複製 URL / refresh 後保持選擇）
 *
 * 若 tenant 內無 LINE channel → 顯示提示訊息
 */

import React from 'react';
import { useChannels } from '@/hooks/useChannels';
import { Select } from '@/components/ui/select';

interface Props {
  value: string | null;
  onChange: (channelId: string) => void;
}

export function OaSwitcher({ value, onChange }: Props) {
  const { channels, isLoading } = useChannels();

  // 只列 LINE 且 active 的渠道
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineChannels = (channels as any[]).filter(
    (c) => c.channelType === 'LINE' && c.isActive,
  );

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">載入中…</div>;
  }

  if (lineChannels.length === 0) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning-subtle px-3 py-2 text-xs text-warning">
        尚未設定任何 LINE 官方帳號。請先到「設定 &gt; 渠道」新增 LINE 渠道。
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-muted-foreground">選擇官方帳號：</label>
      <Select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { value: '', label: '請選擇 LINE 帳號' },
          ...lineChannels.map((c) => ({
            value: c.id,
            label: c.displayName,
          })),
        ]}
      />
    </div>
  );
}
