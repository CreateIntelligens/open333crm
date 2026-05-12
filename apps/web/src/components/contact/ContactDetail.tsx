'use client';

import React from 'react';
import { Mail } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChannelIdentityList } from './ChannelIdentityList';
import { TagManager } from './TagManager';
import { CustomerInfoRow } from './CustomerInfoRow';

interface ContactDetailProps {
  contact: {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    avatar?: string;
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
    attributes?: Record<string, string>;
  };
  onUpdate: () => void;
}

export function ContactDetail({ contact, onUpdate }: ContactDetailProps) {
  // Build CustomerInfoRow tags (heuristic mapping by name keyword)
  const tagItems = (contact.tags || [])
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

  // Build CustomerInfoRow items from attributes
  const items = contact.attributes
    ? Object.entries(contact.attributes).map(([key, value]) => ({ label: key, value }))
    : [];

  return (
    <div className="space-y-6">
      {/* Contact Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[16px] font-semibold text-ink">聯繫人資訊</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-4">
              <Avatar alt={contact.name} src={contact.avatar} size="lg" className="ring-1 ring-neutral-30" />
              <div className="flex flex-col gap-1">
                <h3 className="text-[20px] font-semibold leading-7 text-ink">{contact.name}</h3>
                {contact.email && (
                  <div className="flex items-center gap-1.5 text-[14px] text-ink-subtle">
                    <Mail className="h-4 w-4" />
                    <span>{contact.email}</span>
                  </div>
                )}
              </div>
            </div>

            <CustomerInfoRow
              contact={contact.phone ? { value: contact.phone } : undefined}
              tags={tagItems.length > 0 ? tagItems : undefined}
              items={items.length > 0 ? items : undefined}
            />
          </div>
        </CardContent>
      </Card>

      {/* Channel Identities */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[16px] font-semibold text-ink">渠道身份</CardTitle>
        </CardHeader>
        <CardContent>
          <ChannelIdentityList identities={contact.channelIdentities || []} />
        </CardContent>
      </Card>

      {/* Tags (full management) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[16px] font-semibold text-ink">標籤管理</CardTitle>
        </CardHeader>
        <CardContent>
          <TagManager
            contactId={contact.id}
            tags={contact.tags || []}
            onUpdate={onUpdate}
          />
        </CardContent>
      </Card>
    </div>
  );
}
