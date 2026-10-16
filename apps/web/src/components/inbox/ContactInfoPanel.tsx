'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Bot, Star, Clock } from 'lucide-react';
import api from '@/lib/api';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ChannelLabel } from '@/components/shared/ChannelLabel';
import { CaseCreateModal } from '@/components/case/CaseCreateModal';
import { TagManager } from '@/components/contact/TagManager';
import { SendBindingLinkButton } from './SendBindingLinkButton';
import { SendEmailRegistrationLinkButton } from './SendEmailRegistrationLinkButton';
import { OtherChannelConversations } from './OtherChannelConversations';

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
    tags?: Array<{
      id: string;
      tag?: {
        id: string;
        name: string;
        color?: string;
        type?: string;
        scope?: 'CONVERSATION';
      };
    }>;
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
  onRefresh?: () => void;
}

const CASE_STATUS_LABEL: Record<string, string> = {
  OPEN: '待處理',
  IN_PROGRESS: '處理中',
  PENDING: '等待中',
  RESOLVED: '已解決',
  CLOSED: '已結案',
  ESCALATED: '已升級',
};

export function ContactInfoPanel({ conversation, onRefresh }: ContactInfoPanelProps) {
  const [contact, setContact] = useState<Record<string, unknown> | null>(null);
  const [showCreateCase, setShowCreateCase] = useState(false);

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
        <p className="text-sm text-muted-foreground">未選擇聯絡人</p>
      </div>
    );
  }

  const c = contact || conversation.contact;
  const channelIdentities = (c as Record<string, unknown>).channelIdentities as Array<{
    id: string;
    channelType: string;
    externalId: string;
    displayName?: string;
    channel?: { displayName?: string } | null;
  }> | undefined;
  const tags = (c as Record<string, unknown>).tags as Array<{
    id: string;
    name: string;
    color?: string;
    tag?: {
      id: string;
      name: string;
      color?: string;
    };
  }> | undefined;
  const conversationTags = (conversation.tags || []).map((ct) => ({
    id: ct.tag?.id || ct.id,
    name: ct.tag?.name || '',
    color: ct.tag?.color,
    type: ct.tag?.type,
    scope: ct.tag?.scope,
  })).filter((tag) => tag.name);
  const attributes = (c as Record<string, unknown>).attributes as Array<{
    id: string;
    key: string;
    value: string;
  }> | undefined;

  const isBotHandled = conversation.status === 'BOT_HANDLED';
  const isClosed = conversation.status === 'CLOSED';
  const caseData = conversation.case;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Contact Header：依 Claude Design — 頭像、姓名、聯絡方式，下方「查看聯繫人詳情」；依 Figma 微調 */}
      <div className="flex flex-col items-center gap-1 px-5 pb-5 pt-6 text-center">
        <Avatar
          alt={conversation.contact.name || conversation.contact.displayName || '聯絡人'}
          src={conversation.contact.avatar || conversation.contact.avatarUrl}
          size="lg"
          className="h-[52px] w-[52px] bg-primary-subtle text-[19px] text-primary-hover"
        />
        <h3 className="mt-2 text-base font-semibold leading-6 text-foreground">{conversation.contact.name || conversation.contact.displayName || '未知'}</h3>
        <Link
          href={`/dashboard/contacts/${conversation.contact.id}`}
          className="mt-1 text-xs font-medium text-primary hover:text-primary-hover"
        >
          查看聯繫人詳情 →
        </Link>
      </div>


      {/* Bot Status Block */}
      {isBotHandled && (
        <>
          <div className="p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold leading-[17px] text-muted-foreground">
              <Bot className="h-3.5 w-3.5 text-ai" />
              Bot 狀態
            </h4>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">模式</span>
                <span className="font-medium text-ai">自動回覆</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">已回覆次數</span>
                <span className="font-medium">{conversation.botRepliesCount || 0}</span>
              </div>
            </div>
          </div>
            </>
      )}

      {/* CSAT + Closed info */}
      {isClosed && caseData && (
        <>
          <div className="p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold leading-[17px] text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              結案資訊
            </h4>
            <div className="space-y-1.5 text-sm">
              {caseData.csatScore != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">CSAT 評分</span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`h-3.5 w-3.5 ${
                          star <= (caseData.csatScore || 0) ? 'fill-warning text-warning' : 'text-muted-foreground/60'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
              {caseData.firstResponseAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">首回覆時間</span>
                  <span className="text-xs">{new Date(caseData.firstResponseAt).toLocaleString('zh-TW')}</span>
                </div>
              )}
              {caseData.closedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">關閉時間</span>
                  <span className="text-xs">{new Date(caseData.closedAt).toLocaleString('zh-TW')}</span>
                </div>
              )}
            </div>
          </div>
            </>
      )}

      {/* 聯繫人資訊：Claude Design 的欄位列表（標籤在左、值在右）；依 Figma 微調 */}
      <div className="flex flex-col gap-2 p-4">
        <h4 className="text-xs font-semibold leading-[17px] text-muted-foreground">聯繫人資訊</h4>
        <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">電話</dt>
          <dd className="truncate text-foreground">{conversation.contact.phone || '—'}</dd>
          <dt className="text-muted-foreground">電子郵件</dt>
          <dd className="truncate text-foreground" title={conversation.contact.email}>{conversation.contact.email || '—'}</dd>
          {channelIdentities && channelIdentities.length > 0 && (
            <>
              <dt className="text-muted-foreground">渠道</dt>
              <dd className="flex min-w-0 flex-col gap-1">
                {channelIdentities.map((ci) => (
                  <ChannelLabel key={ci.id} channelType={ci.channelType} channelName={ci.channel?.displayName} />
                ))}
              </dd>
            </>
          )}
        </dl>
      </div>


      {/* 歸戶後同一位顧客在其他渠道的對話（change add-email-identity-merge） */}
      <OtherChannelConversations contactId={conversation.contact.id} currentConversationId={conversation.id} />

      {/* Contact Tags */}
      <div className="p-4">
        <h4 className="mb-2 text-xs font-semibold leading-[17px] text-muted-foreground">
          聯繫人標籤
        </h4>
        <div className="flex flex-wrap gap-2">
          {tags && tags.length > 0 ? (
            tags.map((tag) => {
              const color = tag.tag?.color || tag.color;
              return (
                <span
                  key={tag.tag?.id || tag.id}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary-subtle px-3 text-xs font-medium text-primary-hover"
                >
                  {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />}
                  {tag.tag?.name || tag.name}
                </span>
              );
            })
          ) : (
            <span className="text-sm text-muted-foreground">沒有標籤</span>
          )}
        </div>
      </div>


      {/* Conversation Tags */}
      <div className="p-4">
        <h4 className="mb-2 text-xs font-semibold leading-[17px] text-muted-foreground">
          對話標籤
        </h4>
        <TagManager
          targetType="CONVERSATION"
          targetId={conversation.id}
          tags={conversationTags}
          onUpdate={() => onRefresh?.()}
        />
      </div>


      {/* Custom Attributes */}
      {attributes && attributes.length > 0 && (
        <>
          <div className="p-4">
            <h4 className="mb-2 text-xs font-semibold leading-[17px] text-muted-foreground">
              自訂屬性
            </h4>
            <div className="space-y-1.5">
              {attributes.map((attr) => (
                <div key={attr.id} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{attr.key}</span>
                  <span className="font-medium">{attr.value}</span>
                </div>
              ))}
            </div>
          </div>
            </>
      )}

      {/* 工單：Claude Design 顯示此對話關聯的工單（編號、標題、狀態） */}
      <div className="flex flex-col gap-2 px-4 pb-2 pt-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold leading-[17px] text-muted-foreground">工單</h4>
          <span className="text-xs tabular-nums text-muted-foreground">{caseData ? 1 : 0}</span>
        </div>
        {caseData ? (
          <Link
            href={`/dashboard/cases/${caseData.id}`}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:bg-surface-hover"
          >
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{caseData.title}</span>
            <span className="shrink-0 rounded-full bg-surface-hover px-2 py-px text-[11px] font-medium text-muted-foreground">
              {CASE_STATUS_LABEL[caseData.status] ?? caseData.status}
            </span>
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">尚無工單</p>
        )}
      </div>

      {/* Actions：Claude Design 的「快速操作」 */}
      <div className="flex flex-col gap-2 p-4">
        <h4 className="text-xs font-semibold leading-[17px] text-muted-foreground">快速操作</h4>
        <SendEmailRegistrationLinkButton contactId={conversation.contact.id} conversationId={conversation.id} />
        <SendBindingLinkButton contactId={conversation.contact.id} conversationId={conversation.id} />
        <Button variant="subtle" size="sm" className="w-full justify-start" onClick={() => setShowCreateCase(true)}>
          <Plus />
          建立工單
        </Button>
      </div>

      {/* Create Case Modal */}
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
