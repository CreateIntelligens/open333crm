'use client';

import React from 'react';
import { Phone } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { format } from 'date-fns';
import { ChannelIdentityList } from './ChannelIdentityList';
import { TagManager } from './TagManager';
import { ContactMergeHistory } from './ContactMergeHistory';
import { ContactEmailField } from './ContactEmailField';

interface ContactDetailProps {
  /** profile＝頂部聯繫人卡、side＝右欄卡片（預設） */
  section?: 'profile' | 'side';
  contact: {
    id: string;
    name: string;
    createdAt?: string;
    lastSeenAt?: string;
    phone?: string;
    email?: string;
    avatar?: string;
    channelIdentities?: Array<{
      id: string;
      channelType: string;
      externalId: string;
      displayName?: string;
      channelName?: string;
    }>;
    tags?: Array<{
      id: string;
      name: string;
      color?: string;
    }>;
    attributes?: Record<string, string>;
  };
  onUpdate: () => void;
  /** email 與另一位聯絡人相同、客服選擇合併時呼叫（見 ContactEmailField） */
  onRequestEmailMerge: (other: { id: string; displayName: string }, email: string) => void;
  /** 改變時重設 email 欄位（例如合併完成後） */
  emailFieldKey?: number;
}

const CARD = 'flex flex-col gap-4 rounded-lg border border-border bg-background p-5';

function CardTitleRow({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {count !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{count} 筆</span>}
    </div>
  );
}

/**
 * 版面依 Claude Design「聯繫人詳情」：
 * section="profile" → 頂部聯繫人卡（頭像、名稱、建檔／最後互動／ID、電話與 email）
 * section="side"（預設）→ 右欄：渠道身份、標籤、自訂屬性、合併紀錄。依 Figma 微調
 */
export function ContactDetail({ contact, onUpdate, onRequestEmailMerge, emailFieldKey, section = 'side' }: ContactDetailProps) {
  if (section === 'profile') {
    return (
      <div className="flex flex-wrap items-start gap-4 rounded-lg border border-border bg-background p-5">
        <Avatar
          alt={contact.name}
          src={contact.avatar}
          size="lg"
          className="h-14 w-14 bg-primary-subtle text-xl text-primary-hover"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate text-xl font-bold leading-7 text-foreground">{contact.name}</h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {contact.createdAt && <span>建檔 {format(new Date(contact.createdAt), 'yyyy/MM/dd')}</span>}
            {contact.lastSeenAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>最後互動 {format(new Date(contact.lastSeenAt), 'yyyy/MM/dd HH:mm')}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="font-mono text-xs" title={contact.id}>{contact.id.slice(0, 8)}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-1">
            <span className="flex items-center gap-1.5 text-sm text-foreground">
              <Phone className="h-4 w-4 text-muted-foreground" />
              {contact.phone || <span className="text-muted-foreground">未提供電話</span>}
            </span>
            <ContactEmailField
              key={emailFieldKey}
              contactId={contact.id}
              email={contact.email}
              onUpdate={onUpdate}
              onRequestMerge={onRequestEmailMerge}
            />
          </div>
        </div>
      </div>
    );
  }

  const identities = contact.channelIdentities || [];
  return (
    <div className="flex flex-col gap-5">
      <div className={CARD}>
        <CardTitleRow title="渠道身份" count={identities.length} />
        <ChannelIdentityList identities={identities} />
      </div>

      <div className={CARD}>
        <CardTitleRow title="標籤" />
        <TagManager targetType="CONTACT" targetId={contact.id} tags={contact.tags || []} onUpdate={onUpdate} />
      </div>

      {contact.attributes && Object.keys(contact.attributes).length > 0 && (
        <div className={CARD}>
          <CardTitleRow title="自訂屬性" count={Object.keys(contact.attributes).length} />
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            {Object.entries(contact.attributes).map(([key, value]) => (
              <React.Fragment key={key}>
                <dt className="truncate text-muted-foreground" title={key}>{key}</dt>
                <dd className="break-words text-foreground">{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      )}

      {/* 合併紀錄（跨渠道綁定、手動合併等；可解除合併）：Claude Design 沒有畫，保留 */}
      <div className={CARD}>
        <CardTitleRow title="合併紀錄" />
        <ContactMergeHistory contactId={contact.id} onUpdate={onUpdate} />
      </div>
    </div>
  );
}
