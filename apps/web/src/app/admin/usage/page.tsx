'use client';

import { useEffect, useState } from 'react';
import { platformApi } from '../lib/platform-api';
import { fmtTokens, fmtUsd, fmtNum } from '../lib/format';

interface Overview {
  totalTokens: number;
  totalCostUsd: string;
  totalCalls: number;
  activeTenants: number;
  byProvider: { provider: string; totalTokens: number; totalCostUsd: string; calls: number }[];
}
interface TenantRow {
  tenantId: string;
  tenantName: string;
  planName: string | null;
  totalTokens: number;
  totalCostUsd: string;
  calls: number;
}
interface Detail {
  trend: { day: string; tokens: number; costUsd: string; calls: number }[];
  byFeature: { feature: string; totalTokens: number; totalCostUsd: string; calls: number }[];
}

const RANGES = [
  { label: '近 7 天', days: 7 },
  { label: '近 30 天', days: 30 },
  { label: '近 90 天', days: 90 },
];

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const [ov, setOv] = useState<Overview | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [selected, setSelected] = useState<TenantRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const rangeParams = () => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  };

  useEffect(() => {
    const params = rangeParams();
    platformApi.get('/usage/overview', { params }).then((r) => setOv(r.data.data));
    platformApi.get('/usage/tenants', { params }).then((r) => setTenants(r.data.data));
    setSelected(null);
    setDetail(null);
  }, [days]);

  const drill = async (t: TenantRow) => {
    setSelected(t);
    const r = await platformApi.get(`/usage/tenants/${t.tenantId}`, { params: rangeParams() });
    setDetail(r.data.data);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>用量統計</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              style={{
                border: '1px solid ' + (days === r.days ? '#0d9488' : '#e3e8ef'),
                background: days === r.days ? '#dcf3f0' : '#fff',
                color: days === r.days ? '#0d9488' : '#66707f',
                borderRadius: 8,
                padding: '5px 12px',
                fontSize: 12.5,
                cursor: 'pointer',
                fontWeight: days === r.days ? 600 : 400,
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <p style={{ color: '#66707f', fontSize: 13, marginBottom: 20 }}>
        跨租戶 AI token 用量與成本。成本以寫入當下的模型單價快照計算（僅計成功呼叫）。
      </p>

      {/* 總覽卡 */}
      {ov && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          <StatCard label="總 AI Token" value={fmtTokens(ov.totalTokens)} sub={`${ov.activeTenants} 個活躍租戶`} />
          <StatCard label="總成本" value={fmtUsd(ov.totalCostUsd)} sub="平台承擔（不含 BYOK）" accent />
          <StatCard label="AI 呼叫數" value={fmtNum(ov.totalCalls)} sub="成功呼叫" />
          <StatCard
            label="Provider"
            value={ov.byProvider.map((p) => p.provider).join(' / ') || '—'}
            sub={ov.byProvider.map((p) => `${p.provider}: ${fmtTokens(p.totalTokens)}`).join(' · ')}
          />
        </div>
      )}

      {/* 租戶排行 */}
      <p style={{ fontSize: 13, fontWeight: 640, margin: '0 0 8px' }}>各租戶用量排行</p>
      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#97a0ae', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={th}>租戶</th>
              <th style={th}>方案</th>
              <th style={{ ...th, textAlign: 'right' }}>Token</th>
              <th style={{ ...th, textAlign: 'right' }}>成本</th>
              <th style={{ ...th, textAlign: 'right' }}>呼叫數</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr
                key={t.tenantId}
                onClick={() => drill(t)}
                style={{
                  borderTop: '1px solid #eef1f5',
                  cursor: 'pointer',
                  background: selected?.tenantId === t.tenantId ? '#dcf3f0' : undefined,
                }}
              >
                <td style={td}>{t.tenantName}</td>
                <td style={td}>{t.planName ?? '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(t.totalTokens)}</td>
                <td style={{ ...td, textAlign: 'right', color: '#17935b', fontWeight: 600 }}>{fmtUsd(t.totalCostUsd)}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(t.calls)}</td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...td, textAlign: 'center', color: '#97a0ae' }}>
                  此區間尚無用量資料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 單租戶鑽取 */}
      {selected && detail && (
        <div style={{ ...card, marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <strong style={{ fontSize: 15 }}>{selected.tenantName}</strong>
            <span style={{ fontSize: 12, color: '#97a0ae' }}>近 {days} 天用量趨勢</span>
          </div>
          <TrendChart data={detail.trend} />
          <p style={{ fontSize: 12, fontWeight: 640, margin: '18px 0 8px', color: '#66707f' }}>依功能分佈</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {detail.byFeature.map((f) => (
                <tr key={f.feature} style={{ borderTop: '1px solid #eef1f5' }}>
                  <td style={td}>{f.feature}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(f.totalTokens)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#17935b' }}>{fmtUsd(f.totalCostUsd)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#97a0ae' }}>{fmtNum(f.calls)} 次</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ ...card, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: '#97a0ae', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 680, marginTop: 4, color: accent ? '#17935b' : '#1a2230', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#66707f', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// 純 SVG 長條圖（每日 token），跟 admin inline style 風格一致、不引 recharts
function TrendChart({ data }: { data: { day: string; tokens: number }[] }) {
  if (data.length === 0) return <div style={{ fontSize: 13, color: '#97a0ae', padding: 12 }}>此區間無資料</div>;
  const max = Math.max(...data.map((d) => d.tokens), 1);
  const H = 100;
  const barW = Math.max(3, Math.min(24, Math.floor(560 / data.length) - 3));
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: H, borderBottom: '1px solid #e3e8ef', paddingBottom: 0 }}>
        {data.map((d) => (
          <div
            key={d.day}
            title={`${d.day}: ${d.tokens.toLocaleString()} token`}
            style={{
              width: barW,
              height: Math.max(2, Math.round((d.tokens / max) * H)),
              background: '#0d9488',
              borderRadius: '3px 3px 0 0',
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#97a0ae', marginTop: 4 }}>
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e3e8ef', borderRadius: 12, padding: 18 };
const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px' };
