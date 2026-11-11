'use client';

/**
 * 編輯優惠券：草稿為「編輯草稿」（同建立，可存草稿）；已發布的券鎖定關鍵設定，只能儲存變更。
 */
import { useParams } from 'next/navigation';
import { EditCouponPage } from '@/components/coupons/form/CouponFormPage';

export default function EditCouponRoutePage() {
  const params = useParams<{ id: string }>();
  return <EditCouponPage id={params.id} />;
}
