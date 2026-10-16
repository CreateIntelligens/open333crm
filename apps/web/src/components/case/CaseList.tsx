'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2, Briefcase } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { DeleteIcon } from '@/components/icons/figma-icons';
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

  // 欄位與欄寬依 Claude Design「工單管理」：ID、標題（含優先級色條）、聯繫人、分類、優先級、狀態、負責人、SLA、建立時間、操作
  const cols = onDelete
    ? 'grid-cols-[110px_minmax(240px,1.5fr)_140px_110px_100px_110px_130px_150px_120px_90px]'
    : 'grid-cols-[110px_minmax(240px,1.5fr)_140px_110px_100px_110px_130px_150px_120px]';

  return (
    <div role="table" aria-label="工單列表" className="overflow-x-auto rounded-lg border border-border">
      <div className="min-w-[1360px]">
        <div role="row" className={`grid ${cols} items-center gap-3 border-b border-border bg-muted px-5 py-2 text-sm font-medium leading-7 text-muted-foreground`}>
          <span role="columnheader">ID</span>
          <span role="columnheader">標題</span>
          <span role="columnheader">聯繫人</span>
          <span role="columnheader">分類</span>
          <span role="columnheader">優先級</span>
          <span role="columnheader">狀態</span>
          <span role="columnheader">負責人</span>
          <span role="columnheader">SLA</span>
          <span role="columnheader">建立時間</span>
          {onDelete && <span role="columnheader" className="text-right">操作</span>}
        </div>
        {cases.map((c) => {
          const contactName = c.contact?.displayName || c.contact?.name || '';
          const created = new Date(c.createdAt);
          const open = () => router.push(`/dashboard/cases/${c.id}`);
          return (
            <div
              key={c.id}
              role="row"
              tabIndex={0}
              onClick={open}
              onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
              className={`grid ${cols} cursor-pointer items-center gap-3 border-b border-border bg-background px-5 py-3.5 text-sm transition-colors last:border-b-0 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none`}
            >
              <span role="cell" className="truncate font-mono text-xs text-muted-foreground" title={c.id}>{c.id.slice(0, 8)}</span>
              <span role="cell" className="flex min-w-0 items-center gap-2.5">
                {/* 優先級色條 */}
                <span className={`h-8 w-1 flex-none rounded-full ${PRIORITY_COLORS[c.priority] || 'bg-border'}`} aria-hidden="true" />
                <span className="truncate font-semibold text-foreground" title={c.title}>{c.title}</span>
              </span>
              <span role="cell" className="flex min-w-0 items-center gap-2">
                {contactName ? (
                  <>
                    <Avatar alt={contactName} size="sm" className="h-6 w-6 text-[11px]" />
                    <span className="truncate text-foreground">{contactName}</span>
                  </>
                ) : <span className="text-muted-foreground">—</span>}
              </span>
              <span role="cell" className="truncate text-muted-foreground">{c.category || '—'}</span>
              <span role="cell"><CasePriorityBadge priority={c.priority} /></span>
              <span role="cell"><CaseStatusBadge status={c.status} /></span>
              <span role="cell" className="flex min-w-0 items-center gap-2">
                {c.assignee?.name ? (
                  <>
                    <Avatar alt={c.assignee.name} size="sm" className="h-6 w-6 text-[11px]" />
                    <span className="truncate text-foreground">{c.assignee.name}</span>
                  </>
                ) : <span className="text-muted-foreground">未指派</span>}
              </span>
              <span role="cell"><SlaCountdown deadline={c.slaDueAt || c.slaDeadline || null} /></span>
              <span role="cell" className="flex flex-col text-xs leading-4 tabular-nums">
                <span className="text-foreground">{format(created, 'yyyy/MM/dd')}</span>
                <span className="text-muted-foreground">{format(created, 'HH:mm')}</span>
              </span>
              {onDelete && (
                <span role="cell" className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    disabled={deletingCaseId === c.id}
                    onClick={(event) => handleDeleteClick(event, c)}
                    aria-label={`刪除工單 ${c.title}`}
                    title="刪除工單"
                  >
                    {deletingCaseId === c.id ? <Loader2 className="animate-spin" /> : <DeleteIcon />}
                  </Button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
