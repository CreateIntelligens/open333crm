'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2, Briefcase } from 'lucide-react';
import { CaseStatusBadge } from './CaseStatusBadge';
import { CasePriorityBadge } from './CasePriorityBadge';
import { SlaCountdown } from '@/components/shared/SlaCountdown';
import { EmptyState } from '@/components/shared/EmptyState';

const PRIORITY_BAR: Record<string, string> = {
  URGENT: 'bg-f-red-60',
  HIGH: 'bg-f-orange-60',
  MEDIUM: 'bg-f-lime-60',
  LOW: 'bg-neutral-50',
};

interface CaseListProps {
  cases: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    category?: string;
    contact?: { id: string; displayName?: string; name?: string };
    assignee?: { id: string; name: string };
    slaDueAt?: string;
    slaDeadline?: string;
    createdAt: string;
  }>;
  isLoading: boolean;
}

export function CaseList({ cases, isLoading }: CaseListProps) {
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-ink-subtle" />
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <EmptyState
        icon={<Briefcase className="h-12 w-12" />}
        title="找不到工單"
        description="建立後工單將顯示在這裡"
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-surface-line bg-surface-canvas text-left">
            <th className="w-1" />
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              ID
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              標題
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              聯繫人
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              分類
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              優先級
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              狀態
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              負責人
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              SLA
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              建立時間
            </th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr
              key={c.id}
              className="cursor-pointer border-b border-surface-line transition-colors hover:bg-neutral-20"
              onClick={() => router.push(`/dashboard/cases/${c.id}`)}
            >
              {/* Priority color bar */}
              <td className="w-1 p-0">
                <div className={`h-full w-1 ${PRIORITY_BAR[c.priority.toUpperCase()] || 'bg-neutral-50'}`} />
              </td>
              <td className="px-4 py-3 font-mono text-[13px] text-ink-subtle">
                {c.id.slice(0, 8)}
              </td>
              <td className="max-w-[240px] truncate px-4 py-3 text-[14px] font-medium text-ink" title={c.title}>
                {c.title.length > 30 ? `${c.title.slice(0, 30)}…` : c.title}
              </td>
              <td className="px-4 py-3 text-[14px] text-ink">
                {c.contact?.displayName || c.contact?.name || '-'}
              </td>
              <td className="px-4 py-3 text-[14px] text-ink-subtle">
                {c.category ? (
                  <span className="inline-flex items-center gap-1">
                    <span aria-hidden>🤖</span>
                    {c.category}
                  </span>
                ) : (
                  '-'
                )}
              </td>
              <td className="px-4 py-3">
                <CasePriorityBadge priority={c.priority} />
              </td>
              <td className="px-4 py-3">
                <CaseStatusBadge status={c.status} />
              </td>
              <td className="px-4 py-3 text-[14px] text-ink">
                {c.assignee?.name || (
                  <span className="text-ink-subtle">未指派</span>
                )}
              </td>
              <td className="px-4 py-3">
                <SlaCountdown deadline={c.slaDueAt || c.slaDeadline || null} />
              </td>
              <td className="px-4 py-3 text-[13px] text-ink-subtle">
                {format(new Date(c.createdAt), 'MMM d, HH:mm')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
