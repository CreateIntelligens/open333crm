'use client';

import React from 'react';
import { ChannelBadge } from '@/components/shared/ChannelBadge';

interface ChannelIdentity {
  id: string;
  channelType: string;
  externalId: string;
  displayName?: string;
  /** 渠道名稱（例如「總店 LINE OA」）：同一租戶可能接多個同類型渠道 */
  channelName?: string;
}

interface ChannelIdentityListProps {
  identities: ChannelIdentity[];
}

export function ChannelIdentityList({ identities }: ChannelIdentityListProps) {
  if (!identities || identities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">沒有渠道身份</p>
    );
  }

  return (
    <div className="space-y-2">
      {identities.map((identity) => (
        <div
          key={identity.id}
          className="flex items-center justify-between rounded-md border p-3"
        >
          <div className="flex items-center gap-3">
            <ChannelBadge channel={identity.channelType} />
            <div className="min-w-0">
              {identity.channelName && (
                <p className="truncate text-xs font-medium text-muted-foreground">{identity.channelName}</p>
              )}
              <p className="truncate text-sm font-medium">
                {identity.displayName || identity.externalId}
              </p>
              {identity.displayName && (
                <p className="truncate text-xs text-muted-foreground">{identity.externalId}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
