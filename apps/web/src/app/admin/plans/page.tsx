'use client';

import { useEffect, useState } from 'react';
import { platformApi } from '../lib/platform-api';

const ALL_FEATURES = ['inbox', 'channels', 'automation', 'marketing', 'analytics', 'knowledge', 'portal', 'core'];
// 功能代碼 → 中文顯示（對齊 @open333crm/core 的 features 定義；代碼本身傳後端不變，只換顯示）
const FEATURE_LABELS: Record<string, string> = {
  inbox: '客服收發',
  channels: '渠道管理',
  automation: '自動化',
  marketing: '行銷群發',
  analytics: '分析報表',
  knowledge: '知識庫',
  portal: '粉絲活動',
  core: '帳號 · 角色 · 設定',
};
// 功能對照說明（依 RBAC 權限點整理成人話，供頁首對照表；勾選該功能 = 該方案租戶可用這些）
const FEATURE_DESC: Record<string, string> = {
  inbox: '收件匣對話、案件（工單）、聯絡人、標籤、短連結',
  channels: 'LINE／FB／IG／WebChat 渠道、圖文選單、快速回覆',
  automation: '自動化規則、對話流程畫布、身分識別建議',
  marketing: '分眾名單、行銷活動、群發、素材與模板',
  analytics: '各維度數據報表、個人績效、報表匯出',
  knowledge: '知識文章、語意搜尋、批次匯入',
  portal: '活動頁、抽獎、會員點數',
  core: '成員與角色權限、系統設定、SLA、Webhook、方案用量（核心功能，恆開）',
};
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
  const [showGuide, setShowGuide] = useState(false); // 功能對照表展開

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
    const trimmed = raw.trim();
    // 明確空字串或 ∞ 才視為 null（無上限）
    if (trimmed === '' || trimmed === '∞') {
      setPlans((prev) =>
        prev.map((p) => (p.id === planId ? { ...p, limits: { ...p.limits, [key]: null } } : p)),
      );
      return;
    }
    const value = parseInt(trimmed.replace(/[,\s]/g, ''), 10);
    // 非數字（如 'abc'）→ parseInt 得 NaN，序列化後會變 null 而誤解成無上限；
    // 此時不更新該欄，維持原值，避免靜默解除上限
    if (Number.isNaN(value)) return;
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
        勾選功能 = 調整該方案的功能天花板；填數值上限 = 限制客服人數/標籤數/AI 額度。儲存後該方案所有租戶即時生效，無需改程式。
      </p>

      {/* 功能對照表：說明每個功能模組對應 open333 的哪些功能 */}
      <div style={{ border: '1px solid #e3e8ef', borderRadius: 10, marginBottom: 20, overflow: 'hidden' }}>
        <button
          onClick={() => setShowGuide((v) => !v)}
          style={{ width: '100%', textAlign: 'left', background: '#f7f9fb', border: 'none', padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#1a2230', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span>功能說明 — 每個功能模組包含哪些能力</span>
          <span style={{ color: '#66707f' }}>{showGuide ? '▲ 收合' : '▼ 展開'}</span>
        </button>
        {showGuide && (
          <div style={{ padding: '4px 0' }}>
            {ALL_FEATURES.map((f) => (
              <div key={f} style={{ display: 'flex', gap: 10, padding: '7px 14px', borderTop: '1px solid #f0f3f7', fontSize: 13 }}>
                <span style={{ minWidth: 96, fontWeight: 600, color: '#0d9488' }}>{FEATURE_LABELS[f] ?? f}</span>
                <span style={{ color: '#66707f' }}>{FEATURE_DESC[f] ?? ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>

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
                    {FEATURE_LABELS[f] ?? f}
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
