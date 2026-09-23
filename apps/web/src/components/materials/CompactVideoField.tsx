'use client';

/**
 * CompactVideoField — 影片網址欄位（可貼網址，也可直接上傳）。
 *
 * 為什麼要有這個元件：原本 LineVideoEditor 只有一個純文字輸入框，
 * 使用者手上通常只有 YouTube 連結或本機 mp4 檔，沒有「可直接下載的 mp4 網址」。
 * 結果就是貼 YouTube 連結 → 訊息送得出去但客戶點開播不動（2026-09-23 實際回報）。
 *
 * 系統其實本來就能收 mp4（/files/upload 的通用政策允許 video/mp4），
 * 上傳後也會回傳公開可取的完整網址——正好就是 LINE 要的格式。
 * 缺的只是畫面上沒有入口。
 */

import React, { useRef, useState } from 'react';
import { Upload, Film } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { validateLineVideoUrl, LINE_VIDEO_MAX_BYTES } from '@open333crm/shared';

interface Props {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  /**
   * 上傳大小上限（bytes）。預設用 LINE 的 200MB，
   * 但實際還會被後端 multipart 的 25MB 擋住——見下方 MAX_UPLOAD_BYTES 說明。
   */
  maxBytes?: number;
}

/**
 * 後端 multipart 的 fileSize 上限是 25MB（apps/api/src/index.ts）。
 * LINE 允許到 200MB，但超過 25MB 的檔案我們的上傳端點收不下，
 * 與其讓使用者傳到一半失敗，不如在選檔當下就說清楚。
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function CompactVideoField({ value, onChange, placeholder, maxBytes }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 網址本身的問題（貼 YouTube 等）即時提示；空值不提示，留給必填擋控。
  const urlError = value.trim() ? validateLineVideoUrl(value) : null;

  const uploadLimit = Math.min(maxBytes ?? LINE_VIDEO_MAX_BYTES, MAX_UPLOAD_BYTES);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      if (file.size > uploadLimit) {
        setError(
          `影片 ${formatBytes(file.size)} 超過上限 ${formatBytes(uploadLimit)}，請壓縮後再上傳。`,
        );
        setUploading(false);
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange(res.data?.data?.url ?? '');
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(((err as any)?.response?.data?.error?.message) ?? '上傳失敗');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-100 text-slate-300">
          <Film className="h-4 w-4" />
        </div>

        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'https://example.com/video.mp4'}
          className="flex-1 text-xs"
        />

        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="mr-1 h-3 w-3" />
          {uploading ? '上傳中' : '上傳'}
        </Button>

        <input
          ref={fileRef}
          type="file"
          accept="video/mp4"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {(error || urlError) && (
        <p className="text-xs text-red-600">{error ?? urlError}</p>
      )}

      {!error && !urlError && (
        <p className="text-[11px] text-muted-foreground">
          可直接上傳 mp4（≤ {formatBytes(uploadLimit)}），或貼上可公開下載的 mp4 網址。
        </p>
      )}
    </div>
  );
}
