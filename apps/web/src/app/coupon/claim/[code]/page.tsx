'use client';

import { useParams } from 'next/navigation';
import { ClaimLanding } from '@/components/fan-coupon/claim/ClaimLanding';

/** 公開領券頁（海報、官網 QR Code；不需登入，design D30） */
export default function CouponClaimPage() {
  const params = useParams();
  return <ClaimLanding code={String(params.code ?? '')} />;
}
