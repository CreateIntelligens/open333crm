'use client';

/**
 * 中途離開確認框（CM-196 #13）。新建或草稿與已發布的券，標題與按鈕不同；預設焦點在「繼續編輯」。
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { ModalShell } from './ModalShell';

interface Props {
  open: boolean;
  published: boolean;
  saving: boolean;
  onStay: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

export function LeaveConfirmDialog({ open, published, saving, onStay, onDiscard, onSave }: Props) {
  return (
    <ModalShell
      open={open}
      busy={saving}
      onClose={onStay}
      title={published ? '尚未儲存變更' : '尚未完成優惠券建立'}
      description="離開後，尚未儲存的內容將會遺失。"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onStay} disabled={saving} data-autofocus>
            繼續編輯
          </Button>
          <Button type="button" variant="ghost" onClick={onDiscard} disabled={saving}>
            {published ? '放棄修改' : '放棄建立'}
          </Button>
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving ? '儲存中…' : published ? '儲存變更' : '儲存草稿'}
          </Button>
        </>
      }
    />
  );
}
