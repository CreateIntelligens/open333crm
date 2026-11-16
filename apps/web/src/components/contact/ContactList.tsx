'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/EmptyState';

interface ContactChannelIdentity {
  id: string;
  channelType: string;
  channel?: {
    id: string;
    displayName: string;
    channelType: string;
  } | null;
}

interface ContactListProps {
  contacts: Array<{
    id: string;
    displayName?: string;
    name?: string;
    phone?: string;
    email?: string;
    avatarUrl?: string;
    avatar?: string;
    channelIdentities?: ContactChannelIdentity[];
    tags?: Array<{
      id: string;
      name?: string;
      color?: string;
      tag?: { id: string; name: string; color?: string };
    }>;
    lastActiveAt?: string;
    updatedAt?: string;
  }>;
  isLoading: boolean;
}

// 渠道標籤依 Figma 4.1.1：Tag Outline，Facebook＝藍、LINE＝綠、Instagram＝紫、Web Chat＝灰
const CHANNEL_TAG: Record<string, { label: string; variant: 'outline-primary' | 'outline-success' | 'outline-robot' | 'outline' }> = {
  FB: { label: 'Facebook', variant: 'outline-primary' },
  FACEBOOK: { label: 'Facebook', variant: 'outline-primary' },
  LINE: { label: 'LINE', variant: 'outline-success' },
  INSTAGRAM: { label: 'Instagram', variant: 'outline-robot' },
  IG: { label: 'Instagram', variant: 'outline-robot' },
  WEBCHAT: { label: 'Web Chat', variant: 'outline' },
};

function ChannelTag({ identity }: { identity: ContactChannelIdentity }) {
  const type = (identity.channel?.channelType || identity.channelType || '').toUpperCase();
  const tag = CHANNEL_TAG[type] ?? { label: type || '未知', variant: 'outline' as const };
  // 同類型可能接多個 LINE OA／粉專：滑過顯示渠道名稱
  return (
    <Badge variant={tag.variant} title={identity.channel?.displayName ? `${tag.label}：${identity.channel.displayName}` : tag.label}>
      {tag.label}
    </Badge>
  );
}

// 欄寬依 Figma 4.1.1：姓名 190、電話 130、電子郵件 250、渠道彈性（Figma 500）、標籤 168、最近活躍 170，欄距 20
const COLS = 'grid grid-cols-[190px_130px_250px_minmax(0,1fr)_168px_170px] items-center gap-5 px-5';

export function ContactList({ contacts, isLoading }: ContactListProps) {
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-12 w-12" />}
        title="找不到聯繫人"
        description="客人從任何渠道傳訊息進來後，就會出現在這裡"
      />
    );
  }

  return (
    <div role="table" aria-label="聯繫人列表" className="overflow-x-auto rounded-lg border border-border">
      <div className="min-w-[1100px]">
        <div role="row" className={`${COLS} border-b border-border bg-muted py-2 text-sm font-medium leading-7 text-muted-foreground`}>
          <span role="columnheader">姓名</span>
          <span role="columnheader">電話</span>
          <span role="columnheader">電子郵件</span>
          <span role="columnheader">渠道</span>
          <span role="columnheader">標籤</span>
          <span role="columnheader">最近活躍</span>
        </div>
        {contacts.map((contact) => {
          const contactName = contact.displayName || contact.name || '未知';
          const lastActive = contact.lastActiveAt || contact.updatedAt;
          const open = () => router.push(`/dashboard/contacts/${contact.id}`);
          return (
            <div
              key={contact.id}
              role="row"
              tabIndex={0}
              onClick={open}
              onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
              className={`${COLS} cursor-pointer border-b border-border bg-background py-4 text-sm font-medium text-muted-foreground transition-colors last:border-b-0 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none`}
            >
              <span role="cell" className="flex min-w-0 items-center gap-2">
                <Avatar alt={contactName} src={contact.avatarUrl || contact.avatar} size="md" />
                <span className="truncate font-semibold text-foreground" title={contactName}>{contactName}</span>
              </span>
              <span role="cell" className="truncate tabular-nums">{contact.phone || '—'}</span>
              <span role="cell" className="truncate" title={contact.email}>{contact.email || '—'}</span>
              <span role="cell" className="flex min-w-0 flex-wrap gap-2">
                {contact.channelIdentities && contact.channelIdentities.length > 0
                  ? contact.channelIdentities.map((ci) => <ChannelTag key={ci.id} identity={ci} />)
                  : '—'}
              </span>
              <span role="cell" className="flex min-w-0 flex-wrap gap-1.5">
                {contact.tags && contact.tags.length > 0
                  ? contact.tags.map((t) => {
                      const tagData = t.tag || t;
                      // Figma「Tag / Custom」：標籤自訂顏色的實心膠囊、白字
                      return (
                        <span
                          key={tagData.id || t.id}
                          className="inline-flex h-6 max-w-full items-center truncate rounded-full bg-primary px-4 text-xs font-medium text-white"
                          style={tagData.color ? { backgroundColor: tagData.color } : undefined}
                          title={tagData.name}
                        >
                          {tagData.name}
                        </span>
                      );
                    })
                  : '—'}
              </span>
              <span role="cell" className="font-semibold tabular-nums text-foreground">
                {lastActive ? format(new Date(lastActive), 'MMM d, HH:mm') : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
