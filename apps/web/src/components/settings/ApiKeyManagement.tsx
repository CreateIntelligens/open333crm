'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { Plus, Loader2, Copy, Check, Trash2, Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';

interface ApiKey {
  id: string;
  name: string;
  masked: string;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface CreatedApiKey {
  id: string;
  name: string;
  key: string;        // raw key — only shown once
  masked: string;
  expiresAt: string | null;
  createdAt: string;
}

const EXPIRY_OPTIONS = [
  { value: '0', label: '永不過期' },
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: '180', label: '180 天' },
  { value: '365', label: '1 年' },
];

export function ApiKeyManagement() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await api.get<{ data: ApiKey[] }>('/settings/api-keys');
      setKeys(res.data.data);
    } catch (err) {
      console.error('Failed to fetch API keys:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleRevoke = async (id: string, name: string) => {
    if (!confirm(`確定要撤銷「${name}」這把金鑰嗎？撤銷後使用此金鑰的合作方會立即無法呼叫 API。`)) return;
    try {
      await api.delete(`/settings/api-keys/${id}`);
      fetchKeys();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      alert(e.response?.data?.error?.message || '撤銷失敗');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Partner API 金鑰</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            提供給合作方（產品 / 行銷 / 客服）長期使用的 API 金鑰，僅可呼叫 <code className="rounded bg-muted px-1.5 py-0.5 text-xs">POST /knowledge/partner-ingest</code> 推送知識庫文件。
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          建立金鑰
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : keys.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <Key className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium">尚未建立任何金鑰</p>
          <p className="mt-1 text-xs text-muted-foreground">
            點「建立金鑰」開始為合作方產生第一把
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">名稱</th>
                <th className="px-4 py-2.5 font-medium">金鑰</th>
                <th className="px-4 py-2.5 font-medium">狀態</th>
                <th className="px-4 py-2.5 font-medium">最後使用</th>
                <th className="px-4 py-2.5 font-medium">過期時間</th>
                <th className="px-4 py-2.5 font-medium">建立時間</th>
                <th className="px-4 py-2.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 text-sm font-medium">{k.name}</td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{k.masked}</code>
                  </td>
                  <td className="px-4 py-3">
                    {k.isActive ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        啟用中
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        已撤銷
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {k.lastUsedAt ? format(new Date(k.lastUsedAt), 'yyyy-MM-dd HH:mm') : '從未使用'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {k.expiresAt ? format(new Date(k.expiresAt), 'yyyy-MM-dd') : '永不過期'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {format(new Date(k.createdAt), 'yyyy-MM-dd HH:mm')}
                  </td>
                  <td className="px-4 py-3">
                    {k.isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(k.id, k.name)}
                        className="text-destructive hover:text-destructive"
                        title="撤銷"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(created) => {
          setCreateOpen(false);
          setCreatedKey(created);
          fetchKeys();
        }}
      />

      <CreatedApiKeyDialog
        keyData={createdKey}
        onOpenChange={(open) => {
          if (!open) setCreatedKey(null);
        }}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────

function CreateApiKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedApiKey) => void;
}) {
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('0');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setExpiry('0');
    }
  }, [open]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const days = parseInt(expiry, 10);
      const body: { name: string; expiresInDays?: number | null } = {
        name: name.trim(),
      };
      if (days > 0) body.expiresInDays = days;

      const res = await api.post<{ data: CreatedApiKey }>('/settings/api-keys', body);
      onCreated(res.data.data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      alert(e.response?.data?.error?.message || '建立失敗');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !creating && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle>建立 API 金鑰</DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium">名稱</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：Stanley 產品端 / 行銷端"
                required
                disabled={creating}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                用來識別這把金鑰是給誰用，方便日後管理
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium">過期時間</label>
              <Select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                options={EXPIRY_OPTIONS}
                disabled={creating}
              />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={creating}
            >
              取消
            </Button>
            <Button type="submit" disabled={creating || !name.trim()}>
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  建立中…
                </>
              ) : (
                '建立'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────

function CreatedApiKeyDialog({
  keyData,
  onOpenChange,
}: {
  keyData: CreatedApiKey | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!keyData) return;
    try {
      await navigator.clipboard.writeText(keyData.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      alert(keyData.key);
    }
  };

  return (
    <Dialog open={!!keyData} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>金鑰已建立</DialogTitle>
        </DialogHeader>

        {keyData && (
          <div className="mt-2 space-y-4">
            <div className="rounded-md border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              ⚠️ <strong>請立刻複製並妥善保存</strong>。關閉視窗後將無法再次查看完整金鑰，列表只會顯示遮罩末 4 碼。
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium">{keyData.name}</label>
              <div className="flex gap-2">
                <code className="flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2.5 font-mono text-xs">
                  {keyData.key}
                </code>
                <Button onClick={handleCopy} variant="outline" size="default">
                  {copied ? (
                    <>
                      <Check className="mr-1.5 h-4 w-4 text-green-600" />
                      已複製
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 h-4 w-4" />
                      複製
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">使用方式</p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">
{`curl -X POST https://uat.open333crm.create360.ai/api/v1/knowledge/partner-ingest \\
  -H "Authorization: Bearer ${keyData.key}" \\
  -F "DocID=1234" \\
  -F "Ver=1" \\
  ...`}
              </pre>
            </div>
          </div>
        )}

        <DialogFooter className="mt-6">
          <Button onClick={() => onOpenChange(false)}>我已保存，關閉</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
