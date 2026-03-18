'use client';

import React, { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle } from 'lucide-react';

const ESCALATION_REASONS = [
  'SLA 即將違規',
  'SLA 已違規',
  '客戶多次催促',
  '負面情緒',
  '其他',
];

const PRIORITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const PRIORITY_LABELS: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  URGENT: '緊急',
};

interface EscalationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseData: {
    id: string;
    title: string;
    priority: string;
    status: string;
    contact?: { id: string; displayName?: string };
    assignee?: { id: string; name: string };
  };
  onSuccess: () => void;
}

export function EscalationModal({
  open,
  onOpenChange,
  caseData,
  onSuccess,
}: EscalationModalProps) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [newPriority, setNewPriority] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [notifySupervisor, setNotifySupervisor] = useState(true);
  const [notifyOriginal, setNotifyOriginal] = useState(true);
  const [notifyTeam, setNotifyTeam] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [agents, setAgents] = useState<Array<{ id: string; name: string; _count?: { assignedCases: number } }>>([]);

  // Load agents
  useEffect(() => {
    if (!open) return;
    api.get('/agents').then((res) => setAgents(res.data.data || [])).catch(() => {});
  }, [open]);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setReason('');
      setNote('');
      // Default new priority to one level above current
      const currentIdx = PRIORITY_ORDER.indexOf(caseData.priority);
      const nextPriority = currentIdx < PRIORITY_ORDER.length - 1
        ? PRIORITY_ORDER[currentIdx + 1]
        : PRIORITY_ORDER[PRIORITY_ORDER.length - 1];
      setNewPriority(nextPriority);
      setAssigneeId('');
      setNotifySupervisor(true);
      setNotifyOriginal(true);
      setNotifyTeam(false);
      setError('');
    }
  }, [open, caseData.priority]);

  // Only allow priorities higher than current
  const currentPriorityIdx = PRIORITY_ORDER.indexOf(caseData.priority);
  const higherPriorities = PRIORITY_ORDER.filter((_, i) => i > currentPriorityIdx).map((p) => ({
    value: p,
    label: PRIORITY_LABELS[p] || p,
  }));
  // If already URGENT, allow keeping URGENT
  if (higherPriorities.length === 0) {
    higherPriorities.push({ value: 'URGENT', label: '緊急' });
  }

  const handleSubmit = async () => {
    if (!reason) {
      setError('請選擇升級原因');
      return;
    }
    if (!newPriority) {
      setError('請選擇升級後優先級');
      return;
    }

    setIsSubmitting(true);
    setError('');

    const notifyTargets: string[] = [];
    if (notifySupervisor) notifyTargets.push('supervisor');
    if (notifyOriginal) notifyTargets.push('original_assignee');
    if (notifyTeam) notifyTargets.push('team');

    try {
      await api.post(`/cases/${caseData.id}/escalate`, {
        reason,
        note: note.trim() || undefined,
        newPriority,
        assigneeId: assigneeId || undefined,
        notifyTargets,
      });

      onOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || '升級失敗');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            案件升級
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          {/* Case Summary */}
          <div className="rounded-lg bg-muted p-3 space-y-1">
            <p className="text-sm">
              <span className="text-muted-foreground">案件編號：</span>
              <span className="font-mono">#{caseData.id.slice(0, 8)}</span>
            </p>
            <p className="text-sm font-medium">{caseData.title}</p>
            <div className="flex gap-2 mt-1">
              {caseData.contact?.displayName && (
                <Badge variant="outline" className="text-xs">
                  {caseData.contact.displayName}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {PRIORITY_LABELS[caseData.priority] || caseData.priority}
              </Badge>
              {caseData.assignee && (
                <Badge variant="outline" className="text-xs">
                  {caseData.assignee.name}
                </Badge>
              )}
            </div>
          </div>

          <Separator />

          {/* Reason */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              升級原因 <span className="text-destructive">*</span>
            </label>
            <Select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              options={[
                { value: '', label: '請選擇原因' },
                ...ESCALATION_REASONS.map((r) => ({ value: r, label: r })),
              ]}
            />
            {/* Quick-select chips */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {ESCALATION_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                    reason === r
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input hover:bg-muted'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="mb-1 block text-sm font-medium">補充說明</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="描述升級原因..."
              rows={3}
              maxLength={500}
            />
            <p className="mt-0.5 text-xs text-muted-foreground text-right">{note.length}/500</p>
          </div>

          {/* New Priority */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              升級後優先級 <span className="text-destructive">*</span>
            </label>
            <div className="flex items-center gap-3">
              <Select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value)}
                options={higherPriorities}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                原來：{PRIORITY_LABELS[caseData.priority] || caseData.priority}
              </span>
            </div>
          </div>

          {/* Reassign */}
          <div>
            <label className="mb-1 block text-sm font-medium">重新指派給</label>
            <Select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              options={[
                { value: '', label: '維持原負責人' },
                ...agents.map((a) => ({
                  value: a.id,
                  label: `${a.name}${a._count?.assignedCases != null ? ` (${a._count.assignedCases} 件)` : ''}`,
                })),
              ]}
            />
            {!assigneeId && (
              <p className="mt-1 text-xs text-muted-foreground">不選則維持原指派人</p>
            )}
          </div>

          {/* Notification Targets */}
          <div>
            <label className="mb-2 block text-sm font-medium">通知對象</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={notifySupervisor}
                  onChange={(e) => setNotifySupervisor(e.target.checked)}
                  className="rounded border-input"
                />
                Supervisor（主管）
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={notifyOriginal}
                  onChange={(e) => setNotifyOriginal(e.target.checked)}
                  className="rounded border-input"
                />
                原負責客服
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={notifyTeam}
                  onChange={(e) => setNotifyTeam(e.target.checked)}
                  className="rounded border-input"
                />
                團隊群組通知
              </label>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? '升級中...' : '確認升級'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
