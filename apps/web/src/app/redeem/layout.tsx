'use client';

/**
 * 店員核銷台（/redeem）的版面：店員用自己的手機開啟，深色模式跟隨系統設定。
 * 後台沒有深色切換邏輯，這裡比照顧客票券頁（app/coupon/layout.tsx）依系統設定套用 .dark。
 */
import React, { useEffect } from 'react';

export default function RedeemLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
      document.documentElement.classList.remove('dark');
    };
  }, []);
  return <>{children}</>;
}
