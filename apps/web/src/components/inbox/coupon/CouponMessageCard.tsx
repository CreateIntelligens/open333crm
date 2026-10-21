'use client';

/**
 * 對話中的發券訊息（add-coupon-system A11）：顧客收到的是文字與票券連結，後台畫成券卡。
 * 「查看優惠券」開後台的券詳情，不開顧客的票券連結——座席開啟會被當成顧客本人。
 */
import React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { faceText, ymd, type CouponMessageContent } from '@/lib/coupon/issue';

export function CouponMessageCard({ coupon, createdAt }: { coupon: CouponMessageContent; createdAt: string }) {
  return (
    <div className="flex flex-col items-end px-4 py-1.5">
      <article aria-label="優惠券訊息" className="w-64 overflow-hidden rounded-xl border bg-background shadow-sm">
        <div className="bg-primary px-4 py-3 text-primary-foreground">
          <p className="text-xs opacity-90">為您準備了一張優惠券</p>
          <p className="mt-0.5 text-2xl font-bold">{faceText(coupon)}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-sm font-semibold">{coupon.name}</p>
          {coupon.expiresAt && <p className="mt-0.5 text-xs text-muted-foreground">有效期至 {ymd(coupon.expiresAt)}</p>}
        </div>
        <Link
          href={`/dashboard/marketing/coupons/${coupon.couponId}`}
          className="block border-t px-4 py-2 text-center text-sm font-medium text-primary hover:bg-primary-subtle"
        >
          查看優惠券
        </Link>
      </article>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {coupon.issuedByName ? `由 ${coupon.issuedByName} 發送 · ` : ''}
        {format(new Date(createdAt), 'HH:mm')}
      </p>
    </div>
  );
}
