'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ChannelBadge } from '@/components/shared/ChannelBadge';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';

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

function ChannelProviderPill({ identity }: { identity: ContactChannelIdentity }) {
  const providerType = identity.channel?.channelType || identity.channelType;
  const providerName = identity.channel?.displayName;

  if (!providerName) {
    return <ChannelBadge channel={providerType} />;
  }

  return (
    <span
      className={cn(
        'inline-flex max-w-[12rem] items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-1',
        'text-xs text-foreground'
      )}
      title={`${providerType} - ${providerName}`}
    >
      <ChannelBadge channel={providerType} className="shrink-0" />
      <span className="truncate">{providerName}</span>
    </span>
  );
}

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
        description="建立後聯繫人將顯示在這裡"
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50 text-left">
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              聯繫人
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              電話
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              電子郵件
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              渠道
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              標籤
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              最近活躍
            </th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact) => {
            const contactName = contact.displayName || contact.name || '未知';
            const contactAvatar = contact.avatarUrl || contact.avatar;

            return (
              <tr
                key={contact.id}
                className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                onClick={() => router.push(`/dashboard/contacts/${contact.id}`)}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar alt={contactName} src={contactAvatar} size="sm" />
                    <span className="text-sm font-medium">{contactName}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {contact.phone || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {contact.email || '-'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {contact.channelIdentities && contact.channelIdentities.length > 0 ? (
                      contact.channelIdentities.map((ci) => (
                        <ChannelProviderPill key={ci.id} identity={ci} />
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {contact.tags && contact.tags.length > 0 ? (
                      contact.tags.map((t) => {
                        const tagData = t.tag || t;
                        return (
                          <Badge
                            key={tagData.id || t.id}
                            variant="secondary"
                            className="text-xs"
                            style={tagData.color ? { backgroundColor: `${tagData.color}20`, color: tagData.color, borderColor: tagData.color } : undefined}
                          >
                            {tagData.name}
                          </Badge>
                        );
                      })
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {contact.lastActiveAt || contact.updatedAt
                    ? format(
                        new Date(contact.lastActiveAt || contact.updatedAt || ''),
                        'MMM d, HH:mm'
                      )
                    : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
