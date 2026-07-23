'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, FileJson, Upload } from 'lucide-react';
import {
  validateLineFlexMessageBody,
  type LineFlexMessageBody,
} from '@open333crm/shared';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FlexPreview } from '../MaterialPreview';

interface Props {
  body: LineFlexMessageBody;
  onChange: (next: LineFlexMessageBody) => void;
}

const FLEX_SIMULATOR_URL = 'https://developers.line.biz/flex-simulator/';

const DEFAULT_IMPORT_JSON = JSON.stringify(
  {
    type: 'flex',
    altText: '新品優惠',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '新品優惠', weight: 'bold', size: 'xl', wrap: true },
          { type: 'text', text: '點擊下方按鈕查看活動內容', size: 'sm', color: '#666666', wrap: true, margin: 'md' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: { type: 'uri', label: '立即查看', uri: 'https://example.com' },
          },
        ],
      },
    },
  },
  null,
  2,
);

export function LineFlexTemplateEditor({ body, onChange }: Props) {
  const currentBody = useMemo(() => flexMessageForEditor(body), [body]);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(currentBody, null, 2));
  const [altText, setAltText] = useState(currentBody.altText);
  const [status, setStatus] = useState<{ type: 'ok' | 'error'; message: string } | null>(null);

  const validation = useMemo(() => validateLineFlexMessageBody(currentBody), [currentBody]);

  useEffect(() => {
    setJsonText(JSON.stringify(currentBody, null, 2));
    setAltText(currentBody.altText);
  }, [currentBody]);

  const applyImportedJson = async () => {
    setStatus(null);
    let payload: unknown;
    try {
      payload = JSON.parse(jsonText);
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'JSON 格式錯誤' });
      return;
    }

    try {
      const res = await api.post('/marketing/materials/line-flex/validate', {
        payload,
        altText: altText.trim() || undefined,
      });
      const nextBody = res.data.data.body as LineFlexMessageBody;
      onChange(nextBody);
      setAltText(nextBody.altText);
      setJsonText(JSON.stringify(nextBody, null, 2));
      setStatus({ type: 'ok', message: 'JSON 已驗證並匯入到目前草稿' });
    } catch (error: unknown) {
      setStatus({ type: 'error', message: apiErrorMessage(error, 'Flex JSON 驗證失敗') });
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setJsonText(text);
      setStatus({ type: 'ok', message: `已載入 ${file.name}` });
    } catch {
      setStatus({ type: 'error', message: '檔案讀取失敗' });
    }
  };

  const updateAltText = (value: string) => {
    setAltText(value);
    onChange({ ...currentBody, altText: value });
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">外部 Flex JSON 匯入</div>
            <div className="text-xs text-slate-500">
              在 LINE Flex Simulator 編輯完成後，貼上完整 flex message 或 raw bubble / carousel contents。
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={FLEX_SIMULATOR_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              LINE Flex Simulator
            </a>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
              <Upload className="h-3.5 w-3.5" />
              上傳 .json
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(event) => void handleFile(event.target.files?.[0])}
              />
            </label>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
            替代文字
          </label>
          <Input
            value={altText}
            maxLength={400}
            onChange={(event) => updateAltText(event.target.value)}
            placeholder="手機通知欄顯示用"
          />
        </div>

        <Textarea
          value={jsonText}
          onChange={(event) => setJsonText(event.target.value)}
          className="min-h-[300px] font-mono text-xs"
          spellCheck={false}
        />

        <div className="flex items-center justify-between gap-3">
          <StatusMessage status={status} />
          <Button type="button" onClick={applyImportedJson}>
            <FileJson className="mr-1 h-4 w-4" />驗證並匯入
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
        <div>
          <div className="text-sm font-semibold">匯入預覽</div>
          <div className="text-xs text-slate-500">儲存時會以目前匯入的 altText 與 contents 送出。</div>
        </div>
        {!validation.valid && (
          <div className="space-y-1 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {validation.errors.map((error, index) => (
              <div key={`${error.code}:${index}`}>{error.code}: {error.message}</div>
            ))}
          </div>
        )}
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-xs text-slate-500">altText: {currentBody.altText}</div>
          <FlexPreview flex={currentBody.contents} />
        </div>
      </section>
    </div>
  );
}

function flexMessageForEditor(body: unknown): LineFlexMessageBody {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if (record.type === 'flex' && isFlexContents(record.contents)) {
      return {
        type: 'flex',
        altText: typeof record.altText === 'string' && record.altText.trim() ? record.altText : 'Flex Message',
        contents: record.contents,
      };
    }
    if (typeof record.altText === 'string' && isFlexContents(record.contents)) {
      return {
        type: 'flex',
        altText: record.altText,
        contents: record.contents,
      };
    }
    if (isFlexContents(record)) {
      return {
        type: 'flex',
        altText: 'Flex Message',
        contents: record,
      };
    }
  }
  return JSON.parse(DEFAULT_IMPORT_JSON) as LineFlexMessageBody;
}

function isFlexContents(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    ((value as Record<string, unknown>).type === 'bubble' ||
      (value as Record<string, unknown>).type === 'carousel')
  );
}

function StatusMessage({ status }: { status: { type: 'ok' | 'error'; message: string } | null }) {
  if (!status) return <div className="text-xs text-slate-400">尚未驗證匯入內容</div>;
  const Icon = status.type === 'ok' ? CheckCircle2 : AlertCircle;
  return (
    <div className={status.type === 'ok' ? 'flex items-center gap-1 text-xs text-emerald-700' : 'flex items-center gap-1 text-xs text-red-700'}>
      <Icon className="h-3.5 w-3.5" />
      <span>{status.message}</span>
    </div>
  );
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { error?: { message?: string; code?: string } } } }).response;
    return response?.data?.error?.message ?? response?.data?.error?.code ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
