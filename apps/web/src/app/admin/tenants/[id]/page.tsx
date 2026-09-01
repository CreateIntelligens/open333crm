'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { platformApi } from '../../lib/platform-api';
import { fmtNum } from '../../lib/format';

interface TenantDetail {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  trialEndsAt: string | null;
  purgedAt: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  plan: { id: string; slug: string; name: string } | null;
  agents: { id: string; name: string; email: string; role: string; isActive: boolean; createdAt: string }[];
  _count: { agents: number; channels: number; contacts: number; conversations: number; cases: number };
}

interface PlanOption {
  id: string;
  slug: string;
  name: string;
}

/** ISO datetime → yyyy-MM-dd；null → '' */
function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);
  const [saving, setSaving] = useState(false);

  // 基本資料編輯草稿（載入詳細後初始化）
  const [form, setForm] = useState({ name: '', planSlug: '' });
  // 合約日期草稿
  const [contract, setContract] = useState({ start: '', end: '' });

  const load = useCallback(async () => {
    const res = await platformApi.get(`/tenants/${id}`);
    const t: TenantDetail = res.data.data;
    setTenant(t);
    setForm({ name: t.name, planSlug: t.plan?.slug ?? '' });
    setContract({ start: toDateInput(t.contractStartDate), end: toDateInput(t.contractEndDate) });
  }, [id]);

  useEffect(() => {
    load();
    platformApi.get('/plans').then((res) => setPlans(res.data.data));
  }, [load]);

  const showError = (err: unknown, fallback: string) => {
    setMsgOk(false);
    setMsg(
      (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? fallback,
    );
  };

  const saveBasic = async () => {
    if (!tenant) return;
    setSaving(true);
    setMsg('');
    try {
      await platformApi.patch(`/tenants/${tenant.id}`, { name: form.name, planSlug: form.planSlug });
      setMsgOk(true);
      setMsg('✓ 基本資料已儲存');
      await load();
    } catch (err: unknown) {
      showError(err, '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const saveContract = async () => {
    if (!tenant) return;
    // 前端即時擋：迄日早於起日（後端亦有驗證）
    if (contract.start && contract.end && contract.end < contract.start) {
      setMsgOk(false);
      setMsg('合約迄日不可早於起日');
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      await platformApi.patch(`/tenants/${tenant.id}/contract`, {
        contractStartDate: contract.start || null,
        contractEndDate: contract.end || null,
      });
      setMsgOk(true);
      setMsg('✓ 合約期間已儲存');
      await load();
    } catch (err: unknown) {
      showError(err, '合約日期儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!tenant) return;
    setSaving(true);
    setMsg('');
    try {
      await platformApi.patch(`/tenants/${tenant.id}/active`, { isActive: !tenant.isActive });
      setMsgOk(true);
      setMsg(tenant.isActive ? '✓ 已停用租戶' : '✓ 已啟用租戶');
      await load();
    } catch (err: unknown) {
      showError(err, '狀態切換失敗');
    } finally {
      setSaving(false);
    }
  };

  if (!tenant) {
    return <p style={{ color: '#97a0ae', fontSize: 13 }}>載入中…</p>;
  }

  return (
    <div>
      <p style={{ marginBottom: 12 }}>
        <Link href="/admin/tenants" style={{ color: '#0d9488', fontSize: 13, textDecoration: 'none' }}>
          ← 返回租戶管理
        </Link>
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{tenant.name}</h1>
        <span style={{ color: tenant.isActive ? '#17935b' : '#d1443e', fontSize: 13, fontWeight: 600 }}>
          {tenant.isActive ? '啟用中' : '已停用'}
        </span>
        {tenant.purgedAt && <span style={{ color: '#d1443e', fontSize: 13 }}>（已清除 {fmtDate(tenant.purgedAt)}）</span>}
      </div>
      <p style={{ color: '#66707f', fontSize: 13, marginBottom: 20 }}>
        建立於 {fmtDate(tenant.createdAt)}
        {tenant.trialEndsAt ? `｜試用至 ${fmtDate(tenant.trialEndsAt)}` : ''}
      </p>

      {msg && (
        <div
          style={{
            background: msgOk ? '#e4f5ec' : '#fdecea',
            color: msgOk ? '#17935b' : '#d1443e',
            padding: '8px 14px',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {msg}
        </div>
      )}

      {/* 資料量統計 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {(
          [
            ['客服', tenant._count.agents],
            ['渠道', tenant._count.channels],
            ['聯絡人', tenant._count.contacts],
            ['對話', tenant._count.conversations],
            ['案件', tenant._count.cases],
          ] as const
        ).map(([label, count]) => (
          <div key={label} style={{ ...card, padding: '12px 20px', minWidth: 100 }}>
            <div style={{ fontSize: 11, color: '#97a0ae', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtNum(count)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* 基本資料 */}
        <div style={{ ...card, flex: '1 1 320px', maxWidth: 480 }}>
          <h2 style={h2}>基本資料</h2>
          <label style={label}>站台名稱</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inp} />
          <label style={label}>方案</label>
          <select value={form.planSlug} onChange={(e) => setForm({ ...form, planSlug: e.target.value })} style={inp}>
            {!form.planSlug && <option value="">（無方案）</option>}
            {plans.map((p) => (
              <option key={p.id} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={saveBasic} disabled={saving || !form.name.trim()} style={saveBtn}>
              儲存
            </button>
            <button
              onClick={toggleActive}
              disabled={saving}
              style={{ ...miniBtn, color: tenant.isActive ? '#d1443e' : '#17935b' }}
            >
              {tenant.isActive ? '停用租戶' : '啟用租戶'}
            </button>
          </div>
        </div>

        {/* 合約期間 */}
        <div style={{ ...card, flex: '1 1 280px', maxWidth: 420 }}>
          <h2 style={h2}>合約期間</h2>
          <label style={label}>起日</label>
          <input
            type="date"
            value={contract.start}
            onChange={(e) => setContract({ ...contract, start: e.target.value })}
            style={inp}
          />
          <label style={label}>迄日</label>
          <input
            type="date"
            value={contract.end}
            onChange={(e) => setContract({ ...contract, end: e.target.value })}
            style={inp}
          />
          <div style={{ marginTop: 14 }}>
            <button onClick={saveContract} disabled={saving} style={saveBtn}>
              儲存
            </button>
          </div>
        </div>
      </div>

      {/* 成員 */}
      <h2 style={{ ...h2, margin: '28px 0 12px' }}>成員（{tenant.agents.length}）</h2>
      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#97a0ae', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={th}>姓名</th>
              <th style={th}>Email</th>
              <th style={th}>角色</th>
              <th style={th}>狀態</th>
              <th style={th}>建立時間</th>
            </tr>
          </thead>
          <tbody>
            {tenant.agents.map((a) => (
              <tr key={a.id} style={{ borderTop: '1px solid #eef1f5' }}>
                <td style={td}>{a.name}</td>
                <td style={td}>{a.email}</td>
                <td style={td}>{a.role}</td>
                <td style={td}>
                  <span style={{ color: a.isActive ? '#17935b' : '#d1443e' }}>{a.isActive ? '啟用' : '停用'}</span>
                </td>
                <td style={td}>{fmtDate(a.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e3e8ef', borderRadius: 12, padding: 18 };
const h2: React.CSSProperties = { fontSize: 16, margin: '0 0 12px' };
const label: React.CSSProperties = { display: 'block', fontSize: 12, color: '#66707f', margin: '10px 0 4px' };
const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px' };
const inp: React.CSSProperties = {
  border: '1px solid #e3e8ef',
  borderRadius: 8,
  padding: '9px 11px',
  fontSize: 14,
  width: '100%',
  boxSizing: 'border-box',
};
const miniBtn: React.CSSProperties = {
  border: '1px solid #cdd5e0',
  background: '#fff',
  borderRadius: 8,
  padding: '9px 14px',
  cursor: 'pointer',
  fontSize: 13,
};
const saveBtn: React.CSSProperties = {
  background: '#0d9488',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '9px 18px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
