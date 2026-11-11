'use client';

/**
 * 優惠券列表（A2）。行為依《優惠券後台 UX 規則》第 2、5 節。
 * 搜尋字、狀態與頁碼由上層放在 URL query，這裡只透過 query／onQueryChange 讀寫，
 * 所以從詳情返回或重新整理都會保留。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/providers/AuthProvider';
import { getApiErrorMessage } from '@/lib/api-error';
import { formatNumber } from '@/lib/coupon/labels';
import {
  deleteCoupon,
  duplicateCoupon,
  endCoupon,
  pauseCoupon,
  resumeCoupon,
  useCoupons,
  type CouponListItem,
  type CouponStatus,
} from '@/hooks/useCoupons';
import { CouponToast, useCouponToast } from '@/components/coupons/CouponToast';
import { CouponConfirmDialog } from '@/components/coupons/CouponConfirmDialog';
import { CouponListToolbar } from './CouponListToolbar';
import { CouponTable } from './CouponTable';
import {
  CouponListEmpty,
  CouponListError,
  CouponListNoAccess,
  CouponListNoMatch,
  CouponTableSkeleton,
} from './CouponListStates';
import { couponHref, NEED_MANAGE_HINT, type RowActionKey } from './row-actions';

export interface CouponListQuery {
  q: string;
  status: CouponStatus | '';
  page: number;
}

interface Props {
  query: CouponListQuery;
  onQueryChange: (next: CouponListQuery) => void;
  /** 從其他頁帶回來的提示（例如建立頁儲存草稿後導回列表） */
  notice?: string | null;
  /** 提示顯示後通知頁面清掉網址參數，避免重新整理又顯示一次 */
  onNoticeShown?: () => void;
}

const NEW_HREF = '/dashboard/marketing/coupons/new';

export function CouponListView({ query, onQueryChange, notice, onNoticeShown }: Props) {
  const router = useRouter();
  const { hasPermission, isLoading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <ListFrame header={<PageHeader action={null} />}>
        <div className="overflow-hidden rounded-xl border bg-card">
          <CouponTableSkeleton />
        </div>
      </ListFrame>
    );
  }

  if (!hasPermission('coupon.view')) {
    return (
      <ListFrame header={<PageHeader action={null} />}>
        <CouponListNoAccess
          onBack={() => {
            // 沒有上一頁（例如直接開網址）時回收件匣
            if (typeof window !== 'undefined' && window.history.length > 1) router.back();
            else router.push('/dashboard/inbox');
          }}
        />
      </ListFrame>
    );
  }

  return (
    <CouponListContent
      query={query}
      onQueryChange={onQueryChange}
      notice={notice}
      onNoticeShown={onNoticeShown}
      canManage={hasPermission('coupon.manage')}
    />
  );
}

function ListFrame({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5">
      {header}
      {children}
    </div>
  );
}

function PageHeader({ action }: { action: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">優惠券</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理客服補償與行銷推廣用的優惠券，追蹤發放、領取與核銷成效</p>
      </div>
      {action}
    </header>
  );
}

/**
 * 建立按鈕。無編輯權限時停用但不隱藏；外層 span 可聚焦，滑過或聚焦時顯示「需主管權限」
 * （停用的 button 本身收不到焦點與滑鼠事件）。
 */
function CreateButton({ canManage, onClick }: { canManage: boolean; onClick: () => void }) {
  if (canManage) {
    return (
      <Button onClick={onClick}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        建立優惠券
      </Button>
    );
  }
  return (
    <span
      tabIndex={0}
      title={NEED_MANAGE_HINT}
      aria-describedby="coupon-create-hint"
      className="group relative inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Button disabled aria-disabled="true" tabIndex={-1}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        建立優惠券
      </Button>
      <span
        id="coupon-create-hint"
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden whitespace-nowrap rounded-md bg-foreground px-2.5 py-1 text-xs text-background shadow-dropdown group-hover:block group-focus:block"
      >
        {NEED_MANAGE_HINT}
      </span>
    </span>
  );
}

type Pending = { kind: 'end' | 'delete'; coupon: CouponListItem } | null;

function CouponListContent({
  query,
  onQueryChange,
  notice,
  onNoticeShown,
  canManage,
}: Props & { canManage: boolean }) {
  const router = useRouter();
  const { toast, showOk, showError } = useCouponToast();

  useEffect(() => {
    if (!notice) return;
    showOk(notice);
    onNoticeShown?.();
  }, [notice, showOk, onNoticeShown]);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const { coupons, meta, error, isLoading, mutate } = useCoupons({
    q: query.q || undefined,
    status: query.status,
    page: query.page > 1 ? query.page : undefined,
  });
  // 表尾的「全部 M 張」要用沒有篩選的總數；沒有篩選時與上面同一個 SWR key，不會多打一次 API
  const { meta: allMeta } = useCoupons({});

  const filtered = query.q !== '' || query.status !== '';

  const goCreate = useCallback(() => router.push(NEW_HREF), [router]);
  const createButton = <CreateButton canManage={canManage} onClick={goCreate} />;

  const handleSearch = useCallback(
    (q: string) => onQueryChange({ q, status: query.status, page: 1 }),
    [onQueryChange, query.status],
  );
  const handleStatus = useCallback(
    (status: CouponStatus | '') => onQueryChange({ q: query.q, status, page: 1 }),
    [onQueryChange, query.q],
  );
  const clearFilters = () => onQueryChange({ q: '', status: '', page: 1 });

  /** 執行一個操作；失敗時一律以提示呈現原因，不只寫 log */
  async function run(task: () => Promise<unknown>, okMessage: (result: unknown) => string, fallback: string) {
    try {
      const result = await task();
      showOk(okMessage(result));
      await mutate();
    } catch (err) {
      showError(getApiErrorMessage(err, fallback));
    }
  }

  function handleAction(coupon: CouponListItem, key: RowActionKey) {
    switch (key) {
      case 'view':
        router.push(couponHref(coupon));
        return;
      case 'edit':
        router.push(`/dashboard/marketing/coupons/${coupon.id}/edit`);
        return;
      case 'pause':
        void run(() => pauseCoupon(coupon.id), () => `已暫停發放「${coupon.name}」`, '暫停發放失敗，請稍後重試');
        return;
      case 'resume':
        void run(() => resumeCoupon(coupon.id), () => `已恢復發放「${coupon.name}」`, '恢復發放失敗，請稍後重試');
        return;
      case 'duplicate':
        void run(
          () => duplicateCoupon(coupon.id),
          (created) => `已複製為草稿「${(created as { name?: string } | undefined)?.name ?? `${coupon.name}（複製）`}」`,
          '複製失敗，請稍後重試',
        );
        return;
      case 'end':
      case 'delete':
        setPending({ kind: key, coupon });
        return;
    }
  }

  async function confirmPending() {
    if (!pending) return;
    const { kind, coupon } = pending;
    setBusy(true);
    try {
      if (kind === 'end') {
        await endCoupon(coupon.id);
        showOk(`已提前結束「${coupon.name}」`);
      } else {
        await deleteCoupon(coupon.id);
        showOk(`已刪除「${coupon.name}」`);
      }
      setPending(null);
      await mutate();
    } catch (err) {
      setPending(null);
      showError(getApiErrorMessage(err, kind === 'end' ? '提前結束失敗，請稍後重試' : '刪除失敗，請稍後重試'));
    } finally {
      setBusy(false);
    }
  }

  // ── 表格區塊依狀態切換 ──
  let body: React.ReactNode;
  if (!meta && isLoading) {
    body = <CouponTableSkeleton />;
  } else if (!meta && error) {
    body = <CouponListError onRetry={() => void mutate()} />;
  } else if (coupons.length === 0) {
    body = filtered ? <CouponListNoMatch onClear={clearFilters} /> : <CouponListEmpty createButton={createButton} />;
  } else {
    body = (
      <CouponTable
        coupons={coupons}
        canManage={canManage}
        onOpen={(c) => router.push(couponHref(c))}
        onAction={handleAction}
      />
    );
  }

  const total = meta?.total ?? 0;
  const allTotal = allMeta?.total;
  const pageCount = meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1;
  const showFooter = !!meta && coupons.length > 0;

  return (
    <ListFrame header={<PageHeader action={createButton} />}>
      <CouponListToolbar
        q={query.q}
        status={query.status}
        counts={meta?.statusCounts}
        onSearch={handleSearch}
        onStatusChange={handleStatus}
      />

      <div className="rounded-xl border bg-card">
        {/* 窄螢幕橫向捲動；選單展開時預留底部空間，避免最後幾列的選單被捲動容器裁掉 */}
        <div className="overflow-x-auto has-[[role=menu]]:pb-56">{body}</div>

        {showFooter && (
          <div className="flex flex-col gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              {filtered && allTotal !== undefined
                ? `共 ${formatNumber(total)} 張優惠券（已篩選，全部 ${formatNumber(allTotal)} 張）`
                : `共 ${formatNumber(total)} 張優惠券`}
            </span>
            <div className="flex items-center gap-4">
              {meta && (
                <span>
                  進行中 <span className="font-mono">{meta.statusCounts.ACTIVE}</span> · 草稿{' '}
                  <span className="font-mono">{meta.statusCounts.DRAFT}</span>
                </span>
              )}
              {pageCount > 1 && (
                <nav aria-label="分頁" className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="上一頁"
                    disabled={query.page <= 1}
                    onClick={() => onQueryChange({ ...query, page: query.page - 1 })}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <span className="px-2 font-mono">
                    {query.page} / {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="下一頁"
                    disabled={query.page >= pageCount}
                    onClick={() => onQueryChange({ ...query, page: query.page + 1 })}
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </nav>
              )}
            </div>
          </div>
        )}
      </div>

      <CouponConfirmDialog
        open={pending !== null}
        busy={busy}
        destructive
        title={
          pending?.kind === 'end' ? `提前結束「${pending.coupon.name}」？` : `刪除「${pending?.coupon.name ?? ''}」？`
        }
        description={
          pending?.kind === 'end'
            ? `已有 ${formatNumber(pending.coupon.claimedCount)} 張被領取，其中 ${formatNumber(
                Math.max(0, pending.coupon.claimedCount - pending.coupon.redeemedCount),
              )} 張尚未使用。結束後這些券將立即失效，也無法再發放。`
            : '刪除後無法復原。'
        }
        confirmLabel={pending?.kind === 'end' ? '提前結束' : '刪除'}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />

      <CouponToast toast={toast} />
    </ListFrame>
  );
}
