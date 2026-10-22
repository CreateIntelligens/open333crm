'use client';

/**
 * 今日核銷紀錄（mobile-prototype-spec 2.10）：只顯示今天、本門市在核銷台核銷的券；不提供搜尋與匯出。
 * 點一列展開明細，一次只展開一列。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getToday, type TodayResponse } from '@/lib/store-console-api';
import { classifyError, NETWORK_TEXT, type AccountErrorCode } from './errors';
import { hm, nt, offerOf, ymd, ymdhm } from './format';
import { Button, DetailList, Page, TopBar } from './ui';

interface Props {
  storeName: string;
  onBack: () => void;
  onLoaded: (count: number) => void;
  onAccountError: (code: AccountErrorCode) => void;
}

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: TodayResponse };

export function RecordsScreen({ storeName, onBack, onLoaded, onAccountError }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    setReload((n) => n + 1);
  }, []);

  // 父層傳入的 callback 每次 render 都是新的函式；放進 ref，載入只跟著 reload 觸發
  const callbacks = useRef({ onLoaded, onAccountError });
  useEffect(() => {
    callbacks.current = { onLoaded, onAccountError };
  }, [onLoaded, onAccountError]);

  useEffect(() => {
    let cancelled = false;
    getToday()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', data });
        callbacks.current.onLoaded(data.summary.count);
      })
      .catch((err) => {
        if (cancelled) return;
        const c = classifyError(err);
        if (c.kind === 'account') callbacks.current.onAccountError(c.code);
        else setState({ status: 'error', message: c.kind === 'other' ? c.message : NETWORK_TEXT });
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const data = state.status === 'ready' ? state.data : null;
  const summary = data?.summary;
  const stats = summary
    ? [
        summary.discountTotal > 0 ? `折抵 ${nt(summary.discountTotal)}` : null,
        summary.giftCount > 0 ? `贈品 ${summary.giftCount}` : null,
        summary.exchangeCount > 0 ? `兌換 ${summary.exchangeCount}` : null,
      ].filter(Boolean)
    : [];

  return (
    <Page>
      <TopBar title="今日核銷紀錄" onBack={onBack} />
      <main className="flex flex-1 flex-col gap-4 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4">
        <p className="px-1 text-sm text-muted-foreground">
          {data ? `${storeName} · ${ymd(data.date)}` : storeName}
        </p>

        {state.status === 'loading' && (
          <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            載入中…
          </div>
        )}

        {state.status === 'error' && (
          <div className="rounded-2xl border border-border bg-card p-5 text-center">
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.message}
            </p>
            <Button variant="outline" className="mt-4" onClick={load}>
              重新載入
            </Button>
          </div>
        )}

        {data && summary && (
          <>
            <section aria-label="今日統計" className="rounded-2xl border border-border bg-card px-5 py-4">
              <p className="text-3xl font-black text-foreground">今日 {summary.count} 筆</p>
              {stats.length > 0 && <p className="mt-1 text-sm text-muted-foreground">{stats.join(' · ')}</p>}
            </section>

            {data.items.length === 0 ? (
              <section className="rounded-2xl border border-border bg-card px-5 py-10 text-center">
                <p className="text-base font-semibold text-foreground">今天還沒有核銷紀錄</p>
                <p className="mt-1 text-sm text-muted-foreground">核銷成功後，會依時間顯示在這裡</p>
              </section>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                {data.items.map((item) => {
                  const offer = offerOf(item);
                  const open = openId === item.instanceId;
                  const panelId = `record-${item.instanceId}`;
                  return (
                    <li key={item.instanceId}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={panelId}
                        onClick={() => setOpenId(open ? null : item.instanceId)}
                        className="flex w-full items-start gap-3 px-4 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span className="w-12 shrink-0 font-mono text-[15px] font-semibold text-muted-foreground">{hm(item.redeemedAt)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-[15px] font-semibold text-foreground">{item.name}</span>
                          <span className="mt-0.5 block text-sm text-muted-foreground">
                            {item.customerName} · …{item.code.replace(/[^A-Za-z0-9]/g, '').slice(-4)}
                          </span>
                        </span>
                        <span className="max-w-[40%] shrink-0 text-right text-[15px] font-bold text-foreground">{offer.short}</span>
                        <ChevronDown
                          className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
                          aria-hidden
                        />
                      </button>
                      <div id={panelId} hidden={!open} className="bg-muted px-4">
                        {open && (
                          <DetailList
                            rows={[
                              { k: '券名', v: item.name },
                              { k: '結帳內容', v: offer.detail },
                              { k: '顧客', v: item.customerName },
                              { k: '序號', v: item.code, mono: true },
                              { k: '核銷時間', v: ymdhm(item.redeemedAt), mono: true },
                              { k: '核銷門市', v: storeName },
                            ]}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        <div className="mt-auto pt-4">
          <Button variant="outline" onClick={onBack}>
            返回核銷
          </Button>
        </div>
      </main>
    </Page>
  );
}
