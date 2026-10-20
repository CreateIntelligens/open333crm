'use client';

/**
 * 顧客券詳情與核銷（/coupon/wallet/:id）。畫面狀態機見 CouponRedeemFlow。
 */
import React from 'react';
import { useParams } from 'next/navigation';
import { CouponRedeemFlow } from '@/components/fan-coupon/detail/CouponRedeemFlow';

export default function FanCouponDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id ?? '');
  return <CouponRedeemFlow key={id} id={id} />;
}
