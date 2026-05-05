'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import api from '@/lib/api';

interface ChatSettingsData {
  provider: 'ollama' | 'gemini';
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  chatSystemPrompt: string;
  summarizeSystemPrompt: string;
  clarifySystemPrompt: string;
  clarifyThreshold: number;
  clarifyMaxAttempts: number;
}

interface ProviderInfo {
  id: string;
  label: string;
}

interface ModelInfo {
  id: string;
  label: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  tier?: 'stable' | 'latest' | 'preview' | 'open-source';
}

interface ChatHealth {
  ok: boolean;
  reachable: boolean;
  modelInstalled: boolean;
  currentModel: string;
  error?: string;
}

interface SettingsResponse {
  settings: ChatSettingsData;
  providers: ProviderInfo[];
  models: ModelInfo[];
  health: ChatHealth;
  defaults: {
    chatSystemPrompt: string;
    summarizeSystemPrompt: string;
    clarifySystemPrompt: string;
  };
}

const DEFAULT_SETTINGS: ChatSettingsData = {
  provider: 'ollama',
  model: 'qwen2.5:3b',
  baseUrl: 'http://localhost:11434',
  temperature: 0.3,
  maxTokens: 500,
  chatSystemPrompt: '',
  summarizeSystemPrompt: '',
  clarifySystemPrompt: '',
  clarifyThreshold: 0.5,
  clarifyMaxAttempts: 2,
};

export function ChatPromptSettings() {
  const [settings, setSettings] = useState<ChatSettingsData>(DEFAULT_SETTINGS);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [health, setHealth] = useState<ChatHealth | null>(null);
  const [defaults, setDefaults] = useState({
    chatSystemPrompt: '',
    summarizeSystemPrompt: '',
    clarifySystemPrompt: '',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customModel, setCustomModel] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const res = await api.get<{ data: SettingsResponse }>('/settings/chat');
      const d = res.data.data;
      setSettings(d.settings);
      setProviders(d.providers);
      setModels(d.models);
      setHealth(d.health);
      setDefaults(d.defaults);
    } catch (err) {
      console.error('Failed to fetch chat settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Reload model list when provider or baseUrl changes (after debounce on URL)
  const reloadModels = useCallback(
    async (provider: string, baseUrl: string) => {
      try {
        const res = await api.get<{ data: { models: ModelInfo[] } }>('/settings/chat/models', {
          params: { provider, baseUrl: provider === 'ollama' ? baseUrl : undefined },
        });
        setModels(res.data.data.models);
      } catch (err) {
        console.error('Failed to reload models:', err);
        setModels([]);
      }
    },
    [],
  );

  const handleProviderChange = async (newProvider: string) => {
    const provider = newProvider as 'ollama' | 'gemini';
    // When switching provider, snap model to a sensible default
    const defaultModel = provider === 'gemini' ? 'gemini-2.5-flash' : 'qwen2.5:3b';
    setSettings({ ...settings, provider, model: defaultModel });
    await reloadModels(provider, settings.baseUrl);
  };

  const persistSettings = async (next: ChatSettingsData) => {
    setSaving(true);
    try {
      await api.put('/settings/chat', next);
      await fetchAll();
    } catch (err) {
      console.error('Failed to save chat settings:', err);
      alert('儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const recheckHealth = async () => {
    try {
      const res = await api.post<{ data: ChatHealth }>('/settings/chat/health');
      setHealth(res.data.data);
    } catch (err) {
      console.error('Failed to recheck health:', err);
    }
  };

  if (loading) return <div className="text-sm text-muted-foreground">載入中…</div>;

  const healthBadge = health?.ok ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> 連線正常
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> 異常
    </span>
  );

  const providerLabel = providers.find((p) => p.id === settings.provider)?.label ?? settings.provider;

  // group Gemini models by tier for clearer dropdown
  const groupedModels = settings.provider === 'gemini'
    ? {
        stable: models.filter((m) => m.tier === 'stable'),
        latest: models.filter((m) => m.tier === 'latest'),
        preview: models.filter((m) => m.tier === 'preview'),
      }
    : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold">Chat & RAG 設定</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          設定 KB 自動回覆與對話摘要使用的 LLM 提供者、模型、生成參數，以及系統提示詞。
        </p>
      </div>

      {/* ─── 服務狀態 ────────────────────────── */}
      <section className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">服務狀態</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              檢查所選 Provider 是否可達，以及目前模型是否可用。
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
            <span className="text-muted-foreground w-20">Provider</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{providerLabel}</code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20">目前模型</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{health?.currentModel}</code>
          </div>
          {health?.error && (
            <div className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">{health.error}</div>
          )}
        </div>
      </section>

      {/* ─── Provider / 模型 ────────────────────────── */}
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">Provider 與模型</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          切換 Provider 後請接著選擇對應模型；Gemini 共用平台 API key（管理員 .env 設定）。
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium">Provider</label>
            <Select
              value={settings.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              options={providers.map((p) => ({ value: p.id, label: p.label }))}
            />
          </div>

          {settings.provider === 'ollama' && (
            <div>
              <label className="mb-1.5 block text-xs font-medium">Ollama Base URL</label>
              <Input
                value={settings.baseUrl}
                onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
                onBlur={() => reloadModels(settings.provider, settings.baseUrl)}
                placeholder="http://localhost:11434"
              />
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium">模型</label>
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
                placeholder={settings.provider === 'gemini' ? 'gemini-2.5-flash' : 'qwen2.5:3b'}
              />
            ) : groupedModels ? (
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              >
                {groupedModels.stable.length > 0 && (
                  <optgroup label="穩定版">
                    {groupedModels.stable.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </optgroup>
                )}
                {groupedModels.latest.length > 0 && (
                  <optgroup label="Latest（自動跟版）">
                    {groupedModels.latest.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </optgroup>
                )}
                {groupedModels.preview.length > 0 && (
                  <optgroup label="Preview（測試版，不穩定）">
                    {groupedModels.preview.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </optgroup>
                )}
                {/* if current model is not in any group, show it */}
                {!models.some((m) => m.id === settings.model) && (
                  <option value={settings.model}>{settings.model}（自訂）</option>
                )}
              </select>
            ) : (
              <Select
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                options={[
                  ...(models.some((m) => m.id === settings.model || m.id.startsWith(`${settings.model}:`))
                    ? []
                    : [{ value: settings.model, label: `${settings.model}（未安裝）` }]),
                  ...models.map((m) => ({ value: m.id, label: m.label })),
                ]}
              />
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={() => persistSettings(settings)} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </section>

      {/* ─── 生成參數 ────────────────────────── */}
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">生成參數</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          temperature 控制創意程度（越高越發散），max tokens 控制回覆長度上限。
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label className="font-medium">Temperature</label>
              <span className="text-muted-foreground">{settings.temperature.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.temperature}
              onChange={(e) => setSettings({ ...settings, temperature: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0.00 嚴謹</span>
              <span>0.50</span>
              <span>1.00 發散</span>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label className="font-medium">Max Tokens（回覆長度上限）</label>
              <span className="text-muted-foreground">{settings.maxTokens}</span>
            </div>
            <input
              type="range"
              min={50}
              max={2000}
              step={50}
              value={settings.maxTokens}
              onChange={(e) => setSettings({ ...settings, maxTokens: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>50</span>
              <span>1000</span>
              <span>2000</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={() => persistSettings(settings)} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </section>

      {/* ─── System Prompt：客服回覆 ────────────────────────── */}
      <section className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">客服回覆 System Prompt</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              用於 KB 自動回覆、Suggest Reply、自動化規則的 LLM Reply 動作。留空表示使用預設提示詞。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettings({ ...settings, chatSystemPrompt: defaults.chatSystemPrompt })}
          >
            還原預設
          </Button>
        </div>
        <textarea
          className="mt-3 min-h-[180px] w-full rounded-md border bg-background p-3 font-mono text-xs"
          value={settings.chatSystemPrompt}
          onChange={(e) => setSettings({ ...settings, chatSystemPrompt: e.target.value })}
          placeholder={defaults.chatSystemPrompt}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {settings.chatSystemPrompt.length} 字
            {settings.chatSystemPrompt.length === 0 && '（將使用預設）'}
          </span>
          <Button onClick={() => persistSettings(settings)} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </section>

      {/* ─── System Prompt：對話摘要 ────────────────────────── */}
      <section className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">對話摘要 System Prompt</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              用於 「AI 摘要對話」功能。留空表示使用預設提示詞。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setSettings({ ...settings, summarizeSystemPrompt: defaults.summarizeSystemPrompt })
            }
          >
            還原預設
          </Button>
        </div>
        <textarea
          className="mt-3 min-h-[120px] w-full rounded-md border bg-background p-3 font-mono text-xs"
          value={settings.summarizeSystemPrompt}
          onChange={(e) => setSettings({ ...settings, summarizeSystemPrompt: e.target.value })}
          placeholder={defaults.summarizeSystemPrompt}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {settings.summarizeSystemPrompt.length} 字
            {settings.summarizeSystemPrompt.length === 0 && '（將使用預設）'}
          </span>
          <Button onClick={() => persistSettings(settings)} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </section>

      {/* ─── 多輪追問（Clarify）────────────────────────── */}
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">多輪追問（Clarify）</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          當客戶訊息資訊不足、知識庫信心低於門檻時，Bot 會用此提示詞反問一個澄清問題，
          而不是直接回覆或交給真人。達到追問次數上限後會自動轉接客服。
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label className="font-medium">觸發門檻（KB top similarity 低於此值就改用追問）</label>
              <span className="text-muted-foreground">{settings.clarifyThreshold.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.clarifyThreshold}
              onChange={(e) =>
                setSettings({ ...settings, clarifyThreshold: Number(e.target.value) })
              }
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0.00（總是追問）</span>
              <span>0.50</span>
              <span>1.00（從不追問）</span>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label className="font-medium">最大追問次數（達到後自動 handoff）</label>
              <span className="text-muted-foreground">{settings.clarifyMaxAttempts}</span>
            </div>
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={settings.clarifyMaxAttempts}
              onChange={(e) =>
                setSettings({ ...settings, clarifyMaxAttempts: Number(e.target.value) })
              }
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0</span>
              <span>2（推薦）</span>
              <span>5</span>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium">Clarify System Prompt</label>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSettings({ ...settings, clarifySystemPrompt: defaults.clarifySystemPrompt })
                }
              >
                還原預設
              </Button>
            </div>
            <textarea
              className="min-h-[140px] w-full rounded-md border bg-background p-3 font-mono text-xs"
              value={settings.clarifySystemPrompt}
              onChange={(e) =>
                setSettings({ ...settings, clarifySystemPrompt: e.target.value })
              }
              placeholder={defaults.clarifySystemPrompt}
            />
            <span className="text-xs text-muted-foreground">
              {settings.clarifySystemPrompt.length} 字
              {settings.clarifySystemPrompt.length === 0 && '（將使用預設）'}
            </span>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={() => persistSettings(settings)} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </section>
    </div>
  );
}
