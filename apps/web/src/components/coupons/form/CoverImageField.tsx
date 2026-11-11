'use client';

/**
 * 券面圖上傳（規格 2.2 第 1 區）：拖放或點擊上傳，建議 1040×520、JPG／PNG、2MB 以內。
 * 失敗依原因顯示（格式不符、檔案過大、網路錯誤），並提供「重新上傳」。
 * 上傳走既有的 /files/upload（與素材庫 CompactImageField 相同端點）。
 */
import React, { useRef, useState } from 'react';
import { ImageIcon, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { LOCKED_NOTE } from './fields';

const MAX_BYTES = 2 * 1024 * 1024;

interface Props {
  id: string;
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
}

type State =
  | { kind: 'idle' }
  | { kind: 'uploading'; fileName: string }
  | { kind: 'error'; message: string; retryFile?: File };

interface Meta {
  fileName: string;
  width: number;
  height: number;
  kb: number;
}

function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof URL.createObjectURL !== 'function') {
      resolve({ width: 0, height: 0 });
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}

export function CoverImageField({ id, value, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [meta, setMeta] = useState<Meta | null>(null);
  const [dragging, setDragging] = useState(false);

  const upload = async (file: File) => {
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      setState({ kind: 'error', message: '格式不支援，請上傳 JPG 或 PNG' });
      return;
    }
    if (file.size > MAX_BYTES) {
      setState({ kind: 'error', message: `檔案 ${(file.size / 1048576).toFixed(1)} MB 超過 2MB，請壓縮後再上傳` });
      return;
    }
    setState({ kind: 'uploading', fileName: file.name });
    try {
      const [size, res] = await Promise.all([
        readImageSize(file),
        (() => {
          const fd = new FormData();
          fd.append('file', file);
          return api.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        })(),
      ]);
      const url: string = res.data?.data?.url ?? '';
      if (!url) throw new Error('上傳失敗');
      setMeta({ fileName: file.name, width: size.width, height: size.height, kb: Math.round(file.size / 1024) });
      onChange(url);
      setState({ kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', message: getApiErrorMessage(err, '網路錯誤，圖片未上傳，請重新上傳'), retryFile: file });
    }
  };

  const pick = () => inputRef.current?.click();
  const retry = () => {
    if (state.kind === 'error' && state.retryFile) void upload(state.retryFile);
    else pick();
  };

  const mismatch = meta && meta.width > 0 && Math.abs(meta.width / meta.height - 2) > 0.03;
  const uploading = state.kind === 'uploading';
  const error = state.kind === 'error' ? state.message : '';

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-cell>
      <span id={`${id}-label`} className="text-sm font-medium text-foreground">
        券面圖
      </span>
      {value ? (
        <div className="flex flex-col gap-2">
          <div className="relative aspect-[2/1] w-full max-w-[520px] overflow-hidden rounded-[10px] border bg-muted">
            <img src={value} alt="券面圖預覽" className="absolute inset-0 h-full w-full object-cover" />
          </div>
          {meta && (
            <p className="font-mono text-xs text-muted-foreground">
              {meta.fileName} · {meta.width}×{meta.height} · {meta.kb} KB
            </p>
          )}
          {mismatch && (
            <p className="text-xs text-warning">
              圖片比例 {meta!.width}×{meta!.height} 與 2:1 不符，顯示時會置中裁切。
            </p>
          )}
          {!disabled && (
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={pick} disabled={uploading}>
                {uploading ? `上傳中… ${state.kind === 'uploading' ? state.fileName : ''}` : '更換圖片'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange('');
                  setMeta(null);
                }}
                disabled={uploading}
              >
                刪除
              </Button>
            </div>
          )}
        </div>
      ) : (
        <button
          id={id}
          type="button"
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-help${error ? ` ${id}-err` : ''}`}
          disabled={disabled || uploading}
          onClick={pick}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer?.files?.[0];
            if (file) void upload(file);
          }}
          className={cn(
            'flex aspect-[2/1] w-full max-w-[520px] flex-col items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-dashed p-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            error ? 'border-destructive' : dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/40 bg-background',
          )}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {uploading ? <ImageIcon className="h-4 w-4" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
          </span>
          {uploading ? (
            <span className="text-sm font-medium text-foreground" role="status">
              上傳中… {state.kind === 'uploading' ? state.fileName : ''}
            </span>
          ) : (
            <span className="text-sm font-medium text-foreground">
              拖曳圖片到此，或<span className="text-primary underline">點擊上傳</span>
            </span>
          )}
          <span id={`${id}-help`} className="text-xs text-muted-foreground">
            建議尺寸 1040×520（2:1）· JPG / PNG · 2MB 以內
          </span>
        </button>
      )}
      <p className="text-xs text-muted-foreground">{disabled ? LOCKED_NOTE : '未上傳時使用預設券面（純色底＋券名稱）'}</p>
      {error && (
        <div className="flex flex-wrap items-center gap-2">
          <p id={`${id}-err`} className="text-xs text-destructive" role="alert">
            {error}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            重新上傳
          </Button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
