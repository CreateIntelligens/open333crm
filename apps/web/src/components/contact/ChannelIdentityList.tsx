'use client';

import React from 'react';
import { ChannelBadge } from '@/components/shared/ChannelBadge';
import { Badge } from '@/components/ui/badge';

interface ChannelIdentity {
  id: string;
  channelType: string;
  externalId: string;
  displayName?: string;
  /** 渠道名稱（例如「總店 LINE OA」）：同一租戶可能接多個同類型渠道 */
  channelName?: string;
  /** 顧客封鎖這個官方帳號的時間；有值表示目前封鎖中（重新加入好友時清空） */
  blockedAt?: string | null;
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
          data-testid="channel-identity"
          className="flex items-center justify-between rounded-md border p-3"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <ChannelBadge channel={identity.channelType} className="shrink-0" />
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
          {identity.blockedAt && (
            <Badge
              variant="danger"
              className="shrink-0"
              title={`封鎖時間：${new Date(identity.blockedAt).toLocaleString('zh-TW')}`}
            >
              已封鎖官方帳號
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}
