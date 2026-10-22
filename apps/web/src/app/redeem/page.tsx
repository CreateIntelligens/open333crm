'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { StoreConsoleApp } from '@/components/store-console/StoreConsoleApp';

/** 依網址 ?store={門市 id} 在登入頁顯示門市名稱（門市海報的 QR Code 帶這個參數） */
function RedeemPageInner() {
  const storeId = useSearchParams().get('store');
  return <StoreConsoleApp storeId={storeId} />;
}

/** 店員核銷台（公開頁，以門市帳號登入；與後台座席登入分開） */
export default function RedeemPage() {
  return (
    <Suspense fallback={null}>
      <RedeemPageInner />
    </Suspense>
  );
}
