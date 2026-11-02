import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'open333CRM',
  description: '多渠道客服管理系統',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
