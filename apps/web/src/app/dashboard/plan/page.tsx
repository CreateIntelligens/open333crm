'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUp, Check, Clock, Coins } from 'lucide-react';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { cn } from '@/lib/utils';

interface Req {
  id: string;
  type: 'upgrade' | 'token_topup';
  targetPlanSlug: string | null;
  topupTokens: number | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

type Mode = 'upgrade' | 'token_topup';

// TODO(PM 確認)：方案說明與加購價格目前沒有 API 可讀，先寫死在前端。
// 說明文字依 seed 的方案額度撰寫；價格沿用 Claude Design 稿，上線前需確認。
const PLANS = [
  { slug: 'standard', label: '標準版', hint: '含 300 萬 AI token／月、10 位客服、500 個標籤。' },
  { slug: 'professional', label: '專業版', hint: '含 800 萬 AI token／月、20 位客服，加開行銷與報表功能。' },
  { slug: 'enterprise', label: '企業版', hint: '客製額度與 SLA，審核後由業務聯繫報價。' },
];
const PLAN_LABEL: Record<string, string> = Object.fromEntries(PLANS.map((p) => [p.slug, p.label]));

const TOPUPS = [
  { tokens: 200_000, price: 'NT$ 4,800 / 次' },
  { tokens: 500_000, price: 'NT$ 11,000 / 次' },
  { tokens: 1_000_000, price: 'NT$ 19,800 / 次' },
];

const STATUS: Record<Req['status'], { label: string; cls: string }> = {
  pending: { label: '處理中', cls: 'border-orange-200 bg-orange-50 text-amber-800' },
  approved: { label: '已核准', cls: 'border-green-200 bg-success-subtle text-success' },
  rejected: { label: '已駁回', cls: 'border-red-200 bg-red-50 text-destructive' },
};

const toWan = (n: number) => `${(n / 10_000).toLocaleString()} 萬`;

function formatTime(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function PlanPage() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<Mode>('upgrade');
  const [targetPlan, setTargetPlan] = useState('standard');
  const [topup, setTopup] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      setReqs((await api.get('/plan-change')).data.data);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, '無法載入申請記錄，請重新整理頁面'));
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => { load(); }, []);

  const hasPending = reqs.some((r) => r.status === 'pending');
  const canSubmit = (mode === 'upgrade' ? !!targetPlan : topup !== null) && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const body = mode === 'upgrade'
        ? { type: 'upgrade', targetPlanSlug: targetPlan, note: note || undefined }
        : { type: 'token_topup', topupTokens: topup, note: note || undefined };
      await api.post('/plan-change', body);
      setNote('');
      setTopup(null);
      await load();
      setJustSubmitted(true);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, '申請送出失敗，請稍後重試'));
    } finally {
      setSubmitting(false);
    }
  };

  const planHint = PLANS.find((p) => p.slug === targetPlan)?.hint ?? '';

  return (
    <div className="px-8 pb-10 pt-7">
      <div className="flex max-w-[720px] flex-col gap-5">
        {/* 標題 */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold leading-8 text-foreground">方案</h1>
          <p className="text-sm text-muted-foreground">申請升級方案或加購 AI token 額度，由平台方審核後生效</p>
        </div>

        {/* 設計稿的「目前方案／本期用量／計費週期」摘要卡需要後端提供租戶方案資料，目前沒有 API，先不顯示 */}

        {justSubmitted && (
          <Notice tone="success" icon={<Check className="h-[18px] w-[18px]" strokeWidth={2.2} />}>
            申請已送出，等待平台方審核。審核結果會以站內通知與 Email 通知管理員。
          </Notice>
        )}

        {error && <Notice tone="error">{error}</Notice>}

        {loaded && hasPending && (
          <Notice tone="warning" icon={<Clock className="h-[18px] w-[18px]" strokeWidth={1.9} />}>
            您有一筆處理中的申請，請等待審核完成後再送出新申請。
          </Notice>
        )}

        {/* 申請表單 */}
        {loaded && !hasPending && (
          <div className="overflow-hidden rounded-lg border border-border">
            <div role="tablist" className="flex border-b border-border bg-muted">
              {(['upgrade', 'token_topup'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'h-[46px] min-w-0 flex-1 whitespace-nowrap border-b-2 px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    mode === m ? 'border-primary font-semibold text-primary' : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
                  )}
                >
                  {m === 'upgrade' ? '升級方案' : '加購 Token'}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-[18px] p-5">
              {mode === 'upgrade' ? (
                <div className="flex max-w-[320px] flex-col gap-1.5">
                  <label htmlFor="target-plan" className="text-[13px] font-medium leading-[18px]">目標方案</label>
                  <select
                    id="target-plan"
                    value={targetPlan}
                    onChange={(e) => setTargetPlan(e.target.value)}
                    className="h-10 cursor-pointer rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                  >
                    {PLANS.map((p) => <option key={p.slug} value={p.slug}>{p.label}</option>)}
                  </select>
                  <p className="text-xs leading-[17px] text-muted-foreground">{planHint}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="text-[13px] font-medium leading-[18px]">加購額度</span>
                  <div role="radiogroup" aria-label="加購額度" className="flex flex-wrap items-center gap-2.5">
                    {TOPUPS.map((t) => {
                      const on = topup === t.tokens;
                      return (
                        <button
                          key={t.tokens}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setTopup(t.tokens)}
                          className={cn(
                            'flex items-center gap-2.5 rounded-[10px] border px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            on ? 'border-primary bg-primary-subtle' : 'border-border bg-background hover:border-slate-300',
                          )}
                        >
                          <span className={cn('h-4 w-4 flex-none rounded-full', on ? 'border-[5px] border-primary' : 'border-[1.5px] border-slate-300')} />
                          <span className="flex flex-col items-start gap-0.5">
                            <span className="text-sm font-medium">+{toWan(t.tokens)}</span>
                            <span className="text-xs text-muted-foreground">{t.price}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="plan-note" className="flex items-center gap-1.5 text-[13px] font-medium leading-[18px]">
                  備註<span className="font-normal text-muted-foreground">選填</span>
                </label>
                <textarea
                  id="plan-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={mode === 'upgrade'
                    ? '例如：10 月要開始跑雙 11 活動，需要更高的自動化流程上限'
                    : '例如：本月客服 AI 回覆量暴增，預計月底前會用完額度'}
                  className="min-h-[88px] resize-y rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
                />
                <p className="text-xs leading-[17px] text-muted-foreground">補充審核所需的背景說明，有助於加快審核</p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="h-10 flex-none whitespace-nowrap rounded-md bg-primary px-[22px] text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-border disabled:text-slate-400"
                >
                  {submitting ? '送出中…' : '送出申請'}
                </button>
                <p className="text-xs text-muted-foreground">
                  {mode === 'upgrade' ? '送出後將由平台方審核，審核期間無法再送出新申請' : '加購額度於審核通過後立即入帳'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 申請記錄 */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold">申請記錄</h2>
            {loaded && <span className="text-xs tabular-nums text-muted-foreground">{reqs.length} 筆</span>}
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            {loaded && reqs.length === 0 && (
              <p className="px-[18px] py-6 text-center text-sm text-muted-foreground">還沒有申請記錄，送出第一筆申請後會顯示在這裡。</p>
            )}
            {reqs.map((r) => {
              const Icon = r.type === 'upgrade' ? ArrowUp : Coins;
              const title = r.type === 'upgrade'
                ? `升級 → ${PLAN_LABEL[r.targetPlanSlug ?? ''] ?? r.targetPlanSlug}`
                : `加購 ${toWan(r.topupTokens ?? 0)} token`;
              return (
                <div key={r.id} className="flex items-center gap-3 border-b border-border bg-background px-[18px] py-3.5 last:border-b-0">
                  <div className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="h-[15px] w-[15px]" strokeWidth={1.9} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="text-sm font-medium">{title}</span>
                    <span className="truncate text-xs tabular-nums text-muted-foreground">
                      {formatTime(r.createdAt)}{r.note ? `　${r.note}` : ''}
                    </span>
                  </div>
                  <span className={cn('inline-flex flex-none items-center whitespace-nowrap rounded-full border px-2.5 py-[3px] text-xs font-medium', STATUS[r.status].cls)}>
                    {STATUS[r.status].label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Notice({ tone, icon, children }: { tone: 'success' | 'warning' | 'error'; icon?: ReactNode; children: ReactNode }) {
  const cls = {
    success: 'border-green-200 bg-success-subtle text-success',
    warning: 'border-orange-200 bg-orange-50 text-amber-800 [&_svg]:text-amber-700',
    error: 'border-red-200 bg-red-50 text-destructive',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-[10px] border px-4 py-3.5 text-[13px] leading-[19px]', cls)}>
      {icon && <span className="mt-px flex-none">{icon}</span>}
      <div className="flex-1">{children}</div>
    </div>
  );
}
