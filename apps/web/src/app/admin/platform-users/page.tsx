'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { platformApi } from '../lib/platform-api';
import {
  C, card, pageTitle, pageDesc, sectionTitle, input, label, focusRing,
  btnPrimary, primaryHover, badge, table, th, td, banner,
} from '../lib/ui';

interface PlatformUser {
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

export default function PlatformUsersPage() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);
  const [form, setForm] = useState({ email: '', name: '' });
  const [creating, setCreating] = useState(false);
  const [hoverRow, setHoverRow] = useState<string | null>(null);

  const load = async () => {
    const res = await platformApi.get('/platform-users');
    setUsers(res.data.data);
  };
  useEffect(() => {
    load();
  }, []);

  const showError = (err: unknown, fallback: string) => {
    setMsgOk(false);
    setMsg(
      (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? fallback,
    );
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setMsg('');
    try {
      const res = await platformApi.post('/platform-users', form);
      const loginUrl: string | undefined = res.data.data?.loginUrl;
      setMsgOk(true);
      setMsg(
        `已開通「${form.name}」，系統已產生臨時密碼並寄信至 ${form.email}` +
          (loginUrl ? `；登入網址：${loginUrl}` : '') +
          '（對方需於首次登入後設定新密碼）',
      );
      setForm({ email: '', name: '' });
      await load();
    } catch (err: unknown) {
      showError(err, '開通失敗');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ maxWidth: 1080 }}>
      <h1 style={pageTitle}>平台帳號</h1>
      <p style={pageDesc}>管理平台後台管理員帳號 — 開通、停用/啟用、重寄開通信。</p>

      {msg && <div style={banner(msgOk)}>{msg}</div>}

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>姓名</th>
              <th style={th}>Email</th>
              <th style={th}>狀態</th>
              <th style={th}>最後登入</th>
              <th style={th}>建立時間</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                onMouseEnter={() => setHoverRow(u.id)}
                onMouseLeave={() => setHoverRow(null)}
                style={{ background: hoverRow === u.id ? C.bg : 'transparent', transition: 'background .12s' }}
              >
                <td style={td}>
                  <Link
                    href={`/admin/platform-users/${u.id}`}
                    style={{ color: C.brand, fontWeight: 600, textDecoration: 'none' }}
                  >
                    {u.name}
                  </Link>
                </td>
                <td style={{ ...td, color: C.muted }}>{u.email}</td>
                <td style={td}>
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={badge(u.isActive ? 'ok' : 'danger')}>
                      <Dot color={u.isActive ? C.ok : C.danger} />
                      {u.isActive ? '啟用' : '停用'}
                    </span>
                    {u.mustChangePassword && <span style={badge('warn')}>待改密碼</span>}
                  </span>
                </td>
                <td style={{ ...td, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{fmtDateTime(u.lastLoginAt)}</td>
                <td style={{ ...td, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{fmtDateTime(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...card, marginTop: 24, maxWidth: 440 }}>
        <h2 style={sectionTitle}>開通新平台帳號</h2>
        <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={label}>姓名</label>
            <input
              placeholder="王小明"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              style={input}
              {...focusRing}
            />
          </div>
          <div>
            <label style={label}>Email</label>
            <input
              placeholder="name@example.com"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              style={input}
              {...focusRing}
            />
          </div>
          <div style={{ padding: '10px 12px', background: C.brandSoft, borderRadius: 9, border: `1px solid rgba(13,148,136,.18)` }}>
            <p style={{ fontSize: 12.5, color: C.body, margin: 0, lineHeight: 1.6 }}>
              密碼由系統自動產生並寄至上方 Email，對方登入後需立即設定新密碼。
            </p>
          </div>
          <button type="submit" disabled={creating} style={{ ...btnPrimary, opacity: creating ? 0.6 : 1 }} {...primaryHover}>
            {creating ? '開通中…' : '開通帳號'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span style={{ width: 6, height: 6, borderRadius: 999, background: color, display: 'inline-block' }} />;
}
