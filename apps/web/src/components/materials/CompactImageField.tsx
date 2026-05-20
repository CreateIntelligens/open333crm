'use client';

/**
 * CompactImageField — 緊湊版圖片欄位
 *
 * 一列橫排：[縮圖] [URL 輸入框] [上傳按鈕] [X 清除]
 * 比 ImageUploadField 的大方框上傳適合多欄位密集情境（如 Flex showcase / Imagemap 底圖）。
 */

import React, { useRef, useState } from 'react';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';

interface Props {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
}

export function CompactImageField({ value, onChange, placeholder }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
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
        {/* 小縮圖 */}
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-100">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => ((e.currentTarget.style.display = 'none'))}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">
              <ImageIcon className="h-4 w-4" />
            </div>
          )}
        </div>

        {/* URL 輸入框 */}
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? '圖片網址'}
          className="flex-1 text-xs"
        />

        {/* 上傳按鈕 */}
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload className="mr-1 h-3 w-3" />{uploading ? '上傳中' : '上傳'}
        </Button>

        {value && (
          <Button variant="ghost" size="sm" onClick={() => onChange('')}>
            <X className="h-3 w-3 text-slate-400" />
          </Button>
        )}
      </div>
      {error && <div className="text-[11px] text-red-600">{error}</div>}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
