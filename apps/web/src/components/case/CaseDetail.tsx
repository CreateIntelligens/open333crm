'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  MessageSquare,
  User,
  Clock,
  Shield,
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { CaseStatusBadge } from './CaseStatusBadge';
import { SlaCountdown } from '@/components/shared/SlaCountdown';

// Valid transitions per spec
const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['PENDING', 'RESOLVED', 'ESCALATED', 'CLOSED'],
  PENDING: ['IN_PROGRESS', 'ESCALATED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  ESCALATED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['OPEN'],
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: '開啟',
  IN_PROGRESS: '處理中',
  PENDING: '待處理',
  RESOLVED: '已解決',
  ESCALATED: '已升級',
  CLOSED: '已關閉',
};

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: '低' },
  { value: 'MEDIUM', label: '中' },
  { value: 'HIGH', label: '高' },
  { value: 'URGENT', label: '緊急' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: '未分類' },
  { value: '產品諮詢', label: '產品諮詢' },
  { value: '訂單問題', label: '訂單問題' },
  { value: '退換貨', label: '退換貨' },
  { value: '帳號問題', label: '帳號問題' },
  { value: '技術支援', label: '技術支援' },
  { value: '投訴建議', label: '投訴建議' },
  { value: '付款問題', label: '付款問題' },
  { value: '物流配送', label: '物流配送' },
  { value: '其他', label: '其他' },
];

interface CaseDetailProps {
  caseData: {
    id: string;
    title: string;
    description?: string;
    status: string;
    priority: string;
    category?: string;
    assignee?: { id: string; name: string };
    team?: { id: string; name: string };
    contact?: {
      id: string;
      displayName?: string;
      name?: string;
      phone?: string;
      email?: string;
      channelIdentities?: Array<{ id: string; channelType: string; uid: string; profileName?: string }>;
      tags?: Array<{ tag: { id: string; name: string; color: string } }>;
    };
    conversationId?: string;
    slaDueAt?: string;
    slaPolicy?: string;
    slaPolicyData?: { firstResponseMinutes: number; resolutionMinutes: number } | null;
    events?: Array<{ id: string; eventType?: string; actorType?: string; createdAt: string }>;
    createdAt: string;
    updatedAt: string;
  };
  onRefresh: () => void;
}

const CHANNEL_TYPE_LABELS: Record<string, string> = {
  LINE: 'LINE',
  FACEBOOK: 'FB',
  WEBCHAT: 'WebChat',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'IG',
  API: 'API',
};

export function CaseDetail({ caseData, onRefresh }: CaseDetailProps) {
  const [agents, setAgents] = useState<Array<{ id: string; name: string; team?: { id: string; name: string } | null }>>([]);
  const [saving, setSaving] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(caseData.title);

  useEffect(() => {
    api
      .get('/agents')
      .then((res) => setAgents(res.data.data || []))
      .catch(() => {});
  }, []);

  const teams = agents.reduce<Array<{ id: string; name: string }>>((acc, a) => {
    const t = a.team;
    if (t && !acc.find((x) => x.id === t.id)) { acc.push(t); }
    return acc;
  }, []);

  const handleTitleBlur = async () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim().slice(0, 100);
    if (trimmed && trimmed !== caseData.title) {
      await handlePatch({ title: trimmed });
    } else {
      setTitleDraft(caseData.title);
    }
  };

  // SLA first response check
  const slaFirstResponseMet = (() => {
    if (!caseData.slaPolicyData?.firstResponseMinutes || !caseData.events) { return null; }
    const firstAgentEvent = [...caseData.events]
      .reverse()
      .find((e) => e.actorType === 'agent' && e.eventType !== 'created');
    if (!firstAgentEvent) { return null; } // no agent response yet
    const caseCreated = new Date(caseData.createdAt).getTime();
    const firstResponse = new Date(firstAgentEvent.createdAt).getTime();
    const diffMinutes = (firstResponse - caseCreated) / 60000;
    return diffMinutes <= caseData.slaPolicyData.firstResponseMinutes;
  })();

  const handlePatch = async (data: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.patch(`/cases/${caseData.id}`, data);
      onRefresh();
    } catch (err) {
      console.error('Failed to update case:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === 'CLOSED') {
      setShowCloseConfirm(true);
      return;
    }
    await handlePatch({ status: newStatus });
  };

  const handleConfirmClose = async () => {
    setShowCloseConfirm(false);
    await handlePatch({ status: 'CLOSED' });
  };

  const handleAssign = async (assigneeId: string) => {
    if (assigneeId) {
      await api.post(`/cases/${caseData.id}/assign`, { assigneeId });
    } else {
      await handlePatch({ assigneeId: null });
    }
    onRefresh();
  };

  // Build status transition options
  const allowedStatuses = VALID_TRANSITIONS[caseData.status] || [];
  const statusOptions = [
    { value: caseData.status, label: `${STATUS_LABELS[caseData.status] || caseData.status}（目前）` },
    ...allowedStatuses.map((s) => ({ value: s, label: STATUS_LABELS[s] || s })),
  ];

  const contactDisplayName = caseData.contact?.displayName || caseData.contact?.name || '未知';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0 mr-3">
            {editingTitle ? (
              <input
                className="w-full text-xl font-semibold border-b border-primary bg-transparent outline-none"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value.slice(0, 100))}
                onBlur={handleTitleBlur}
                onKeyDown={(e) => { if (e.key === 'Enter') { handleTitleBlur(); } if (e.key === 'Escape') { setTitleDraft(caseData.title); setEditingTitle(false); } }}
                maxLength={100}
              />
            ) : (
              <CardTitle
                className="text-xl cursor-pointer hover:text-primary transition-colors"
                onClick={() => { setTitleDraft(caseData.title); setEditingTitle(true); }}
                title="點擊編輯標題"
              >
                {caseData.title}
              </CardTitle>
            )}
            <p className="mt-1 text-sm text-muted-foreground font-mono">
              #{caseData.id.slice(0, 8)}
            </p>
          </div>
          <CaseStatusBadge status={caseData.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Description */}
        {caseData.description && (
          <div>
            <h4 className="mb-1 text-sm font-medium text-muted-foreground">描述</h4>
            <p className="text-sm">{caseData.description}</p>
          </div>
        )}

        <Separator />

        {/* Status Dropdown */}
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">狀態</h4>
          <Select
            value={caseData.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            disabled={saving}
            options={statusOptions}
            className="max-w-xs"
          />
        </div>

        <Separator />

        {/* Priority Dropdown */}
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">優先級</h4>
          <Select
            value={caseData.priority}
            onChange={(e) => handlePatch({ priority: e.target.value })}
            disabled={saving}
            options={PRIORITY_OPTIONS}
            className="max-w-xs"
          />
        </div>

        <Separator />

        {/* Category Dropdown */}
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">分類</h4>
          <Select
            value={caseData.category || ''}
            onChange={(e) => handlePatch({ category: e.target.value })}
            disabled={saving}
            options={CATEGORY_OPTIONS}
            className="max-w-xs"
          />
          {caseData.category && (
            <p className="mt-1 text-[11px] text-muted-foreground">🤖 AI 自動分類</p>
          )}
        </div>

        <Separator />

        {/* Assignee */}
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">負責人</h4>
          <Select
            value={caseData.assignee?.id || ''}
            onChange={(e) => handleAssign(e.target.value)}
            disabled={saving}
            options={[
              { value: '', label: '未指派' },
              ...agents.map((a) => ({ value: a.id, label: a.name })),
            ]}
            className="max-w-xs"
          />
        </div>

        <Separator />

        {/* Team */}
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">團隊</h4>
          <Select
            value={caseData.team?.id || ''}
            onChange={(e) => handlePatch({ teamId: e.target.value || null })}
            disabled={saving}
            options={[
              { value: '', label: '未指定' },
              ...teams.map((t) => ({ value: t.id, label: t.name })),
            ]}
            className="max-w-xs"
          />
        </div>

        <Separator />

        {/* SLA Block */}
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground flex items-center gap-1">
            <Shield className="h-4 w-4" />
            SLA
          </h4>
          <div className="space-y-1.5 text-sm">
            {caseData.slaPolicy && (
              <p className="text-muted-foreground">
                政策：<span className="font-medium text-foreground">{caseData.slaPolicy}</span>
              </p>
            )}
            {caseData.slaPolicyData?.firstResponseMinutes != null && (
              <p className="text-muted-foreground">
                首次回應：
                {slaFirstResponseMet === true && <span className="text-green-600 font-medium ml-1">已達 ✓</span>}
                {slaFirstResponseMet === false && <span className="text-red-600 font-medium ml-1">未達 ✗</span>}
                {slaFirstResponseMet === null && <span className="text-yellow-600 ml-1">待回應</span>}
              </p>
            )}
            {caseData.slaPolicyData?.resolutionMinutes != null && (
              <p className="text-muted-foreground">
                解決目標：<span className="font-medium text-foreground">{caseData.slaPolicyData.resolutionMinutes / 60} 小時</span>
              </p>
            )}
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <SlaCountdown deadline={caseData.slaDueAt || null} />
            </div>
          </div>
        </div>

        <Separator />

        {/* Linked Conversation */}
        {caseData.conversationId && (
          <>
            <div>
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                關聯對話
              </h4>
              <Link
                href={`/dashboard/inbox?conv=${caseData.conversationId}`}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <MessageSquare className="h-4 w-4" />
                查看對話
              </Link>
            </div>
            <Separator />
          </>
        )}

        {/* Contact Info */}
        {caseData.contact && (
          <>
            <div>
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">聯繫人</h4>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <Link
                  href={`/dashboard/contacts/${caseData.contact.id}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {contactDisplayName}
                </Link>
              </div>
              {caseData.contact.phone && (
                <Badge variant="outline" className="mt-1 mr-1 text-xs">
                  {caseData.contact.phone}
                </Badge>
              )}
              {caseData.contact.email && (
                <Badge variant="outline" className="mt-1 text-xs">
                  {caseData.contact.email}
                </Badge>
              )}
              {/* Channel Identity Pills */}
              {caseData.contact.channelIdentities && caseData.contact.channelIdentities.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {caseData.contact.channelIdentities.map((ci) => (
                    <Badge key={ci.id} className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200">
                      {CHANNEL_TYPE_LABELS[ci.channelType] || ci.channelType}
                    </Badge>
                  ))}
                </div>
              )}
              {/* Contact Tags */}
              {caseData.contact.tags && caseData.contact.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {caseData.contact.tags.map((ct) => (
                    <Badge
                      key={ct.tag.id}
                      variant="outline"
                      className="text-xs"
                      style={{ borderColor: ct.tag.color, color: ct.tag.color }}
                    >
                      {ct.tag.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <Separator />
          </>
        )}

        {/* Timestamps */}
        <div className="flex gap-6 text-xs text-muted-foreground">
          <div>
            <span className="font-medium">建立時間：</span>{' '}
            {format(new Date(caseData.createdAt), 'MMM d, yyyy HH:mm')}
          </div>
          <div>
            <span className="font-medium">更新時間：</span>{' '}
            {format(new Date(caseData.updatedAt), 'MMM d, yyyy HH:mm')}
          </div>
        </div>
      </CardContent>

      {/* Close Confirmation Dialog */}
      <Dialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>確認關閉案件</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            確定要關閉此案件嗎？關閉後可從已關閉清單重新開啟。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloseConfirm(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleConfirmClose}>
              確認關閉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
