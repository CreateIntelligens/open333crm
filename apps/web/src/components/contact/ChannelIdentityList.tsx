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
    <div className="flex flex-col gap-2">
      {identities.map((identity) => (
        <div
          key={identity.id}
          className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <ChannelBadge channel={identity.channelType} className="shrink-0" />
            <div className="min-w-0">
              {identity.channelName && (
                <p className="truncate text-xs font-medium text-muted-foreground">{identity.channelName}</p>
              )}
              <p className="truncate text-sm font-semibold text-foreground">
                {identity.displayName || identity.externalId}
              </p>
              {identity.displayName && (
                <p className="truncate font-mono text-xs text-muted-foreground" title={identity.externalId}>{identity.externalId}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
