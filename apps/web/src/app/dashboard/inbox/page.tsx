'use client';

import React, { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import api from '@/lib/api';
import { InboxHeader } from '@/components/inbox/InboxHeader';
import { ConversationList } from '@/components/inbox/ConversationList';
import { ChatWindow } from '@/components/inbox/ChatWindow';
import { ContactInfoPanel } from '@/components/inbox/ContactInfoPanel';
import { HandoffModal } from '@/components/inbox/HandoffModal';

export default function InboxPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const convId = searchParams.get('conv');

  const [showAiSuggest, setShowAiSuggest] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);

  const { data: convData, mutate: mutateConversation } = useSWR(
    convId ? `/conversations/${convId}` : null,
    (url: string) => api.get(url).then((res) => res.data.data)
  );
  const selectedConversation: Record<string, unknown> | null = convData ?? null;

  const handleSelectConversation = (id: string) => {
    setShowAiSuggest(false);
    setShowHandoffModal(false);
    router.push(`/dashboard/inbox?conv=${id}`, { scroll: false });
  };

  const contact = selectedConversation?.contact as Record<string, unknown> | undefined;
  const caseData = selectedConversation?.case as Record<string, unknown> | undefined;
  const chatConversation = selectedConversation
    ? {
        id: selectedConversation.id as string,
        contact: contact ? {
          id: contact.id as string,
          name: (contact.name || contact.displayName) as string | undefined,
          displayName: contact.displayName as string | undefined,
          avatar: (contact.avatar || contact.avatarUrl) as string | undefined,
        } : undefined,
        channelType: selectedConversation.channelType as string,
        status: selectedConversation.status as string,
        assignedToId: (selectedConversation.assignedToId as string | undefined) || null,
      }
    : null;

  const infoPanelConversation = selectedConversation
    ? {
        id: selectedConversation.id as string,
        status: selectedConversation.status as string,
        botRepliesCount: (selectedConversation.botRepliesCount as number) || 0,
        contact: contact ? {
          id: contact.id as string,
          name: (contact.name || contact.displayName) as string | undefined,
          displayName: contact.displayName as string | undefined,
          phone: contact.phone as string | undefined,
          email: contact.email as string | undefined,
          avatar: (contact.avatar || contact.avatarUrl) as string | undefined,
          channelIdentities: contact.channelIdentities as Array<{
            id: string;
            channelType: string;
            externalId: string;
            displayName?: string;
          }> | undefined,
          tags: contact.tags as Array<{
            id: string;
            name: string;
            color?: string;
          }> | undefined,
          attributes: contact.attributes as Array<{
            id: string;
            key: string;
            value: string;
          }> | undefined,
        } : undefined,
        channelType: selectedConversation.channelType as string,
        case: caseData ? {
          id: caseData.id as string,
          title: caseData.title as string,
          status: caseData.status as string,
          priority: caseData.priority as string,
          csatScore: caseData.csatScore as number | undefined,
          firstResponseAt: caseData.firstResponseAt as string | undefined,
          resolvedAt: caseData.resolvedAt as string | undefined,
          closedAt: caseData.closedAt as string | undefined,
        } : undefined,
      }
    : null;

  return (
    <div className="flex h-full flex-col">
      <InboxHeader />

      <div className="flex h-[calc(100%-72px)]">
        <div className="w-80 shrink-0 border-r">
          <ConversationList
            selectedId={convId}
            onSelect={handleSelectConversation}
          />
        </div>

<div className="relative flex-1">
          <ChatWindow
            conversation={chatConversation}
            showAiSuggest={showAiSuggest}
            onAiSuggestToggle={() => setShowAiSuggest((v) => !v)}
          />
          {convId && (
            <HandoffModal
              open={showHandoffModal}
              onClose={() => setShowHandoffModal(false)}
              conversationId={convId}
              onConfirm={() => mutateConversation()}
            />
          )}
        </div>

        <div className="w-[328px] shrink-0 border-l">
          <ContactInfoPanel conversation={infoPanelConversation} />
        </div>
      </div>
    </div>
  );
}
