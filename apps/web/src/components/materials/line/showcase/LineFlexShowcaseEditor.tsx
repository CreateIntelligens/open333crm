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
import { Plus, Trash2, Image as ImageIcon, Type, Link as LinkIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
} from './flex-fields';
import { SHOWCASE_SAMPLES, type ShowcaseSample } from './samples';

export interface ShowcaseBody {
  sampleId?: string;
  /** 完整 Flex JSON（type=bubble 或 type=carousel） */
  contents?: Record<string, unknown>;
  altText?: string;
}

interface Props {
  body: ShowcaseBody;
  onChange: (next: ShowcaseBody) => void;
}

export function LineFlexShowcaseEditor({ body, onChange }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const sample = body.sampleId ? SHOWCASE_SAMPLES.find((s) => s.id === body.sampleId) : undefined;
  const contents = body.contents;

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

  // 沒選範本時：顯示提示與選擇按鈕
  if (!sample || !contents) {
    return (
      <>
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <div className="text-sm text-slate-600">尚未選擇範本</div>
          <Button className="mt-3" onClick={() => setPickerOpen(true)}>
            從範本建立
          </Button>
        </div>
        <ShowcasePickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={selectSample} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* 範本資訊 + 切換按鈕 */}
      <div className="flex items-center justify-between rounded-md border border-slate-200 p-3">
        <div>
          <div className="text-sm font-semibold">{sample.name}</div>
          <div className="text-xs text-slate-500">{sample.description}</div>
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

      {/* 欄位列表 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">編輯欄位</label>
          <span className="text-[11px] text-slate-400">{fields.length} 個欄位</span>
        </div>
        <div className="space-y-2">
          {fields.map((field) => (
            <FieldRow key={field.path} field={field} onChange={(v) => handleFieldChange(field.path, v)} />
          ))}
        </div>
      </div>

      {/* 容器列表（可新增 / 刪除元件） */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2 block">新增 / 刪除元件</label>
        <div className="space-y-2">
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
      </div>

      <ShowcasePickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={selectSample} />
    </div>
  );
}

// ─── 單一欄位列 ─────────────────────────────────────────

function FieldRow({ field, onChange }: { field: FlexField; onChange: (v: string) => void }) {
  const isImage = field.kind === 'image' || field.kind === 'icon';

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-slate-500">
        <FieldKindIcon kind={field.kind} />
        <span>{kindLabel(field.kind)}</span>
        <span className="text-slate-300">·</span>
        <span className="font-mono text-slate-400 truncate">{field.label}</span>
      </div>
      {isImage ? (
        <CompactImageField value={field.value} onChange={onChange} />
      ) : (
        <Input value={field.value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function FieldKindIcon({ kind }: { kind: FlexField['kind'] }) {
  if (kind === 'image' || kind === 'icon') return <ImageIcon className="h-3 w-3" />;
  if (kind === 'text') return <Type className="h-3 w-3" />;
  return <LinkIcon className="h-3 w-3" />;
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
