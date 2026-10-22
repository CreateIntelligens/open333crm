'use client';

/**
 * 優惠券列表頁 /dashboard/marketing/coupons
 * 搜尋字、狀態與頁碼放在 URL query（?q=&status=&page=），從詳情返回或重新整理都保留。
 */
import React, { Suspense, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Topbar } from '@/components/layout/Topbar';
import { MarketingTabs } from '@/components/marketing/MarketingTabs';
import { CouponListView, type CouponListQuery } from '@/components/coupons/list/CouponListView';
import type { CouponStatus } from '@/hooks/useCoupons';

const STATUSES: CouponStatus[] = ['ACTIVE', 'PAUSED', 'DRAFT', 'ENDED'];

function parseQuery(params: URLSearchParams): CouponListQuery {
  const status = params.get('status');
  const page = Number(params.get('page'));
  return {
    q: params.get('q') ?? '',
    // 網址被手動改成不認得的狀態時當作「全部」
    status: STATUSES.includes(status as CouponStatus) ? (status as CouponStatus) : '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

function toSearch(query: CouponListQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.page > 1) params.set('page', String(query.page));
  const s = params.toString();
  return s ? `?${s}` : '';
}

function CouponListPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseQuery(new URLSearchParams(searchParams.toString())), [searchParams]);

  // 用 replace 而非 push：篩選不另外留瀏覽紀錄，「上一頁」直接回到進入列表前的頁面
  const handleQueryChange = useCallback(
    (next: CouponListQuery) => router.replace(`${pathname}${toSearch(next)}`, { scroll: false }),
    [router, pathname],
  );

  // 建立頁儲存草稿後帶 ?draftSaved=1 回來；顯示提示後清掉參數，重新整理不會再顯示
  const notice = searchParams.get('draftSaved') ? '已儲存草稿' : null;
  const clearNotice = useCallback(
    () => router.replace(`${pathname}${toSearch(query)}`, { scroll: false }),
    [router, pathname, query],
  );

  return (
    <CouponListView query={query} onQueryChange={handleQueryChange} notice={notice} onNoticeShown={clearNotice} />
  );
}

export default function CouponListPage() {
  return (
    <div className="flex h-screen flex-col bg-muted">
      <Topbar title="行銷" />
      <div className="bg-background">
        <MarketingTabs active="coupons" />
      </div>
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {/* useSearchParams 需要 Suspense 邊界，否則 next build 會失敗 */}
        <Suspense fallback={null}>
          <CouponListPageInner />
        </Suspense>
      </main>
    </div>
  );
}
