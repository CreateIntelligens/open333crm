'use client';

import React from 'react';
import { format } from 'date-fns';
import {
  MessageSquare,
  Briefcase,
  Tag,
  Clock,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimelineEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface ContactTimelineProps {
  events: TimelineEvent[];
}

const CHANNEL_LABELS: Record<string, string> = {
  LINE: 'LINE',
  FACEBOOK: 'Facebook',
  WEBCHAT: 'WebChat',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  API: 'API',
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: '開啟',
  IN_PROGRESS: '處理中',
  PENDING: '待處理',
  RESOLVED: '已解決',
  ESCALATED: '已升級',
  CLOSED: '已關閉',
};

function formatTimelineDescription(event: TimelineEvent): string {
  const d = event.data;
  switch (event.type) {
    case 'conversation':
      return `新對話 · ${CHANNEL_LABELS[d.channelType as string] || d.channelType} · ${d.channelName || ''}`;
    case 'case':
      return `建立案件「${d.title || ''}」· ${STATUS_LABELS[d.status as string] || d.status}`;
    case 'case_event': {
      const et = d.eventType as string;
      const payload = (d.payload || {}) as Record<string, unknown>;
      if (et === 'status_changed') {
        const from = STATUS_LABELS[payload.from as string] || payload.from;
        const to = STATUS_LABELS[payload.to as string] || payload.to;
        return `案件「${d.caseTitle || ''}」狀態：${from} → ${to}`;
      }
      if (et === 'assigned') { return `案件「${d.caseTitle || ''}」指派給 ${payload.assigneeName || ''}`; }
      if (et === 'escalated') { return `案件「${d.caseTitle || ''}」已升級`; }
      if (et === 'created') { return `案件「${d.caseTitle || ''}」已建立`; }
      return `案件事件：${et}`;
    }
    case 'tag':
      return `標籤「${d.tagName || ''}」已加入`;
    default:
      return event.type;
  }
}

const eventIcons: Record<string, React.ReactNode> = {
  conversation: <MessageSquare className="h-4 w-4" />,
  case: <Briefcase className="h-4 w-4" />,
  case_event: <Briefcase className="h-4 w-4" />,
  tag: <Tag className="h-4 w-4" />,
  tag_added: <Tag className="h-4 w-4" />,
  tag_removed: <Tag className="h-4 w-4" />,
  created: <User className="h-4 w-4" />,
  message: <MessageSquare className="h-4 w-4" />,
};

const eventColors: Record<string, string> = {
  conversation: 'bg-blue-100 text-blue-700',
  case: 'bg-purple-100 text-purple-700',
  case_event: 'bg-purple-50 text-purple-600',
  tag: 'bg-green-100 text-green-700',
  tag_added: 'bg-green-100 text-green-700',
  tag_removed: 'bg-red-100 text-red-700',
  created: 'bg-gray-100 text-gray-700',
  message: 'bg-blue-100 text-blue-700',
};

export function ContactTimeline({ events }: ContactTimelineProps) {
  if (!events || events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        尚無活動記錄
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {events.map((event, idx) => {
        const eventId = (event.data?.id as string) || `${event.type}-${idx}`;
        const ts = event.timestamp;
        const dateObj = ts ? new Date(ts) : null;
        const isValidDate = dateObj && !Number.isNaN(dateObj.getTime());

        return (
          <div key={eventId} className="relative flex gap-3 pb-4">
            {/* Line connector */}
            {idx < events.length - 1 && (
              <div className="absolute left-[15px] top-8 h-full w-px bg-border" />
            )}
            {/* Icon */}
            <div
              className={cn(
                'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                eventColors[event.type] || 'bg-muted text-muted-foreground'
              )}
            >
              {eventIcons[event.type] || <Clock className="h-4 w-4" />}
            </div>
            {/* Content */}
            <div className="flex-1 pt-0.5">
              <p className="text-sm">
                {formatTimelineDescription(event)}
              </p>
              <p className="text-xs text-muted-foreground">
                {isValidDate ? format(dateObj, 'MMM d, yyyy HH:mm') : ''}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
