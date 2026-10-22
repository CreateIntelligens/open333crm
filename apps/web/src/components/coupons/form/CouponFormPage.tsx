'use client';

/**
 * 建立／編輯優惠券頁的外框：權限、載入中、找不到、載入失敗等系統狀態（UX 規則第 5 節），
 * 狀態都正常才掛上 CouponForm。/new 與 /[id]/edit 共用。
 */
import React from 'react';
import { useRouter } from 'next/navigation';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/providers/AuthProvider';
import { useCoupon, useCouponStats } from '@/hooks/useCoupons';
import { getApiErrorMessage } from '@/lib/api-error';
import { CouponForm } from './CouponForm';

const LIST_HREF = '/dashboard/marketing/coupons';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <Topbar title="優惠券" />
      {/* 捲動容器：表單的底部操作列與右側進度以它為基準 sticky */}
      <div className="relative flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function StateMessage({ title, text, action }: { title: string; text?: string; action: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      {text && <p className="max-w-md text-sm text-muted-foreground">{text}</p>}
      <div className="mt-2">{action}</div>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="px-4 pt-6 sm:px-8" aria-busy="true" aria-label="載入中">
      <div className="h-3 w-40 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-7 w-56 animate-pulse rounded bg-muted" />
      <div className="mt-6 flex gap-7">
        <div className="flex flex-1 flex-col gap-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl border bg-muted/40" />
          ))}
        </div>
        <div className="hidden w-[248px] flex-col gap-3 lg:flex">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}

function useCanManage() {
  const { hasPermission } = useAuth();
  return hasPermission('coupon.manage');
}

function NoPermission() {
  const router = useRouter();
  return (
    <StateMessage
      title="你沒有查看此頁面的權限，請洽主管"
      action={
        <Button variant="outline" onClick={() => router.push(LIST_HREF)}>
          返回
        </Button>
      }
    />
  );
}

export function CreateCouponPage() {
  const canManage = useCanManage();
  return <Shell>{canManage ? <CouponForm mode="create" /> : <NoPermission />}</Shell>;
}

export function EditCouponPage({ id }: { id: string }) {
  const router = useRouter();
  const canManage = useCanManage();
  const { coupon, error, isLoading, mutate } = useCoupon(canManage ? id : null);
  const isPublished = !!coupon && coupon.status !== 'DRAFT';
  // 已發布：發行總量下限要用已發放張數。序號包草稿：已匯入的序號（發布失敗後再回來編輯）算在序號包內
  const needStats = !!coupon && (isPublished || coupon.codeMode === 'IMPORTED_CODES');
  const { stats, isLoading: statsLoading } = useCouponStats(canManage && needStats ? id : null);
  const back = (
    <Button variant="outline" onClick={() => router.push(LIST_HREF)}>
      返回優惠券列表
    </Button>
  );

  let body: React.ReactNode;
  if (!canManage) {
    body = <NoPermission />;
  } else if (isLoading || (needStats && statsLoading)) {
    body = <FormSkeleton />;
  } else if (error && (error as { response?: { status?: number } }).response?.status !== 404) {
    body = (
      <StateMessage
        title="優惠券載入失敗"
        text={getApiErrorMessage(error, '網路連線逾時，請確認網路後重試。')}
        action={<Button onClick={() => mutate()}>重試</Button>}
      />
    );
  } else if (!coupon) {
    body = <StateMessage title="找不到此優惠券" text="這張優惠券可能已被刪除。" action={back} />;
  } else if (coupon.status === 'ENDED') {
    body = (
      <StateMessage
        title="已結束的優惠券無法編輯"
        action={
          <Button variant="outline" onClick={() => router.push(`${LIST_HREF}/${coupon.id}`)}>
            查看優惠券詳情
          </Button>
        }
      />
    );
  } else {
    body = (
      <CouponForm
        key={coupon.id}
        mode={coupon.status === 'DRAFT' ? 'draft' : 'published'}
        coupon={coupon}
        claimedCount={stats?.claimed ?? 0}
        issuedCount={stats?.issued}
        existingCodes={coupon.status === 'DRAFT' ? stats?.poolSize ?? 0 : 0}
      />
    );
  }
  return <Shell>{body}</Shell>;
}
