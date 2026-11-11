'use client';

/**
 * MarketingTabs — 行銷模組共用 Tab 列
 *
 * 點 campaigns / broadcasts / segments 都跳回 /dashboard/marketing 並帶 query 切到對應 tab；
 * 點 materials 跳到獨立的 /dashboard/marketing/materials。
 *
 * 範本管理 / 群發訊息已整合進 Material 系統與 Broadcast，故移除。
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/providers/AuthProvider';

interface Props {
  /** 目前 active 的 tab：campaigns / broadcasts / segments / materials / coupons */
  active: string;
}

export function MarketingTabs({ active }: Props) {
  const router = useRouter();
  const { hasPermission } = useAuth();

  const handleChange = (v: string) => {
    if (v === 'materials' || v === 'coupons') {
      router.push(`/dashboard/marketing/${v}`);
      return;
    }
    if (active === 'materials' || active === 'coupons') {
      // 從素材庫跳回主頁，並帶 query 讓主頁 sync activeTab
      router.push(`/dashboard/marketing?tab=${v}`);
      return;
    }
    // 主頁內部切換由父層處理
    window.dispatchEvent(new CustomEvent('marketing-tab-change', { detail: v }));
  };

  return (
    <div className="border-b px-6 pt-2">
      <Tabs value={active} onValueChange={handleChange}>
        <TabsList>
          <TabsTrigger value="campaigns">行銷活動</TabsTrigger>
          <TabsTrigger value="broadcasts">廣播</TabsTrigger>
          <TabsTrigger value="segments">受眾分群</TabsTrigger>
          <TabsTrigger value="materials">素材庫</TabsTrigger>
          {hasPermission('coupon.view') && <TabsTrigger value="coupons">優惠券</TabsTrigger>}
        </TabsList>
      </Tabs>
    </div>
  );
}
