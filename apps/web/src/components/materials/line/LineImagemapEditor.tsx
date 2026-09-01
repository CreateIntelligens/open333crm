'use client';

/**
 * LineImagemapEditor — LINE 圖文訊息（Imagemap）編輯器。
 *
 * 對齊 LINE OA 後台「圖文訊息」UI：
 *   • 上傳底圖（按版型尺寸驗證）
 *   • 28 種預設版型 + 自訂版型（自訂可手動切區）
 *   • 每個區域編輯 action（訊息 / 網址 / postback）
 *
 * 注意：本次先做基本「依版型套座標」流程；cropper 拖拉調整座標於下版本補強。
 */

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CompactImageField } from '../CompactImageField';
import { LayoutPickerDialog } from './LayoutPickerDialog';
import { ActionConfigEditor, type ActionConfig } from './ActionConfigEditor';
import { getLayoutById, type ImagemapArea } from './imagemap-layouts';

export interface ImagemapBody {
  baseImageUrl?: string;
  layoutId?: string;
  width: number;
  height: number;
  areas: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    action?: ActionConfig;
  }>;
  altText?: string;
}

interface Props {
  body: ImagemapBody;
  onChange: (next: ImagemapBody) => void;
}

export function LineImagemapEditor({ body, onChange }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [currentAreaIdx, setCurrentAreaIdx] = useState(0);
  const layout = body.layoutId ? getLayoutById(body.layoutId) : undefined;

  const selectLayout = (layout: { id: string; width: number; height: number; defaultAreas: ImagemapArea[] }) => {
    onChange({
      ...body,
      layoutId: layout.id,
      width: layout.width,
      height: layout.height,
      areas: layout.defaultAreas.map((a) => ({ ...a })),
    });
    setPickerOpen(false);
    setCurrentAreaIdx(0);
  };

  const updateArea = (idx: number, next: Partial<ImagemapBody['areas'][0]>) => {
    const newAreas = [...body.areas];
    newAreas[idx] = { ...newAreas[idx], ...next };
    onChange({ ...body, areas: newAreas });
  };

  const addArea = () => {
    if (body.areas.length >= 20) return;
    onChange({
      ...body,
      areas: [
        ...body.areas,
        { x: 0, y: 0, width: 200, height: 200 },
      ],
    });
    setCurrentAreaIdx(body.areas.length);
  };

  const removeArea = (idx: number) => {
    if (body.areas.length <= 1) return;
    onChange({ ...body, areas: body.areas.filter((_, i) => i !== idx) });
    setCurrentAreaIdx(Math.min(idx, body.areas.length - 2));
  };

  return (
    <div className="space-y-4">
      {/* 版型選擇 */}
      <div className="flex items-center justify-between rounded-md border border-slate-200 p-3">
        <div className="text-sm">
          <div className="font-semibold">版型</div>
          <div className="text-xs text-slate-500">
            {layout ? `寬 ${layout.width}px × 高 ${layout.height}px（${layout.category} · ${body.areas.length} 區）` : '尚未選擇版型'}
          </div>
        </div>
        <Button variant="outline" onClick={() => setPickerOpen(true)}>{layout ? '變更版型' : '選擇版型'}</Button>
      </div>

      {/* 底圖上傳 */}
      {layout && (
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">底圖 *</label>
          <CompactImageField
            value={body.baseImageUrl ?? ''}
            onChange={(baseImageUrl) => onChange({ ...body, baseImageUrl })}
            placeholder={`寬 ${layout.width}px × 高 ${layout.height}px${layout.id === 'custom' ? '（高度 520-2080）' : ''}`}
            // 自訂版型高度可變（520-2080），不做固定比例驗證；其餘版型要求比例符合。
            requireAspectRatio={layout.id === 'custom' ? undefined : { width: layout.width, height: layout.height }}
            // imagemap 底圖走專用端點：後端 sharp 產 5 尺寸，回不含副檔名的 baseUrl（LINE 規範）。
            uploadEndpoint="/files/imagemap-upload"
            extractUrl={(data) => (data.baseUrl as string) ?? ''}
          />
          <div className="mt-1 text-[11px] text-slate-500">
            {layout.id === 'custom'
              ? '底圖寬 1040px、高 520-2080px；JPEG / PNG 格式，建議 ≤ 1MB'
              : `底圖需為 ${layout.width}:${layout.height} 比例（如 ${layout.width}×${layout.height}），比例不符會被擋下；JPEG / PNG，建議 ≤ 1MB`}
          </div>
        </div>
      )}

      {/* 底圖預覽 + 區域虛線標示 */}
      {layout && body.baseImageUrl && (
        <ImagemapPreview
          baseImageUrl={body.baseImageUrl}
          width={body.width}
          height={body.height}
          areas={body.areas}
          currentIdx={currentAreaIdx}
        />
      )}

      {/* 區域列表 */}
      {layout && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">互動區域（{body.areas.length}/20）</label>
            {layout.id === 'custom' && body.areas.length < 20 && (
              <Button variant="outline" size="sm" onClick={addArea}>
                <Plus className="h-3 w-3 mr-1" />新增區域
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {body.areas.map((area, idx) => (
              <AreaCard
                key={idx}
                index={idx}
                area={area}
                isCustom={layout.id === 'custom'}
                isCurrent={idx === currentAreaIdx}
                canDelete={body.areas.length > 1}
                onSelect={() => setCurrentAreaIdx(idx)}
                onUpdate={(next) => updateArea(idx, next)}
                onRemove={() => removeArea(idx)}
              />
            ))}
          </div>
        </div>
      )}

      <LayoutPickerDialog
        open={pickerOpen}
        currentLayoutId={body.layoutId}
        onClose={() => setPickerOpen(false)}
        onSelect={selectLayout}
      />
    </div>
  );
}

// ─── 預覽（底圖 + 區域虛線標示） ───────────────────

function ImagemapPreview({
  baseImageUrl,
  width,
  height,
  areas,
  currentIdx,
}: {
  baseImageUrl: string;
  width: number;
  height: number;
  areas: ImagemapBody['areas'];
  currentIdx: number;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="relative" style={{ paddingBottom: `${(height / width) * 100}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={baseImageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => ((e.currentTarget.style.display = 'none'))}
        />
        {areas.map((area, idx) => (
          <div
            key={idx}
            className={`absolute border-2 ${idx === currentIdx ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/70 bg-white/5'} flex items-start justify-start text-[10px] font-bold text-white`}
            style={{
              left: `${(area.x / width) * 100}%`,
              top: `${(area.y / height) * 100}%`,
              width: `${(area.width / width) * 100}%`,
              height: `${(area.height / height) * 100}%`,
              textShadow: '0 1px 2px rgba(0,0,0,0.8)',
              padding: 2,
            }}
          >
            {idx + 1}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 單一區域編輯卡 ──────────────────────────

function AreaCard({
  index,
  area,
  isCustom,
  isCurrent,
  canDelete,
  onSelect,
  onUpdate,
  onRemove,
}: {
  index: number;
  area: ImagemapBody['areas'][0];
  isCustom: boolean;
  isCurrent: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onUpdate: (next: Partial<ImagemapBody['areas'][0]>) => void;
  onRemove: () => void;
}) {
  return (
    <div className={`rounded-md border p-3 ${isCurrent ? 'border-emerald-500 bg-emerald-50/40' : 'border-slate-200 bg-white'}`} onClick={onSelect}>
      <div className="mb-2 flex items-center justify-between">
        <strong className="text-sm">區域 {index + 1}</strong>
        {canDelete && (
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
            <Trash2 className="h-3 w-3 text-red-600" />
          </Button>
        )}
      </div>

      {/* 座標欄位（自訂版型才能改） */}
      {isCustom ? (
        <div className="mb-3 grid grid-cols-4 gap-2">
          <NumField label="x" value={area.x} onChange={(v) => onUpdate({ x: v })} />
          <NumField label="y" value={area.y} onChange={(v) => onUpdate({ y: v })} />
          <NumField label="寬" value={area.width} onChange={(v) => onUpdate({ width: v })} />
          <NumField label="高" value={area.height} onChange={(v) => onUpdate({ height: v })} />
        </div>
      ) : (
        <div className="mb-2 text-[11px] text-slate-500 font-mono">
          x:{area.x} y:{area.y} 寬:{area.width} 高:{area.height}
        </div>
      )}

      {/* 動作 */}
      {/* imagemap 官方只支援 uri/message，不支援 postback（會被降級）→ 不給選 */}
      <ActionConfigEditor
        action={area.action}
        onChange={(action) => onUpdate({ action })}
        allowedTypes={['uri', 'message']}
      />
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500">{label}</div>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 text-sm"
      />
    </div>
  );
}
