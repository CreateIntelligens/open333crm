'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
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
  line_video: 'LINE 影片',
  line_carousel: 'LINE 卡片訊息',
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
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; message: string } | null>(null);

  // 失敗提示 4 秒後自動淡出（成功提示會隨跳頁消失，不需清除）
  useEffect(() => {
    if (toast?.type === 'error') {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

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
    if (!draft.name.trim()) {
      setToast({ type: 'error', message: '素材名稱必填' });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const m = await createMaterial({
        ...draft,
        categoryId: gov.categoryId,
        tags: gov.tags,
        status: gov.status,
      });
      // 成功：先顯示提示，短暫停留後跳到編輯頁（否則跳頁太快看不到回饋）
      setToast({ type: 'ok', message: '素材已建立' });
      setTimeout(() => router.push(`/dashboard/marketing/materials/${m.id}`), 800);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = ((err as any)?.response?.data?.error?.message) ?? '建立失敗，請稍後再試';
      setError(msg);
      setToast({ type: 'error', message: msg });
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
            <MaterialEditor
              draft={draft}
              templateName={TYPE_LABEL[draft.contentType]}
              saving={saving}
              onChange={setDraft}
              onSave={handleSave}
              onCancel={() => router.push('/dashboard/marketing/materials')}
              rightPanelExtra={<MaterialGovernancePanel value={gov} onChange={setGov} />}
            />
          )}
        </div>
      </main>
    </div>
  );
}
