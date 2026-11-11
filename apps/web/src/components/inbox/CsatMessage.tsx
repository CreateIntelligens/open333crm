'use client';

import React, { useState } from 'react';
import { AlertCircle, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { csatScoreLabel } from '@/lib/csat-labels';

interface CsatMessageProps {
  score?: number;
  /** 誰評的分（問卷訊息的 metadata.csatRatedBy，issue #444）：客人回覆或客服代評 */
  ratedBy?: 'customer' | 'agent';
  readonly?: boolean;
  caseId?: string;
  onRate?: (score: number) => void;
  /** 問卷沒有送到客人時的原因；undefined 表示沒有失敗，空字串表示失敗但沒有原因 */
  deliveryError?: string;
}

export function CsatMessage({ score: initialScore, ratedBy, readonly, caseId, onRate, deliveryError }: CsatMessageProps) {
  const [hovered, setHovered] = useState(0);
  // 客服在這張卡片上點的分數；後端推來的分數（initialScore）優先，socket 更新後卡片跟著變（issue #444）
  const [picked, setPicked] = useState(0);
  const rated = !!initialScore;
  const selected = initialScore || picked;
  const locked = readonly || rated || picked > 0;

  const handleClick = async (star: number) => {
    if (locked) return;
    setPicked(star);
    onRate?.(star);

    if (caseId) {
      try {
        await api.post(`/cases/${caseId}/csat`, { score: star });
      } catch (err) {
        console.error('Failed to submit CSAT:', err);
        // 沒有記錄成功：恢復可點，不讓卡片看起來已評分
        setPicked(0);
        alert(getApiErrorMessage(err, '評分送出失敗，請稍後重試'));
      }
    }
  };

  const displayScore = hovered || selected;
  const title = rated
    ? `${ratedBy === 'agent' ? '客服代評' : '客人評'} ${initialScore} 分`
    : picked > 0
      ? '感謝您的評價！'
      : '請評價此次服務體驗';

  return (
    <div className="flex justify-center py-3">
      <div className="rounded-xl border border-border bg-card px-6 py-4 text-center shadow-soft">
        <p className="mb-2 text-sm font-semibold text-primary">
          {title}
        </p>
        <div className="flex items-center justify-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onMouseEnter={() => !locked && setHovered(star)}
              onMouseLeave={() => !locked && setHovered(0)}
              onClick={() => handleClick(star)}
              disabled={locked}
              className={cn(
                'transition-transform',
                !locked && 'hover:scale-110 cursor-pointer',
                locked && 'cursor-default'
              )}
            >
              <Star
                className={cn(
                  'h-7 w-7 transition-colors',
                  star <= displayScore
                    ? 'fill-warning text-warning'
                    : 'text-muted-foreground/30'
                )}
              />
            </button>
          ))}
        </div>
        {displayScore > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">{csatScoreLabel(displayScore)}</p>
        )}
        {deliveryError !== undefined && (
          <p role="alert" className="mt-2 flex max-w-xs items-start gap-1 text-left text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="break-words">
              這份問卷沒有送出，客人並未收到
              {deliveryError && <span className="opacity-90">：{deliveryError}</span>}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
