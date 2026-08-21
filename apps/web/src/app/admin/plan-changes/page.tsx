'use client';

import { useEffect, useState } from 'react';
import { platformApi } from '../lib/platform-api';
import { fmtTokens } from '../lib/format';

interface Req {
  id: string;
  tenantName: string;
  currentPlan: string | null;
  type: 'upgrade' | 'token_topup';
  targetPlanSlug: string | null;
  topupTokens: number | null;
  note: string | null;
  createdAt: string;
}

const PLAN_LABEL: Record<string, string> = {
  light: '輕量版', standard: '標準版', professional: '專業版', enterprise: '企業版',
};

export default function PlanChangesPage() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [msg, setMsg] = useState('');

  const load = async () => setReqs((await platformApi.get('/plan-change-requests')).data.data);
  useEffect(() => { load(); }, []);

  const act = async (r: Req, action: 'approve' | 'reject') => {
    const verb = action === 'approve' ? '核准' : '駁回';
    if (!window.confirm(`確定${verb}「${r.tenantName}」的申請？`)) return;
    await platformApi.patch(`/plan-change-requests/${r.id}/${action}`);
    await load();
    setMsg(`✓ 已${verb}「${r.tenantName}」的申請`);
    setTimeout(() => setMsg(''), 3000);
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>升級/加購申請</h1>
      <p style={{ color: '#66707f', fontSize: 13, marginBottom: 20 }}>
        租戶發起的方案升級與加購 token 申請。核准後即時生效。
      </p>
      {msg && <div style={{ background: '#e4f5ec', color: '#17935b', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#97a0ae', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={th}>租戶</th>
              <th style={th}>類型</th>
              <th style={th}>內容</th>
              <th style={th}>備註</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {reqs.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #eef1f5' }}>
                <td style={td}>
                  {r.tenantName}
                  <div style={{ fontSize: 11, color: '#97a0ae' }}>目前：{r.currentPlan ?? '—'}</div>
                </td>
                <td style={td}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: r.type === 'upgrade' ? '#eaeffc' : '#fbf1dc', color: r.type === 'upgrade' ? '#2563eb' : '#b7791f' }}>
                    {r.type === 'upgrade' ? '升級方案' : '加購 Token'}
                  </span>
                </td>
                <td style={td}>
                  {r.type === 'upgrade'
                    ? `→ ${PLAN_LABEL[r.targetPlanSlug ?? ''] ?? r.targetPlanSlug}`
                    : `+${fmtTokens(r.topupTokens ?? 0)} token`}
                </td>
                <td style={{ ...td, fontSize: 12, color: '#66707f', maxWidth: 200 }}>{r.note ?? '—'}</td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={{ ...miniBtn, background: '#17935b', color: '#fff', border: 'none' }} onClick={() => act(r, 'approve')}>核准</button>
                    <button style={{ ...miniBtn, color: '#d1443e' }} onClick={() => act(r, 'reject')}>駁回</button>
                  </div>
                </td>
              </tr>
            ))}
            {reqs.length === 0 && (
              <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#97a0ae' }}>目前沒有待審核的申請</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e3e8ef', borderRadius: 12, padding: 18 };
const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px' };
const miniBtn: React.CSSProperties = { border: '1px solid #cdd5e0', background: '#fff', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
