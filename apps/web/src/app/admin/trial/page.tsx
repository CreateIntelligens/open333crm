'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { platformApi } from '../lib/platform-api';

interface Signup {
  id: string;
  email: string;
  siteName: string;
  status: string;
  provisionedAt: string | null;
  failureReason: string | null;
  createdAt: string;
}
interface TrialTenant {
  id: string;
  name: string;
  isActive: boolean;
  trialEndsAt: string | null;
  purgedAt: string | null;
  daysLeft: number | null;
  status: 'active' | 'expiring' | 'expired' | 'disabled' | 'purged';
  planName: string | null;
  agentCount: number;
}

const SETTINGS = [
  { key: 'trial.enabled', label: '開放試用申請', type: 'bool' as const, def: false },
  { key: 'trial.durationDays', label: '試用天數', type: 'num' as const, def: 14 },
  { key: 'trial.verifyTokenTtlHours', label: '驗證連結有效小時', type: 'num' as const, def: 24 },
  { key: 'trial.dataRetentionDays', label: '到期後資料保留天數', type: 'num' as const, def: 30 },
  { key: 'trial.reminderDaysBefore', label: '到期前提醒天數（逗號分隔）', type: 'list' as const, def: [7, 1] },
];

// 轉正式可選方案（排除 trial）
const PAID_PLANS = [
  { slug: 'light', label: '輕量版' },
  { slug: 'standard', label: '標準版' },
  { slug: 'professional', label: '專業版' },
  { slug: 'enterprise', label: '企業版' },
];

const STATUS_META: Record<TrialTenant['status'], { label: string; color: string }> = {
  active: { label: '試用中', color: '#17935b' },
  expiring: { label: '即將到期', color: '#b7791f' },
  expired: { label: '已到期', color: '#d1443e' },
  disabled: { label: '已停用', color: '#97a0ae' },
  purged: { label: '已清除', color: '#6b7280' },
};

export default function TrialAdminPage() {
  const [tab, setTab] = useState<'tenants' | 'signups' | 'settings'>('tenants');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [signups, setSignups] = useState<Signup[]>([]);
  const [tenants, setTenants] = useState<TrialTenant[]>([]);
  const [msg, setMsg] = useState('');

  const loadSettings = async () => {
    const entries = await Promise.all(
      SETTINGS.map(async (s) => {
        const res = await platformApi.get(`/settings/${s.key}`);
        return [s.key, res.data.data ?? s.def] as const;
      }),
    );
    setValues(Object.fromEntries(entries));
  };
  const loadSignups = async () => setSignups((await platformApi.get('/trial-signups')).data.data);
  const loadTenants = async () => setTenants((await platformApi.get('/trial-tenants')).data.data);

  useEffect(() => {
    loadSettings();
    loadSignups();
    loadTenants();
  }, []);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 3000);
  };

  const saveSetting = async (key: string, value: unknown) => {
    await platformApi.put(`/settings/${key}`, { value });
    setValues((v) => ({ ...v, [key]: value }));
    flash(`✓ 已更新 ${key}`);
  };

  const extend = async (t: TrialTenant) => {
    const raw = window.prompt(`延長「${t.name}」試用幾天？`, '7');
    if (!raw) return;
    const days = parseInt(raw, 10);
    if (isNaN(days) || days <= 0) return flash('請輸入正整數天數');
    await platformApi.patch(`/trial-tenants/${t.id}/extend`, { days });
    await loadTenants();
    flash(`✓ 已延長「${t.name}」試用 ${days} 天`);
  };

  const convert = async (t: TrialTenant, planSlug: string) => {
    if (!planSlug) return;
    if (!window.confirm(`確定將「${t.name}」轉為正式方案？此後脫離試用、不再到期。`)) return;
    await platformApi.patch(`/trial-tenants/${t.id}/convert`, { planSlug });
    await loadTenants();
    flash(`✓ 已將「${t.name}」轉為正式方案`);
  };

  // 復原已軟刪（已清除）的試用租戶：清 purgedAt（業務資料本就未真刪，仍維持停用）
  const restore = async (t: TrialTenant) => {
    if (!window.confirm(`復原「${t.name}」的已清除標記？資料未曾真刪，復原後恢復可見（仍為停用狀態）。`)) return;
    await platformApi.patch(`/tenants/${t.id}/restore`, {});
    await loadTenants();
    flash(`✓ 已復原「${t.name}」`);
  };

  const resend = async (s: Signup) => {
    await platformApi.post(`/trial-signups/${s.id}/resend`);
    flash(`✓ 已重寄驗證信給 ${s.email}`);
  };
  const markFailed = async (s: Signup) => {
    if (!window.confirm(`確定將 ${s.email} 的申請標記為作廢？`)) return;
    await platformApi.patch(`/trial-signups/${s.id}/fail`, { reason: '平台手動作廢' });
    await loadSignups();
    flash('✓ 已標記為作廢');
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>試用管理</h1>
      <p style={{ color: '#66707f', fontSize: 13, marginBottom: 16 }}>
        管理試用租戶、申請記錄與試用政策參數。功能與上限請至{' '}
        <Link href="/admin/plans" style={{ color: '#0d9488' }}>方案與上限</Link> 編輯 <code>trial</code> 方案。
      </p>

      {/* 分頁 */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e3e8ef', marginBottom: 18 }}>
        {[
          { k: 'tenants', label: `試用租戶 (${tenants.length})` },
          { k: 'signups', label: `申請記錄 (${signups.length})` },
          { k: 'settings', label: '政策設定' },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k as typeof tab)}
            style={{
              border: 'none',
              background: 'none',
              padding: '9px 14px',
              fontSize: 13.5,
              fontWeight: tab === t.k ? 600 : 400,
              color: tab === t.k ? '#0d9488' : '#66707f',
              borderBottom: '2px solid ' + (tab === t.k ? '#0d9488' : 'transparent'),
              marginBottom: -1,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg && <div style={{ background: '#e4f5ec', color: '#17935b', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      {/* 試用租戶 */}
      {tab === 'tenants' && (
        <div style={card}>
          <table style={tbl}>
            <thead>
              <tr style={thr}>
                <th style={th}>站台</th>
                <th style={th}>方案</th>
                <th style={th}>狀態</th>
                <th style={{ ...th, textAlign: 'right' }}>剩餘天數</th>
                <th style={th}>到期日</th>
                <th style={th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid #eef1f5' }}>
                  <td style={td}>{t.name}</td>
                  <td style={td}>{t.planName ?? '—'}</td>
                  <td style={td}>
                    <span style={{ color: STATUS_META[t.status].color, fontWeight: 600, fontSize: 12 }}>
                      {STATUS_META[t.status].label}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: t.daysLeft !== null && t.daysLeft <= 3 ? '#d1443e' : '#1a2230' }}>
                    {t.daysLeft !== null ? `${t.daysLeft} 天` : '—'}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: '#66707f' }}>
                    {t.trialEndsAt ? new Date(t.trialEndsAt).toLocaleDateString('zh-TW') : '—'}
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {t.purgedAt ? (
                        <button style={{ ...miniBtn, color: '#0d9488' }} onClick={() => restore(t)}>
                          復原
                        </button>
                      ) : (
                        <>
                          <button style={miniBtn} onClick={() => extend(t)}>延長</button>
                          <select
                            defaultValue=""
                            onChange={(e) => { convert(t, e.target.value); e.target.value = ''; }}
                            style={{ ...miniBtn, cursor: 'pointer' }}
                          >
                            <option value="" disabled>轉正式…</option>
                            {PAID_PLANS.map((p) => <option key={p.slug} value={p.slug}>{p.label}</option>)}
                          </select>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && <EmptyRow cols={6} text="目前沒有試用租戶" />}
            </tbody>
          </table>
        </div>
      )}

      {/* 申請記錄 */}
      {tab === 'signups' && (
        <div style={card}>
          <table style={tbl}>
            <thead>
              <tr style={thr}>
                <th style={th}>Email</th>
                <th style={th}>站台</th>
                <th style={th}>狀態</th>
                <th style={th}>備註</th>
                <th style={th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {signups.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid #eef1f5' }}>
                  <td style={td}>{s.email}</td>
                  <td style={td}>{s.siteName}</td>
                  <td style={td}>
                    <span style={{ color: s.status === 'provisioned' ? '#17935b' : s.status === 'failed' ? '#d1443e' : '#66707f', fontSize: 12 }}>
                      {s.status}
                    </span>
                  </td>
                  <td style={{ ...td, fontSize: 12, color: '#66707f' }}>{s.failureReason ?? '—'}</td>
                  <td style={td}>
                    {s.status === 'pending_verification' ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={miniBtn} onClick={() => resend(s)}>重寄</button>
                        <button style={{ ...miniBtn, color: '#d1443e' }} onClick={() => markFailed(s)}>作廢</button>
                      </div>
                    ) : (
                      <span style={{ color: '#cdd5e0', fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {signups.length === 0 && <EmptyRow cols={5} text="尚無申請記錄" />}
            </tbody>
          </table>
        </div>
      )}

      {/* 政策設定 */}
      {tab === 'settings' && (
        <div style={card}>
          {SETTINGS.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
              <div style={{ width: 220, fontSize: 13 }}>{s.label}</div>
              {s.type === 'bool' ? (
                <input type="checkbox" checked={!!values[s.key]} onChange={(e) => saveSetting(s.key, e.target.checked)} />
              ) : s.type === 'num' ? (
                <input type="number" defaultValue={values[s.key] as number} onBlur={(e) => saveSetting(s.key, parseInt(e.target.value, 10))} style={inp} />
              ) : (
                <input
                  defaultValue={(values[s.key] as number[])?.join(', ')}
                  onBlur={(e) => saveSetting(s.key, e.target.value.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n)))}
                  style={{ ...inp, width: 160 }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} style={{ ...td, textAlign: 'center', color: '#97a0ae' }}>{text}</td>
    </tr>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e3e8ef', borderRadius: 12, padding: 18 };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const thr: React.CSSProperties = { textAlign: 'left', color: '#97a0ae', fontSize: 11, textTransform: 'uppercase' };
const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px' };
const inp: React.CSSProperties = { border: '1px solid #e3e8ef', borderRadius: 8, padding: '7px 10px', fontSize: 14, width: 100 };
const miniBtn: React.CSSProperties = { border: '1px solid #cdd5e0', background: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
