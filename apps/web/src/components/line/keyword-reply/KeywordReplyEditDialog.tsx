'use client';

import React, { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  PageDialog,
  PageDialogContent,
  PageDialogHeader,
  PageDialogTitle,
  PageDialogDescription,
  PageDialogFooter,
} from '@/components/ui/page-dialog';
import { useMaterials } from '@/hooks/useMaterials';
import type { KeywordReply, KeywordReplyInput } from '@/hooks/useKeywordReplies';

interface Props {
  open: boolean;
  reply: KeywordReply | null; // null = 新建
  onClose: () => void;
  onSave: (input: KeywordReplyInput) => Promise<void>;
}

export function KeywordReplyEditDialog({ open, reply, onClose, onSave }: Props) {
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [draftKeyword, setDraftKeyword] = useState('');
  const [matchMode, setMatchMode] = useState<'any' | 'all'>('any');
  const [materialId, setMaterialId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 列出所有 LINE 素材給選
  const { materials } = useMaterials({ channelType: 'line', isActive: true, limit: 200 });

  useEffect(() => {
    if (open) {
      setName(reply?.name ?? '');
      setKeywords(reply?.keywords ?? []);
      setMatchMode(reply?.matchMode ?? 'any');
      setMaterialId(reply?.materialId ?? '');
      setDraftKeyword('');
      setError(null);
    }
  }, [open, reply]);


  const handleAddKeyword = () => {
    const k = draftKeyword.trim();
    if (!k) return;
    if (keywords.includes(k)) return;
    setKeywords([...keywords, k]);
    setDraftKeyword('');
  };

  const handleRemoveKeyword = (idx: number) => {
    setKeywords(keywords.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('請輸入規則名稱'); return; }
    if (keywords.length === 0) { setError('至少要 1 個關鍵字'); return; }
    if (!materialId) { setError('請選擇要回覆的素材'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        keywords,
        matchMode,
        materialId,
      });
      onClose();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(((err as any)?.response?.data?.error?.message) ?? '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const selectedMaterial = materials.find((m) => m.id === materialId);

  const CONTENT_TYPE_LABEL: Record<string, string> = { text: '文字', image: '圖片', flex: 'Flex', carousel: '輪播', imagemap: '圖文', video: '影片' };

  // 依 Claude Design「關鍵字回覆」：改為下一頁式表單（原本是自製的跳出視窗，沒有焦點管理、欄位名稱也沒綁定輸入框）
  return (
    <PageDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }} section="渠道" parent="關鍵字回覆">
      <PageDialogContent>
        <PageDialogHeader>
          <PageDialogTitle>{reply ? '編輯關鍵字回覆' : '建立關鍵字回覆'}</PageDialogTitle>
          <PageDialogDescription>設定觸發的關鍵字，以及要自動回覆的素材</PageDialogDescription>
        </PageDialogHeader>

        <div className="flex flex-col gap-6">
          {/* 規則名稱 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kr-name" className="text-sm font-medium text-foreground">
              規則名稱<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </label>
            <Input
              id="kr-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 200))}
              placeholder="例：詢問營業時間、預約諮詢、產品 DM"
              aria-required="true"
              aria-describedby="kr-name-hint"
            />
            <p id="kr-name-hint" className="text-xs text-muted-foreground">只給管理用，顧客不會看到</p>
          </div>

          {/* 關鍵字 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kr-keyword" className="text-sm font-medium text-foreground">
              關鍵字<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">至少 1 個</span>
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="kr-keyword"
                value={draftKeyword}
                onChange={(e) => setDraftKeyword(e.target.value)}
                placeholder="輸入關鍵字後按 Enter 或點「加入」"
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddKeyword();
                  }
                }}
              />
              <Button variant="outline" size="lg" onClick={handleAddKeyword} disabled={!draftKeyword.trim()}>
                <Plus />
                加入
              </Button>
            </div>
            {keywords.length > 0 && (
              <ul aria-label="已加入的關鍵字" className="flex flex-wrap items-center gap-1.5 pt-1">
                {keywords.map((k, idx) => (
                  <li key={idx} className="inline-flex max-w-[240px] items-center gap-1 rounded-full border border-primary-border bg-primary-subtle py-1 pl-3 pr-1.5 text-sm text-primary">
                    <span className="truncate" title={k}>{k}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveKeyword(idx)}
                      aria-label={`移除關鍵字「${k}」`}
                      className="flex h-5 w-5 flex-none items-center justify-center rounded-full hover:bg-primary/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 比對方式：2 個以上關鍵字才出現 */}
          {keywords.length > 1 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium text-foreground">比對方式</legend>
              {([
                ['any', '任一關鍵字符合就觸發'],
                ['all', '全部關鍵字都出現才觸發'],
              ] as const).map(([value, label]) => (
                <label key={value} className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input type="radio" name="kr-match" checked={matchMode === value} onChange={() => setMatchMode(value)} className="h-4 w-4 accent-primary" />
                  {label}
                </label>
              ))}
            </fieldset>
          )}

          {/* 回覆素材 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kr-material" className="text-sm font-medium text-foreground">
              回覆素材<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </label>
            <Select
              id="kr-material"
              value={materialId}
              onChange={(e) => setMaterialId(e.target.value)}
              aria-required="true"
              aria-describedby="kr-material-hint"
              placeholder="請選擇素材"
              options={materials.map((m) => ({ value: m.id, label: `${m.name}（${CONTENT_TYPE_LABEL[m.contentType] ?? m.contentType}）` }))}
            />
            {selectedMaterial?.variables && selectedMaterial.variables.length > 0 && (
              <p role="note" className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-amber-800">
                此素材含 {selectedMaterial.variables.length} 個變數（{selectedMaterial.variables.map((v) => v.key).join('、')}），會以預設值送出
              </p>
            )}
            <p id="kr-material-hint" className="text-xs text-muted-foreground">
              素材在「行銷 &gt; 素材庫」建立，這裡只列 LINE 渠道的素材
            </p>
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <PageDialogFooter>
          <Button variant="outline" size="lg" onClick={onClose} disabled={saving}>取消</Button>
          <Button size="lg" onClick={handleSave} disabled={saving} loading={saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </PageDialogFooter>
      </PageDialogContent>
    </PageDialog>
  );
}
