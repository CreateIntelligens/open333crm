'use client';

import React, { useId } from 'react';
import { Input } from '@/components/ui/input';

interface Props {
  value?: string;
  /** 沒填時 LINE 顯示的預設文字 */
  fallback: string;
  onChange: (value: string) => void;
}

/** LINE 訊息的預覽文字（altText）：聊天列表、手機通知與引用訊息顯示的文字 */
export function PreviewTextField({ value, fallback, onChange }: Props) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
        預覽文字
      </label>
      <Input
        id={id}
        value={value ?? ''}
        maxLength={400}
        onChange={(event) => onChange(event.target.value)}
        placeholder="如：秋季新品上市，點開看優惠"
      />
      <div className="mt-1 text-[11px] text-slate-500">
        顯示在聊天列表與手機通知；沒填會顯示「{fallback}」
      </div>
    </div>
  );
}
