'use client';

import React, { useState, useRef } from 'react';
import { Loader2, Upload, CheckCircle2, XCircle, FileText } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

interface FileStatus {
  name: string;
  state: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

const ACCEPT = '.pdf,.docx,.xlsx,.csv,.txt,.md,.html,.htm,.json';

function isJsonFile(file: File) {
  return file.name.toLowerCase().endsWith('.json');
}

export function ImportDialog({ open, onOpenChange, onImported }: ImportDialogProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFiles([]);
    setFileStatuses([]);
    setUploading(false);
    setDone(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;
    setFiles(selected);
    setFileStatuses(selected.map((f) => ({ name: f.name, state: 'pending' })));
    setDone(false);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setDone(false);

    const jsonFiles = files.filter(isJsonFile);
    const otherFiles = files.filter((f) => !isJsonFile(f));

    // Helper to update a single file's status
    const updateStatus = (name: string, state: FileStatus['state'], error?: string) => {
      setFileStatuses((prev) =>
        prev.map((s) => (s.name === name ? { ...s, state, error } : s)),
      );
    };

    // 1. Upload non-JSON files via multipart
    if (otherFiles.length > 0) {
      otherFiles.forEach((f) => updateStatus(f.name, 'uploading'));

      const formData = new FormData();
      otherFiles.forEach((f) => formData.append('files', f));

      try {
        const res = await api.post('/knowledge/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000,
        });
        const results = res.data.data.results as { title: string; success: boolean; error?: string }[];

        // Match results back to files (same order)
        otherFiles.forEach((f, i) => {
          const r = results[i];
          if (r?.success) {
            updateStatus(f.name, 'success');
          } else {
            updateStatus(f.name, 'error', r?.error || 'Unknown error');
          }
        });
      } catch (err: any) {
        const msg = err.response?.data?.error?.message || err.message || 'Upload failed';
        otherFiles.forEach((f) => updateStatus(f.name, 'error', msg));
      }
    }

    // 2. Handle JSON files via existing import endpoint
    for (const file of jsonFiles) {
      updateStatus(file.name, 'uploading');
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
          updateStatus(file.name, 'error', 'JSON must be an array');
          continue;
        }
        const res = await api.post('/knowledge/import', { articles: parsed });
        const data = res.data.data;
        updateStatus(
          file.name,
          data.failed > 0 && data.imported === 0 ? 'error' : 'success',
          data.failed > 0 ? `${data.imported} imported, ${data.failed} failed` : undefined,
        );
      } catch (err: any) {
        const msg = err.response?.data?.error?.message || 'Import failed';
        updateStatus(file.name, 'error', msg);
      }
    }

    setUploading(false);
    setDone(true);
    onImported();
  };

  const successCount = fileStatuses.filter((s) => s.state === 'success').length;
  const errorCount = fileStatuses.filter((s) => s.state === 'error').length;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>匯入文章</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            支援格式：PDF、Word (.docx)、Excel (.xlsx/.csv)、HTML、Markdown、純文字、JSON
          </p>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="mr-2 h-4 w-4" />
              選擇檔案
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            {files.length > 0 && !done && (
              <span className="text-sm text-muted-foreground">
                已選 {files.length} 個檔案
              </span>
            )}
          </div>

          {/* File list with statuses */}
          {fileStatuses.length > 0 && (
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-2">
              {fileStatuses.map((fs) => (
                <div key={fs.name} className="flex items-center gap-2 text-sm">
                  {fs.state === 'pending' && <FileText className="h-4 w-4 text-muted-foreground" />}
                  {fs.state === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                  {fs.state === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                  {fs.state === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                  <span className="flex-1 truncate">{fs.name}</span>
                  {fs.error && (
                    <span className="ml-2 truncate text-xs text-destructive">{fs.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Summary */}
          {done && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-300">
              上傳完成：成功 {successCount} 個，失敗 {errorCount} 個
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
            {done ? '關閉' : '取消'}
          </Button>
          {!done && (
            <Button onClick={handleUpload} disabled={uploading || files.length === 0}>
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  上傳中...
                </>
              ) : (
                `上傳 ${files.length} 個檔案`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
