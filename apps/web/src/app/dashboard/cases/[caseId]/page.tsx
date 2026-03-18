'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle, XCircle, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Topbar } from '@/components/layout/Topbar';
import { CaseDetail } from '@/components/case/CaseDetail';
import { CaseTimeline } from '@/components/case/CaseTimeline';
import { EscalationModal } from '@/components/case/EscalationModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
    }
  };

  const handleClose = async () => {
    try {
      await api.post(`/cases/${caseId}/close`);
      fetchCase();
    } catch (err) {
      console.error('Failed to close case:', err);
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

  return (
    <div className="flex h-full flex-col">
      <Topbar title="工單詳情">
        <div className="flex items-center gap-2">
          <Link href="/dashboard/cases">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              返回
            </Button>
          </Link>
          {canResolve && (
            <Button variant="default" size="sm" onClick={handleResolve}>
              <CheckCircle className="mr-1 h-4 w-4" />
              標記解決
            </Button>
          )}
          {canClose && (
            <Button variant="outline" size="sm" onClick={handleClose}>
              <XCircle className="mr-1 h-4 w-4" />
              關閉案件
            </Button>
          )}
          {canReopen && (
            <Button variant="outline" size="sm" onClick={handleReopen}>
              <RotateCcw className="mr-1 h-4 w-4" />
              重新開啟
            </Button>
          )}
          {canEscalate && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowEscalation(true)}
            >
              <AlertTriangle className="mr-1 h-4 w-4" />
              升級
            </Button>
          )}
        </div>
      </Topbar>

      {/* Breadcrumb */}
      <div className="border-b px-6 py-2">
        <nav className="flex items-center text-sm text-muted-foreground">
          <Link href="/dashboard/cases" className="hover:text-foreground">
            案件
          </Link>
          <span className="mx-2">/</span>
          <span className="font-medium text-foreground">
            #{(caseData.id as string).slice(0, 8)}
          </span>
        </nav>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
          {/* Left - Case Detail */}
          <div>
            <CaseDetail
              caseData={{
                id: caseData.id as string,
                title: caseData.title as string,
                description: caseData.description as string | undefined,
                status: caseData.status as string,
                priority: caseData.priority as string,
                category: caseData.category as string | undefined,
                assignee: caseData.assignee as { id: string; name: string } | undefined,
                team: caseData.team as { id: string; name: string } | undefined,
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
              }}
              onRefresh={fetchCase}
            />
          </div>

          {/* Right - Timeline */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">時間軸與備註</CardTitle>
              </CardHeader>
              <CardContent>
                <CaseTimeline
                  caseId={caseId}
                  events={events}
                  notes={notes}
                  onRefresh={fetchCase}
                />
              </CardContent>
            </Card>
          </div>
        </div>
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
