'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2, Briefcase, Trash2 } from 'lucide-react';
import { CaseStatusBadge } from './CaseStatusBadge';
import { CasePriorityBadge } from './CasePriorityBadge';
import { SlaCountdown } from '@/components/shared/SlaCountdown';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: 'bg-destructive',
  HIGH: 'bg-warning',
  MEDIUM: 'bg-primary',
  LOW: 'bg-muted-foreground',
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
  onDelete?: (caseId: string) => Promise<void> | void;
  deletingCaseId?: string | null;
}

export function CaseList({ cases, isLoading, onDelete, deletingCaseId }: CaseListProps) {
  const router = useRouter();

  const handleDeleteClick = async (
    event: React.MouseEvent<HTMLButtonElement>,
    caseRecord: CaseListProps['cases'][number],
  ) => {
    event.stopPropagation();
    if (!onDelete) return;
    if (!window.confirm(`確定要刪除此工單「${caseRecord.title}」嗎？`)) return;
    await onDelete(caseRecord.id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
          <tr className="border-b bg-muted/50 text-left">
            <th className="w-1" />
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              ID
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              標題
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              聯繫人
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              分類
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              優先級
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              狀態
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              負責人
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              SLA
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              建立時間
            </th>
            {onDelete && (
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                操作
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr
              key={c.id}
              className="cursor-pointer border-b transition-colors hover:bg-muted/50 relative"
              onClick={() => router.push(`/dashboard/cases/${c.id}`)}
            >
              {/* Priority color bar */}
              <td className="w-1 p-0">
                <div className={`h-full w-1 ${PRIORITY_COLORS[c.priority] || 'bg-border'}`} />
              </td>
              <td className="px-4 py-3 text-sm font-mono text-muted-foreground">
                {c.id.slice(0, 8)}
              </td>
              <td className="px-4 py-3 text-sm font-medium max-w-[200px] truncate" title={c.title}>
                {c.title.length > 30 ? `${c.title.slice(0, 30)}…` : c.title}
              </td>
              <td className="px-4 py-3 text-sm">
                {c.contact?.displayName || c.contact?.name || '-'}
              </td>
              <td className="px-4 py-3 text-sm">{c.category ? `🤖 ${c.category}` : '-'}</td>
              <td className="px-4 py-3">
                <CasePriorityBadge priority={c.priority} />
              </td>
              <td className="px-4 py-3">
                <CaseStatusBadge status={c.status} />
              </td>
              <td className="px-4 py-3 text-sm">{c.assignee?.name || '未指派'}</td>
              <td className="px-4 py-3">
                <SlaCountdown deadline={c.slaDueAt || c.slaDeadline || null} />
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {format(new Date(c.createdAt), 'MMM d, HH:mm')}
              </td>
              {onDelete && (
                <td className="px-4 py-3 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={deletingCaseId === c.id}
                    onClick={(event) => handleDeleteClick(event, c)}
                    aria-label={`刪除工單 ${c.title}`}
                  >
                    {deletingCaseId === c.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
