'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2, Merge } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Topbar } from '@/components/layout/Topbar';
import { ContactDetail } from '@/components/contact/ContactDetail';
import { ContactTimeline } from '@/components/contact/ContactTimeline';
import { ContactMergeModal } from '@/components/contact/ContactMergeModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

  return (
    <div className="flex h-full flex-col">
      <Topbar title="聯繫人詳情">
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
            合併聯繫人
          </Button>
        </div>
      </Topbar>
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
          {/* Left - Contact Info */}
          <div>
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
                  displayName: ci.profileName || ci.channel?.displayName,
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
              onUpdate={() => {
                fetchContact();
              }}
            />
          </div>

          {/* Right - Timeline */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">活動時間軸</CardTitle>
              </CardHeader>
              <CardContent>
                <ContactTimeline events={timeline} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <ContactMergeModal
        open={showMergeModal}
        onOpenChange={setShowMergeModal}
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
        onMergeComplete={() => {
          fetchContact();
          fetchTimeline();
        }}
      />
    </div>
  );
}
