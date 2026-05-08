'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ExternalLink, Plus, Bot, Star, FileText, ChevronDown } from 'lucide-react';
import api from '@/lib/api';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ChannelBadge } from '@/components/shared/ChannelBadge';
import { CaseCreateModal } from '@/components/case/CaseCreateModal';
import { CustomerInfoRow } from '@/components/contact/CustomerInfoRow';
import { useMessages } from '@/hooks/useMessages';
import { cn } from '@/lib/utils';

interface ContactInfoPanelProps {
  conversation: {
    id: string;
    status?: string;
    botRepliesCount?: number;
    assignedToId?: string | null;
    contact?: {
      id: string;
      name?: string;
      displayName?: string;
      phone?: string;
      email?: string;
      avatar?: string;
      avatarUrl?: string;
      channelIdentities?: Array<{
        id: string;
        channelType: string;
        externalId: string;
        displayName?: string;
      }>;
      tags?: Array<{
        id: string;
        name: string;
        color?: string;
      }>;
      attributes?: Array<{
        id: string;
        key: string;
        value: string;
      }>;
    };
    channelType: string;
    case?: {
      id: string;
      title: string;
      status: string;
      priority: string;
      csatScore?: number;
      firstResponseAt?: string;
      resolvedAt?: string;
      closedAt?: string;
    };
  } | null;
}

const CASE_STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  OPEN: { bg: 'bg-surface-active', text: 'text-link', label: 'OPEN' },
  IN_PROGRESS: { bg: 'bg-[#FFF0E4]', text: 'text-[#FF6E00]', label: 'IN_PROGRESS' },
  RESOLVED: { bg: 'bg-f-green-10', text: 'text-f-green-80', label: 'RESOLVED' },
  CLOSED: { bg: 'bg-neutral-30', text: 'text-ink-subtle', label: 'CLOSED' },
};

const PRIORITY_STYLE: Record<string, string> = {
  LOW: 'text-ink-subtle',
  NORMAL: 'text-ink',
  HIGH: 'text-f-orange-80',
  URGENT: 'text-[#EE3134]',
};

const PRIORITY_LABEL: Record<string, string> = {
  LOW: '低',
  NORMAL: '中',
  HIGH: '高',
  URGENT: '緊急',
};

function CustomerProfileSection({
  conversation,
  contact,
}: {
  conversation: NonNullable<ContactInfoPanelProps['conversation']>;
  contact: Record<string, unknown>;
}) {
  const channelIdentities = contact.channelIdentities as Array<{
    id: string;
    channelType: string;
    externalId: string;
    displayName?: string;
  }> | undefined;
  const tags = contact.tags as Array<{ id: string; name: string; color?: string }> | undefined;
  const attributes = contact.attributes as Array<{ id: string; key: string; value: string }> | undefined;

  const items = (attributes || []).map((a) => ({ label: a.key, value: a.value }));

  const tagItems = (tags || [])
    .filter((t) => t && typeof t.name === 'string')
    .map((t) => {
      const name = t.name;
      const v: 'identity' | 'alert' | 'topic' = name.includes('VIP')
        ? 'identity'
        : name.includes('投訴') || name.includes('Alert')
          ? 'alert'
          : 'topic';
      return { label: name, variant: v };
    });

  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-surface-line p-4">
      <div className="flex items-center gap-3 py-2 pl-0 pr-4">
        <Avatar
          alt={conversation.contact?.name || conversation.contact?.displayName || '聯繫人'}
          src={conversation.contact?.avatar || conversation.contact?.avatarUrl}
          size="md"
          className="h-10 w-10 shrink-0 ring-1 ring-neutral-30"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate text-[16px] font-semibold leading-5 text-ink">
            {conversation.contact?.name || conversation.contact?.displayName || '未知'}
          </h3>
          {channelIdentities && channelIdentities.length > 0 ? (
            <div className="mt-1 flex items-center gap-1.5">
              {channelIdentities.slice(0, 3).map((ci, i) => (
                <React.Fragment key={ci.id}>
                  {i > 0 && <span className="text-ink-subtle">．</span>}
                  <ChannelBadge channel={ci.channelType} />
                </React.Fragment>
              ))}
            </div>
          ) : (
            <div className="mt-1">
              <ChannelBadge channel={conversation.channelType} />
            </div>
          )}
        </div>
      </div>

      <CustomerInfoRow
        contact={conversation.contact?.phone ? { value: conversation.contact.phone } : undefined}
        tags={tagItems.length > 0 ? tagItems : undefined}
        items={items.length > 0 ? items : undefined}
      />
    </div>
  );
}

interface BotMetrics {
  hasBotActivity: boolean;
  repliesCount: number;
  maxConfidence: number | null;
  mode: string;
}

function getBotMetrics(
  conversation: NonNullable<ContactInfoPanelProps['conversation']>,
  messages: Array<{ senderType?: string; metadata?: Record<string, unknown> }>,
): BotMetrics {
  const botMessages = messages.filter((m) => m.senderType === 'BOT');
  const repliesCount =
    typeof conversation.botRepliesCount === 'number' && conversation.botRepliesCount > 0
      ? conversation.botRepliesCount
      : botMessages.length;
  let maxConfidence: number | null = null;
  for (const m of botMessages) {
    const c = m.metadata?.confidence;
    if (typeof c === 'number' && (maxConfidence === null || c > maxConfidence)) {
      maxConfidence = c;
    }
  }
  return {
    hasBotActivity: repliesCount > 0,
    repliesCount,
    maxConfidence,
    mode: '關鍵字+LLM',
  };
}

function BotStatusSection({ metrics }: { metrics: BotMetrics }) {
  const pct = metrics.maxConfidence != null ? Math.round(metrics.maxConfidence * 100) : null;
  const barColor =
    pct == null
      ? 'bg-neutral-50'
      : pct >= 80
        ? 'bg-f-green-60'
        : pct >= 50
          ? 'bg-f-orange-60'
          : 'bg-f-red-60';

  return (
    <div className="flex shrink-0 flex-col gap-3 border-b border-surface-line p-4">
      <div className="flex items-center gap-4">
        <h4 className="text-[16px] font-medium leading-6 text-ink">Bot 狀態</h4>
        <span className="inline-flex items-center rounded-chip bg-brand-10 px-2 py-0.5 text-[11px] font-semibold text-brand-80">
          BOT_HANDLED
        </span>
      </div>
      <div className="flex flex-col gap-2 rounded-card border border-surface-line bg-surface-canvas p-4">
        <div className="flex items-center justify-between text-[14px] leading-5">
          <span className="text-ink-subtle">模式</span>
          <span className="font-medium text-link">{metrics.mode}</span>
        </div>
        <div className="flex items-center justify-between text-[14px] leading-5">
          <span className="text-ink-subtle">Bot 已回覆次數</span>
          <span className="font-medium text-link">{metrics.repliesCount} 次</span>
        </div>
        <div className="flex items-center justify-between text-[14px] leading-5">
          <span className="text-ink-subtle">最高信心值</span>
          <span className="font-medium text-link">{pct != null ? `${pct}%` : '—'}</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-line">
          <div
            className={cn('h-full rounded-full transition-all', barColor)}
            style={{ width: pct != null ? `${pct}%` : '0%' }}
          />
        </div>
      </div>
    </div>
  );
}

interface BotRef {
  id: string;
  title: string;
  url?: string;
  source?: string;
}

function BotReferencesSection({ refs }: { refs: BotRef[] }) {
  return (
    <div className="flex shrink-0 flex-col gap-3 border-b border-surface-line p-4">
      <h4 className="text-[16px] font-medium leading-6 text-ink">本次 Bot 引用</h4>
      <div className="flex flex-col gap-2">
        {refs.map((ref) => (
          <a
            key={ref.id}
            href={ref.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 rounded-card border border-surface-line bg-surface-canvas p-3 transition-colors hover:bg-neutral-30"
          >
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-link" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px] font-medium leading-5 text-ink">
                {ref.title}
              </span>
              {ref.source && (
                <span className="truncate text-[12px] leading-4 text-ink-subtle">
                  {ref.source}
                </span>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function AssignmentSection({
  conversation,
  onCreateCase,
  isClosed,
  hasCase,
}: {
  conversation: NonNullable<ContactInfoPanelProps['conversation']>;
  onCreateCase: () => void;
  isClosed: boolean;
  hasCase: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-3 border-b border-surface-line p-4">
      <h4 className="text-[16px] font-medium leading-6 text-ink">本次對話</h4>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium leading-4 text-ink-subtle">指派人員：</span>
        <button
          type="button"
          className="flex flex-1 items-center justify-between gap-1 rounded-card border border-surface-line bg-surface-canvas px-3 py-2 text-left text-[14px] leading-6 text-ink-subtle"
          disabled
        >
          <span>{conversation.assignedToId ? '已指派' : '尚未指派'}</span>
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {!isClosed && !hasCase && (
        <Button
          onClick={onCreateCase}
          className="flex w-full items-center justify-center gap-2 rounded-card bg-[#378ADD] px-4 py-3 text-[14px] font-medium leading-5 text-white hover:bg-[#2876C4]"
        >
          <Plus className="h-4 w-4" />
          開立案件
        </Button>
      )}
    </div>
  );
}

function CaseDetailsSection({
  caseData,
  isClosed,
  contactId,
}: {
  caseData: NonNullable<NonNullable<ContactInfoPanelProps['conversation']>['case']>;
  isClosed: boolean;
  contactId?: string;
}) {
  const statusStyle = CASE_STATUS_STYLE[caseData.status] || CASE_STATUS_STYLE.OPEN;
  const priorityClass = PRIORITY_STYLE[caseData.priority] || 'text-ink';
  const priorityLabel = PRIORITY_LABEL[caseData.priority] || caseData.priority;

  return (
    <div className="shrink-0 p-4">
      <div className="flex flex-col gap-3 rounded-card border border-surface-line bg-surface-canvas p-4">
        <div className="flex items-center justify-between">
          <Link
            href={`/dashboard/cases/${caseData.id}`}
            className="text-[14px] font-medium leading-5 text-ink hover:underline"
          >
            案件 #{caseData.id.slice(0, 6)}
          </Link>
          <span
            className={cn(
              'inline-flex items-center rounded-card border px-2 py-0.5 text-[12px] font-semibold',
              statusStyle.bg,
              statusStyle.text,
            )}
            style={{ borderColor: 'currentColor' }}
          >
            {statusStyle.label}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[14px] leading-5">
            <span className="text-ink-subtle">優先級</span>
            <span className={cn('font-medium', priorityClass)}>{priorityLabel}</span>
          </div>
          {caseData.firstResponseAt && (
            <div className="flex items-center justify-between text-[14px] leading-5">
              <span className="text-ink-subtle">首回覆時間</span>
              <span className="text-ink">
                {new Date(caseData.firstResponseAt).toLocaleString('zh-TW', { hour12: false })}
              </span>
            </div>
          )}
          {caseData.csatScore != null && (
            <div className="flex items-center justify-between text-[14px] leading-5">
              <span className="text-ink-subtle">CSAT</span>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`h-3.5 w-3.5 ${
                      star <= (caseData.csatScore || 0) ? 'fill-f-orange-60 text-f-orange-60' : 'text-neutral-50'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
          {isClosed && caseData.closedAt && (
            <div className="flex items-center justify-between text-[14px] leading-5">
              <span className="text-ink-subtle">關閉時間</span>
              <span className="text-ink">
                {new Date(caseData.closedAt).toLocaleString('zh-TW', { hour12: false })}
              </span>
            </div>
          )}
        </div>

        {contactId && (
          <Link
            href={`/dashboard/contacts/${contactId}`}
            className="flex items-center justify-center gap-1 rounded-card border border-surface-line bg-white py-2 text-[12px] font-medium text-ink-subtle transition-colors hover:bg-neutral-30"
          >
            <ExternalLink className="h-3 w-3" />
            <span>查看完整資料</span>
          </Link>
        )}
      </div>
    </div>
  );
}

export function ContactInfoPanel({ conversation }: ContactInfoPanelProps) {
  const [contact, setContact] = useState<Record<string, unknown> | null>(null);
  const [showCreateCase, setShowCreateCase] = useState(false);
  const { messages } = useMessages(conversation?.id ?? null);

  useEffect(() => {
    if (!conversation?.contact?.id) {
      setContact(null);
      return;
    }
    api
      .get(`/contacts/${conversation.contact.id}`)
      .then((res) => setContact(res.data.data))
      .catch(() => setContact(null));
  }, [conversation?.contact?.id]);

  if (!conversation?.contact) {
    return (
      <div className="flex h-full items-center justify-center bg-white p-4">
        <p className="text-[14px] text-ink-subtle">未選擇聯繫人</p>
      </div>
    );
  }

  const c = (contact || conversation.contact) as Record<string, unknown>;
  const isClosed = conversation.status === 'CLOSED';
  const caseData = conversation.case;

  const botMetrics = getBotMetrics(conversation, messages as Array<{ senderType?: string; metadata?: Record<string, unknown> }>);

  // Aggregate Bot KM refs from messages
  const refsMap = new Map<string, BotRef>();
  for (const m of messages as Array<{ senderType?: string; metadata?: Record<string, unknown> }>) {
    if (m.senderType !== 'BOT') continue;
    const refs = (m.metadata?.knowledgeRefs || m.metadata?.kmRefs) as
      | Array<{ id: string; title: string; url?: string; source?: string }>
      | undefined;
    if (!refs) continue;
    for (const r of refs) {
      if (!refsMap.has(r.id)) refsMap.set(r.id, r);
    }
  }
  const botRefs = Array.from(refsMap.values());

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto bg-white">
      <CustomerProfileSection conversation={conversation} contact={c} />

      {botMetrics.hasBotActivity && <BotStatusSection metrics={botMetrics} />}

      {botRefs.length > 0 && <BotReferencesSection refs={botRefs} />}

      <AssignmentSection
        conversation={conversation}
        onCreateCase={() => setShowCreateCase(true)}
        isClosed={isClosed}
        hasCase={!!caseData}
      />

      {caseData ? (
        <CaseDetailsSection
          caseData={caseData}
          isClosed={isClosed}
          contactId={conversation.contact.id}
        />
      ) : (
        <div className="shrink-0 p-4">
          <div className="rounded-card border border-dashed border-surface-line p-4 text-center text-[12px] text-ink-subtle">
            尚未建立案件
          </div>
        </div>
      )}

      <CaseCreateModal
        open={showCreateCase}
        onOpenChange={setShowCreateCase}
        conversationId={conversation.id}
        contactName={conversation.contact.name || conversation.contact.displayName || '未知'}
        contactId={conversation.contact.id}
        channelType={conversation.channelType}
      />
    </div>
  );
}
