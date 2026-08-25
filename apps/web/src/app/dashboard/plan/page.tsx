'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

interface Req {
  id: string;
  type: 'upgrade' | 'token_topup';
  targetPlanSlug: string | null;
  topupTokens: number | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

const PLANS = [
  { slug: 'standard', label: '標準版' },
  { slug: 'professional', label: '專業版' },
  { slug: 'enterprise', label: '企業版' },
];
const TOPUPS = [200_000, 500_000, 1_000_000];

const STATUS_LABEL: Record<Req['status'], { label: string; cls: string }> = {
  pending: { label: '處理中', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: '已核准', cls: 'bg-green-100 text-green-700' },
  rejected: { label: '已駁回', cls: 'bg-red-100 text-red-700' },
};

export default function PlanPage() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [mode, setMode] = useState<'upgrade' | 'token_topup'>('upgrade');
  const [targetPlan, setTargetPlan] = useState('standard');
  const [topup, setTopup] = useState(200_000);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => setReqs((await api.get('/plan-change')).data.data);
  useEffect(() => { load(); }, []);

  const hasPending = reqs.some((r) => r.status === 'pending');

  const submit = async () => {
    setSubmitting(true);
    setMsg('');
    try {
      const body = mode === 'upgrade'
        ? { type: 'upgrade', targetPlanSlug: targetPlan, note: note || undefined }
        : { type: 'token_topup', topupTokens: topup, note: note || undefined };
      await api.post('/plan-change', body);
      setNote('');
      await load();
      setMsg('✓ 申請已送出，等待平台方核准');
    } catch (err: unknown) {
      const m = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setMsg(m ?? '送出失敗');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">方案</h1>
      <p className="mt-1 text-sm text-muted-foreground">申請升級方案或加購 AI token 額度，由平台方審核後生效。</p>

      {msg && <div className="mt-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{msg}</div>}

      {/* 申請表單 */}
      <div className="mt-6 rounded-lg border bg-card p-5">
        {hasPending ? (
          <p className="text-sm text-amber-700">您有一筆處理中的申請，請等待審核完成後再送出新申請。</p>
        ) : (
          <>
            <div className="mb-4 flex gap-2">
              {(['upgrade', 'token_topup'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === m ? 'bg-primary text-primary-foreground' : 'border'}`}
                >
                  {m === 'upgrade' ? '升級方案' : '加購 Token'}
                </button>
              ))}
            </div>

            {mode === 'upgrade' ? (
              <div>
                <label className="mb-1.5 block text-xs font-medium">目標方案</label>
                <select value={targetPlan} onChange={(e) => setTargetPlan(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  {PLANS.map((p) => <option key={p.slug} value={p.slug}>{p.label}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-xs font-medium">加購額度</label>
                <div className="flex gap-2">
                  {TOPUPS.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTopup(t)}
                      className={`rounded-md px-3 py-2 text-sm font-medium ${topup === t ? 'border-primary bg-primary/10 text-primary' : 'border'} border`}
                    >
                      +{(t / 10000).toLocaleString()} 萬
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-medium">備註（選填）</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="例如：促銷檔期流量會增加" />
            </div>

            <button onClick={submit} disabled={submitting} className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {submitting ? '送出中…' : '送出申請'}
            </button>
          </>
        )}
      </div>

      {/* 申請記錄 */}
      <h2 className="mt-8 text-lg font-medium">申請記錄</h2>
      <div className="mt-3 space-y-2">
        {reqs.map((r) => (
          <div key={r.id} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
            <span className="font-medium">
              {r.type === 'upgrade' ? `升級 → ${r.targetPlanSlug}` : `加購 ${((r.topupTokens ?? 0) / 10000).toLocaleString()} 萬 token`}
            </span>
            {r.note && <span className="text-xs text-muted-foreground">{r.note}</span>}
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_LABEL[r.status].cls}`}>
              {STATUS_LABEL[r.status].label}
            </span>
          </div>
        ))}
        {reqs.length === 0 && <p className="text-sm text-muted-foreground">尚無申請記錄。</p>}
      </div>
    </div>
  );
}
