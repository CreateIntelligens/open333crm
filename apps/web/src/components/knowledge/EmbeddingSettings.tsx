'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import api from '@/lib/api';

interface EmbeddingSettingsData {
  baseUrl: string;
  model: string;
  topK: number;
  threshold: number;
}

interface OllamaModel {
  name: string;
  size?: number;
}

interface OllamaHealth {
  ok: boolean;
  reachable: boolean;
  modelInstalled: boolean;
  currentModel: string;
  error?: string;
}

interface EmbeddingStats {
  total: number;
  embedded: number;
  missing: number;
}

interface SettingsResponse {
  settings: EmbeddingSettingsData;
  health: OllamaHealth;
  models: OllamaModel[];
  stats: EmbeddingStats;
  vectorDim: number;
}

const DEFAULT_SETTINGS: EmbeddingSettingsData = {
  baseUrl: 'http://localhost:11434',
  model: 'bge-m3',
  topK: 5,
  threshold: 0.3,
};

export function EmbeddingSettings() {
  const [settings, setSettings] = useState<EmbeddingSettingsData>(DEFAULT_SETTINGS);
  const [originalModel, setOriginalModel] = useState(DEFAULT_SETTINGS.model);
  const [health, setHealth] = useState<OllamaHealth | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [stats, setStats] = useState<EmbeddingStats | null>(null);
  const [vectorDim, setVectorDim] = useState(1024);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reembedding, setReembedding] = useState(false);
  const [reembedResult, setReembedResult] = useState<{ started: boolean; total: number; message: string } | null>(null);
  const [confirmModelChange, setConfirmModelChange] = useState<{ from: string; to: string } | null>(null);
  const [customModel, setCustomModel] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const res = await api.get<{ data: SettingsResponse }>('/settings/embedding');
      const data = res.data.data;
      setSettings(data.settings);
      setOriginalModel(data.settings.model);
      setHealth(data.health);
      setModels(data.models);
      setStats(data.stats);
      setVectorDim(data.vectorDim);
    } catch (err) {
      console.error('Failed to fetch embedding settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const recheckHealth = async () => {
    try {
      const res = await api.post<{ data: OllamaHealth }>('/settings/embedding/health');
      setHealth(res.data.data);
    } catch (err) {
      console.error('Failed to recheck health:', err);
    }
  };

  const persistSettings = async (next: EmbeddingSettingsData) => {
    setSaving(true);
    try {
      await api.put('/settings/embedding', next);
      setOriginalModel(next.model);
      // refresh derived data (health, stats) since model/baseUrl may have changed
      await fetchAll();
    } catch (err) {
      console.error('Failed to save embedding settings:', err);
      alert('儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveModelOrUrl = async () => {
    if (settings.model !== originalModel) {
      setConfirmModelChange({ from: originalModel, to: settings.model });
      return;
    }
    await persistSettings(settings);
  };

  const confirmAndPersist = async () => {
    if (!confirmModelChange) return;
    setConfirmModelChange(null);
    await persistSettings(settings);
  };

  const handleSaveSearchParams = async () => {
    await persistSettings(settings);
  };

  const runBulkReembed = async () => {
    setReembedding(true);
    setReembedResult(null);
    try {
      const res = await api.post<{ data: { started: boolean; total: number; message: string } }>(
        '/knowledge/bulk-embed',
      );
      setReembedResult(res.data.data);
      // Stats will update over time as background job progresses; refetch
      // current snapshot so the user sees something change immediately.
      const refresh = await api.get<{ data: SettingsResponse }>('/settings/embedding');
      setStats(refresh.data.data.stats);
    } catch (err) {
      console.error('Bulk re-embed failed:', err);
      alert('重新嵌入失敗');
    } finally {
      setReembedding(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">載入中…</div>;
  }

  const healthBadge = health?.ok ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success-subtle px-2.5 py-0.5 text-xs font-medium text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success" /> 連線正常
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive-subtle px-2.5 py-0.5 text-xs font-medium text-destructive">
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" /> 異常
    </span>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold">AI / 向量設定</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          設定知識庫向量化所使用的 Ollama 服務、模型，以及語意搜尋的 topK 與相似度門檻。
        </p>
      </div>

      {/* ─── 服務狀態 ────────────────────────── */}
      <section className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">Ollama 服務狀態</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              檢查 Ollama 是否可達，以及目前選擇的 embedding 模型是否已安裝。
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={recheckHealth}>
            重新檢測
          </Button>
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20">狀態</span>
            {healthBadge}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20">目前模型</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{health?.currentModel}</code>
            {health?.modelInstalled ? (
              <span className="text-xs text-success">已安裝</span>
            ) : (
              <span className="text-xs text-destructive">未安裝</span>
            )}
          </div>
          {health?.error && (
            <div className="mt-2 rounded-md bg-destructive-subtle p-2 text-xs text-destructive">
              {health.error}
            </div>
          )}
        </div>
      </section>

      {/* ─── 模型設定 ────────────────────────── */}
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">模型設定</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          向量維度固定為 <code className="rounded bg-muted px-1 py-0.5">{vectorDim}</code>
          ，請選擇相同維度的模型（例：bge-m3、multilingual-e5-large）。切換模型後現有向量會失效，需要重新嵌入。
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium">Ollama Base URL</label>
            <Input
              value={settings.baseUrl}
              onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
              placeholder="http://localhost:11434"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium">Embedding 模型</label>
              <button
                type="button"
                onClick={() => setCustomModel((v) => !v)}
                className="text-xs text-primary hover:underline"
              >
                {customModel ? '從清單選擇' : '自訂輸入'}
              </button>
            </div>

            {customModel || models.length === 0 ? (
              <Input
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                placeholder="bge-m3"
              />
            ) : (
              <Select
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                options={[
                  // 把目前設定值放最上面（即使本機沒安裝也保留）
                  ...(models.some((m) => m.name === settings.model || m.name.startsWith(`${settings.model}:`))
                    ? []
                    : [{ value: settings.model, label: `${settings.model}（未安裝）` }]),
                  ...models.map((m) => ({
                    value: m.name.replace(/:latest$/, ''),
                    label: m.name,
                  })),
                ]}
              />
            )}

            <p className="mt-1.5 text-xs text-muted-foreground">
              {models.length > 0
                ? `已偵測到 ${models.length} 個本地模型`
                : '尚未偵測到本地模型，請確認 Ollama 已啟動或切換 Base URL'}
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={handleSaveModelOrUrl} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </section>

      {/* ─── 搜尋參數 ────────────────────────── */}
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">語意搜尋參數</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          影響 KB 自動回覆與 RAG 檢索行為。topK 越大召回越多、threshold 越低越寬鬆。
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label className="font-medium">topK（取前幾筆）</label>
              <span className="text-muted-foreground">{settings.topK}</span>
            </div>
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={settings.topK}
              onChange={(e) => setSettings({ ...settings, topK: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>1</span>
              <span>10</span>
              <span>20</span>
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label className="font-medium">相似度門檻</label>
              <span className="text-muted-foreground">{settings.threshold.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.threshold}
              onChange={(e) => setSettings({ ...settings, threshold: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0.00 寬鬆</span>
              <span>0.50</span>
              <span>1.00 嚴格</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={handleSaveSearchParams} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </section>

      {/* ─── 批次重新嵌入 ────────────────────────── */}
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">批次重新嵌入</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          重新計算所有「已發布」文章的向量。切換模型後請執行這個。
        </p>

        {stats && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <StatBlock label="總文章數" value={stats.total} />
            <StatBlock label="已嵌入" value={stats.embedded} tone="success" />
            <StatBlock label="未嵌入" value={stats.missing} tone={stats.missing > 0 ? 'warning' : 'default'} />
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={runBulkReembed} disabled={reembedding}>
            {reembedding ? '處理中…（可能需要數分鐘）' : '重新嵌入全部已發布文章'}
          </Button>
          {reembedResult && (
            <span className="text-xs text-muted-foreground">
              {reembedResult.message}
            </span>
          )}
        </div>
      </section>

      {/* ─── 模型切換確認 Modal ────────────────────────── */}
      {confirmModelChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md rounded-lg bg-background p-6 shadow-lg">
            <h3 className="text-base font-semibold">確認切換模型？</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              將從 <code className="rounded bg-muted px-1 py-0.5 text-xs">{confirmModelChange.from}</code>
              {' '}切換為{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{confirmModelChange.to}</code>
              。
            </p>
            <div className="mt-3 rounded-md bg-warning-subtle p-3 text-xs text-warning">
              <strong>注意：</strong>
              不同模型產生的向量空間不相容。儲存後{' '}
              <strong>所有現有向量將失效</strong>
              ，知識庫搜尋會找不到結果，請接著執行「批次重新嵌入」。
              <br />
              另外，新模型必須輸出 {vectorDim} 維向量，否則嵌入會失敗。
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmModelChange(null)}>
                取消
              </Button>
              <Button onClick={confirmAndPersist}>確認切換</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBlock({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'warning';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : 'text-foreground';
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
