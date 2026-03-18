'use client';

import React, { useState, useCallback } from 'react';
import { Plus, Send, Loader2 } from 'lucide-react';
import { useTemplates } from '@/hooks/useTemplates';
import { useChannels } from '@/hooks/useChannels';
import { TemplateList } from '@/components/marketing/TemplateList';
import { TemplateFormDialog } from '@/components/marketing/TemplateFormDialog';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import api from '@/lib/api';

export default function MarketingPage() {
  const [activeTab, setActiveTab] = useState('templates');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);

  // Template management state
  const { templates, isLoading, mutate } = useTemplates();

  // Broadcast state
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

  const handleEdit = useCallback((template: any) => {
    setEditingTemplate(template);
    setDialogOpen(true);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('確定要刪除這個範本嗎？')) return;
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

  const handleBroadcast = useCallback(async () => {
    if (!selectedTemplateId || !selectedChannelId) {
      alert('請選擇範本和渠道');
      return;
    }

    if (!confirm('確定要發送群發訊息嗎？')) return;

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
  }, [selectedTemplateId, selectedChannelId, targetType, mutate]);

  const activeChannels = channels.filter((c: any) => c.isActive);

  const templateOptions = [
    { value: '', label: '請選擇範本' },
    ...templates.map((t: any) => ({ value: t.id, label: t.name })),
  ];

  const channelOptions = [
    { value: '', label: '請選擇渠道' },
    ...activeChannels.map((c: any) => ({
      value: c.id,
      label: `${c.displayName} (${c.channelType})`,
    })),
  ];

  const targetTypeOptions = [
    { value: 'all', label: '全部聯繫人' },
    { value: 'tags', label: '依標籤篩選' },
    { value: 'contacts', label: '手動選擇' },
  ];

  // Find selected template for preview
  const selectedTemplate = templates.find((t: any) => t.id === selectedTemplateId);

  return (
    <div className="flex h-full flex-col">
      <Topbar title="行銷" />

      <div className="border-b px-6 pt-2">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="templates">範本管理</TabsTrigger>
            <TabsTrigger value="broadcast">群發訊息</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === 'templates' && (
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
            />
          </div>
        )}

        {activeTab === 'broadcast' && (
          <div className="mx-auto max-w-2xl space-y-6 p-6">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                選擇範本
              </label>
              <Select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                options={templateOptions}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                選擇渠道
              </label>
              <Select
                value={selectedChannelId}
                onChange={(e) => setSelectedChannelId(e.target.value)}
                options={channelOptions}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                選擇受眾
              </label>
              <Select
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                options={targetTypeOptions}
              />
              {targetType === 'tags' && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  依標籤篩選功能將在正式版中支援多選標籤
                </p>
              )}
              {targetType === 'contacts' && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  手動選擇聯繫人功能將在正式版中支援
                </p>
              )}
            </div>

            {/* Preview */}
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

            {/* Result */}
            {broadcastResult && (
              <div className="rounded-lg border p-4">
                <h4 className="mb-3 text-sm font-medium">發送結果</h4>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold">{broadcastResult.total}</p>
                    <p className="text-xs text-muted-foreground">總計</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-600">
                      {broadcastResult.success}
                    </p>
                    <p className="text-xs text-muted-foreground">成功</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-600">
                      {broadcastResult.failed}
                    </p>
                    <p className="text-xs text-muted-foreground">失敗</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <TemplateFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={editingTemplate}
        onSaved={handleSaved}
      />
    </div>
  );
}
