/**
 * 店員核銷台（/redeem）的版面：一律淺色，不跟隨手機的系統深色設定
 * （2026-10-21 使用者決定，與顧客票券頁 app/coupon/layout.tsx 一致）。
 */
import React from 'react';

export default function RedeemLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
