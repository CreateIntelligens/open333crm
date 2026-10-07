'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2, Merge } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { Button } from '@/components/ui/button';
import { Topbar } from '@/components/layout/Topbar';
import { ContactDetail } from '@/components/contact/ContactDetail';
import { ContactTimeline } from '@/components/contact/ContactTimeline';
import { ContactMergeModal } from '@/components/contact/ContactMergeModal';
import { ContactConversationHistory } from '@/components/contact/ContactConversationHistory';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
        <Topbar title="聯絡人詳情" />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title="聯絡人詳情" />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">找不到聯絡人</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Topbar title="聯絡人詳情">
        <div className="flex items-center gap-2">
          <Link href="/dashboard/contacts">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              返回
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMergeModal(true)}
          >
            <Merge className="mr-1 h-4 w-4" />
            合併聯絡人
          </Button>
        </div>
      </Topbar>
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
          {/* Left - Contact Info */}
          <div>
            {emailMergeError && <p className="mb-3 text-sm text-destructive">{emailMergeError}</p>}
            <ContactDetail
              contact={{
                id: contact.id as string,
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
              }}
              onRequestEmailMerge={(other, email) => {
                setEmailMergeError(null);
                setEmailMerge({ other, email });
                setShowMergeModal(true);
              }}
              onUpdate={() => {
                fetchContact();
                // 解除合併會把對話搬回另一位聯絡人，時間軸與對話紀錄也要跟著更新
                fetchTimeline();
                setHistoryKey((k) => k + 1);
              }}
            />
          </div>

          {/* Right - Timeline / 對話紀錄 */}
          <div>
            <Card>
              <CardHeader>
                {/* Tabs 只把選中的值傳給直接子元件，TabsList 必須是 Tabs 的直接子元件 */}
                <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as 'timeline' | 'messages')}>
                  <TabsList>
                    <TabsTrigger value="timeline">活動時間軸</TabsTrigger>
                    <TabsTrigger value="messages">對話紀錄</TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent>
                {rightTab === 'timeline' ? (
                  <ContactTimeline events={timeline} />
                ) : (
                  <ContactConversationHistory key={historyKey} contactId={contactId} />
                )}
              </CardContent>
            </Card>
          </div>
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
        onMergeComplete={async () => {
          // 對方已封存，email 不再重複，直接寫入
          if (emailMerge) {
            try {
              await api.patch(`/contacts/${contactId}`, { email: emailMerge.email || null });
            } catch (err) {
              setEmailMergeError(getApiErrorMessage(err, '已合併，但 email 沒有寫入，請重新編輯 email'));
            }
            setEmailMerge(null);
          }
          fetchContact();
          fetchTimeline();
          setHistoryKey((k) => k + 1);
        }}
      />
    </div>
  );
}
