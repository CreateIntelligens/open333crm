'use client';

/**
 * LineFlexShowcaseEditor — 精選範本編輯器
 *
 * 結構：
 *   • 上方按鈕「重新選擇範本」開啟 ShowcasePickerDialog
 *   • 中段「可編輯欄位列表」：自動掃 body 內所有 text / image / button
 *   • 每個欄位旁有編輯框 + 刪除按鈕（刪除整個元件）
 *   • 每個 box.contents 容器下方有「＋ 文字 / ＋ 圖片 / ＋ 按鈕」可加新元件
 *   • 圖片欄位用 CompactImageField 可直接上傳
 *   • 預覽走 MaterialPreview 走 line_flex_showcase 分支
 */

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Image as ImageIcon, Type, Link as LinkIcon, Sparkles, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { CompactImageField } from '../../CompactImageField';
import { ShowcasePickerDialog } from './ShowcasePickerDialog';
import {
  extractFields,
  extractContainers,
  updateField,
  addItemToContainer,
  removeItemFromContainer,
  type FlexField,
  type FlexContainer,
  type FlexFieldGroup,
} from './flex-fields';
import { SHOWCASE_SAMPLES, type ShowcaseSample } from './samples';

/** 業務區塊顯示順序（主圖 → 標題內文 → 按鈕 → 其他）。 */
const groupOrder: FlexFieldGroup[] = ['主圖', '標題與內文', '按鈕', '其他'];

function GroupIcon({ group }: { group: FlexFieldGroup }) {
  if (group === '主圖') return <ImageIcon className="h-4 w-4 text-slate-400" />;
  if (group === '標題與內文') return <Type className="h-4 w-4 text-slate-400" />;
  if (group === '按鈕') return <LinkIcon className="h-4 w-4 text-slate-400" />;
  return <Type className="h-4 w-4 text-slate-400" />;
}

export interface ShowcaseBody {
  sampleId?: string;
  /** 完整 Flex JSON（type=bubble 或 type=carousel） */
  contents?: Record<string, unknown>;
  altText?: string;
  /** 內容來源：'ai' 表 AI 生成（無 sampleId），供辨識與後續分析 */
  source?: 'ai';
}

interface Props {
  body: ShowcaseBody;
  onChange: (next: ShowcaseBody) => void;
}

export function LineFlexShowcaseEditor({ body, onChange }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const sample = body.sampleId ? SHOWCASE_SAMPLES.find((s) => s.id === body.sampleId) : undefined;
  const contents = body.contents;

  // 一句話描述 → AI 產合法 Flex → 載入同一個填空編輯器微調（body 標 source:'ai'、無 sampleId）
  const handleAiGenerate = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await api.post('/marketing/materials/line-flex/ai-generate', { prompt });
      const data = res.data.data as { contents: Record<string, unknown>; altText: string };
      onChange({ contents: data.contents, altText: data.altText, source: 'ai' });
    } catch (error: unknown) {
      setAiError(apiErrorMessage(error, 'AI 生成失敗，請調整描述或改用精選範本。'));
    } finally {
      setAiLoading(false);
    }
  };

  const fields = useMemo<FlexField[]>(() => (contents ? extractFields(contents) : []), [contents]);
  const containers = useMemo<FlexContainer[]>(() => (contents ? extractContainers(contents) : []), [contents]);

  const selectSample = (s: ShowcaseSample) => {
    onChange({ sampleId: s.id, contents: JSON.parse(JSON.stringify(s.json)), altText: s.name });
    setPickerOpen(false);
  };

  const handleFieldChange = (path: string, value: string) => {
    if (!contents) return;
    onChange({ ...body, contents: updateField(contents, path, value) });
  };

  const handleAddItem = (containerPath: string, kind: 'text' | 'image' | 'button') => {
    if (!contents) return;
    onChange({ ...body, contents: addItemToContainer(contents, containerPath, kind) });
  };

  const handleRemoveItem = (containerPath: string, idx: number) => {
    if (!contents) return;
    if (!confirm('確定要刪除此元件嗎？')) return;
    onChange({ ...body, contents: removeItemFromContainer(contents, containerPath, idx) });
  };

  // 尚無內容（未選範本、也未 AI 生成）時：顯示兩種起手方式
  if (!contents) {
    return (
      <>
        <div className="space-y-4">
          {/* 起手方式一：AI 描述生成 */}
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-900">
              <Sparkles className="h-4 w-4" />
              用 AI 描述生成
            </div>
            <div className="mb-2 text-xs text-violet-700">
              用一句話描述想要的卡片，AI 產出草稿後可直接進填空編輯器微調。
            </div>
            <div className="flex gap-2">
              <Input
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAiGenerate();
                  }
                }}
                disabled={aiLoading}
                placeholder="如：一張咖啡廳新品促銷卡，含圖片、價格與「立即訂購」按鈕"
                maxLength={500}
              />
              <Button onClick={() => void handleAiGenerate()} disabled={aiLoading || !aiPrompt.trim()}>
                {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '生成'}
              </Button>
            </div>
            {aiError && <div className="mt-2 text-xs text-red-600">{aiError}</div>}
          </div>

          {/* 起手方式二：精選範本 */}
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
            <div className="text-sm text-slate-600">或直接套用官方設計範本</div>
            <Button variant="outline" className="mt-3" onClick={() => setPickerOpen(true)}>
              從範本建立
            </Button>
          </div>
        </div>
        <ShowcasePickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={selectSample} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* 範本資訊 / AI 來源 + 切換按鈕 */}
      <div className="flex items-center justify-between rounded-md border border-slate-200 p-3">
        <div>
          {sample ? (
            <>
              <div className="text-sm font-semibold">{sample.name}</div>
              <div className="text-xs text-slate-500">{sample.description}</div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-sm font-semibold text-violet-900">
                <Sparkles className="h-3.5 w-3.5" />
                AI 生成草稿
              </div>
              <div className="text-xs text-slate-500">可直接微調各欄位，或重新選擇範本</div>
            </>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          重新選擇範本
        </Button>
      </div>

      {/* altText 欄位 */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1">
          替代文字 <span className="text-slate-400 font-normal">（手機通知欄顯示用）</span>
        </label>
        <Input
          value={body.altText ?? ''}
          onChange={(e) => onChange({ ...body, altText: e.target.value })}
          maxLength={400}
          placeholder="如：餐廳介紹"
        />
      </div>

      {/* 欄位依業務區塊分組（主圖 / 標題與內文 / 按鈕），取代平鋪技術欄位列表 */}
      <div className="space-y-3">
        {groupOrder.map((group) => {
          const groupFields = fields.filter((f) => f.group === group);
          if (groupFields.length === 0) return null;
          return (
            <div key={group} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <GroupIcon group={group} />
                {group}
              </div>
              <div className="space-y-2">
                {groupFields.map((field) => (
                  <FieldRow key={field.path} field={field} onChange={(v) => handleFieldChange(field.path, v)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 進階：新增 / 刪除元件（收摺，多數填空使用者不需要動結構） */}
      <details className="rounded-lg border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
          ⚙ 進階：新增 / 刪除元件
        </summary>
        <div className="space-y-2 px-3 pb-3">
          {containers.map((container) => (
            <ContainerRow
              key={container.path}
              container={container}
              contents={contents}
              onAdd={(kind) => handleAddItem(container.path, kind)}
              onRemove={(idx) => handleRemoveItem(container.path, idx)}
            />
          ))}
        </div>
      </details>

      <ShowcasePickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={selectSample} />
    </div>
  );
}

// ─── 單一欄位列 ─────────────────────────────────────────

/** 可做 AI 潤稿的文字類欄位（image/icon/uri/data 不潤稿）。 */
function isRewritable(kind: FlexField['kind']): boolean {
  return kind === 'text' || kind === 'button_label' || kind === 'button_text';
}

function FieldRow({ field, onChange }: { field: FlexField; onChange: (v: string) => void }) {
  const isImage = field.kind === 'image' || field.kind === 'icon';

  if (isImage) {
    return (
      <div>
        <label className="mb-1 block text-xs text-slate-500">{kindLabel(field.kind)}</label>
        <CompactImageField value={field.value} onChange={onChange} />
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1 block text-xs text-slate-500">{kindLabel(field.kind)}</label>
      <div className="flex items-center gap-2">
        <Input value={field.value} onChange={(e) => onChange(e.target.value)} />
        {isRewritable(field.kind) && <RewriteButton text={field.value} onRewritten={onChange} />}
      </div>
    </div>
  );
}

// ─── AI 潤稿鈕（文字欄位用） ─────────────────────────────

const REWRITE_ACTIONS: { action: 'polish' | 'shorten' | 'tone'; label: string }[] = [
  { action: 'polish', label: '潤飾' },
  { action: 'shorten', label: '縮短' },
  { action: 'tone', label: '換語氣' },
];

function RewriteButton({ text, onRewritten }: { text: string; onRewritten: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const run = async (action: 'polish' | 'shorten' | 'tone') => {
    setOpen(false);
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      const res = await api.post('/ai/rewrite', { text, action });
      const next = (res.data.data as { text: string }).text;
      if (next) onRewritten(next);
    } catch {
      // 潤稿失敗不阻斷編輯，靜默略過（欄位維持原值）
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={loading || !text.trim()}
        onClick={() => setOpen((v) => !v)}
        title="AI 潤稿"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-violet-500" />}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-24 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {REWRITE_ACTIONS.map((a) => (
            <button
              key={a.action}
              type="button"
              onClick={() => void run(a.action)}
              className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function kindLabel(kind: FlexField['kind']): string {
  if (kind === 'text') return '文字';
  if (kind === 'image') return '圖片';
  if (kind === 'icon') return '小圖示';
  if (kind === 'button_label') return '按鈕文字';
  if (kind === 'button_uri') return '按鈕網址';
  if (kind === 'button_text') return '按鈕訊息';
  if (kind === 'button_data') return '按鈕資料';
  return kind;
}

/** 取 axios 錯誤的後端訊息（success/error wrapper），無則回 fallback。 */
function apiErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { error?: { message?: string; code?: string } } } }).response;
    return response?.data?.error?.message ?? response?.data?.error?.code ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

// ─── 容器列（顯示子元件、可加可減） ────────────────────

function ContainerRow({
  container,
  contents,
  onAdd,
  onRemove,
}: {
  container: FlexContainer;
  contents: Record<string, unknown>;
  onAdd: (kind: 'text' | 'image' | 'button') => void;
  onRemove: (idx: number) => void;
}) {
  // 取容器內的元件清單，給「刪除」按鈕用
  const items = useMemo(() => {
    const parts = container.path.split('/').slice(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cur: any = contents;
    for (const p of parts) {
      if (Array.isArray(cur)) cur = cur[Number(p)];
      else if (cur && typeof cur === 'object') cur = cur[p];
    }
    return Array.isArray(cur) ? cur : [];
  }, [contents, container.path]);

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-mono text-slate-600 truncate">{container.label}</span>
        <span className="text-[11px] text-slate-400">{container.length} 個元件</span>
      </div>
      <div className="mb-2 space-y-1">
        {items.map((item: { type?: string }, idx: number) => (
          <div key={idx} className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs">
            <span className="text-slate-600">
              <span className="text-slate-400">[{idx}]</span> {item.type ?? '(unknown)'}
            </span>
            <button
              type="button"
              onClick={() => onRemove(idx)}
              className="text-red-600 hover:text-red-700"
              aria-label="刪除"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onAdd('text')}>
          <Plus className="mr-1 h-3 w-3" />文字
        </Button>
        <Button variant="outline" size="sm" onClick={() => onAdd('image')}>
          <Plus className="mr-1 h-3 w-3" />圖片
        </Button>
        <Button variant="outline" size="sm" onClick={() => onAdd('button')}>
          <Plus className="mr-1 h-3 w-3" />按鈕
        </Button>
      </div>
    </div>
  );
}
