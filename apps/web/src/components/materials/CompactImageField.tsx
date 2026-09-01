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
  /** 建議圖片比例/尺寸提示（如「建議 20:13（1024×665），過寬過高會被裁切」），顯示於欄位下方 */
  hint?: string;
  /**
   * 要求上傳圖片的寬高比例必須符合此比例（如 imagemap 版型 { width:1040, height:700 }）。
   * 傳入時，上傳前先讀圖實際尺寸比對，比例不符（超過容差）則擋下、不寫入、顯示錯誤。
   */
  requireAspectRatio?: { width: number; height: number };
  /** 自訂上傳端點（預設 /files/upload；imagemap 底圖走 /files/imagemap-upload 產多尺寸）。 */
  uploadEndpoint?: string;
  /** 從上傳回應取出要存的 URL（預設取 data.url；imagemap 取 data.baseUrl）。 */
  extractUrl?: (data: Record<string, unknown>) => string;
}

/** 讀取本機圖片檔的實際像素寬高。 */
function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('無法讀取圖片'));
    };
    img.src = url;
  });
}

export function CompactImageField({ value, onChange, placeholder, hint, requireAspectRatio, uploadEndpoint, extractUrl }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      // 版型比例驗證：上傳前讀圖實際尺寸，比例不符（容差 3%）則擋下。
      if (requireAspectRatio) {
        const { width, height } = await readImageSize(file);
        const expected = requireAspectRatio.width / requireAspectRatio.height;
        const actual = width / height;
        // 相對誤差容差 3%，吸收縮放/邊緣像素差異，但擋掉明顯比例不符的圖。
        if (Math.abs(actual - expected) / expected > 0.03) {
          setError(
            `圖片比例與版型不符：版型需 ${requireAspectRatio.width}:${requireAspectRatio.height}` +
              `（如 ${requireAspectRatio.width}×${requireAspectRatio.height}），此圖為 ${width}×${height}。請裁成正確比例再上傳。`,
          );
          setUploading(false);
          return;
        }
      }
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post(uploadEndpoint ?? '/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const data = res.data?.data ?? {};
      onChange(extractUrl ? extractUrl(data) : (data.url ?? ''));
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
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
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
