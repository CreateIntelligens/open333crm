'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Phone, Mail, ExternalLink, Plus, Bot, Star, Clock, Send } from 'lucide-react';
import api from '@/lib/api';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ChannelBadge } from '@/components/shared/ChannelBadge';
import { CaseCreateModal } from '@/components/case/CaseCreateModal';
import { CHANNEL_TYPE } from '@open333crm/shared';

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

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Contact Header */}
      <div className="flex flex-col items-center p-6 text-center">
        <Avatar
          alt={conversation.contact.name || conversation.contact.displayName || '聯繫人'}
          src={conversation.contact.avatar || conversation.contact.avatarUrl}
          size="lg"
        />
        <h3 className="mt-3 text-lg font-semibold">{conversation.contact.name || conversation.contact.displayName || '未知'}</h3>
        {conversation.contact.phone && (
          <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Phone className="h-3 w-3" />
            <span>{conversation.contact.phone}</span>
          </div>
        )}
        {conversation.contact.email && (
          <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Mail className="h-3 w-3" />
            <span>{conversation.contact.email}</span>
          </div>
        )}
      </div>

      <Separator />

      {/* Bot Status Block */}
      {isBotHandled && (
        <>
          <div className="p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
              <Bot className="h-3.5 w-3.5 text-purple-500" />
              Bot 狀態
            </h4>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">模式</span>
                <span className="font-medium text-purple-600">自動回覆</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">已回覆次數</span>
                <span className="font-medium">{conversation.botRepliesCount || 0}</span>
              </div>
            </div>
          </div>
          <Separator />
        </>
      )}

      {/* CSAT + Closed info */}
      {isClosed && caseData && (
        <>
          <div className="p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
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
                          star <= (caseData.csatScore || 0) ? 'fill-amber-400 text-amber-400' : 'text-gray-300'
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
          <Separator />
        </>
      )}

      {/* Channel Identities */}
      {channelIdentities && channelIdentities.length > 0 && (
        <div className="p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            渠道
          </h4>
          <div className="flex flex-wrap gap-2">
            {channelIdentities.map((ci) => (
              <ChannelBadge key={ci.id} channel={ci.channelType} />
            ))}
          </div>
        </div>
      )}

      <Separator />

      {/* Tags */}
      <div className="p-4">
        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          標籤
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {tags && tags.length > 0 ? (
            tags.map((tag) => (
              <Badge
                key={tag.id}
                variant="secondary"
                color={tag.color}
                className="text-xs"
              >
                {tag.name}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">沒有標籤</span>
          )}
        </div>
      </div>

      <Separator />

      {/* Custom Attributes */}
      {attributes && attributes.length > 0 && (
        <>
          <div className="p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
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
          <Separator />
        </>
      )}

      {/* Actions */}
      <div className="p-4 space-y-2">
        {(conversation.channelType === CHANNEL_TYPE.LINE || conversation.channelType === CHANNEL_TYPE.FB) && !(c as Record<string, unknown>).email && (
          <Button
            variant="outline"
            className="w-full"
            disabled={requestingEmail}
            onClick={async () => {
              setRequestingEmail(true);
              try {
                const endpoint = conversation.channelType === CHANNEL_TYPE.LINE
                  ? '/auth/line/request-email'
                  : '/auth/fb/request-email';
                await api.post(endpoint, {
                  conversationId: conversation.id,
                });
              } catch {
                // Error handled silently — message appears via WebSocket
              } finally {
                setRequestingEmail(false);
              }
            }}
          >
            <Send className="mr-2 h-4 w-4" />
            {requestingEmail ? '傳送中...' : '請求 Email'}
          </Button>
        )}
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
