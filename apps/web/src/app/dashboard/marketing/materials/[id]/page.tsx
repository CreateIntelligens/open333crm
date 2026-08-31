'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { MarketingTabs } from '@/components/marketing/MarketingTabs';
import { Button } from '@/components/ui/button';
import { MaterialEditor, type MaterialDraft } from '@/components/materials/MaterialEditor';
import { MaterialGovernancePanel } from '@/components/materials/MaterialGovernancePanel';
import { MaterialVersionHistory } from '@/components/materials/MaterialVersionHistory';
import { MaterialStatsPanel } from '@/components/materials/MaterialStatsPanel';
import { useMaterial, updateMaterial } from '@/hooks/useMaterials';

interface GovernanceState {
  categoryId: string | null;
  tags: string[];
  status: string;
}

export default function EditMaterialPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const { material, isLoading, mutate } = useMaterial(id);

  const [draft, setDraft] = useState<MaterialDraft | null>(null);
  const [gov, setGov] = useState<GovernanceState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; message: string } | null>(null);

  // 儲存提示 3 秒後自動淡出
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    if (!material) return;
    setDraft({
      name: material.name,
      description: material.description ?? undefined,
      category: material.category ?? undefined,
      channelType: material.channelType,
      contentType: material.contentType,
      body: material.body,
      variables: material.variables ?? [],
      targetChannels: material.targetChannels,
    });
    setGov({
      categoryId: material.categoryId,
      tags: material.tags ?? [],
      status: material.status ?? 'draft',
    });
  }, [material]);

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setToast({ type: 'error', message: '素材名稱必填' }); return; }
    setSaving(true);
    try {
      await updateMaterial(id, {
        ...(draft as any),
        categoryId: gov?.categoryId ?? null,
        tags: gov?.tags ?? [],
        status: gov?.status ?? 'draft',
      });
      await mutate();
      setError(null);
      setToast({ type: 'ok', message: '已儲存變更' });
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? '儲存失敗，請稍後再試';
      setError(msg);
      setToast({ type: 'error', message: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-muted">
      {/* 儲存成功 / 失敗浮動提示 */}
      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2">
          <div
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
              toast.type === 'ok'
                ? 'bg-success text-success-foreground'
                : 'bg-destructive text-destructive-foreground'
            }`}
          >
            {toast.type === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {toast.message}
          </div>
        </div>
      )}
      <Topbar title="行銷" />
      <MarketingTabs active="materials" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/marketing/materials')}>
            <ArrowLeft className="mr-1 h-4 w-4" />回到素材列表
          </Button>

          {isLoading && <div className="py-12 text-center text-sm text-muted-foreground">載入中…</div>}
          {error && <div className="rounded-md border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive">{error}</div>}
          {draft && gov && !isLoading && (
            <MaterialEditor
              draft={draft}
              templateName={material?.template?.name}
              saving={saving}
              onChange={setDraft}
              onSave={handleSave}
              onCancel={() => router.push('/dashboard/marketing/materials')}
              rightPanelExtra={
                <>
                  <MaterialGovernancePanel value={gov} onChange={setGov} />
                  <MaterialStatsPanel materialId={id} />
                  <MaterialVersionHistory materialId={id} onRestored={() => mutate()} />
                </>
              }
            />
          )}
        </div>
      </main>
    </div>
  );
}
