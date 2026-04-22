'use client';

import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

interface CsatMessageProps {
  score?: number;
  readonly?: boolean;
  caseId?: string;
  onRate?: (score: number) => void;
}

export function CsatMessage({ score: initialScore, readonly, caseId, onRate }: CsatMessageProps) {
  const [hovered, setHovered] = useState(0);
  const [selected, setSelected] = useState(initialScore || 0);
  const [submitted, setSubmitted] = useState(!!initialScore);

  const handleClick = async (star: number) => {
    if (readonly || submitted) { return; }
    setSelected(star);
    setSubmitted(true);
    onRate?.(star);

    if (caseId) {
      try {
        await api.post(`/cases/${caseId}/csat`, { score: star });
      } catch (err) {
        console.error('Failed to submit CSAT:', err);
      }
    }
  };

  const displayScore = hovered || selected;

  const labels = ['', '非常不滿意', '不滿意', '一般', '滿意', '非常滿意'];

  return (
    <div className="flex justify-center py-3">
      <div className="rounded-xl bg-muted px-6 py-4 text-center">
        <p className="mb-2 text-sm font-medium">
          {submitted ? '感謝您的評價！' : '請評價此次服務體驗'}
        </p>
        <div className="flex items-center justify-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onMouseEnter={() => !readonly && !submitted && setHovered(star)}
              onMouseLeave={() => !readonly && !submitted && setHovered(0)}
              onClick={() => handleClick(star)}
              disabled={readonly || submitted}
              className={cn(
                'transition-transform',
                !readonly && !submitted && 'hover:scale-110 cursor-pointer',
                (readonly || submitted) && 'cursor-default'
              )}
            >
              <Star
                className={cn(
                  'h-7 w-7 transition-colors',
                  star <= displayScore
                    ? 'fill-amber-400 text-amber-400'
                    : 'text-gray-300'
                )}
              />
            </button>
          ))}
        </div>
        {displayScore > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">{labels[displayScore]}</p>
        )}
      </div>
    </div>
  );
}
