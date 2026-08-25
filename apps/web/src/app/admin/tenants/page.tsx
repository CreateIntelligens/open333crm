'use client';

import { useEffect, useState } from 'react';
import { platformApi } from '../lib/platform-api';

interface Tenant {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  plan: { slug: string; name: string } | null;
  _count: { agents: number };
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ name: '', planSlug: 'trial', adminEmail: '', adminName: '', adminPassword: '' });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const res = await platformApi.get('/tenants');
    setTenants(res.data.data);
  };
  useEffect(() => {
    load();
  }, []);

  const toggleActive = async (t: Tenant) => {
    await platformApi.patch(`/tenants/${t.id}/active`, { isActive: !t.isActive });
    await load();
  };

  const provision = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setMsg('');
    try {
      await platformApi.post('/tenants', form);
      setMsg(`✓ 已開通「${form.name}」`);
      setForm({ name: '', planSlug: 'trial', adminEmail: '', adminName: '', adminPassword: '' });
      await load();
    } catch (err: unknown) {
      setMsg(
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
          '開通失敗',
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>租戶管理</h1>
      <p style={{ color: '#66707f', fontSize: 13, marginBottom: 20 }}>檢視租戶、停用/啟用、手動開通。</p>
      {msg && (
        <div style={{ background: '#e4f5ec', color: '#17935b', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {msg}
        </div>
      )}

      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#97a0ae', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={th}>租戶</th>
              <th style={th}>方案</th>
              <th style={th}>客服數</th>
              <th style={th}>狀態</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} style={{ borderTop: '1px solid #eef1f5' }}>
                <td style={td}>{t.name}</td>
                <td style={td}>{t.plan?.name ?? '（無方案）'}</td>
                <td style={td}>{t._count.agents}</td>
                <td style={td}>
                  <span style={{ color: t.isActive ? '#17935b' : '#d1443e' }}>
                    {t.isActive ? '啟用' : '停用'}
                  </span>
                </td>
                <td style={td}>
                  <button onClick={() => toggleActive(t)} style={miniBtn}>
                    {t.isActive ? '停用' : '啟用'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 16, margin: '28px 0 12px' }}>手動開通租戶</h2>
      <form onSubmit={provision} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
        <input placeholder="站台名稱" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={inp} />
        <select value={form.planSlug} onChange={(e) => setForm({ ...form, planSlug: e.target.value })} style={inp}>
          <option value="trial">免費試用</option>
          <option value="light">輕量版</option>
          <option value="standard">標準版</option>
          <option value="professional">專業版</option>
          <option value="enterprise">企業版</option>
        </select>
        <input placeholder="管理員 Email" type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} required style={inp} />
        <input placeholder="管理員姓名" value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} required style={inp} />
        <input placeholder="管理員密碼（≥8）" type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} required style={inp} />
        <button type="submit" disabled={creating} style={saveBtn}>
          {creating ? '開通中…' : '開通'}
        </button>
      </form>
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e3e8ef', borderRadius: 12, padding: 18 };
const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px' };
const miniBtn: React.CSSProperties = { border: '1px solid #cdd5e0', background: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 };
const inp: React.CSSProperties = { border: '1px solid #e3e8ef', borderRadius: 8, padding: '9px 11px', fontSize: 14 };
const saveBtn: React.CSSProperties = { background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
