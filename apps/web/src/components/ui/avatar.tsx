'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface AvatarProps {
  src?: string;
  alt?: string;
  fallback?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

function Avatar({ src, alt, fallback, className, size = 'md' }: AvatarProps) {
  const [imgError, setImgError] = useState(false);

  const sizeClasses = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-14 w-14 text-lg',
  };

  const initials = fallback
    || (alt
      ? alt
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)
      : '??');

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted',
        sizeClasses[size],
        className
      )}
    >
      {src && !imgError ? (
        <Image
          src={src}
          alt={alt || ''}
          fill
          className="object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="font-medium text-muted-foreground">{initials}</span>
      )}
    </div>
  );
}

export { Avatar };
