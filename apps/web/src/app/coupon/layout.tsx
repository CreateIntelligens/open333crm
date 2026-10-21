/**
 * 顧客票券頁（/coupon/*）的版面：一律淺色，不跟隨手機的系統深色設定
 * （2026-10-21 使用者決定，取代原本 tasks 3.7 的跟隨系統）。深色主題只在 html 有 dark class 時套用，
 * 這裡不加，票券頁就固定淺色。
 */
import React from 'react';

export default function CouponLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
