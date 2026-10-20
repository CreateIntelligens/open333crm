'use client';

/**
 * 優惠券詳情頁 /dashboard/marketing/coupons/[id]。畫面與狀態都在 CouponDetailView。
 */
import React, { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { CouponDetailView } from '@/components/coupons/detail/CouponDetailView';

function DetailRoute() {
  const params = useParams<{ id: string }>();
  return <CouponDetailView id={params.id} />;
}

export default function CouponDetailPage() {
  // useSearchParams 需要 Suspense 邊界，否則 next build 會報錯
  return (
    <Suspense fallback={null}>
      <DetailRoute />
    </Suspense>
  );
}
