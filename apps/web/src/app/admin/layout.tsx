'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getPlatformToken, setPlatformToken } from './lib/platform-api';

const NAV = [
  { href: '/admin/plans', label: '方案與上限' },
  { href: '/admin/tenants', label: '租戶管理' },
  { href: '/admin/usage', label: '用量統計' },
  { href: '/admin/trial', label: '試用管理' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    if (isLoginPage) {
      setReady(true);
      return;
    }
    if (!getPlatformToken()) {
      router.replace('/admin/login');
      return;
    }
    setReady(true);
  }, [isLoginPage, router]);

  if (!ready) return null;
  if (isLoginPage) return <>{children}</>;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'system-ui, sans-serif' }}>
      <aside
        style={{
          width: 220,
          background: '#0d9488',
          color: '#fff',
          padding: '20px 14px',
          flexShrink: 0,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>平台控制台</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              style={{
                padding: '9px 12px',
                borderRadius: 8,
                color: '#fff',
                textDecoration: 'none',
                background: pathname === n.href ? 'rgba(255,255,255,.18)' : 'transparent',
                fontWeight: pathname === n.href ? 600 : 400,
              }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => {
            setPlatformToken(null);
            router.replace('/admin/login');
          }}
          style={{
            marginTop: 24,
            background: 'transparent',
            border: '1px solid rgba(255,255,255,.4)',
            color: '#fff',
            borderRadius: 8,
            padding: '7px 12px',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          登出
        </button>
      </aside>
      <main style={{ flex: 1, padding: 28, background: '#f4f6f9', overflow: 'auto' }}>{children}</main>
    </div>
  );
}
