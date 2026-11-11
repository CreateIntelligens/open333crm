'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CasePriorityBadge } from '@/components/case/CasePriorityBadge';
import { SettingsHeader } from './SettingsHeader';
import { AddIcon, DeleteIcon, EditIcon } from '@/components/icons/figma-icons';
import {
  PageDialog,
  PageDialogContent,
  PageDialogHeader,
  PageDialogTitle,
  PageDialogFooter,
} from '@/components/ui/page-dialog';

interface SlaPolicy {
  id: string;
  name: string;
  priority: string;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  warningBeforeMinutes: number;
  isDefault: boolean;
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  URGENT: { label: '緊急', color: '#dc2626' },
  HIGH: { label: '高', color: '#ea580c' },
  MEDIUM: { label: '中', color: '#2563eb' },
  LOW: { label: '低', color: '#6b7280' },
};

const PRIORITY_OPTIONS = [
  { value: 'URGENT', label: '緊急' },
  { value: 'HIGH', label: '高' },
  { value: 'MEDIUM', label: '中' },
  { value: 'LOW', label: '低' },
];

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours} 小時 ${mins} 分` : `${hours} 小時`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days} 天 ${remainHours} 小時` : `${days} 天`;
}

// 欄寬依 Claude Design：政策名稱、優先級、首回、解決、預警、操作
const SLA_COLS = 'grid grid-cols-[minmax(180px,1.4fr)_100px_110px_110px_130px_96px] items-center gap-4 px-5';

export function SlaManagement() {
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<SlaPolicy | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formPriority, setFormPriority] = useState('MEDIUM');
  const [formFirstResponse, setFormFirstResponse] = useState('15');
  const [formResolution, setFormResolution] = useState('60');
  const [formWarning, setFormWarning] = useState('10');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await api.get('/sla-policies');
      setPolicies(res.data.data || []);
    } catch {
      console.error('Failed to fetch SLA policies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const openCreate = () => {
    setEditingPolicy(null);
    setFormName('');
    setFormPriority('MEDIUM');
    setFormFirstResponse('15');
    setFormResolution('60');
    setFormWarning('10');
    setFormIsDefault(false);
    setError('');
    setShowDialog(true);
  };

  const openEdit = (policy: SlaPolicy) => {
    setEditingPolicy(policy);
    setFormName(policy.name);
    setFormPriority(policy.priority);
    setFormFirstResponse(String(policy.firstResponseMinutes));
    setFormResolution(String(policy.resolutionMinutes));
    setFormWarning(String(policy.warningBeforeMinutes));
    setFormIsDefault(policy.isDefault);
    setError('');
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setError('請輸入政策名稱');
      return;
    }
    setSaving(true);
    setError('');

    const payload = {
      name: formName.trim(),
      priority: formPriority,
      firstResponseMinutes: parseInt(formFirstResponse, 10) || 15,
      resolutionMinutes: parseInt(formResolution, 10) || 60,
      warningBeforeMinutes: parseInt(formWarning, 10) || 10,
      isDefault: formIsDefault,
    };

    try {
      if (editingPolicy) {
        await api.patch(`/sla-policies/${editingPolicy.id}`, payload);
      } else {
        await api.post('/sla-policies', payload);
      }
      setShowDialog(false);
      fetchPolicies();
    } catch (err) {
      setError(getApiErrorMessage(err, '儲存失敗'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除此 SLA 政策嗎？')) return;
    try {
      await api.delete(`/sla-policies/${id}`);
      fetchPolicies();
    } catch (err) {
      // 仍有未結案工單使用時後端回 409 並說明（G20）
      alert(getApiErrorMessage(err, '刪除 SLA 政策失敗，請稍後重試'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    // 版面依 Claude Design「SLA 政策」：標題區＋建立、政策列表（名稱＋預設、優先級、首回、解決、預警、操作）；依 Figma 微調
    <div className="flex flex-col gap-5">
      <SettingsHeader title="SLA 政策" description="設定不同優先級的服務等級承諾">
        <Button size="lg" onClick={openCreate}>
          <AddIcon />
          建立 SLA 政策
        </Button>
      </SettingsHeader>

      <div role="table" aria-label="SLA 政策列表" className="overflow-hidden rounded-lg border border-border">
        <div role="row" className={`${SLA_COLS} border-b border-border bg-muted py-2 text-sm font-medium leading-7 text-muted-foreground`}>
          <span role="columnheader">政策名稱</span>
          <span role="columnheader">優先級</span>
          <span role="columnheader">首回時間</span>
          <span role="columnheader">解決時間</span>
          <span role="columnheader">預警</span>
          <span role="columnheader" className="text-right">操作</span>
        </div>
        {policies.map((policy) => (
          <div key={policy.id} role="row" className={`${SLA_COLS} border-b border-border bg-background py-3.5 text-sm transition-colors last:border-b-0 hover:bg-surface-hover`}>
            <span role="cell" className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold text-foreground">{policy.name}</span>
              {policy.isDefault && <Badge variant="outline-primary">預設</Badge>}
            </span>
            <span role="cell"><CasePriorityBadge priority={policy.priority} /></span>
            <span role="cell" className="tabular-nums text-foreground">{formatDuration(policy.firstResponseMinutes)}</span>
            <span role="cell" className="tabular-nums text-foreground">{formatDuration(policy.resolutionMinutes)}</span>
            <span role="cell" className="tabular-nums text-muted-foreground">到期前 {formatDuration(policy.warningBeforeMinutes)}</span>
            <span role="cell" className="flex items-center justify-end gap-1">
              <Button size="icon-sm" variant="ghost" onClick={() => openEdit(policy)} aria-label={`編輯「${policy.name}」`} title="編輯">
                <EditIcon />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => handleDelete(policy.id)} className="text-destructive" aria-label={`刪除「${policy.name}」`} title="刪除">
                <DeleteIcon />
              </Button>
            </span>
          </div>
        ))}
        {policies.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">尚未建立 SLA 政策</div>
        )}
      </div>

      <PageDialog section="設定" parent="SLA 政策" open={showDialog} onOpenChange={setShowDialog}>
        <PageDialogContent>
          <PageDialogHeader>
            <PageDialogTitle>
              {editingPolicy ? '編輯 SLA 政策' : '建立 SLA 政策'}
            </PageDialogTitle>
          </PageDialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">政策名稱</label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="例：VIP 快速服務"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">套用優先級</label>
              <Select
                value={formPriority}
                onChange={(e) => setFormPriority(e.target.value)}
                options={PRIORITY_OPTIONS}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">首次回應目標（分鐘）</label>
                <Input
                  type="number"
                  value={formFirstResponse}
                  onChange={(e) => setFormFirstResponse(e.target.value)}
                  min="1"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">解決時間目標（分鐘）</label>
                <Input
                  type="number"
                  value={formResolution}
                  onChange={(e) => setFormResolution(e.target.value)}
                  min="1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">到期前預警（分鐘）</label>
                <Input
                  type="number"
                  value={formWarning}
                  onChange={(e) => setFormWarning(e.target.value)}
                  min="1"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formIsDefault}
                    onChange={(e) => setFormIsDefault(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span className="text-sm">設為此優先級預設</span>
                </label>
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <PageDialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  儲存中...
                </>
              ) : (
                '儲存政策'
              )}
            </Button>
          </PageDialogFooter>
        </PageDialogContent>
      </PageDialog>
    </div>
  );
}
