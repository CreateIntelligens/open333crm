'use client';

import React, { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

  if (!open) return null;

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">
              {reply ? '編輯關鍵字回覆' : '建立關鍵字回覆'}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              當用戶在 LINE 傳訊息中出現指定關鍵字，自動回覆對應素材
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          {/* 規則名稱 */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">
              規則名稱 *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 200))}
              placeholder="例：詢問營業時間、預約諮詢、產品 DM"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">只給管理用，用戶不會看到</p>
          </div>

          {/* 關鍵字 */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">
              關鍵字 *
            </label>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {keywords.map((k, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 rounded-full border border-primary-border bg-primary-subtle px-2.5 py-1 text-xs text-primary"
                >
                  {k}
                  <button
                    type="button"
                    onClick={() => handleRemoveKeyword(idx)}
                    className="text-primary hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                value={draftKeyword}
                onChange={(e) => setDraftKeyword(e.target.value)}
                placeholder="輸入關鍵字後按 Enter 或點「加入」"
                className="flex-1 h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddKeyword();
                  }
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                onClick={handleAddKeyword}
                disabled={!draftKeyword.trim()}
              >
                <Plus className="mr-1 h-3 w-3" />
                加入
              </Button>
            </div>

            {/* match mode */}
            {keywords.length > 1 && (
              <div className="mt-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground">比對方式</div>
                <div className="flex gap-3 text-xs">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={matchMode === 'any'}
                      onChange={() => setMatchMode('any')}
                    />
                    任一關鍵字出現就觸發（OR）
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={matchMode === 'all'}
                      onChange={() => setMatchMode('all')}
                    />
                    所有關鍵字都要出現才觸發（AND）
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* 素材選擇 */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">
              回覆素材 *
            </label>
            <select
              value={materialId}
              onChange={(e) => setMaterialId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— 請選擇 —</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}（{m.contentType}）
                </option>
              ))}
            </select>
            {selectedMaterial && (
              <div className="mt-2 rounded border border-border bg-muted px-3 py-2 text-xs">
                <div className="font-medium">{selectedMaterial.name}</div>
                <div className="text-muted-foreground">
                  類型：{selectedMaterial.contentType}
                  {selectedMaterial.category ? ` · 分類：${selectedMaterial.category}` : ''}
                </div>
                {selectedMaterial.variables && selectedMaterial.variables.length > 0 && (
                  <div className="mt-1 text-warning">
                    ⚠️ 此素材含 {selectedMaterial.variables.length} 個變數（{selectedMaterial.variables.map((v) => v.key).join(', ')}），會以預設值送出
                  </div>
                )}
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              素材在「行銷 → 素材庫」建立，這裡只列 LINE 渠道的素材
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </div>
    </div>
  );
}
