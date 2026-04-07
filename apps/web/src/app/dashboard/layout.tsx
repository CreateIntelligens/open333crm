'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SWRConfig } from 'swr';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { SocketProvider } from '@/providers/SocketProvider';
import { Sidebar } from '@/components/layout/Sidebar';
import { SimulatorPanel } from '@/components/shared/SimulatorPanel';
import { Loader2 } from 'lucide-react';

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { agent, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !agent) {
      router.push('/login');
    }
  }, [isLoading, agent, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!agent) {
    return null;
  }

  return (
    <SocketProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
      <SimulatorPanel />
    </SocketProvider>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <SWRConfig value={{ revalidateOnFocus: false, revalidateOnReconnect: false }}>
        <DashboardShell>{children}</DashboardShell>
      </SWRConfig>
    </AuthProvider>
  );
}
