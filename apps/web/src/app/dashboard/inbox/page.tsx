'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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

  const [selectedConversation, setSelectedConversation] = useState<Record<string, unknown> | null>(null);
  const [showAiSuggest, setShowAiSuggest] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);

  // Fetch selected conversation details
  useEffect(() => {
    if (!convId) {
      setSelectedConversation(null);
      return;
    }

    api
      .get(`/conversations/${convId}`)
      .then((res) => setSelectedConversation(res.data.data))
      .catch((err) => {
        console.error('Failed to fetch conversation:', err);
        setSelectedConversation(null);
      });
  }, [convId]);

  const handleSelectConversation = (id: string) => {
    setShowAiSuggest(false);
    setShowHandoffModal(false);
    router.push(`/dashboard/inbox?conv=${id}`, { scroll: false });
  };

  const refreshConversation = useCallback(() => {
    if (!convId) return;
    api
      .get(`/conversations/${convId}`)
      .then((res) => setSelectedConversation(res.data.data))
      .catch(() => {});
  }, [convId]);

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
    <div className="flex h-full">
      {/* Left panel - Conversation List */}
      <div className="w-80 shrink-0 border-r">
        <ConversationList
          selectedId={convId}
          onSelect={handleSelectConversation}
        />
      </div>

      {/* Center panel - Chat Window */}
      <div className="relative flex-1">
        <ChatWindow
          conversation={chatConversation}
          onShowAiSuggest={() => setShowAiSuggest((v) => !v)}
          showAiSuggest={showAiSuggest}
        />
        {/* AI Suggest Panel */}
        {convId && (
          <AiSuggestPanel
            open={showAiSuggest}
            onClose={() => setShowAiSuggest(false)}
            conversationId={convId}
            onAdopt={(text) => {
              // We'll use a simple approach: set the text in MessageInput via state
              setShowAiSuggest(false);
              // Trigger a custom event for the MessageInput to pick up
              window.dispatchEvent(new CustomEvent('ai-adopt', { detail: { text } }));
            }}
          />
        )}
        {/* Handoff Modal */}
        {convId && (
          <HandoffModal
            open={showHandoffModal}
            onClose={() => setShowHandoffModal(false)}
            conversationId={convId}
            onConfirm={refreshConversation}
          />
        )}
      </div>

      {/* Right panel - Contact Info */}
      <div className="w-72 shrink-0 border-l">
        <ContactInfoPanel conversation={infoPanelConversation} />
      </div>
    </div>
  );
}
