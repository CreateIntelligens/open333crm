'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';

interface AvatarProps {
  src?: string;
  alt?: string;
  fallback?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** bot=紫底機器人頭像 (對齊 Figma State=bot Avatar) */
  variant?: 'user' | 'bot';
}

/**
 * 頭像縮寫：中日韓姓名取第一個字（林佩君 → 林），英文取前兩個字的字首（Michael Huang → MH）。
 * 會略過 emoji 與符號（🌸 櫻花妹 🌸 → 櫻），並以「字元」而非 UTF-16 單位切割，避免 emoji 被切一半變成亂碼。
 */
export function initialsOf(name?: string): string {
  if (!name) return '?';
  const words = name
    .split(/\s+/)
    .map((w) => Array.from(w).filter((ch) => /[\p{L}\p{N}]/u.test(ch)).join(''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0])[0];
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(first)) return first;
  return words.slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase();
}

function Avatar({ src, alt, fallback, className, size = 'md', variant = 'user' }: AvatarProps) {
  const [imgError, setImgError] = useState(false);

  const sizeClasses = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-14 w-14 text-lg',
  };

  const variantClasses =
    variant === 'bot' ? 'bg-ai text-ai-foreground' : 'bg-surface-hover text-muted-foreground';

  const initials = fallback || initialsOf(alt);

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        variantClasses,
        sizeClasses[size],
        className
      )}
    >
      {src && !imgError ? (
        <img
          src={src}
          alt={alt || ''}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="font-semibold">{initials}</span>
      )}
    </div>
  );
}

export { Avatar };
