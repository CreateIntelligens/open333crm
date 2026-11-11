'use client';

/**
 * 確認核銷（mobile-prototype-spec 2.7）：核銷前預覽，主卡的焦點是「結帳時要做什麼」。
 * 送出中顯示「核銷中…」，取消、確認與左上返回全部停用，不可重複送出。
 */
import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { StoreCoupon } from '@/lib/store-console-api';
import { cn } from '@/lib/utils';
import { offerOf, validityRange } from './format';
import { Button, DetailList, ErrorNote, Page, TopBar } from './ui';

interface Props {
  coupon: StoreCoupon;
  storeName: string;
  submitting: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 頂列只放分店名（「大同3C・內湖門市」取「內湖門市」） */
function shortStoreName(name: string): string {
  const parts = name.split(/[・．·]/);
  return parts[parts.length - 1].trim() || name;
}

export function ConfirmScreen({ coupon, storeName, submitting, error, onCancel, onConfirm }: Props) {
  const offer = offerOf(coupon);
  return (
    <Page>
      <TopBar title="確認核銷" subtitle={shortStoreName(storeName)} onBack={onCancel} backDisabled={submitting} />
      <main className="flex flex-1 flex-col gap-4 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-5">
        <section aria-label="結帳時要做什麼" className="rounded-2xl border border-border bg-card p-6">
          <span className="inline-block rounded-md bg-muted px-2.5 py-1 text-sm font-bold text-foreground">{offer.label}</span>
          <p className="mt-4 text-base text-muted-foreground">{offer.verb}</p>
          <p
            className={cn(
              'mt-1 break-words font-extrabold leading-tight tracking-tight text-foreground',
              // 金額與折數用等寬大字；品項名稱是中文，用一般字型避免過寬
              /^(NT\$|\d)/.test(offer.main) ? 'font-mono text-[44px]' : 'text-[32px]',
            )}
          >
            {offer.main}
          </p>
          {offer.sub && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-base text-muted-foreground">
                  {offer.note && <AlertCircle className="h-4 w-4" aria-hidden />}
                  {offer.sub.k}
                </span>
                <span className="font-mono text-xl font-bold text-foreground">{offer.sub.v}</span>
              </div>
              {offer.note && <p className="mt-2 text-sm font-medium text-warning">{offer.note}</p>}
            </div>
          )}
        </section>

        <section aria-label="券明細" className="rounded-2xl border border-border bg-card px-4">
          <DetailList
            rows={[
              { k: '券名', v: coupon.name },
              { k: '顧客', v: coupon.customerName },
              { k: '有效期限', v: validityRange(coupon) },
              { k: '序號', v: coupon.code, mono: true },
            ]}
          />
        </section>

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="mt-auto space-y-3 pt-4">
          <p className="text-center text-sm text-muted-foreground">按「取消」不會使用這張券</p>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={submitting} aria-busy={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? '核銷中…' : '確認核銷'}
          </Button>
        </div>
      </main>
    </Page>
  );
}
