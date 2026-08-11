'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { MarketingTabs } from '@/components/marketing/MarketingTabs';
import { Button } from '@/components/ui/button';
import { MaterialEditor, type MaterialDraft } from '@/components/materials/MaterialEditor';
import { useMaterial, updateMaterial } from '@/hooks/useMaterials';

export default function EditMaterialPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const { material, isLoading, mutate } = useMaterial(id);

  const [draft, setDraft] = useState<MaterialDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [material]);

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setError('素材名稱必填'); return; }
    setSaving(true);
    try {
      await updateMaterial(id, draft as any);
      await mutate();
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-muted">
      <Topbar title="行銷" />
      <MarketingTabs active="materials" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/marketing/materials')}>
            <ArrowLeft className="mr-1 h-4 w-4" />回到素材列表
          </Button>

          {isLoading && <div className="py-12 text-center text-sm text-muted-foreground">載入中…</div>}
          {error && <div className="rounded-md border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive">{error}</div>}
          {draft && !isLoading && (
            <MaterialEditor
              draft={draft}
              templateName={material?.template?.name}
              saving={saving}
              onChange={setDraft}
              onSave={handleSave}
              onCancel={() => router.push('/dashboard/marketing/materials')}
            />
          )}
        </div>
      </main>
    </div>
  );
}
