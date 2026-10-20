'use client';

/**
 * 券卡（列表型）：左側票根顯示面額，右側券名、日期與狀態。
 * 已使用、已過期、活動已結束整張灰階（設計稿 F.1）。
 * 票根預設為綠色漸層；商家上傳券面圖時改用圖片並加深色漸層讓白字可讀。
 */
import React from 'react';
import { Gift } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FanCoupon } from '@/hooks/useFanCoupons';
import { cardSubtitle, faceValue, statusLabel } from '@/lib/fan-coupon/labels';
import { FanStatusBadge } from './FanStatusBadge';

export function FanCouponCard({ item, onClick }: { item: FanCoupon; onClick?: () => void }) {
  const face = faceValue(item.coupon);
  const muted = item.walletTab !== 'available';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'relative flex h-[108px] w-full overflow-hidden rounded-2xl bg-card text-left shadow-[0_0_2px_rgba(0,0,0,0.1)]',
        onClick && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        muted && 'grayscale',
      )}
    >
      {/* 票根 */}
      <div
        className="relative flex w-[108px] shrink-0 flex-col items-center justify-center bg-gradient-to-br from-[#0b6b57] to-[#14876f] text-white"
        style={
          item.coupon.imageUrl
            ? { backgroundImage: `linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.55)), url(${item.coupon.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : undefined
        }
      >
        <div className="flex items-baseline gap-1">
          {face.prefix && <span className="text-sm font-bold">{face.prefix}</span>}
          <span className="text-[28px] font-black leading-8">{face.value}</span>
          {face.suffix && <span className="text-sm font-bold">{face.suffix}</span>}
        </div>
        {face.caption && <span className="text-xs font-bold">{face.caption}</span>}
        {/* 右側上下的半圓缺口 */}
        <span aria-hidden className="absolute -right-2.5 -top-2.5 h-5 w-5 rounded-full bg-muted" />
        <span aria-hidden className="absolute -bottom-2.5 -right-2.5 h-5 w-5 rounded-full bg-muted" />
      </div>
      <div aria-hidden className="my-3 border-l-2 border-dashed border-[#D1C8BB]" />
      {/* 資訊 */}
      <div className="relative flex min-w-0 flex-1 flex-col justify-center gap-1 px-4">
        <p className="truncate text-sm font-extrabold text-foreground">{item.coupon.name}</p>
        <p className={cn('truncate text-xs font-semibold text-muted-foreground', item.walletStatus === 'USED' && 'line-through')}>
          {cardSubtitle(item)}
        </p>
        <div>
          <FanStatusBadge status={item.walletStatus} label={statusLabel(item)} size="sm" />
        </div>
        <Gift aria-hidden className="absolute bottom-2 right-3 h-8 w-8 text-primary/20" />
      </div>
    </Tag>
  );
}
