'use client';

/**
 * 顧客券夾（/coupon/wallet，設計稿 C3～C3.3）。
 *
 * - 三個分頁：可使用／已使用／已失效，各帶數量（API meta.counts），預設可使用。
 * - 沒有顧客憑證或憑證失效（401）時，請顧客回到對話點選優惠券連結；不導向後台登入。
 * - 每個分頁都有空狀態；載入中顯示骨架；其他錯誤顯示訊息與重試。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle, Ticket, WifiOff } from 'lucide-react';
import { useWallet, type FanCoupon, type WalletStatus, type WalletTab } from '@/hooks/useFanCoupons';
import { getFanToken, setFanToken } from '@/lib/fan-api';
import { cn } from '@/lib/utils';
import { FanShell, StatusMessage } from '../FanShell';
import { FanCouponCard } from '../FanCouponCard';
import { FanButton } from '../entry/FanButton';
import { CLOSE_HINT, useTryClose } from '../entry/useTryClose';

const TABS: { key: WalletTab; label: string; emptyTitle: string; emptyBody: string }[] = [
  { key: 'available', label: '可使用', emptyTitle: '目前沒有可使用的優惠券', emptyBody: '收到的優惠券會出現在這裡' },
  // 設計稿只畫了可使用的空狀態；另外兩個沿用手機原型的文案（mobile-prototype-spec 1.7）
  { key: 'used', label: '已使用', emptyTitle: '還沒有使用過的優惠券', emptyBody: '核銷完成的券會移到這裡' },
  { key: 'invalid', label: '已失效', emptyTitle: '沒有已失效的優惠券', emptyBody: '過期或作廢的券會移到這裡' },
];

/** 可使用分頁的排序：即將到期 → 可使用 → 未到生效日（customer-spec C3 建議）；同組維持 API 順序（到期日升冪） */
const AVAILABLE_ORDER: Partial<Record<WalletStatus, number>> = { EXPIRING: 0, AVAILABLE: 1, NOT_YET: 2 };

function sortForTab(tab: WalletTab, list: FanCoupon[]): FanCoupon[] {
  const sorted = [...list];
  if (tab === 'available') {
    sorted.sort((a, b) => (AVAILABLE_ORDER[a.walletStatus] ?? 9) - (AVAILABLE_ORDER[b.walletStatus] ?? 9));
  } else if (tab === 'used') {
    // 最近使用的在最上面
    sorted.sort((a, b) => (b.redeemedAt ?? '').localeCompare(a.redeemedAt ?? ''));
  }
  return sorted;
}

const isUnauthorized = (err: unknown) => (err as { response?: { status?: number } } | undefined)?.response?.status === 401;

export function WalletView() {
  const router = useRouter();
  const { tryClose, showHint } = useTryClose();
  // 憑證存在 sessionStorage，伺服器端讀不到；掛載後再讀，避免 hydration 不一致
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  useEffect(() => setHasToken(getFanToken() !== null), []);

  const { coupons, counts, error, isLoading, mutate } = useWallet(hasToken === true);
  const unauthorized = hasToken === false || isUnauthorized(error);

  // 憑證過期：清掉，避免其他頁面以為還能讀券夾
  useEffect(() => {
    if (isUnauthorized(error)) setFanToken(null);
  }, [error]);

  const [tab, setTab] = useState<WalletTab>('available');
  const tabRefs = useRef<Record<WalletTab, HTMLButtonElement | null>>({ available: null, used: null, invalid: null });
  const visible = useMemo(() => sortForTab(tab, coupons.filter((c) => c.walletTab === tab)), [coupons, tab]);
  const current = TABS.find((t) => t.key === tab)!;

  // 分頁的鍵盤操作（WAI-ARIA Tabs）：左右鍵切換
  const onTabKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TABS[(index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].key;
    setTab(next);
    tabRefs.current[next]?.focus();
  }, []);

  let content: React.ReactNode;
  if (unauthorized) {
    content = (
      <StatusMessage
        icon={<MessageCircle className="h-9 w-9" aria-hidden />}
        title="請回到對話，點選優惠券連結開啟"
        description="為了保護你的優惠券，券夾需要從對話中的連結開啟。"
      />
    );
  } else if (error) {
    content = (
      <StatusMessage icon={<WifiOff className="h-9 w-9" aria-hidden />} title="無法載入優惠券" description="請確認網路後重試。">
        <FanButton onClick={() => void mutate()}>重試</FanButton>
      </StatusMessage>
    );
  } else if (hasToken === null || isLoading) {
    content = (
      <div role="status" aria-label="載入中" className="flex flex-col gap-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[108px] animate-pulse rounded-2xl bg-card" />
        ))}
      </div>
    );
  } else {
    content = (
      <>
        <div role="tablist" aria-label="優惠券分類" className="sticky top-12 z-10 -mx-5 -mt-5 mb-5 flex border-b border-border bg-background">
          {TABS.map((t, i) => {
            const selected = t.key === tab;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[t.key] = el;
                }}
                type="button"
                role="tab"
                id={`wallet-tab-${t.key}`}
                aria-selected={selected}
                aria-controls="wallet-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(t.key)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={cn(
                  'relative flex flex-1 items-center justify-center gap-1.5 px-3 pb-2 pt-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  selected ? 'font-semibold text-primary' : 'font-medium text-muted-foreground',
                )}
              >
                {t.label}
                <span
                  className={cn(
                    'rounded-xl px-2 text-xs leading-5',
                    selected ? 'bg-primary-subtle font-semibold text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {counts[t.key]}
                </span>
                {selected && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[1.5px] bg-primary" />}
              </button>
            );
          })}
        </div>
        <div role="tabpanel" id="wallet-panel" aria-labelledby={`wallet-tab-${tab}`}>
          {visible.length === 0 ? (
            <StatusMessage icon={<Ticket className="h-9 w-9" aria-hidden />} title={current.emptyTitle} description={current.emptyBody} />
          ) : (
            <ul className="flex flex-col gap-5">
              {visible.map((c) => (
                <li key={c.id}>
                  <FanCouponCard item={c} onClick={() => router.push(`/coupon/wallet/${c.id}`)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  return (
    <FanShell
      title="我的優惠券"
      nav="close"
      onNav={tryClose}
      footer={
        showHint ? (
          <p role="status" className="text-center text-sm font-medium text-muted-foreground">
            {CLOSE_HINT}
          </p>
        ) : undefined
      }
    >
      {content}
    </FanShell>
  );
}
