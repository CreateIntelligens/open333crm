'use client';

/**
 * 對話發券 Dialog（add-coupon-system A11；Jira CM-196「對話發券 UX 規格」第一階段）。
 *
 * 流程：顧客補償紀錄 → 選券 → 確認（同一個 Dialog 內切換）→ 發送。
 * 發送失敗不關閉，顯示原因並說明券是否已發出；沒有收到回應時以發送鍵查詢結果，查到之前不能重送。
 * 補償原因、每月額度、主管核准屬後續提案，不在此階段。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Loader2, X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  describeIssueFailure,
  faceShort,
  faceText,
  fetchIssueContext,
  fetchIssueRequest,
  issueCoupon,
  issueErrorOf,
  ISSUED_STATUS_LABEL,
  limitReachedText,
  md,
  couponMeta,
  validityOnConfirm,
  type IssuableCoupon,
  type IssueContext,
} from '@/lib/coupon/issue';

export interface CouponIssueDialogProps {
  open: boolean;
  conversationId: string;
  onClose: () => void;
  onIssued: (info: { couponName: string; faceText: string }) => void;
}

/** 查詢發送結果的間隔 */
const POLL_MS = 2000;
/** 連續幾次查無這次發券，就判定系統沒有收到 */
const UNKNOWN_LIMIT = 3;

type Phase = 'idle' | 'sending' | 'checking';
interface Banner {
  message: string;
  outcome: string;
}

const BLOCKED_TEXT: Record<NonNullable<IssueContext['blocked']>['reason'], string> = {
  REPLY_WINDOW_EXPIRED: '已超過回覆期限，無法發送優惠券',
  CONVERSATION_CLOSED: '對話已結束，無法發券',
  BOT_HANDLED: '請先接手對話再發券',
};

const CHECKING_BANNER: Banner = { message: '確認發送結果中…', outcome: '系統正在確認券是否已發出，查詢完成前請勿重送。' };
const NOT_RECEIVED_BANNER: Banner = { message: '沒有發出', outcome: '系統沒有收到這次發券，券未發出，可以重新發送。' };
/** 確認中最多等這麼久；之後讓座席可以關閉或用同一個發送鍵重送（不會重複發券） */
const CHECK_LIMIT_MS = 60_000;
const UNCONFIRMED_BANNER: Banner = {
  message: '仍無法確認是否已發出',
  outcome: '請稍後到右側「已發優惠券」查看。再按一次發送會沿用同一次發券，不會重複發出。',
};

const newKey = () => crypto.randomUUID();

export function CouponIssueDialog({ open, conversationId, onClose, onIssued }: CouponIssueDialogProps) {
  const [context, setContext] = useState<IssueContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<IssuableCoupon | null>(null);
  const [requestKey, setRequestKey] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [outOfScope, setOutOfScope] = useState(false);
  const [askAbandon, setAskAbandon] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 視窗關閉後，進行中的查詢回來也不再處理（不在別的對話跳出提示、不再排下一輪）
  const cancelled = useRef(false);
  const checkStartedAt = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setContext(await fetchIssueContext(conversationId));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  // 每次開啟都重新載入並回到選券
  useEffect(() => {
    if (!open) return;
    setContext(null);
    setSelected(null);
    setPhase('idle');
    setBanner(null);
    setOutOfScope(false);
    setAskAbandon(false);
    cancelled.current = false;
    void load();
    return () => {
      cancelled.current = true;
      stopPolling();
    };
  }, [open, load, stopPolling]);

  const finish = useCallback(
    (coupon: IssuableCoupon) => {
      stopPolling();
      onIssued({ couponName: coupon.name, faceText: faceText(coupon) });
      onClose();
    },
    [onClose, onIssued, stopPolling],
  );

  const fail = useCallback(
    (code: string, details?: { issuedByName?: string | null }) => {
      const f = describeIssueFailure(code, details);
      setPhase('idle');
      setBanner({ message: f.message, outcome: f.outcome });
      if (code === 'COUPON_NOT_ISSUABLE' || code === 'PER_CONTACT_LIMIT_REACHED' || code === 'REPLY_WINDOW_EXPIRED' || code === 'CONVERSATION_BOT_HANDLED') {
        // 回到選券並重新整理清單，讓座席看到最新的上限與狀態
        setSelected(null);
        void load();
        return;
      }
      if (code === 'CONVERSATION_OUT_OF_SCOPE') {
        setOutOfScope(true);
        return;
      }
      // 確定沒發出（例如顧客收不到訊息）：換新的發送鍵才能再試
      setRequestKey(newKey());
    },
    [load],
  );

  const poll = useCallback(
    (coupon: IssuableCoupon, key: string, unknownCount: number) => {
      if (Date.now() - checkStartedAt.current > CHECK_LIMIT_MS) {
        setPhase('idle');
        setBanner(UNCONFIRMED_BANNER);
        return;
      }
      pollTimer.current = setTimeout(async () => {
        try {
          const state = await fetchIssueRequest(key);
          if (cancelled.current) return;
          if (state.state === 'done') {
            if (state.result.ok) finish(coupon);
            else fail(state.result.reason, state.result.details);
            return;
          }
          if (state.state === 'unknown') {
            if (unknownCount + 1 >= UNKNOWN_LIMIT) {
              // 系統沒有收到這次發券：可以重送，沿用同一個發送鍵，萬一原請求遲到也只會發一張
              setPhase('idle');
              setBanner(NOT_RECEIVED_BANNER);
              return;
            }
            poll(coupon, key, unknownCount + 1);
            return;
          }
          poll(coupon, key, 0);
        } catch {
          if (cancelled.current) return;
          // 查詢也失敗（網路仍不通）：繼續查，超過時限才開放重送
          poll(coupon, key, unknownCount);
        }
      }, POLL_MS);
    },
    [fail, finish],
  );

  const send = async () => {
    if (!selected || !context) return;
    const coupon = selected;
    setPhase('sending');
    setBanner(null);
    try {
      await issueCoupon(conversationId, {
        couponId: coupon.id,
        requestKey,
        expectedAssigneeId: context.conversation.assignedToId,
      });
      finish(coupon);
    } catch (err) {
      const { code, details } = issueErrorOf(err);
      if (code === 'NETWORK' || code === 'ISSUE_IN_PROGRESS') {
        setPhase('checking');
        setBanner(CHECKING_BANNER);
        checkStartedAt.current = Date.now();
        poll(coupon, requestKey, 0);
        return;
      }
      fail(code, details);
    }
  };

  const choose = (c: IssuableCoupon) => {
    setSelected(c);
    setRequestKey(newKey());
    setBanner(null);
    setOutOfScope(false);
  };

  const busy = phase !== 'idle';
  const requestClose = () => {
    if (busy) return;
    if (selected) {
      setAskAbandon(true);
      return;
    }
    onClose();
  };

  const blocked = context?.blocked ?? null;
  const contactName = context?.conversation.contactName ?? '';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }} onRequestClose={requestClose}>
      <div className="relative flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl flex-col">
        {/* 標題列：固定 */}
        <div className="flex items-center gap-2 border-b px-5 py-4">
          {selected && (
            <button
              type="button"
              aria-label="返回"
              className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
              disabled={busy}
              onClick={() => { setSelected(null); setBanner(null); setOutOfScope(false); }}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
            {contactName ? `發券給 ${contactName}` : '發券'}
          </h2>
          <button
            type="button"
            aria-label="關閉"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
            disabled={busy}
            onClick={requestClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 內容：內部捲動 */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loadError ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive">
              <p>無法載入發券資料</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>重試</Button>
            </div>
          ) : !context ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              載入中…
            </div>
          ) : (
            <>
              {blocked && !banner && (
                <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm font-semibold text-destructive">
                  {BLOCKED_TEXT[blocked.reason]}
                </div>
              )}
              {banner && (
                <div
                  role="alert"
                  className={cn(
                    'rounded-lg border px-4 py-3 text-sm',
                    phase === 'checking'
                      ? 'border-warning/40 bg-warning-subtle text-warning'
                      : 'border-destructive/30 bg-destructive-subtle text-destructive',
                  )}
                >
                  <p className="font-semibold">{banner.message}</p>
                  <p className="mt-0.5">{banner.outcome}</p>
                </div>
              )}

              {selected ? (
                <ConfirmView coupon={selected} contactName={contactName} />
              ) : (
                <>
                  <HistoryCard history={context.history} />
                  <CouponList
                    coupons={context.coupons}
                    disabled={Boolean(blocked) || loading}
                    onChoose={choose}
                  />
                </>
              )}
            </>
          )}
        </div>

        {/* 底部按鈕：固定 */}
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" disabled={busy} onClick={requestClose}>取消</Button>
          {selected && (
            <Button disabled={busy || outOfScope || Boolean(blocked)} onClick={() => void send()}>
              {phase === 'sending' ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />發送中…</>
              ) : phase === 'checking' ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />確認中…</>
              ) : (
                '確認發送'
              )}
            </Button>
          )}
        </div>

        {askAbandon && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80 p-6">
            <div role="alertdialog" aria-labelledby="coupon-abandon-title" className="w-full max-w-xs rounded-lg border bg-background p-5 shadow-dropdown">
              <p id="coupon-abandon-title" className="font-semibold">放棄這次發券？</p>
              <p className="mt-1 text-sm text-muted-foreground">選好的券不會發出。</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setAskAbandon(false)}>繼續發券</Button>
                <Button variant="destructive" size="sm" onClick={() => { setAskAbandon(false); onClose(); }}>放棄</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function HistoryCard({ history }: { history: IssueContext['history'] }) {
  if (history.count === 0 || !history.latest) {
    return (
      <section aria-label="顧客補償紀錄" className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        尚無補償紀錄
      </section>
    );
  }
  const l = history.latest;
  return (
    <section aria-label="顧客補償紀錄" className="rounded-lg border bg-muted/40 px-4 py-3">
      <p className="text-sm font-semibold">
        近 90 天補償 {history.count} 次，共 NT${history.totalAmount.toLocaleString('zh-TW')}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {['最近一筆：' + l.couponName, l.issuedByName, md(l.issuedAt), ISSUED_STATUS_LABEL[l.status]].filter(Boolean).join(' · ')}
      </p>
    </section>
  );
}

function CouponList({
  coupons,
  disabled,
  onChoose,
}: {
  coupons: IssuableCoupon[];
  disabled: boolean;
  onChoose: (c: IssuableCoupon) => void;
}) {
  if (coupons.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        目前沒有可發送的補償券，請洽行銷人員建立
      </p>
    );
  }
  return (
    <section aria-labelledby="coupon-issue-list-title">
      <h3 id="coupon-issue-list-title" className="mb-2 text-sm font-semibold">選擇優惠券</h3>
      <ul className="space-y-2">
        {coupons.map((c) => (
          <li
            key={c.id}
            className={cn(
              'flex items-center gap-4 rounded-lg border px-4 py-3',
              c.limitReached ? 'bg-muted/40' : 'bg-primary-subtle/40',
            )}
          >
            <span className="w-16 shrink-0 text-xl font-bold text-primary">{faceShort(c)}</span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                <span>{c.name}</span>
                {c.drivesSpend && (
                  <span className="rounded bg-success-subtle px-1.5 py-0.5 text-[11px] font-medium text-success">可帶動消費</span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{couponMeta(c)}</p>
              {c.limitReached && <p className="mt-0.5 text-xs text-destructive">{limitReachedText(c)}</p>}
              {!c.limitReached && c.expiringAt && (
                <p className="mt-0.5 text-xs text-warning">此券將於 {md(c.expiringAt)} 到期</p>
              )}
            </div>
            <Button size="sm" disabled={disabled || c.limitReached} onClick={() => onChoose(c)}>
              選擇
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConfirmView({ coupon, contactName }: { coupon: IssuableCoupon; contactName: string }) {
  const rows: Array<[string, string]> = [
    ['發給', contactName],
    ['券名與面額', `${coupon.name} · ${faceText(coupon)}`],
    ['有效期', validityOnConfirm(coupon)],
  ];
  if (coupon.minSpend) rows.push(['使用門檻', `滿 NT$${coupon.minSpend.toLocaleString('zh-TW')} 可用`]);
  return (
    <section aria-label="確認發送內容">
      <dl className="divide-y rounded-lg border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 px-4 py-2.5 text-sm">
            <dt className="w-24 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 flex-1 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm font-semibold text-destructive">發送後無法撤回</p>
    </section>
  );
}
