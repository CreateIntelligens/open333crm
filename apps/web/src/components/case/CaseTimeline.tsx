'use client';

import React, { useState } from 'react';
import { format } from 'date-fns';
import {
  Clock,
  User,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RotateCcw,
  MessageSquare,
  StickyNote,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const STATUS_LABELS: Record<string, string> = {
  OPEN: '開啟',
  IN_PROGRESS: '處理中',
  PENDING: '待處理',
  RESOLVED: '已解決',
  ESCALATED: '已升級',
  CLOSED: '已關閉',
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  URGENT: '緊急',
};

function formatEventDescription(
  eventType: string,
  payload?: Record<string, unknown>,
): string {
  switch (eventType) {
    case 'created':
      return `建立了案件${payload?.title ? `「${payload.title}」` : ''}`;
    case 'status_changed': {
      const from = STATUS_LABELS[payload?.from as string] || payload?.from || '?';
      const to = STATUS_LABELS[payload?.to as string] || payload?.to || '?';
      return `狀態：${from} → ${to}`;
    }
    case 'assigned':
      return `指派給 ${payload?.assigneeName || '未知'}`;
    case 'escalated': {
      const prev = PRIORITY_LABELS[payload?.previousPriority as string] || payload?.previousPriority;
      const next = PRIORITY_LABELS[payload?.newPriority as string] || payload?.newPriority;
      const reason = payload?.reason ? `，原因：${payload.reason}` : '';
      return `案件升級（${prev} → ${next}${reason}）`;
    }
    case 'priority_changed': {
      const from = PRIORITY_LABELS[payload?.from as string] || payload?.from;
      const to = PRIORITY_LABELS[payload?.to as string] || payload?.to;
      return `優先級：${from} → ${to}`;
    }
    case 'resolved':
      return '案件已解決';
    case 'closed':
      return '案件已關閉';
    case 'reopened':
      return '案件已重新開啟';
    default:
      return eventType;
  }
}

interface CaseTimelineProps {
  caseId: string;
  events: Array<{
    id: string;
    type: string;
    eventType?: string;
    description?: string;
    content?: string;
    payload?: Record<string, unknown>;
    isInternal?: boolean;
    createdBy?: string;
    agentName?: string;
    actor?: { id: string; name: string };
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>;
  notes?: Array<{
    id: string;
    content: string;
    isInternal: boolean;
    agentName?: string;
    createdAt: string;
  }>;
  onRefresh: () => void;
}

const eventIcons: Record<string, React.ReactNode> = {
  created: <Clock className="h-4 w-4" />,
  assigned: <User className="h-4 w-4" />,
  escalated: <AlertTriangle className="h-4 w-4" />,
  resolved: <CheckCircle className="h-4 w-4" />,
  closed: <XCircle className="h-4 w-4" />,
  reopened: <RotateCcw className="h-4 w-4" />,
  note: <StickyNote className="h-4 w-4" />,
  message: <MessageSquare className="h-4 w-4" />,
  status_changed: <Clock className="h-4 w-4" />,
};

export function CaseTimeline({ caseId, events, notes, onRefresh }: CaseTimelineProps) {
  const [noteContent, setNoteContent] = useState('');
  const [isInternal, setIsInternal] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleAddNote = async () => {
    if (!noteContent.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/cases/${caseId}/notes`, {
        content: noteContent.trim(),
        isInternal,
      });
      setNoteContent('');
      onRefresh();
    } catch (err) {
      console.error('Failed to add note:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Combine events and notes into a single timeline
  const allItems = [
    ...(events || []).map((e) => {
      const evtType = e.eventType || e.type || 'event';
      const payload = (e.payload || e.metadata || {}) as Record<string, unknown>;
      return {
        id: e.id,
        type: evtType,
        content: formatEventDescription(evtType, payload),
        isInternal: e.isInternal || false,
        author: e.actor?.name || e.agentName || e.createdBy || 'System',
        createdAt: e.createdAt,
        isNote: false,
      };
    }),
    ...(notes || []).map((n) => ({
      id: n.id,
      type: 'note',
      content: n.content,
      isInternal: n.isInternal,
      author: n.agentName || 'Agent',
      createdAt: n.createdAt,
      isNote: true,
    })),
  ].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="space-y-4">
      {/* Add Note Form */}
      <div className="rounded-lg border p-4">
        <h4 className="mb-2 text-sm font-semibold">新增備註</h4>
        <Textarea
          value={noteContent}
          onChange={(e) => setNoteContent(e.target.value)}
          placeholder="撰寫備註..."
          rows={3}
        />
        <div className="mt-2 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isInternal}
              onChange={(e) => setIsInternal(e.target.checked)}
              className="rounded border-input"
            />
            內部備註
          </label>
          <Button
            size="sm"
            onClick={handleAddNote}
            disabled={!noteContent.trim() || submitting}
          >
            {submitting ? '新增中...' : '新增備註'}
          </Button>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative space-y-0">
        {allItems.map((item, idx) => (
          <div key={item.id} className="relative flex gap-3 pb-4">
            {/* Line connector */}
            {idx < allItems.length - 1 && (
              <div className="absolute left-[15px] top-8 h-full w-px bg-border" />
            )}
            {/* Icon */}
            <div
              className={cn(
                'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                item.isNote
                  ? item.isInternal
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-blue-100 text-blue-700'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {eventIcons[item.type] || <Clock className="h-4 w-4" />}
            </div>
            {/* Content */}
            <div className="flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{item.author}</span>
                {item.isNote && item.isInternal && (
                  <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700">
                    內部
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {format(new Date(item.createdAt), 'MMM d, HH:mm')}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{item.content}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
