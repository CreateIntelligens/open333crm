'use client';

/**
 * 發布確認框（規格 2.5；CM-196 #8–10）。
 * 列出發布後鎖定的設定；驗證碼模式另起一行強調驗證碼。有風險項目時列出「需要確認」與最壞成本，
 * 必須勾選確認才能發布。送出期間兩顆按鈕都停用；失敗留在框內顯示原因並可重試。
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ModalShell } from './ModalShell';
import type { Risk, WorstCost } from './form-model';

export type PublishPhase = 'review' | 'submitting' | 'failed';

interface Props {
  open: boolean;
  rows: { label: string; value: string }[];
  /** 驗證碼模式：「店員驗證碼：582917（發布後無法修改）」；其他模式為一般說明 */
  pinLine: string;
  pinEmphasis: boolean;
  risks: Risk[];
  worst: WorstCost;
  ack: boolean;
  onAckChange: (ack: boolean) => void;
  phase: PublishPhase;
  failMessage: string;
  onConfirm: () => void;
  onCancel: () => void;
  onFix: (risk: Risk) => void;
}

export function PublishConfirmDialog({
  open, rows, pinLine, pinEmphasis, risks, worst, ack, onAckChange, phase, failMessage, onConfirm, onCancel, onFix,
}: Props) {
  const submitting = phase === 'submitting';
  const failed = phase === 'failed';
  const needAck = risks.length > 0;
  const confirmDisabled = submitting || (needAck && !ack && !failed);

  return (
    <ModalShell
      open={open}
      busy={submitting}
      onClose={onCancel}
      tone={failed ? 'danger' : 'default'}
      title={failed ? '發布失敗' : '確認發布優惠券？'}
      description={failed ? undefined : '發布後以下設定將無法修改，請確認內容正確。'}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button type="button" onClick={onConfirm} disabled={confirmDisabled}>
            {submitting ? '發布中…' : failed ? '重試' : '確認發布'}
          </Button>
        </>
      }
    >
      {failed ? (
        <div className="space-y-2 text-sm" role="alert">
          <p className="text-foreground">{failMessage}</p>
          <p className="text-muted-foreground">優惠券尚未發布。已填寫的內容都已保留，可以重試。</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="divide-y rounded-[10px] border text-sm">
            {rows.map((r) => (
              <div key={r.label} className="flex gap-4 px-4 py-2.5">
                <dt className="w-24 shrink-0 text-muted-foreground">{r.label}</dt>
                <dd className="min-w-0 break-words text-foreground">{r.value}</dd>
              </div>
            ))}
          </dl>

          <p
            className={cn(
              'flex items-start gap-2 rounded-[10px] px-4 py-2.5 text-sm',
              pinEmphasis ? 'border border-warning/40 bg-warning-subtle font-medium text-warning' : 'bg-muted text-muted-foreground',
            )}
          >
            {pinEmphasis && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className={pinEmphasis ? 'font-mono' : undefined}>{pinLine}</span>
          </p>

          {needAck && (
            <section aria-label="需要確認的設定" className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-warning">{risks.length} 項設定需要確認</h3>
              {risks.map((r) => (
                <div key={r.key} className="flex items-start gap-3 rounded-[10px] border border-warning/40 bg-warning-subtle px-4 py-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-warning">{r.title}</p>
                    <p className="text-xs text-warning">{r.text}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => onFix(r)} disabled={submitting}>
                    去設定
                  </Button>
                </div>
              ))}

              <div className="rounded-[10px] border bg-muted/50 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-foreground">最壞成本</span>
                  <span className={cn('font-mono text-xl font-semibold', worst.bounded ? 'text-foreground' : 'text-warning')}>{worst.cost}</span>
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{worst.formula}</p>
                <p className="mt-1 text-xs text-muted-foreground">{worst.note}</p>
              </div>

              <label className="mt-1 flex cursor-pointer items-start gap-2.5 rounded-lg px-1 py-1.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={ack}
                  disabled={submitting}
                  onChange={(e) => onAckChange(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                />
                我已確認以上 {risks.length} 項設定與最壞成本
              </label>
            </section>
          )}
        </div>
      )}
    </ModalShell>
  );
}
