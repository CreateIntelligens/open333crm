'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Phone, Mail, ExternalLink, Plus, Bot, Star, Clock, Send, Package, AlertCircle } from 'lucide-react';
import useSWR from 'swr';
import api from '@/lib/api';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ChannelBadge } from '@/components/shared/ChannelBadge';
import { CaseCreateModal } from '@/components/case/CaseCreateModal';
import { Select } from '@/components/ui/select';

interface ContactInfoPanelProps {
  conversation: {
    id: string;
    status?: string;
    botRepliesCount?: number;
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

export function ContactInfoPanel({ conversation }: ContactInfoPanelProps) {
  const [contact, setContact] = useState<Record<string, unknown> | null>(null);
  const [showCreateCase, setShowCreateCase] = useState(false);
  const [requestingEmail, setRequestingEmail] = useState(false);

  const { data: agentsData } = useSWR('/agents', (url: string) =>
    api.get(url).then((res) => res.data.data)
  );
  const agents: { id: string; name: string }[] = agentsData || [];

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
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">未選擇聯繫人</p>
      </div>
    );
  }

  const c = contact || conversation.contact;
  const channelIdentities = (c as Record<string, unknown>).channelIdentities as Array<{
    id: string;
    channelType: string;
    externalId: string;
    displayName?: string;
  }> | undefined;
  const tags = (c as Record<string, unknown>).tags as Array<{
    id: string;
    name: string;
    color?: string;
  }> | undefined;
  const attributes = (c as Record<string, unknown>).attributes as Array<{
    id: string;
    key: string;
    value: string;
  }> | undefined;

  const isBotHandled = conversation.status === 'BOT_HANDLED';
  const isClosed = conversation.status === 'CLOSED';
  const caseData = conversation.case;

  const agentOptions = [
    { value: '', label: '未指派' },
    ...agents.map((a) => ({ value: a.id, label: a.name })),
  ];

  const handleAssign = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!conversation) { return; }
    const value = e.target.value || null;
    await api.patch(`/conversations/${conversation.id}`, { assignedToId: value });
  };

  const priorityColor: Record<string, string> = {
    HIGH: 'text-[#e53e3e]',
    MEDIUM: 'text-orange-500',
    LOW: 'text-green-500',
  };
  const priorityBg: Record<string, string> = {
    HIGH: 'bg-red-50',
    MEDIUM: 'bg-orange-50',
    LOW: 'bg-green-50',
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <Avatar
            alt={conversation.contact.name || conversation.contact.displayName || '聯繫人'}
            src={conversation.contact.avatar || conversation.contact.avatarUrl}
            size="md"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-[#1e2939] truncate">
                {conversation.contact.name || conversation.contact.displayName || '未知'}
              </h3>
              <span className="inline-flex items-center rounded-full bg-[#fffbeb] px-2 py-0.5 text-[10px] font-medium text-[#bb4d00] border border-[#fee685]">
                VIP
              </span>
              <span className="inline-flex items-center rounded-full bg-[#eff6ff] px-2 py-0.5 text-[10px] font-medium text-[#1447e6] border border-[#bedbff]">
                已購買
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <ChannelBadge channel={conversation.channelType} />
              {channelIdentities && channelIdentities.map((ci) => (
                <ChannelBadge key={ci.id} channel={ci.channelType} />
              ))}
            </div>
          </div>
        </div>

        {conversation.contact.phone && (
          <div className="mt-3 flex items-center gap-2 text-sm text-[#4a5565]">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span>{conversation.contact.phone}</span>
          </div>
        )}
        {conversation.contact.email && (
          <div className="mt-1.5 flex items-center gap-2 text-sm text-[#4a5565]">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span>{conversation.contact.email}</span>
          </div>
        )}
      </div>

      <Separator />

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 rounded-lg bg-[#f3f4f6] p-3">
          <Package className="h-4 w-4 text-[#4a5565] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[#4a5565]">商品</p>
            <p className="text-sm font-medium text-[#1e2939] truncate">iPhone 15 Pro Max</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-[#f3f4f6] p-3">
          <Clock className="h-4 w-4 text-[#4a5565] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[#4a5565]">保固</p>
            <p className="text-sm font-medium text-[#1e2939]">2025-12-31 截止</p>
          </div>
        </div>
      </div>

      <Separator />

      <div className="p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase text-[#4a5565]">本次對話</h4>
        <div className="mb-3">
          <Select
            className="w-full h-9 text-sm"
            options={agentOptions}
            value={(conversation as Record<string, unknown>).assignedToId as string || ''}
            onChange={handleAssign}
          />
        </div>
        <Button
          className="w-full bg-[#cb74c1] hover:bg-[#cb74c1]/90 text-white h-9"
          onClick={() => setShowCreateCase(true)}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          開立案件
        </Button>
      </div>

      <Separator />

      {caseData && (
        <div className="p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase text-[#4a5565]">關聯案件</h4>
          <div className="rounded-lg border border-[#e2e8f0] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#4a5565]">#{caseData.id?.slice(0, 8) || '1087'}</span>
              <span className="inline-flex items-center rounded-full bg-[#f8eaf6] px-2 py-0.5 text-[10px] font-medium text-[#cb74c1]">
                處理中
              </span>
            </div>
            <p className="text-sm font-medium text-[#1e2939]">{caseData.title}</p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <AlertCircle className={`h-3.5 w-3.5 ${priorityColor[caseData.priority] || 'text-muted-foreground'}`} />
                <span className={`text-xs ${priorityColor[caseData.priority] || 'text-muted-foreground'}`}>
                  {caseData.priority === 'HIGH' ? '高' : caseData.priority === 'MEDIUM' ? '中' : '低'}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">SLA 餘 2h</span>
            </div>
          </div>
        </div>
      )}

      {isBotHandled && (
        <>
          <Separator />
          <div className="p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-[#4a5565]">
              <Bot className="h-3.5 w-3.5 text-[#cb74c1]" />
              Bot 狀態
            </h4>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-[#4a5565]">模式</span>
                <span className="font-medium text-[#cb74c1]">自動回覆</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#4a5565]">已回覆次數</span>
                <span className="font-medium">{conversation.botRepliesCount || 0}</span>
              </div>
            </div>
          </div>
        </>
      )}

      <Separator />

      <div className="p-4">
        <h4 className="mb-2 text-xs font-semibold uppercase text-[#4a5565]">標籤</h4>
        <div className="flex flex-wrap gap-1.5">
          {tags && tags.length > 0 ? (
            tags.map((tag) => (
              <Badge key={tag.id} variant="secondary" color={tag.color} className="text-xs" />
            ))
          ) : (
            <span className="text-xs text-muted-foreground">沒有標籤</span>
          )}
        </div>
      </div>

      <Separator />

      <div className="p-4 space-y-2">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setShowCreateCase(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          建立工單
        </Button>
        <Link href={`/dashboard/contacts/${conversation.contact.id}`}>
          <Button variant="ghost" className="w-full">
            <ExternalLink className="mr-2 h-4 w-4" />
            查看完整資料
          </Button>
        </Link>
      </div>

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
