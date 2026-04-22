'use client';

/* eslint-disable jsx-a11y/label-has-associated-control */
import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

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
  if (minutes < 60) { return `${minutes} 分鐘`; }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) { return mins > 0 ? `${hours} 小時 ${mins} 分` : `${hours} 小時`; }
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days} 天 ${remainHours} 小時` : `${days} 天`;
}

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
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除此 SLA 政策嗎？')) { return; }
    try {
      await api.delete(`/sla-policies/${id}`);
      fetchPolicies();
    } catch {
      console.error('Failed to delete SLA policy');
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
    <div className="mt-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">SLA 政策</h2>
          <p className="text-sm text-muted-foreground">
            設定不同優先級的服務等級承諾
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          建立 SLA 政策
        </Button>
      </div>

      {/* Policy table */}
      <div className="rounded-lg border">
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-4 border-b px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>政策名稱</span>
          <span className="w-20 text-center">優先級</span>
          <span className="w-24 text-center">首回時間</span>
          <span className="w-24 text-center">解決時間</span>
          <span className="w-20 text-center">預警</span>
          <span className="w-20 text-center">操作</span>
        </div>
        {policies.map((policy) => {
          const pc = PRIORITY_CONFIG[policy.priority] || PRIORITY_CONFIG.MEDIUM;
          return (
            <div
              key={policy.id}
              className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-4 border-b px-4 py-3 last:border-b-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate text-sm font-medium">{policy.name}</span>
                {policy.isDefault && (
                  <Badge variant="outline" className="text-[10px] shrink-0">預設</Badge>
                )}
              </div>
              <div className="w-20 text-center">
                <Badge color={pc.color}>{pc.label}</Badge>
              </div>
              <div className="w-24 text-center text-sm">
                {formatDuration(policy.firstResponseMinutes)}
              </div>
              <div className="w-24 text-center text-sm">
                {formatDuration(policy.resolutionMinutes)}
              </div>
              <div className="w-20 text-center text-sm">
                {formatDuration(policy.warningBeforeMinutes)}
              </div>
              <div className="w-20 flex items-center justify-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openEdit(policy)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(policy.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
        {policies.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            尚未建立 SLA 政策
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPolicy ? '編輯 SLA 政策' : '建立 SLA 政策'}
            </DialogTitle>
          </DialogHeader>
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
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm">設為此優先級預設</span>
                </label>
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
