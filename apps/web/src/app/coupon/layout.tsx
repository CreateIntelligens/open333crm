'use client';

/**
 * 顧客票券頁（/coupon/*）的版面：跟隨手機的系統深色設定（tasks 3.7）。
 * 後台沒有深色切換邏輯；顧客頁在 LINE 內建瀏覽器開啟，會吃到系統設定，兩套主題都要可讀。
 */
import React, { useEffect } from 'react';

export default function CouponLayout({ children }: { children: React.ReactNode }) {
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
