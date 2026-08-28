'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { MarketingTabs } from '@/components/marketing/MarketingTabs';
import { Button } from '@/components/ui/button';
import { TemplatePickerGrid } from '@/components/materials/TemplatePickerGrid';
import { MaterialEditor, type MaterialDraft } from '@/components/materials/MaterialEditor';
import { MaterialGovernancePanel } from '@/components/materials/MaterialGovernancePanel';
import { createMaterial } from '@/hooks/useMaterials';
import { DEFAULT_BODY_FOR_TYPE } from '@/components/materials/default-bodies';

interface GovernanceState {
  categoryId: string | null;
  tags: string[];
  status: string;
}

const TYPE_LABEL: Record<string, string> = {
  line_text: 'LINE 純文字',
  line_image: 'LINE 單張圖片',
  line_video: 'LINE 進階影片',
  line_carousel: 'LINE 多頁訊息',
  line_imagemap: 'LINE 圖文訊息',
  line_flex_showcase: 'LINE 精選範本',
  line_flex_template: 'LINE Flex 匯入素材',
  fb_text: 'FB 純文字',
  fb_image: 'FB 單張圖片',
  fb_video: 'FB 影片',
  fb_generic: 'FB 商品輪播',
  fb_button: 'FB 按鈕選單',
  fb_media: 'FB 大圖／影片廣告',
  fb_coupon: 'FB 優惠券',
  fb_receipt: 'FB 訂單收據',
  fb_feedback: 'FB 滿意度調查',
};

export default function NewMaterialPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<MaterialDraft | null>(null);
  const [gov, setGov] = useState<GovernanceState>({ categoryId: null, tags: [], status: 'draft' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePick = (channelType: 'line' | 'fb', contentType: string) => {
    const body = DEFAULT_BODY_FOR_TYPE[contentType] ?? {};
    setDraft({
      name: `新${TYPE_LABEL[contentType] ?? '素材'}`,
      channelType,
      contentType,
      body,
      variables: [],
    });
    setGov({ categoryId: null, tags: [], status: 'draft' });
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setError('素材名稱必填'); return; }
    setSaving(true);
    try {
      const m = await createMaterial({
        ...draft,
        categoryId: gov.categoryId,
        tags: gov.tags,
        status: gov.status,
      });
      router.push(`/dashboard/marketing/materials/${m.id}`);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(((err as any)?.response?.data?.error?.message) ?? '建立失敗');
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (draft) setDraft(null);
              else router.push('/dashboard/marketing/materials');
            }}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />{draft ? '重新選擇類型' : '回到素材列表'}
          </Button>

          {!draft && (
            <div className="space-y-4">
              <header>
                <h1 className="text-2xl font-bold tracking-tight">選擇訊息類型</h1>
                <p className="mt-1 text-sm text-muted-foreground">先挑要建立哪種訊息，再填內容。</p>
              </header>
              <TemplatePickerGrid onPick={handlePick} />
            </div>
          )}

          {draft && error && (
            <div className="rounded-md border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive">{error}</div>
          )}

          {draft && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
              <MaterialEditor
                draft={draft}
                templateName={TYPE_LABEL[draft.contentType]}
                saving={saving}
                onChange={setDraft}
                onSave={handleSave}
                onCancel={() => router.push('/dashboard/marketing/materials')}
              />
              <MaterialGovernancePanel value={gov} onChange={setGov} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
