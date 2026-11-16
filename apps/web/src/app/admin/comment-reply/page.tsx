'use client';

/**
 * 平台後台：留言自動私訊（change add-comment-keyword-private-reply design D21、D22、D25；
 * spec comment-reply-platform-controls「平台留言自動私訊頁」「平台設定鍵有型別檢查」）。
 *
 * 設定區沿用 GET/PUT /platform/settings/:key（後端驗證型別並寫 setting.update 平台稽核），以表單編輯，不手打 JSON。
 * 健康區讀 GET /platform/comment-reply/health（不呼叫 Meta）。
 */
import { useCallback, useEffect, useState } from 'react';
import { platformApi } from '../lib/platform-api';
import { C, badge, banner, btnPrimary, card, input, label, pageDesc, pageTitle, sectionTitle, table, td, th } from '../lib/ui';
import { reasonLabel } from '@/lib/comment-reply/codes';
import { getApiErrorMessage } from '@/lib/api-error';

type Capabilities = {
  fbPrivateReply: boolean;
  fbPostPicker: boolean;
  fbPublicReply: boolean;
  igPrivateReply: boolean;
  igPostPicker: boolean;
  igPublicReply: boolean;
};
type TestPhase = { fb: boolean; ig: boolean };
type EmergencyStop = { stopped: boolean; reason?: string };
type RateLimits = { fbPerHour: number; igPerHour: number; publicReplyPerHour: number };

const KEYS = {
  capabilities: 'commentReply.capabilities',
  testPhase: 'commentReply.testPhase',
  emergencyStop: 'commentReply.emergencyStop',
  rateLimits: 'commentReply.rateLimits',
  logRetentionDays: 'commentReply.logRetentionDays',
} as const;

/** 沒有設定時的預設值（design D21） */
const DEFAULT_CAPABILITIES: Capabilities = {
  fbPrivateReply: false,
  fbPostPicker: false,
  fbPublicReply: false,
  igPrivateReply: false,
  igPostPicker: false,
  igPublicReply: false,
};
const DEFAULT_TEST_PHASE: TestPhase = { fb: true, ig: true };
const DEFAULT_RATE_LIMITS: RateLimits = { fbPerHour: 700, igPerHour: 700, publicReplyPerHour: 300 };
const DEFAULT_RETENTION_DAYS = 180;

const CAPABILITY_FIELDS: Array<{ key: keyof Capabilities; label: string }> = [
  { key: 'fbPrivateReply', label: 'Facebook 留言私訊' },
  { key: 'fbPostPicker', label: 'Facebook 貼文挑選' },
  { key: 'fbPublicReply', label: 'Facebook 公開回覆' },
  { key: 'igPrivateReply', label: 'Instagram 留言私訊' },
  { key: 'igPostPicker', label: 'Instagram 貼文挑選' },
  { key: 'igPublicReply', label: 'Instagram 公開回覆' },
];

const RATE_FIELDS: Array<{ key: keyof RateLimits; label: string }> = [
  { key: 'fbPerHour', label: 'Facebook 每小時私訊上限' },
  { key: 'igPerHour', label: 'Instagram 每小時私訊上限' },
  { key: 'publicReplyPerHour', label: '公開回覆每小時上限' },
];

/** 健康 API 的回應。design 沒有列出欄位名稱，這裡的名稱需與後端核對 */
interface HealthChannel {
  tenantId: string;
  tenantName?: string | null;
  channelId: string;
  channelType: string;
  displayName: string;
  appMode?: string | null;
  subscription?: { status?: string | null; checkedAt?: string | null } | null;
  tokenStatus?: string | null;
  lastCommentEventAt?: string | null;
  activeRules?: number | null;
  sent24h?: number | null;
  failed24h?: number | null;
  pending24h?: number | null;
  topFailureReason?: string | null;
}
interface Health {
  summary?: {
    matched24h?: number | null;
    sent24h?: number | null;
    failureRate24h?: number | null;
    queue?: Record<string, number> | null;
    oldestPendingAt?: string | null;
  } | null;
  channels: HealthChannel[];
}

function parseIntInRange(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= min && n <= max ? n : null;
}

function fmtTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

const SUBSCRIPTION_LABELS: Record<string, { text: string; tone: 'ok' | 'danger' | 'warn' | 'neutral' }> = {
  ok: { text: '正常', tone: 'ok' },
  missing: { text: '缺少留言欄位', tone: 'danger' },
  unknown: { text: '無法確認', tone: 'neutral' },
};

export default function CommentReplyPlatformPage() {
  const [capabilities, setCapabilities] = useState<Capabilities>(DEFAULT_CAPABILITIES);
  const [testPhase, setTestPhase] = useState<TestPhase>(DEFAULT_TEST_PHASE);
  const [emergency, setEmergency] = useState<EmergencyStop>({ stopped: false });
  const [savedStopped, setSavedStopped] = useState(false);
  const [rates, setRates] = useState<Record<keyof RateLimits, string>>({ fbPerHour: '700', igPerHour: '700', publicReplyPerHour: '300' });
  const [rateErrors, setRateErrors] = useState<Partial<Record<keyof RateLimits, string>>>({});
  const [retention, setRetention] = useState(String(DEFAULT_RETENTION_DAYS));
  const [retentionError, setRetentionError] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState('');

  const loadSettings = useCallback(async () => {
    const get = async <T,>(key: string): Promise<T | null> => {
      try {
        const res = await platformApi.get(`/settings/${key}`);
        return (res.data.data ?? null) as T | null;
      } catch {
        return null;
      }
    };
    const [cap, phase, stop, rate, days] = await Promise.all([
      get<Partial<Capabilities>>(KEYS.capabilities),
      get<Partial<TestPhase>>(KEYS.testPhase),
      get<EmergencyStop>(KEYS.emergencyStop),
      get<Partial<RateLimits>>(KEYS.rateLimits),
      get<number>(KEYS.logRetentionDays),
    ]);
    setCapabilities({ ...DEFAULT_CAPABILITIES, ...(cap ?? {}) });
    setTestPhase({ ...DEFAULT_TEST_PHASE, ...(phase ?? {}) });
    setEmergency({ stopped: stop?.stopped === true, reason: stop?.reason ?? '' });
    setSavedStopped(stop?.stopped === true);
    const r = { ...DEFAULT_RATE_LIMITS, ...(rate ?? {}) };
    setRates({ fbPerHour: String(r.fbPerHour), igPerHour: String(r.igPerHour), publicReplyPerHour: String(r.publicReplyPerHour) });
    setRetention(String(typeof days === 'number' ? days : DEFAULT_RETENTION_DAYS));
  }, []);

  const loadHealth = useCallback(async () => {
    setHealthError('');
    try {
      const res = await platformApi.get('/comment-reply/health');
      setHealth(res.data.data as Health);
    } catch (err) {
      setHealthError(getApiErrorMessage(err, '健康狀態載入失敗，請稍後重試'));
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadHealth();
  }, [loadSettings, loadHealth]);

  const put = async (key: string, value: unknown, successText: string) => {
    setSaving(key);
    setMsg(null);
    try {
      await platformApi.put(`/settings/${key}`, { value });
      setMsg({ ok: true, text: successText });
      return true;
    } catch (err) {
      setMsg({ ok: false, text: `儲存失敗：${getApiErrorMessage(err, '請稍後重試')}` });
      return false;
    } finally {
      setSaving(null);
    }
  };

  const saveEmergency = async () => {
    if (emergency.stopped && !savedStopped && !window.confirm('確定緊急停止所有租戶的留言自動私訊？60 秒內生效，排隊中的私訊會略過不送。')) return;
    const reason = (emergency.reason ?? '').trim().slice(0, 200);
    const value: EmergencyStop = emergency.stopped ? { stopped: true, ...(reason ? { reason } : {}) } : { stopped: false };
    if (await put(KEYS.emergencyStop, value, emergency.stopped ? '已開啟緊急停止' : '已解除緊急停止')) setSavedStopped(emergency.stopped);
  };

  const saveRates = async () => {
    const errs: Partial<Record<keyof RateLimits, string>> = {};
    const value = {} as RateLimits;
    for (const f of RATE_FIELDS) {
      const n = parseIntInRange(rates[f.key], 1, 30000);
      if (n === null) errs[f.key] = '請輸入 1～30000 的整數';
      else value[f.key] = n;
    }
    setRateErrors(errs);
    if (Object.keys(errs).length > 0) return;
    await put(KEYS.rateLimits, value, '已儲存限速');
  };

  const saveRetention = async () => {
    const n = parseIntInRange(retention, 30, 730);
    if (n === null) {
      setRetentionError('請輸入 30～730 的整數');
      return;
    }
    setRetentionError('');
    await put(KEYS.logRetentionDays, n, '已儲存保存天數');
  };

  const summary = health?.summary ?? null;
  const queueText = summary?.queue ? Object.entries(summary.queue).map(([k, v]) => `${k} ${v}`).join('、') : '—';

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1 style={pageTitle}>留言自動私訊</h1>
      <p style={pageDesc}>
        控制 Facebook／Instagram 留言自動私訊的開放範圍、緊急停止、限速與紀錄保存天數。設定儲存後約 60 秒內對所有租戶生效。
        租戶能不能使用另由方案的「留言自動私訊」功能決定（方案與上限）。
      </p>

      {msg && <div role={msg.ok ? 'status' : 'alert'} style={banner(msg.ok)}>{msg.text}</div>}

      <div style={{ display: 'grid', gap: 18 }}>
        <section style={card}>
          <h2 style={sectionTitle}>能力開關</h2>
          <p style={{ color: C.muted, fontSize: 13, margin: '0 0 12px' }}>Meta 審核通過哪一項就開哪一項；關閉私訊時，該平台的留言不建紀錄、排隊中的私訊會略過。</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {CAPABILITY_FIELDS.map((f) => (
              <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <input type="checkbox" checked={capabilities[f.key]} onChange={(e) => setCapabilities((c) => ({ ...c, [f.key]: e.target.checked }))} />
                {f.label}
              </label>
            ))}
          </div>
          <button type="button" style={{ ...btnPrimary, marginTop: 14 }} disabled={saving === KEYS.capabilities} onClick={() => put(KEYS.capabilities, capabilities, '已儲存能力開關')}>
            儲存能力開關
          </button>
        </section>

        <section style={card}>
          <h2 style={sectionTitle}>測試階段</h2>
          <p style={{ color: C.muted, fontSize: 13, margin: '0 0 12px' }}>
            只影響租戶頁面的「目前為測試階段」說明與錯誤對照，不會擋下收件或送出。只對平台模式的渠道有意義。
          </p>
          <div style={{ display: 'flex', gap: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={testPhase.fb} onChange={(e) => setTestPhase((t) => ({ ...t, fb: e.target.checked }))} />
              Facebook 測試階段
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={testPhase.ig} onChange={(e) => setTestPhase((t) => ({ ...t, ig: e.target.checked }))} />
              Instagram 測試階段
            </label>
          </div>
          <button type="button" style={{ ...btnPrimary, marginTop: 14 }} disabled={saving === KEYS.testPhase} onClick={() => put(KEYS.testPhase, testPhase, '已儲存測試階段')}>
            儲存測試階段
          </button>
        </section>

        <section style={{ ...card, borderColor: emergency.stopped ? C.danger : C.line }}>
          <h2 style={sectionTitle}>緊急停止</h2>
          <p style={{ color: C.muted, fontSize: 13, margin: '0 0 12px' }}>
            開啟後所有租戶的留言都不處理、排隊中的私訊略過不送；webhook 照常回應，私訊收發不受影響。
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: emergency.stopped ? C.danger : C.ink }}>
            <input type="checkbox" checked={emergency.stopped} onChange={(e) => setEmergency((s) => ({ ...s, stopped: e.target.checked }))} />
            緊急停止所有租戶的留言自動私訊
          </label>
          <div style={{ marginTop: 12, maxWidth: 480 }}>
            <label htmlFor="cr-emergency-reason" style={label}>暫停原因（選填）</label>
            <input
              id="cr-emergency-reason"
              style={input}
              maxLength={200}
              value={emergency.reason ?? ''}
              onChange={(e) => setEmergency((s) => ({ ...s, reason: e.target.value }))}
              placeholder="200 字內，只給平台內部看"
            />
          </div>
          <button type="button" style={{ ...btnPrimary, marginTop: 14, background: emergency.stopped ? C.danger : C.brand }} disabled={saving === KEYS.emergencyStop} onClick={saveEmergency}>
            儲存緊急停止
          </button>
        </section>

        <section style={card}>
          <h2 style={sectionTitle}>限速（每個渠道每小時）</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {RATE_FIELDS.map((f) => (
              <div key={f.key} style={{ width: 220 }}>
                <label htmlFor={`cr-rate-${f.key}`} style={label}>{f.label}</label>
                <input
                  id={`cr-rate-${f.key}`}
                  style={input}
                  inputMode="numeric"
                  value={rates[f.key]}
                  aria-invalid={Boolean(rateErrors[f.key])}
                  onChange={(e) => setRates((r) => ({ ...r, [f.key]: e.target.value }))}
                />
                {rateErrors[f.key] && <div style={{ color: C.danger, fontSize: 12, marginTop: 4 }}>{rateErrors[f.key]}</div>}
              </div>
            ))}
          </div>
          <button type="button" style={{ ...btnPrimary, marginTop: 14 }} disabled={saving === KEYS.rateLimits} onClick={saveRates}>
            儲存限速
          </button>
        </section>

        <section style={card}>
          <h2 style={sectionTitle}>觸發紀錄保存期限</h2>
          <div style={{ width: 220 }}>
            <label htmlFor="cr-retention" style={label}>觸發紀錄保存天數</label>
            <input id="cr-retention" style={input} inputMode="numeric" value={retention} aria-invalid={Boolean(retentionError)} onChange={(e) => setRetention(e.target.value)} />
            {retentionError && <div style={{ color: C.danger, fontSize: 12, marginTop: 4 }}>{retentionError}</div>}
          </div>
          <p style={{ color: C.muted, fontSize: 12.5, margin: '8px 0 0' }}>30～730 天，預設 180 天。超過天數的紀錄每小時分批刪除。</p>
          <button type="button" style={{ ...btnPrimary, marginTop: 14 }} disabled={saving === KEYS.logRetentionDays} onClick={saveRetention}>
            儲存保存天數
          </button>
        </section>

        <section style={card}>
          <h2 style={sectionTitle}>健康狀態</h2>
          {healthError && <div role="alert" style={banner(false)}>{healthError}</div>}
          {summary && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
              <span style={badge('neutral')}>{`命中 ${summary.matched24h ?? 0}`}</span>
              <span style={badge('ok')}>{`送出 ${summary.sent24h ?? 0}`}</span>
              <span style={badge((summary.failureRate24h ?? 0) > 0.2 ? 'danger' : 'neutral')}>{`失敗率 ${((summary.failureRate24h ?? 0) * 100).toFixed(1)}%`}</span>
              <span style={badge('neutral')}>{`佇列：${queueText}`}</span>
              <span style={badge(summary.oldestPendingAt ? 'warn' : 'neutral')}>{`最舊的處理中：${fmtTime(summary.oldestPendingAt)}`}</span>
              <span style={{ color: C.faint, fontSize: 12, alignSelf: 'center' }}>近 24 小時</span>
            </div>
          )}
          {health && health.channels.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>目前沒有開啟留言接收的渠道</p>}
          {health && health.channels.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={table} aria-label="開啟留言接收的渠道">
                <thead>
                  <tr>
                    <th style={th}>租戶</th>
                    <th style={th}>渠道</th>
                    <th style={th}>連結模式</th>
                    <th style={th}>訂閱</th>
                    <th style={th}>權杖</th>
                    <th style={th}>最後收到留言</th>
                    <th style={th}>啟用規則</th>
                    <th style={th}>24h 送出</th>
                    <th style={th}>24h 失敗</th>
                    <th style={th}>排隊</th>
                    <th style={th}>最常見失敗原因</th>
                  </tr>
                </thead>
                <tbody>
                  {health.channels.map((c) => {
                    const sub = SUBSCRIPTION_LABELS[c.subscription?.status ?? 'unknown'] ?? SUBSCRIPTION_LABELS.unknown;
                    return (
                      <tr key={c.channelId}>
                        <td style={td}>{c.tenantName ?? c.tenantId}</td>
                        <td style={td}>
                          <span style={{ color: C.faint, fontSize: 11, marginRight: 4 }}>{c.channelType === 'THREADS' ? 'IG' : 'FB'}</span>
                          <span>{c.displayName}</span>
                        </td>
                        <td style={td}>{c.appMode === 'own_app' ? '自備 App' : '平台'}</td>
                        <td style={td}>
                          <span style={badge(sub.tone)}>{sub.text}</span>
                          <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>{fmtTime(c.subscription?.checkedAt)}</div>
                        </td>
                        <td style={td}>{c.tokenStatus ?? '—'}</td>
                        <td style={td}>{fmtTime(c.lastCommentEventAt)}</td>
                        <td style={td}>{c.activeRules ?? 0}</td>
                        <td style={td}>{c.sent24h ?? 0}</td>
                        <td style={td}>{c.failed24h ?? 0}</td>
                        <td style={td}>{c.pending24h ?? 0}</td>
                        <td style={td}>{c.topFailureReason ? reasonLabel(c.topFailureReason) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
