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
import { uploadDirect, type DirectUploadPurpose } from '@/lib/direct-upload';
import { validateLineVideoUrl } from '@open333crm/shared';

interface Props {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  /**
   * 上傳大小上限（bytes）。一般上傳最多 25MB（見下方 MAX_UPLOAD_BYTES）；
   * 有 uploadPurpose 時走直傳，上限由呼叫端依渠道給（LINE 影片 200MB）。
   */
  maxBytes?: number;
  /** 設定時改走直傳（檔案不經過 API），用於超過 25MB 的檔案 */
  uploadPurpose?: DirectUploadPurpose;
  /** 網址的即時檢查；預設是 LINE 的規則，傳 null 不檢查（訊息寫的是 LINE，FB 不適用） */
  validateUrl?: ((url: string) => string | null) | null;
}

/**
 * 後端 multipart 的 fileSize 上限是 25MB（apps/api/src/index.ts），也是 FB Messenger 附件的上限。
 * 更大的檔案要走直傳（uploadPurpose）。在選檔當下就擋，不讓使用者傳到一半失敗。
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function CompactVideoField({ value, onChange, placeholder, maxBytes, uploadPurpose, validateUrl = validateLineVideoUrl }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 網址本身的問題（貼 YouTube 等）即時提示；空值不提示，留給必填擋控。
  const urlError = value.trim() && validateUrl ? validateUrl(value) : null;

  const uploadLimit = uploadPurpose ? maxBytes ?? MAX_UPLOAD_BYTES : Math.min(maxBytes ?? MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES);

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

      if (uploadPurpose) {
        setProgress(0);
        onChange(await uploadDirect(file, uploadPurpose, setProgress));
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
      setError(((err as any)?.response?.data?.error?.message) ?? (err instanceof Error ? err.message : '上傳失敗'));
    } finally {
      setUploading(false);
      setProgress(null);
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
          onChange={(e) => {
            // 清掉上一次的上傳錯誤：兩種錯誤共用同一個顯示位置，
            // 不清的話使用者改網址後仍看到「上傳失敗」，蓋住即時的網址檢查結果。
            if (error) setError(null);
            onChange(e.target.value);
          }}
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
          {uploading ? (progress === null ? '上傳中' : `上傳中 ${progress}%`) : '上傳'}
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
