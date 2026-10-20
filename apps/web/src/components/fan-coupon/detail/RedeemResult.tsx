'use client';

/**
 * 核銷結果（Figma 顧客端 C8）。核銷門市要等店員端第 3 階段後端支援，目前不顯示該列。
 * 成功訊息不加勾勾圖示，靠標題與排版呈現。
 */
import React, { useEffect, useRef } from 'react';
import type { FanCoupon } from '@/hooks/useFanCoupons';
import { ymdhms } from '@/lib/fan-coupon/labels';
import { FanShell } from '../FanShell';
import { FanCouponCard } from '../FanCouponCard';
import { REDEEM_MODE_LABEL, btnSecondary } from './ui';

interface Props {
  item: FanCoupon;
  redeemedAt: string;
  onClose: () => void;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <dt className="shrink-0 text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? 'break-all text-right font-mono text-sm font-semibold text-foreground' : 'text-right text-sm font-semibold text-foreground'}>
        {value}
      </dd>
    </div>
  );
}

export function RedeemResult({ item, redeemedAt, onClose }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 切換畫面後把焦點移到結果標題，螢幕閱讀器才會念出核銷完成
  useEffect(() => headingRef.current?.focus(), []);
  const usedItem: FanCoupon = { ...item, walletStatus: 'USED', walletTab: 'used', redeemedAt };
  const isExchange = item.coupon.couponType === 'EXCHANGE';

  return (
    <FanShell
      title="核銷結果"
      nav="back"
      onNav={onClose}
      footer={
        <button type="button" className={btnSecondary} onClick={onClose}>
          關閉
        </button>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="text-center">
          <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-black leading-8 text-foreground focus:outline-none">
            {isExchange ? '兌換完成' : '核銷完成'}
          </h2>
          <p className="mt-1 text-sm font-medium text-muted-foreground">此券已使用，請向店員出示此畫面確認</p>
        </div>
        <FanCouponCard item={usedItem} />
        <section aria-labelledby="redeem-detail-title" className="-mx-5 bg-card px-5 pb-4 pt-5">
          <h3 id="redeem-detail-title" className="text-base font-semibold text-foreground">
            核銷明細
          </h3>
          <dl className="mt-1">
            <Row label="券名" value={item.coupon.name} />
            <Row label="核銷時間" value={ymdhms(redeemedAt)} />
            {item.code && <Row label="券號" value={item.code} mono />}
            {item.coupon.redeemMode && <Row label="核銷方式" value={REDEEM_MODE_LABEL[item.coupon.redeemMode]} />}
          </dl>
        </section>
      </div>
    </FanShell>
  );
}
