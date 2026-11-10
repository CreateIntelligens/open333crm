'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { platformApi } from '../../lib/platform-api';
import {
  C, card, pageTitle, sectionTitle, input, label, focusRing,
  btnPrimary, primaryHover, btnSecondary, secondaryHover, badge, banner,
} from '../../lib/ui';
import { AuditLogTable } from '../../lib/AuditLogTable';
import type { PlatformAuditEntry } from '../../lib/audit-log';

interface PlatformUserDetail {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

function fmtDateTime(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '—';
}

export default function PlatformUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<PlatformUserDetail | null>(null);
  const [logs, setLogs] = useState<PlatformAuditEntry[]>([]);
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '' });

  const load = useCallback(async () => {
    const [userRes, logsRes] = await Promise.all([
      platformApi.get(`/platform-users/${id}`),
      platformApi.get(`/platform-users/${id}/audit-logs`),
    ]);
    const u: PlatformUserDetail = userRes.data.data;
    setUser(u);
    setForm({ name: u.name, email: u.email });
    setLogs(logsRes.data.data);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const showError = (err: unknown, fallback: string) => {
    setMsgOk(false);
    setMsg(
      (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? fallback,
    );
  };

  const saveBasic = async () => {
    if (!user) return;
    setSaving(true);
    setMsg('');
    try {
      await platformApi.patch(`/platform-users/${user.id}`, { name: form.name.trim(), email: form.email.trim() });
      setMsgOk(true);
      setMsg('基本資料已儲存');
      await load();
    } catch (err: unknown) {
      showError(err, '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!user) return;
    setSaving(true);
    setMsg('');
    try {
      await platformApi.patch(`/platform-users/${user.id}/active`, { isActive: !user.isActive });
      setMsgOk(true);
      setMsg(user.isActive ? '已停用帳號' : '已啟用帳號');
      await load();
    } catch (err: unknown) {
      showError(err, '狀態切換失敗');
    } finally {
      setSaving(false);
    }
  };

  const resendWelcome = async () => {
    if (!user) return;
    setSaving(true);
    setMsg('');
    try {
      await platformApi.post(`/platform-users/${user.id}/resend-welcome`);
      setMsgOk(true);
      setMsg(`開通信已重寄至 ${user.email}（系統已產生新的臨時密碼，舊密碼已失效）`);
      await load();
    } catch (err: unknown) {
      showError(err, '開通信重寄失敗');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return <p style={{ color: C.faint, fontSize: 13 }}>載入中…</p>;
  }

  return (
    <div style={{ maxWidth: 780 }}>
      <p style={{ marginBottom: 14 }}>
        <Link href="/admin/platform-users" style={{ color: C.brand, fontSize: 13, textDecoration: 'none', fontWeight: 500 }}>
          ← 返回平台帳號
        </Link>
      </p>

      {/* 帳號 header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
        <div style={avatar}>{user.name.slice(0, 1).toUpperCase()}</div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ ...pageTitle, fontSize: 21 }}>{user.name}</h1>
            <span style={badge(user.isActive ? 'ok' : 'danger')}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: user.isActive ? C.ok : C.danger, display: 'inline-block' }} />
              {user.isActive ? '啟用中' : '已停用'}
            </span>
            {user.mustChangePassword && <span style={badge('warn')}>使用臨時密碼中，尚未改密碼</span>}
          </div>
          <p style={{ color: C.muted, fontSize: 13, margin: '4px 0 0' }}>
            {user.email}｜建立於 {fmtDateTime(user.createdAt)}｜最後登入 {fmtDateTime(user.lastLoginAt)}
          </p>
        </div>
      </div>

      <div style={{ height: 18 }} />
      {msg && <div style={banner(msgOk)}>{msg}</div>}

      {/* 基本資料 */}
      <div style={{ ...card, maxWidth: 460 }}>
        <h2 style={sectionTitle}>基本資料</h2>
        <div style={{ marginBottom: 14 }}>
          <label style={label}>姓名</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} {...focusRing} />
        </div>
        <div>
          <label style={label}>Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            style={input}
            {...focusRing}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <button
            onClick={saveBasic}
            disabled={saving || !form.name.trim() || !form.email.trim()}
            style={{ ...btnPrimary, opacity: saving || !form.name.trim() || !form.email.trim() ? 0.5 : 1 }}
            {...primaryHover}
          >
            儲存
          </button>
          <button onClick={resendWelcome} disabled={saving} style={btnSecondary} {...secondaryHover}>
            重寄開通信
          </button>
          <button
            onClick={toggleActive}
            disabled={saving}
            style={{ ...btnSecondary, color: user.isActive ? C.danger : C.ok }}
            {...secondaryHover}
          >
            {user.isActive ? '停用帳號' : '啟用帳號'}
          </button>
        </div>
      </div>

      {/* 操作紀錄（動作名稱與對象顯示規則與租戶詳細頁共用） */}
      <AuditLogTable logs={logs} />
    </div>
  );
}

const avatar: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 12,
  background: `linear-gradient(135deg, ${C.brand}, ${C.brandDark})`,
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 18,
  fontWeight: 700,
  flexShrink: 0,
  boxShadow: '0 2px 6px rgba(13,148,136,.3)',
};
