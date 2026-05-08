'use client';

import React, { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import api from '@/lib/api';
import { ConversationList } from '@/components/inbox/ConversationList';
import { ChatWindow } from '@/components/inbox/ChatWindow';
import { ContactInfoPanel } from '@/components/inbox/ContactInfoPanel';
import { AiSuggestPanel } from '@/components/inbox/AiSuggestPanel';
import { HandoffModal } from '@/components/inbox/HandoffModal';

export default function InboxPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const convId = searchParams.get('conv');

  const [showAiSuggest, setShowAiSuggest] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);

  // Fetch selected conversation details via SWR so globalMutate from ChatWindow triggers re-render
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
        assignedToId: (selectedConversation.assignedToId as string | undefined) || null,
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
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left panel - Conversation List (Figma fixed ~310px) */}
      <div className="flex h-full min-h-0 w-[310px] shrink-0 flex-col border-r border-surface-line">
        <ConversationList
          selectedId={convId}
          onSelect={handleSelectConversation}
        />
      </div>

      {/* Center panel - Chat Window (flex-1, takes remaining space) */}
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <ChatWindow
          conversation={chatConversation}
          onShowAiSuggest={() => setShowAiSuggest((v) => !v)}
          showAiSuggest={showAiSuggest}
          aiSuggestSlot={
            convId && showAiSuggest ? (
              <AiSuggestPanel
                open={showAiSuggest}
                onClose={() => setShowAiSuggest(false)}
                conversationId={convId}
                inline
                onAdopt={(text) => {
                  setShowAiSuggest(false);
                  window.dispatchEvent(new CustomEvent('ai-adopt', { detail: { text } }));
                }}
              />
            ) : null
          }
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

      {/* Right panel - Customer Sidebar (Figma fixed ~328px) */}
      <div className="flex h-full min-h-0 w-[328px] shrink-0 flex-col border-l border-surface-line">
        <ContactInfoPanel conversation={infoPanelConversation} />
      </div>
    </div>
  );
}
