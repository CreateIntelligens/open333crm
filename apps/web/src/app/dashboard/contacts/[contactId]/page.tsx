'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Merge } from 'lucide-react';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { Button } from '@/components/ui/button';
import { Topbar } from '@/components/layout/Topbar';
import { ContactDetail } from '@/components/contact/ContactDetail';
import { ContactTimeline } from '@/components/contact/ContactTimeline';
import { ContactMergeModal } from '@/components/contact/ContactMergeModal';
import { ContactConversationHistory } from '@/components/contact/ContactConversationHistory';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ContactDetailPage() {
  const params = useParams();
  const contactId = params.contactId as string;

  const [contact, setContact] = useState<Record<string, unknown> | null>(null);
  const [timeline, setTimeline] = useState<Array<{
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [showMergeModal, setShowMergeModal] = useState(false);
  // 右欄：活動時間軸／跨渠道對話紀錄（change add-email-identity-merge）
  const [rightTab, setRightTab] = useState<'timeline' | 'messages'>('timeline');
  // 合併或解除後重新載入對話紀錄
  const [historyKey, setHistoryKey] = useState(0);
  // 修改 email 時與另一位聯絡人相同、客服選擇合併：合併完成後再寫入 email（change add-email-identity-merge）
  const [emailMerge, setEmailMerge] = useState<{ other: { id: string; displayName: string }; email: string } | null>(null);
  const [emailMergeError, setEmailMergeError] = useState<string | null>(null);
  // 合併完成後重設 email 欄位（離開編輯與衝突提示）
  const [emailFieldKey, setEmailFieldKey] = useState(0);

  const fetchContact = useCallback(async () => {
    try {
      const res = await api.get(`/contacts/${contactId}`);
      setContact(res.data.data);
    } catch (err) {
      console.error('Failed to fetch contact:', err);
    }
  }, [contactId]);

  const fetchTimeline = useCallback(async () => {
    try {
      const res = await api.get(`/contacts/${contactId}/timeline`);
      setTimeline(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch timeline:', err);
    }
  }, [contactId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchContact(), fetchTimeline()]).finally(() =>
      setLoading(false)
    );
  }, [fetchContact, fetchTimeline]);

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title="聯繫人詳情" />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title="聯繫人詳情" />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">找不到聯繫人</p>
        </div>
      </div>
    );
  }

  const detailContact = {
                id: contact.id as string,
                createdAt: contact.createdAt as string | undefined,
                lastSeenAt: (contact.lastActiveAt || contact.updatedAt) as string | undefined,
                name: (contact.displayName || contact.name) as string,
                phone: contact.phone as string | undefined,
                email: contact.email as string | undefined,
                avatar: (contact.avatarUrl || contact.avatar) as string | undefined,
                channelIdentities: (
                  contact.channelIdentities as Array<{
                    id: string;
                    channelType: string;
                    uid: string;
                    profileName?: string;
                    channel?: { id: string; displayName: string; channelType: string };
                  }> | undefined
                )?.map((ci) => ({
                  id: ci.id,
                  channelType: ci.channelType || ci.channel?.channelType || '',
                  externalId: ci.uid || '',
                  displayName: ci.profileName || undefined,
                  // 同一租戶可能接多個 LINE OA／粉專，要顯示是哪一個渠道
                  channelName: ci.channel?.displayName,
                })),
                tags: (
                  contact.tags as Array<{
                    id: string;
                    tagId: string;
                    tag: { id: string; name: string; color?: string };
                  }> | undefined
                )?.map((ct) => ({
                  id: ct.tag?.id || ct.tagId || ct.id,
                  name: ct.tag?.name || '',
                  color: ct.tag?.color,
                })),
                attributes: contact.attributes
                  ? Object.fromEntries(
                      (contact.attributes as Array<{ key: string; value: string }>).map(
                        (a) => [a.key, a.value]
                      )
                    )
                  : undefined,
              };
  const detailHandlers = {
    emailFieldKey,
    onRequestEmailMerge: (other: { id: string; displayName: string }, email: string) => {
      setEmailMergeError(null);
      setEmailMerge({ other, email });
      setShowMergeModal(true);
    },
    onUpdate: () => {
      fetchContact();
      // 解除合併會把對話搬回另一位聯絡人，時間軸與對話紀錄也要跟著更新
      fetchTimeline();
      setHistoryKey((k) => k + 1);
    },
  };

  // 版面依 Claude Design「聯繫人詳情」：標題列＋合併按鈕、頂部聯繫人卡、左側活動時間軸、右側渠道身份與標籤
  return (
    <div className="flex h-full flex-col">
      <Topbar title="聯繫人詳情" description="檢視互動歷程、綁定渠道與標籤，若為重複建檔可執行合併">
        <Button variant="outline" size="lg" onClick={() => setShowMergeModal(true)}>
          <Merge />
          合併聯繫人
        </Button>
      </Topbar>
      <div className="flex flex-1 flex-col gap-5 overflow-auto px-8 pb-8">
        {emailMergeError && <p role="alert" className="text-sm text-destructive">{emailMergeError}</p>}
        <ContactDetail contact={detailContact} section="profile" {...detailHandlers} />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* 左：活動時間軸／對話紀錄（Claude Design 只有時間軸，對話紀錄是原有功能，以分頁保留） */}
          <div className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-background p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as 'timeline' | 'messages')}>
                <TabsList>
                  <TabsTrigger value="timeline">活動時間軸</TabsTrigger>
                  <TabsTrigger value="messages">對話紀錄</TabsTrigger>
                </TabsList>
              </Tabs>
              {rightTab === 'timeline' && (
                <span className="text-xs tabular-nums text-muted-foreground">{timeline.length} 筆</span>
              )}
            </div>
            {rightTab === 'timeline' ? (
              <ContactTimeline events={timeline} />
            ) : (
              <ContactConversationHistory key={historyKey} contactId={contactId} />
            )}
          </div>

          {/* 右：渠道身份、標籤、自訂屬性、合併紀錄 */}
          <ContactDetail contact={detailContact} section="side" {...detailHandlers} />
        </div>
      </div>

      <ContactMergeModal
        open={showMergeModal}
        primaryContact={{
          id: contact.id as string,
          displayName: (contact.displayName || contact.name) as string,
          phone: contact.phone as string | undefined,
          avatarUrl: (contact.avatarUrl || contact.avatar) as string | undefined,
          channelIdentities: (
            contact.channelIdentities as Array<{
              id: string;
              channelType: string;
              uid: string;
              profileName?: string;
            }> | undefined
          ),
        }}
        initialSecondary={emailMerge?.other ?? null}
        onOpenChange={(open) => {
          setShowMergeModal(open);
          if (!open) setEmailMerge(null);
        }}
        onMergeComplete={async (mergedContactId) => {
          // 對方已封存，email 不再重複，直接寫入。客服在視窗中改選了別人時，原本的 email 仍屬於對方，不寫入
          if (emailMerge && mergedContactId === emailMerge.other.id) {
            try {
              await api.patch(`/contacts/${contactId}`, { email: emailMerge.email || null });
            } catch (err) {
              setEmailMergeError(getApiErrorMessage(err, '已合併，但 email 沒有寫入，請重新編輯 email'));
            }
            setEmailFieldKey((k) => k + 1);
          }
          setEmailMerge(null);
          fetchContact();
          fetchTimeline();
          setHistoryKey((k) => k + 1);
        }}
      />
    </div>
  );
}
