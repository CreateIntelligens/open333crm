'use client';

/**
 * 優惠券詳情頁（A4 單券成效）。規則依《優惠券後台 UX 規則》第 4、5、6 節與 Jira CM-196。
 *
 * 狀態的判斷順序：無查看權限 → 網址的券不存在（404，不顯示任何券資料，差異 D2）
 * → 載入失敗 → 載入中骨架 → 正常畫面。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { downloadExportFile, useCoupon, useCouponStats } from '@/hooks/useCoupons';
import { CouponPurposeBadge, CouponStatusBadge } from '@/components/coupons/CouponBadges';
import { CouponToast, useCouponToast } from '@/components/coupons/CouponToast';
import { Button, buttonVariants } from '@/components/ui/button';
import { getApiErrorMessage } from '@/lib/api-error';
import { COUPON_LIST_PATH, errorStatus, isCouponId, saveBlob } from './detail-helpers';
import { CouponStatCards } from './CouponStatCards';
import { CouponInstancesPanel } from './CouponInstancesPanel';
import { CouponSettingsPanel } from './CouponSettingsPanel';
import { CouponClaimLinksPanel } from './CouponClaimLinksPanel';

type TabKey = 'codes' | 'settings' | 'claim-links';
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'codes', label: '序號明細' },
  { key: 'settings', label: '設定' },
  { key: 'claim-links', label: '領券連結' },
];
const tabOf = (value: string | null): TabKey => TABS.find((t) => t.key === value)?.key ?? 'codes';

/**
 * 返回列表並保留列表的搜尋與篩選（列表把 q、status 放在 URL query）。
 * - 從發布或編輯完成導來：上一頁是編輯頁，直接回列表。
 * - 在站內由列表點進來（client-side 導覽）：router.back() 回到原本帶 query 的列表。
 * - 整頁載入且 referrer 是列表：回到 referrer 的網址（含 query）。
 * - 其他（書籤、外部連結）：回列表預設畫面。
 */
function useBackToList(arrivedFromForm: boolean) {
  const router = useRouter();
  const clientNav = useRef(false);

  useEffect(() => {
    try {
      // 第一次載入的文件不是這一頁，代表是站內導覽進來的，上一頁仍在本站
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (nav?.name) clientNav.current = new URL(nav.name).pathname !== window.location.pathname;
    } catch {
      clientNav.current = false;
    }
  }, []);

  return useCallback(() => {
    if (!arrivedFromForm) {
      if (clientNav.current && window.history.length > 1) {
        router.back();
        return;
      }
      try {
        const ref = document.referrer ? new URL(document.referrer) : null;
        if (ref && ref.origin === window.location.origin && ref.pathname === COUPON_LIST_PATH) {
          router.push(`${ref.pathname}${ref.search}`);
          return;
        }
      } catch {
        // referrer 格式異常時走預設
      }
    }
    router.push(COUPON_LIST_PATH);
  }, [arrivedFromForm, router]);
}

function FullPageMessage({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      <div className="mt-2">{action}</div>
    </div>
  );
}

export function CouponDetailView({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isLoading: authLoading, hasPermission } = useAuth();
  const canView = hasPermission('coupon.view');
  const canManage = hasPermission('coupon.manage');
  const validId = isCouponId(id);
  const fetchId = canView && validId ? id : null;

  const { coupon, error, isLoading, mutate } = useCoupon(fetchId);
  const stats = useCouponStats(fetchId);
  const { toast, showOk, showError } = useCouponToast();

  // ── 發布／更新後的提示：顯示一次後把 query 清掉，重新整理不會再跳 ──
  const [arrivedFromForm] = useState(
    () => searchParams.get('published') === '1' || searchParams.get('updated') === '1',
  );
  const handledArrival = useRef(false);
  useEffect(() => {
    if (handledArrival.current) return;
    const published = searchParams.get('published') === '1';
    const updated = searchParams.get('updated') === '1';
    if (!published && !updated) return;
    handledArrival.current = true;
    showOk(published ? '已發布優惠券' : '已更新優惠券');
    const next = new URLSearchParams(searchParams.toString());
    next.delete('published');
    next.delete('updated');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router, showOk]);

  // ── 從「序號明細已可下載」通知進來：下載背景產生的檔案，再把 export 參數清掉（design D22） ──
  const handledExport = useRef(false);
  useEffect(() => {
    const jobId = searchParams.get('export');
    if (!jobId || handledExport.current) return;
    handledExport.current = true;
    const next = new URLSearchParams(searchParams.toString());
    next.delete('export');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    downloadExportFile(jobId)
      .then(({ blob, fileName }) => {
        saveBlob(blob, fileName);
        showOk('已下載序號明細');
      })
      .catch((err: unknown) => showError(getApiErrorMessage(err, '下載失敗，請回到序號明細重新匯出')));
  }, [searchParams, pathname, router, showOk, showError]);

  const goBack = useBackToList(arrivedFromForm);

  // ── 分頁：同步到 ?tab=，用 replace 不增加瀏覽紀錄 ──
  const [tab, setTab] = useState<TabKey>(() => tabOf(searchParams.get('tab')));
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({ codes: null, settings: null, 'claim-links': null });
  function selectTab(next: TabKey, focus = false) {
    setTab(next);
    if (focus) tabRefs.current[next]?.focus();
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete('published');
    qs.delete('updated');
    if (next === 'codes') qs.delete('tab');
    else qs.set('tab', next);
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }
  function onTabKeyDown(e: React.KeyboardEvent) {
    const idx = TABS.findIndex((t) => t.key === tab);
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = TABS.length - 1;
    if (nextIdx === null) return;
    e.preventDefault();
    selectTab(TABS[nextIdx].key, true);
  }

  const backButton = (
    <button
      type="button"
      onClick={goBack}
      aria-label="返回優惠券列表"
      className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <ChevronLeft className="h-4 w-4" />
    </button>
  );

  const content = (() => {
    if (authLoading) return <DetailSkeleton />;

    if (!canView) {
      return (
        <FullPageMessage
          title="你沒有查看此頁面的權限，請洽主管"
          action={
            <Button variant="outline" onClick={goBack}>
              返回
            </Button>
          }
        />
      );
    }

    if (!validId || errorStatus(error) === 404) {
      return (
        <FullPageMessage
          title="找不到此優惠券"
          description="這張優惠券可能已被刪除，或網址有誤。"
          action={<Button onClick={() => router.push(COUPON_LIST_PATH)}>返回優惠券列表</Button>}
        />
      );
    }

    if (error && !coupon) {
      return (
        <div role="alert">
          <FullPageMessage
            title="優惠券載入失敗"
            description={getApiErrorMessage(error, '網路連線逾時，請確認網路後重試。')}
            action={<Button onClick={() => mutate()}>重試</Button>}
          />
        </div>
      );
    }

    if (isLoading || !coupon) return <DetailSkeleton />;

    const ended = coupon.status === 'ENDED';
    const editDisabledReason = !canManage ? '需主管權限' : ended ? '已結束的優惠券無法編輯' : null;

    return (
      <div className="space-y-6">
        {/* 頁首 */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            {backButton}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-xl font-semibold text-foreground sm:text-2xl">{coupon.name}</h1>
                <CouponStatusBadge status={coupon.status} />
                <CouponPurposeBadge purpose={coupon.purpose} />
              </div>
              <p className="mt-1 font-mono text-[13px] text-muted-foreground">{coupon.displayCode}</p>
            </div>
          </div>

          {editDisabledReason ? (
            <span className="group relative inline-flex">
              <button
                type="button"
                aria-disabled="true"
                aria-describedby="coupon-edit-disabled-reason"
                onClick={(e) => e.preventDefault()}
                className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Pencil className="h-4 w-4" />
                編輯
              </button>
              <span
                id="coupon-edit-disabled-reason"
                role="tooltip"
                className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background opacity-0 shadow-dropdown transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
              >
                {editDisabledReason}
              </span>
            </span>
          ) : (
            <Link href={`${COUPON_LIST_PATH}/${coupon.id}/edit`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil />
              編輯
            </Link>
          )}
        </div>

        <CouponStatCards
          stats={stats.stats}
          isLoading={stats.isLoading}
          error={stats.error}
          onRetry={() => stats.mutate()}
        />

        {/* 分頁 */}
        <div>
          <div role="tablist" aria-label="優惠券詳情" className="flex gap-1 border-b border-border" onKeyDown={onTabKeyDown}>
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  ref={(el) => {
                    tabRefs.current[t.key] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`coupon-tab-${t.key}`}
                  aria-selected={active}
                  aria-controls={`coupon-panel-${t.key}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectTab(t.key)}
                  className={cn(
                    '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    active
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div
            role="tabpanel"
            id={`coupon-panel-${tab}`}
            aria-labelledby={`coupon-tab-${tab}`}
            className="pt-5"
          >
            {tab === 'codes' ? (
              <CouponInstancesPanel
                coupon={coupon}
                issuedCount={stats.stats?.issued ?? null}
                poolSize={stats.stats?.poolSize ?? null}
                showOk={showOk}
                showError={showError}
              />
            ) : tab === 'settings' ? (
              <CouponSettingsPanel coupon={coupon} showOk={showOk} showError={showError} />
            ) : (
              <CouponClaimLinksPanel coupon={coupon} canManage={canManage} showOk={showOk} showError={showError} />
            )}
          </div>
        </div>
      </div>
    );
  })();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <nav aria-label="麵包屑" className="mb-4 text-xs text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li>行銷</li>
            <li aria-hidden="true">&gt;</li>
            <li>
              <Link href={COUPON_LIST_PATH} onClick={(e) => { e.preventDefault(); goBack(); }} className="hover:text-foreground hover:underline">
                優惠券
              </Link>
            </li>
            {coupon && canView && validId && !error && (
              <>
                <li aria-hidden="true">&gt;</li>
                <li aria-current="page" className="text-foreground">
                  {coupon.name}
                </li>
              </>
            )}
          </ol>
        </nav>
        {content}
      </div>
      <CouponToast toast={toast} />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="載入中">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 animate-pulse rounded-md bg-muted" />
        <div className="space-y-2">
          <div className="h-7 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-[98px] animate-pulse rounded-[10px] border border-border bg-muted" />
        ))}
      </div>
      <div className="space-y-2">
        <div className="h-10 w-48 animate-pulse rounded bg-muted" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
