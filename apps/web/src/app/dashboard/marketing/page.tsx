'use client';
/* eslint-disable jsx-a11y/label-has-associated-control */

import React, { useState, useCallback, useEffect } from 'react';
import {
  Plus,
  Send,
  Loader2,
  Trash2,
  Play,
  XCircle,
  Eye,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTemplates } from '@/hooks/useTemplates';
import { useChannels } from '@/hooks/useChannels';
import { useCampaigns, useSegments, useBroadcasts } from '@/hooks/useMarketing';
import { TemplateList } from '@/components/marketing/TemplateList';
import { TemplateFormDialog } from '@/components/marketing/TemplateFormDialog';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';

// ─── Status badge helpers ──────────────────────────────────────────────────

const campaignStatusMap: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: '#94a3b8' },
  active: { label: '進行中', color: '#22c55e' },
  completed: { label: '已完成', color: '#3b82f6' },
  cancelled: { label: '已取消', color: '#ef4444' },
};

const broadcastStatusMap: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: '#94a3b8' },
  scheduled: { label: '已排程', color: '#f59e0b' },
  sending: { label: '發送中', color: '#3b82f6' },
  completed: { label: '已完成', color: '#22c55e' },
  failed: { label: '失敗', color: '#ef4444' },
  cancelled: { label: '已取消', color: '#94a3b8' },
};

function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; color: string }> }) {
  const info = map[status] || { label: status, color: '#6b7280' };
  return <Badge color={info.color}>{info.label}</Badge>;
}

// ─── Campaign Tab ──────────────────────────────────────────────────────────

function CampaignTab() {
  const router = useRouter();
  const { campaigns, isLoading, mutate } = useCampaigns();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '', startDate: '', endDate: '' });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!formData.name) { return; }
    setSaving(true);
    try {
      await api.post('/marketing/campaigns', {
        name: formData.name,
        description: formData.description || undefined,
        startDate: formData.startDate || undefined,
        endDate: formData.endDate || undefined,
      });
      setDialogOpen(false);
      setFormData({ name: '', description: '', startDate: '', endDate: '' });
      mutate();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '建立失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除這個行銷活動嗎？')) { return; }
    try {
      await api.delete(`/marketing/campaigns/${id}`);
      mutate();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '刪除失敗');
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">行銷活動</h3>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          新增活動
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : campaigns.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">尚無行銷活動</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c: any) => (
            <button
              key={c.id}
              className="cursor-pointer rounded-lg border p-4 transition hover:shadow-md text-left w-full"
              onClick={() => router.push(`/dashboard/marketing/campaigns/${c.id}`)}
            >
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-medium">{c.name}</h4>
                <StatusBadge status={c.status} map={campaignStatusMap} />
              </div>
              {c.description && (
                <p className="mb-2 text-sm text-muted-foreground line-clamp-2">{c.description}</p>
              )}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {c._count?.broadcasts || 0} 次廣播
                </span>
                <span>{new Date(c.createdAt).toLocaleDateString('zh-TW')}</span>
              </div>
              {c.status === 'draft' && (
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(c.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增行銷活動</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">名稱 *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="活動名稱"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">描述</label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="活動描述"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">開始日期</label>
                <Input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">結束日期</label>
                <Input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={saving || !formData.name}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              建立
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Broadcast Tab ─────────────────────────────────────────────────────────

function BroadcastTab() {
  const { broadcasts, isLoading, mutate } = useBroadcasts();
  const { templates } = useTemplates();
  const { channels } = useChannels();
  const { campaigns } = useCampaigns();
  const { segments } = useSegments();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    templateId: '',
    channelId: '',
    campaignId: '',
    segmentId: '',
    targetType: 'all',
    scheduledAt: '',
  });

  const activeChannels = channels.filter((c: any) => c.isActive);

  const handleCreate = async () => {
    if (!formData.name || !formData.templateId || !formData.channelId) {
      alert('請填寫必填欄位');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        name: formData.name,
        templateId: formData.templateId,
        channelId: formData.channelId,
        targetType: formData.targetType,
      };
      if (formData.campaignId) { payload.campaignId = formData.campaignId; }
      if (formData.targetType === 'segment' && formData.segmentId) {
        payload.segmentId = formData.segmentId;
      }
      if (formData.scheduledAt) { payload.scheduledAt = new Date(formData.scheduledAt).toISOString(); }

      await api.post('/marketing/broadcasts', payload);
      setDialogOpen(false);
      setFormData({
        name: '',
        templateId: '',
        channelId: '',
        campaignId: '',
        segmentId: '',
        targetType: 'all',
        scheduledAt: '',
      });
      mutate();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '建立失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async (id: string) => {
    if (!confirm('確定要立即發送嗎？')) { return; }
    try {
      await api.post(`/marketing/broadcasts/${id}/send`);
      mutate();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '發送失敗');
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('確定要取消嗎？')) { return; }
    try {
      await api.post(`/marketing/broadcasts/${id}/cancel`);
      mutate();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '取消失敗');
    }
  };

  const targetTypeOptions = [
    { value: 'all', label: '全部聯繫人' },
    { value: 'segment', label: '受眾分群' },
    { value: 'tags', label: '依標籤篩選' },
    { value: 'contacts', label: '手動選擇' },
  ];

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">廣播歷史</h3>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          建立廣播
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : broadcasts.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">尚無廣播記錄</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 font-medium">名稱</th>
                <th className="pb-2 font-medium">狀態</th>
                <th className="pb-2 font-medium">受眾</th>
                <th className="pb-2 font-medium">發送</th>
                <th className="pb-2 font-medium">成功</th>
                <th className="pb-2 font-medium">失敗</th>
                <th className="pb-2 font-medium">時間</th>
                <th className="pb-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((b: any) => (
                <tr key={b.id} className="border-b">
                  <td className="py-3 font-medium">{b.name}</td>
                  <td className="py-3">
                    <StatusBadge status={b.status} map={broadcastStatusMap} />
                  </td>
                  <td className="py-3 text-muted-foreground">
                    {b.targetType === 'all' ? '全部' : b.targetType === 'segment' ? '分群' : b.targetType}
                  </td>
                  <td className="py-3">{b.totalCount}</td>
                  <td className="py-3 text-green-600">{b.successCount}</td>
                  <td className="py-3 text-red-600">{b.failedCount}</td>
                  <td className="py-3 text-muted-foreground">
                    {b.sentAt
                      ? new Date(b.sentAt).toLocaleString('zh-TW')
                      : b.scheduledAt
                        ? `排程: ${new Date(b.scheduledAt).toLocaleString('zh-TW')}`
                        : '-'}
                  </td>
                  <td className="py-3">
                    <div className="flex gap-1">
                      {['draft', 'scheduled'].includes(b.status) && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => handleSend(b.id)} title="立即發送">
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleCancel(b.id)} title="取消">
                            <XCircle className="h-4 w-4 text-red-500" />
                          </Button>
                        </>
                      )}
</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>建立廣播</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">名稱 *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="廣播名稱"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">範本 *</label>
              <Select
                value={formData.templateId}
                onChange={(e) => setFormData({ ...formData, templateId: e.target.value })}
                options={[
                  { value: '', label: '請選擇範本' },
                  ...templates.map((t: any) => ({ value: t.id, label: t.name })),
                ]}
              />
              {formData.templateId && (() => {
                const selectedTpl = templates.find((t: any) => t.id === formData.templateId);
                if (!selectedTpl) { return null; }
                const body = (selectedTpl as any).body;
                return (
                  <div className="mt-2 rounded-md border bg-muted/50 p-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">範本預覽</p>
                    <p className="whitespace-pre-wrap text-sm">
                      {body?.text || JSON.stringify(body, null, 2)}
                    </p>
                  </div>
                );
              })()}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">渠道 *</label>
              <Select
                value={formData.channelId}
                onChange={(e) => setFormData({ ...formData, channelId: e.target.value })}
                options={[
                  { value: '', label: '請選擇渠道' },
                  ...activeChannels.map((c: any) => ({
                    value: c.id,
                    label: `${c.displayName} (${c.channelType})`,
                  })),
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">關聯活動</label>
              <Select
                value={formData.campaignId}
                onChange={(e) => setFormData({ ...formData, campaignId: e.target.value })}
                options={[
                  { value: '', label: '無（獨立廣播）' },
                  ...campaigns.map((c: any) => ({ value: c.id, label: c.name })),
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">受眾</label>
              <Select
                value={formData.targetType}
                onChange={(e) => setFormData({ ...formData, targetType: e.target.value })}
                options={targetTypeOptions}
              />
            </div>
            {formData.targetType === 'segment' && (
              <div>
                <label className="mb-1 block text-sm font-medium">選擇分群</label>
                <Select
                  value={formData.segmentId}
                  onChange={(e) => setFormData({ ...formData, segmentId: e.target.value })}
                  options={[
                    { value: '', label: '請選擇分群' },
                    ...segments.map((s: any) => ({
                      value: s.id,
                      label: `${s.name} (${s.contactCount} 人)`,
                    })),
                  ]}
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">排程發送（留空為草稿）</label>
              <Input
                type="datetime-local"
                value={formData.scheduledAt}
                onChange={(e) => setFormData({ ...formData, scheduledAt: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving || !formData.name || !formData.templateId || !formData.channelId}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              建立
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Segment Tab ───────────────────────────────────────────────────────────

function SegmentTab() {
  const { segments, isLoading, mutate } = useSegments();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [tags, setTags] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    logic: 'AND' as 'AND' | 'OR',
    conditions: [{ field: 'channelType', operator: 'eq', value: '' }] as Array<{
      field: string;
      operator: string;
      value: string;
    }>,
  });

  useEffect(() => {
    api.get('/tags').then((res) => setTags(res.data.data || [])).catch(() => {});
  }, []);

  const addCondition = () => {
    setFormData({
      ...formData,
      conditions: [...formData.conditions, { field: 'channelType', operator: 'eq', value: '' }],
    });
  };

  const removeCondition = (idx: number) => {
    setFormData({
      ...formData,
      conditions: formData.conditions.filter((_, i) => i !== idx),
    });
  };

  const updateCondition = (idx: number, key: string, value: string) => {
    const updated = [...formData.conditions];
    (updated[idx] as any)[key] = value;
    setFormData({ ...formData, conditions: updated });
  };

  const buildRules = () => ({
    conditions: formData.conditions.filter((c) => c.value),
    logic: formData.logic,
  });

  const handlePreview = async () => {
    setPreviewing(true);
    setPreviewCount(null);
    try {
      const res = await api.post('/marketing/segments/preview', buildRules());
      setPreviewCount(res.data.data.count);
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '預覽失敗');
    } finally {
      setPreviewing(false);
    }
  };

  const handleCreate = async () => {
    if (!formData.name) { return; }
    setSaving(true);
    try {
      await api.post('/marketing/segments', {
        name: formData.name,
        description: formData.description || undefined,
        rules: buildRules(),
      });
      setDialogOpen(false);
      setFormData({
        name: '',
        description: '',
        logic: 'AND',
        conditions: [{ field: 'channelType', operator: 'eq', value: '' }],
      });
      setPreviewCount(null);
      mutate();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '建立失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除這個分群嗎？')) { return; }
    try {
      await api.delete(`/marketing/segments/${id}`);
      mutate();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '刪除失敗');
    }
  };

  const fieldOptions = [
    { value: 'channelType', label: '渠道類型' },
    { value: 'tag', label: '標籤' },
    { value: 'createdAfter', label: '建立日期（之後）' },
    { value: 'createdBefore', label: '建立日期（之前）' },
  ];

  const channelTypeValues = [
    { value: 'LINE', label: 'LINE' },
    { value: 'FB', label: 'Facebook' },
    { value: 'WEBCHAT', label: 'WebChat' },
    { value: 'WHATSAPP', label: 'WhatsApp' },
  ];

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">受眾分群</h3>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          新增分群
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : segments.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">尚無受眾分群</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 font-medium">名稱</th>
                <th className="pb-2 font-medium">描述</th>
                <th className="pb-2 font-medium">人數</th>
                <th className="pb-2 font-medium">建立日期</th>
                <th className="pb-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s: any) => (
                <tr key={s.id} className="border-b">
                  <td className="py-3 font-medium">{s.name}</td>
                  <td className="py-3 text-muted-foreground">{s.description || '-'}</td>
                  <td className="py-3">
                    <Badge variant="secondary">{s.contactCount} 人</Badge>
                  </td>
                  <td className="py-3 text-muted-foreground">
                    {new Date(s.createdAt).toLocaleDateString('zh-TW')}
                  </td>
                  <td className="py-3">
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(s.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>新增受眾分群</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">名稱 *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="分群名稱"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">描述</label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="分群描述"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">條件邏輯</label>
              <Select
                value={formData.logic}
                onChange={(e) => setFormData({ ...formData, logic: e.target.value as 'AND' | 'OR' })}
                options={[
                  { value: 'AND', label: '全部符合 (AND)' },
                  { value: 'OR', label: '任一符合 (OR)' },
                ]}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">條件規則</label>
              {formData.conditions.map((cond, idx) => (
                <div key={idx} className="mb-2 flex items-center gap-2">
                  <Select
                    value={cond.field}
                    onChange={(e) => {
                      updateCondition(idx, 'field', e.target.value);
                      updateCondition(idx, 'value', '');
                    }}
                    options={fieldOptions}
                    className="w-40"
                  />
                  {cond.field === 'channelType' && (
                    <Select
                      value={cond.value}
                      onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                      options={[{ value: '', label: '選擇渠道' }, ...channelTypeValues]}
                      className="flex-1"
                    />
                  )}
                  {cond.field === 'tag' && (
                    <Select
                      value={cond.value}
                      onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                      options={[
                        { value: '', label: '選擇標籤' },
                        ...tags.map((t: any) => ({ value: t.id, label: t.name })),
                      ]}
                      className="flex-1"
                    />
                  )}
                  {(cond.field === 'createdAfter' || cond.field === 'createdBefore') && (
                    <Input
                      type="date"
                      value={cond.value}
                      onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                      className="flex-1"
                    />
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeCondition(idx)}
                    disabled={formData.conditions.length <= 1}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={addCondition}>
                <Plus className="mr-1 h-3 w-3" />
                新增條件
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={handlePreview} disabled={previewing}>
                {previewing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="mr-2 h-4 w-4" />
                )}
                預覽人數
              </Button>
              {previewCount !== null && (
                <span className="text-sm">
                  符合人數：<strong>{previewCount}</strong>
                </span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={saving || !formData.name}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              建立
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Quick Broadcast Tab (legacy) ──────────────────────────────────────────

function QuickBroadcastTab() {
  const { templates, mutate } = useTemplates();
  const { channels } = useChannels();
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [targetType, setTargetType] = useState('all');
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{
    total: number;
    success: number;
    failed: number;
  } | null>(null);

  const activeChannels = channels.filter((c: any) => c.isActive);

  const handleBroadcast = async () => {
    if (!selectedTemplateId || !selectedChannelId) {
      alert('請選擇範本和渠道');
      return;
    }
    if (!confirm('確定要發送群發訊息嗎？')) { return; }

    setBroadcasting(true);
    setBroadcastResult(null);

    try {
      const res = await api.post('/marketing/broadcast', {
        templateId: selectedTemplateId,
        channelId: selectedChannelId,
        targetType,
      });
      setBroadcastResult(res.data.data);
      mutate();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '群發失敗');
    } finally {
      setBroadcasting(false);
    }
  };

  const selectedTemplate = templates.find((t: any) => t.id === selectedTemplateId);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <label className="mb-1.5 block text-sm font-medium">選擇範本</label>
        <Select
          value={selectedTemplateId}
          onChange={(e) => setSelectedTemplateId(e.target.value)}
          options={[
            { value: '', label: '請選擇範本' },
            ...templates.map((t: any) => ({ value: t.id, label: t.name })),
          ]}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">選擇渠道</label>
        <Select
          value={selectedChannelId}
          onChange={(e) => setSelectedChannelId(e.target.value)}
          options={[
            { value: '', label: '請選擇渠道' },
            ...activeChannels.map((c: any) => ({
              value: c.id,
              label: `${c.displayName} (${c.channelType})`,
            })),
          ]}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">選擇受眾</label>
        <Select
          value={targetType}
          onChange={(e) => setTargetType(e.target.value)}
          options={[
            { value: 'all', label: '全部聯繫人' },
            { value: 'tags', label: '依標籤篩選' },
            { value: 'contacts', label: '手動選擇' },
          ]}
        />
      </div>
      {selectedTemplate && (
        <div className="rounded-lg border p-4">
          <h4 className="mb-2 text-sm font-medium">訊息預覽</h4>
          <div className="rounded-md bg-muted p-3 text-sm">
            {(selectedTemplate.body as any)?.text || JSON.stringify(selectedTemplate.body)}
          </div>
        </div>
      )}
      <Button
        onClick={handleBroadcast}
        disabled={broadcasting || !selectedTemplateId || !selectedChannelId}
        className="w-full"
      >
        {broadcasting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            發送中...
          </>
        ) : (
          <>
            <Send className="mr-2 h-4 w-4" />
            發送群發訊息
          </>
        )}
      </Button>
      {broadcastResult && (
        <div className="rounded-lg border p-4">
          <h4 className="mb-3 text-sm font-medium">發送結果</h4>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{broadcastResult.total}</p>
              <p className="text-xs text-muted-foreground">總計</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{broadcastResult.success}</p>
              <p className="text-xs text-muted-foreground">成功</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{broadcastResult.failed}</p>
              <p className="text-xs text-muted-foreground">失敗</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Template Tab ──────────────────────────────────────────────────────────

function TemplateTab() {
  const { templates, isLoading, mutate } = useTemplates();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);

  const handleEdit = useCallback((template: any) => {
    setEditingTemplate(template);
    setDialogOpen(true);
  }, []);

  const handleDuplicate = useCallback((template: any) => {
    // Pre-fill dialog with template data but remove id and add (副本) suffix
    setEditingTemplate({
      ...template,
      id: undefined,
      name: `${template.name} (副本)`,
      isSystem: false,
    });
    setDialogOpen(true);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('確定要刪除這個範本嗎？')) { return; }
      try {
        await api.delete(`/marketing/templates/${id}`);
        mutate();
      } catch (err: any) {
        alert(err.response?.data?.error?.message || '刪除失敗');
      }
    },
    [mutate],
  );

  const handleSaved = useCallback(() => {
    setDialogOpen(false);
    setEditingTemplate(null);
    mutate();
  }, [mutate]);

  const handleNewTemplate = useCallback(() => {
    setEditingTemplate(null);
    setDialogOpen(true);
  }, []);

  return (
    <div>
      <div className="border-b px-6 py-3">
        <Button onClick={handleNewTemplate}>
          <Plus className="mr-2 h-4 w-4" />
          新增範本
        </Button>
      </div>
      <TemplateList
        templates={templates}
        isLoading={isLoading}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
      />
      <TemplateFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={editingTemplate}
        onSaved={handleSaved}
      />
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function MarketingPage() {
  const [activeTab, setActiveTab] = useState('campaigns');

  return (
    <div className="flex h-full flex-col">
      <Topbar title="行銷" />

      <div className="border-b px-6 pt-2">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="campaigns">行銷活動</TabsTrigger>
            <TabsTrigger value="broadcasts">廣播</TabsTrigger>
            <TabsTrigger value="segments">受眾分群</TabsTrigger>
            <TabsTrigger value="templates">範本管理</TabsTrigger>
            <TabsTrigger value="quick-broadcast">群發訊息</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === 'campaigns' && <CampaignTab />}
        {activeTab === 'broadcasts' && <BroadcastTab />}
        {activeTab === 'segments' && <SegmentTab />}
        {activeTab === 'templates' && <TemplateTab />}
        {activeTab === 'quick-broadcast' && <QuickBroadcastTab />}
      </div>
    </div>
  );
}
