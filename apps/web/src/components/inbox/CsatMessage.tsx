'use client';

import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CsatMessageProps {
  score?: number;
  readonly?: boolean;
  onRate?: (score: number) => void;
}

export function CsatMessage({ score: initialScore, readonly, onRate }: CsatMessageProps) {
  const [hovered, setHovered] = useState(0);
  const [selected, setSelected] = useState(initialScore || 0);

  const handleClick = (star: number) => {
    if (readonly) return;
    setSelected(star);
    onRate?.(star);
  };

  const displayScore = hovered || selected;

  const labels = ['', '非常不滿意', '不滿意', '一般', '滿意', '非常滿意'];

  return (
    <div className="flex justify-center py-3">
      <div className="rounded-xl bg-muted px-6 py-4 text-center">
        <p className="mb-2 text-sm font-medium">請評價此次服務體驗</p>
        <div className="flex items-center justify-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onMouseEnter={() => !readonly && setHovered(star)}
              onMouseLeave={() => !readonly && setHovered(0)}
              onClick={() => handleClick(star)}
              disabled={readonly}
              className={cn(
                'transition-transform',
                !readonly && 'hover:scale-110 cursor-pointer',
                readonly && 'cursor-default'
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
