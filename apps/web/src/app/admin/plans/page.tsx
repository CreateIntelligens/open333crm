'use client';

import { useEffect, useState } from 'react';
import { platformApi } from '../lib/platform-api';

const ALL_FEATURES = ['inbox', 'channels', 'automation', 'marketing', 'analytics', 'knowledge', 'portal', 'core'];
const LIMIT_KEYS: { key: string; label: string }[] = [
  { key: 'maxAgents', label: '客服人數' },
  { key: 'maxTags', label: '分眾標籤數' },
  { key: 'monthlyTokens', label: 'AI 月額度 token' },
];

interface Plan {
  id: string;
  slug: string;
  name: string;
  features: string[];
  limits: Record<string, number | null>;
  priceMonthly: number | null;
  isActive: boolean;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const res = await platformApi.get('/plans');
    setPlans(res.data.data);
  };
  useEffect(() => {
    load();
  }, []);

  const toggleFeature = (planId: string, feature: string) => {
    setPlans((prev) =>
      prev.map((p) =>
        p.id === planId
          ? {
              ...p,
              features: p.features.includes(feature)
                ? p.features.filter((f) => f !== feature)
                : [...p.features, feature],
            }
          : p,
      ),
    );
  };

  const setLimit = (planId: string, key: string, raw: string) => {
    const value = raw.trim() === '' || raw.trim() === '∞' ? null : parseInt(raw.replace(/[,\s]/g, ''), 10);
    setPlans((prev) =>
      prev.map((p) => (p.id === planId ? { ...p, limits: { ...p.limits, [key]: value } } : p)),
    );
  };

  const save = async (plan: Plan) => {
    setSaving(plan.id);
    setMsg('');
    try {
      await platformApi.patch(`/plans/${plan.id}`, {
        features: plan.features,
        limits: plan.limits,
      });
      setMsg(`✓ 已更新「${plan.name}」——該方案所有租戶即時生效`);
      await load();
    } catch {
      setMsg('儲存失敗');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>方案與上限</h1>
      <p style={{ color: '#66707f', fontSize: 13, marginBottom: 20 }}>
        改 features = 改功能天花板；改 limits = 改數值上限。儲存後該方案所有租戶即時生效，零改碼。
      </p>
      {msg && (
        <div style={{ background: '#e4f5ec', color: '#17935b', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {msg}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {plans.map((plan) => (
          <div key={plan.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <strong style={{ fontSize: 16 }}>{plan.name}</strong>
              <span style={{ fontSize: 11, color: '#97a0ae', fontFamily: 'monospace' }}>{plan.slug}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#66707f' }}>
                {plan.priceMonthly === null ? '客製報價' : `NT$ ${plan.priceMonthly.toLocaleString()}/月`}
              </span>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={label}>功能</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {ALL_FEATURES.map((f) => (
                  <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={plan.features.includes(f)}
                      disabled={f === 'core'}
                      onChange={() => toggleFeature(plan.id, f)}
                    />
                    {f}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={label}>數值上限（留空 = 無上限）</div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {LIMIT_KEYS.map(({ key, label: l }) => (
                  <div key={key} style={{ fontSize: 13 }}>
                    <div style={{ color: '#66707f', marginBottom: 2 }}>{l}</div>
                    <input
                      defaultValue={plan.limits[key] ?? ''}
                      placeholder="無上限"
                      onChange={(e) => setLimit(plan.id, key, e.target.value)}
                      style={{ width: 120, border: '1px solid #e3e8ef', borderRadius: 6, padding: '5px 8px' }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => save(plan)} disabled={saving === plan.id} style={saveBtn}>
              {saving === plan.id ? '儲存中…' : '儲存'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e3e8ef', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', color: '#97a0ae', fontWeight: 600, marginBottom: 6 };
const saveBtn: React.CSSProperties = { background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
