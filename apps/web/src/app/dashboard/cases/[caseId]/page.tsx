'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Topbar } from '@/components/layout/Topbar';
import { CaseDetail } from '@/components/case/CaseDetail';
import { CaseTimeline } from '@/components/case/CaseTimeline';
import { EscalationModal } from '@/components/case/EscalationModal';
import { getApiErrorMessage } from '@/lib/api-error';

export default function CaseDetailPage() {
  const params = useParams();
  const caseId = params.caseId as string;

  const [caseData, setCaseData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEscalation, setShowEscalation] = useState(false);

  const fetchCase = useCallback(async () => {
    try {
      const res = await api.get(`/cases/${caseId}`);
      setCaseData(res.data.data);
    } catch (err) {
      console.error('Failed to fetch case:', err);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchCase();
  }, [fetchCase]);

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title="工單詳情" />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title="工單詳情" />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">找不到工單</p>
        </div>
      </div>
    );
  }

  const status = caseData.status as string;
  const canEscalate = ['OPEN', 'IN_PROGRESS', 'PENDING'].includes(status);
  const canResolve = ['OPEN', 'IN_PROGRESS', 'PENDING', 'ESCALATED'].includes(status);
  const canClose = status !== 'CLOSED';
  const canReopen = status === 'CLOSED';

  const handleResolve = async () => {
    try {
      await api.post(`/cases/${caseId}/resolve`);
      fetchCase();
    } catch (err) {
      console.error('Failed to resolve case:', err);
      alert(getApiErrorMessage(err, '結案失敗，請稍後重試'));
    }
  };

  const handleClose = async () => {
    try {
      await api.post(`/cases/${caseId}/close`);
      fetchCase();
    } catch (err) {
      console.error('Failed to close case:', err);
      alert(getApiErrorMessage(err, '關閉案件失敗，請稍後重試'));
    }
  };

  const handleReopen = async () => {
    try {
      await api.post(`/cases/${caseId}/reopen`);
      fetchCase();
    } catch (err) {
      console.error('Failed to reopen case:', err);
    }
  };

  const events = (caseData.events || []) as Array<{
    id: string;
    type: string;
    description?: string;
    content?: string;
    isInternal?: boolean;
    createdBy?: string;
    agentName?: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>;
  const notes = (caseData.notes || []) as Array<{
    id: string;
    content: string;
    isInternal: boolean;
    agentName?: string;
    createdAt: string;
  }>;

  const detailProps = {
    caseData: {
                id: caseData.id as string,
                title: caseData.title as string,
                description: caseData.description as string | undefined,
                status: caseData.status as string,
                priority: caseData.priority as string,
                category: caseData.category as string | undefined,
                assignee: caseData.assignee as { id: string; name: string } | undefined,
                team: caseData.team as { id: string; name: string } | undefined,
                tags: caseData.tags as Array<{
                  tag: { id: string; name: string; color?: string; type?: string; scope?: 'CASE' };
                }> | undefined,
                contact: caseData.contact as {
                  id: string;
                  displayName?: string;
                  name?: string;
                  phone?: string;
                  email?: string;
                  channelIdentities?: Array<{ id: string; channelType: string; uid: string; profileName?: string }>;
                  tags?: Array<{ tag: { id: string; name: string; color: string } }>;
                } | undefined,
                conversationId: (caseData.conversation as { id?: string } | undefined)?.id,
                slaDueAt: caseData.slaDueAt as string | undefined,
                slaPolicy: caseData.slaPolicy as string | undefined,
                slaPolicyData: caseData.slaPolicyData as { firstResponseMinutes: number; resolutionMinutes: number } | null | undefined,
                events: events,
                createdAt: caseData.createdAt as string,
                updatedAt: caseData.updatedAt as string,
    },
    onRefresh: fetchCase,
  };

  // 版面依 Claude Design「工單詳情」：麵包屑、標題區＋右側操作、左欄（SLA、說明、關聯對話、時間軸與備註）＋右欄（屬性、標籤、聯繫人、時間戳記）
  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex flex-none flex-col gap-3 px-8 pb-6 pt-8">
        <nav aria-label="麵包屑" className="flex items-center gap-1 text-sm text-foreground">
          <Link href="/dashboard/cases" className="text-primary hover:text-primary-hover">工單</Link>
          <span aria-hidden="true">&gt;</span>
          <span aria-current="page" className="font-mono">#{(caseData.id as string).slice(0, 8)}</span>
        </nav>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Link href="/dashboard/cases" aria-label="返回工單列表" title="返回工單列表">
              <Button variant="subtle" size="icon-sm"><ArrowLeft /></Button>
            </Link>
            <div className="min-w-0 flex-1">
              <CaseDetail {...detailProps} section="header" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEscalate && (
              <Button variant="outline" size="lg" onClick={() => setShowEscalation(true)}>
                <AlertTriangle />
                升級
              </Button>
            )}
            {canReopen && (
              <Button variant="outline" size="lg" onClick={handleReopen}>
                <RotateCcw />
                重新開啟
              </Button>
            )}
            {canClose && (
              <Button variant="outline" size="lg" onClick={handleClose}>
                關閉案件
              </Button>
            )}
            {canResolve && (
              <Button size="lg" onClick={handleResolve}>
                <CheckCircle />
                標記解決
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-8 pb-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <CaseDetail {...detailProps} section="main" />
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
            <h3 className="text-sm font-semibold text-foreground">時間軸與備註</h3>
            <CaseTimeline caseId={caseId} events={events} notes={notes} onRefresh={fetchCase} />
          </div>
        </div>
        <CaseDetail {...detailProps} section="side" />
      </div>

      {/* Escalation Modal */}
      <EscalationModal
        open={showEscalation}
        onOpenChange={setShowEscalation}
        caseData={{
          id: caseData.id as string,
          title: caseData.title as string,
          priority: caseData.priority as string,
          status: caseData.status as string,
          contact: caseData.contact as { id: string; displayName?: string } | undefined,
          assignee: caseData.assignee as { id: string; name: string } | undefined,
        }}
        onSuccess={fetchCase}
      />
    </div>
  );
}
