'use client';

import { useParams } from 'next/navigation';
import { CouponEntry } from '@/components/fan-coupon/entry/CouponEntry';

/** 票券連結入口（公開頁，以連結 token 換顧客憑證；design D12） */
export default function CouponOpenPage() {
  const params = useParams();
  return <CouponEntry token={String(params.token ?? '')} />;
}
