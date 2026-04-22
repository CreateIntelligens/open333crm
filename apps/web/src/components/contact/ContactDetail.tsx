'use client';

import React from 'react';
import { Phone, Mail } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChannelIdentityList } from './ChannelIdentityList';
import { TagManager } from './TagManager';

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
  return (
    <div className="space-y-6">
      {/* Contact Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">聯繫人資訊</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-4">
            <Avatar alt={contact.name} src={contact.avatar} size="lg" />
            <div>
              <h3 className="text-lg font-semibold">{contact.name}</h3>
              {contact.phone && (
                <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <span>{contact.phone}</span>
                </div>
              )}
              {contact.email && (
                <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span>{contact.email}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Channel Identities */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">渠道身份</CardTitle>
        </CardHeader>
        <CardContent>
          <ChannelIdentityList identities={contact.channelIdentities || []} />
        </CardContent>
      </Card>

      {/* Custom Attributes */}
      {contact.attributes && Object.keys(contact.attributes).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">自訂屬性</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(contact.attributes).map(([key, value]) => (
                <div key={key} className="flex justify-between rounded-md border p-3">
                  <span className="text-sm font-medium text-muted-foreground">{key}</span>
                  <span className="text-sm">{value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tags */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">標籤</CardTitle>
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
