'use client';

/* eslint-disable jsx-a11y/label-has-associated-control */
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Save,
  Play,
  Trash2,
  X,
  Plus,
} from 'lucide-react';
import Link from 'next/link';
import type { RuleGroupType } from 'react-querybuilder';
import api from '@/lib/api';
import { qbToEngine, engineToQb } from '@/lib/automation/qb-to-engine';
import { useAutomationRule } from '@/hooks/useAutomation';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ConditionBuilder } from '@/components/automation/ConditionBuilder';
import { ActionList } from '@/components/automation/ActionList';

// ---- constants ----

const TRIGGER_EVENTS = [
  { value: 'message.received', label: '收到訊息' },
  { value: 'keyword.matched', label: '關鍵字命中' },
  { value: 'case.created', label: '工單建立' },
  { value: 'case.escalated', label: '工單升級' },
  { value: 'case.updated', label: '工單更新' },
  { value: 'case.closed', label: '工單關閉' },
  { value: 'contact.created', label: '聯繫人建立' },
  { value: 'contact.tagged', label: '聯繫人加標籤' },
  { value: 'contact.updated', label: '聯繫人更新' },
  { value: 'conversation.created', label: '新對話建立' },
];

const MATCH_MODES = [
  { value: 'any', label: '任一命中' },
  { value: 'all', label: '全部命中' },
];

const DEFAULT_QUERY: RuleGroupType = { combinator: 'and', rules: [] };

interface RuleForm {
  name: string;
  description: string;
  triggerType: string;
  priority: number;
  isActive: boolean;
  stopOnMatch: boolean;
  keywords: string[];
  matchMode: string;
}

const DEFAULT_FORM: RuleForm = {
  name: '',
  description: '',
  triggerType: 'message.received',
  priority: 10,
  isActive: false,
  stopOnMatch: false,
  keywords: [],
  matchMode: 'any',
};

// ---- page component ----

export default function AutomationRuleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ruleId = params.ruleId as string;
  const isNew = ruleId === 'new';

  // SWR for existing rules
  const { rule, isLoading, mutate } = useAutomationRule(isNew ? null : ruleId);

  // Local form state
  const [form, setForm] = useState<RuleForm>(DEFAULT_FORM);
  const [query, setQuery] = useState<RuleGroupType>(DEFAULT_QUERY);
  const [actions, setActions] = useState<
    Array<{ type: string; payload: Record<string, unknown> }>
  >([]);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testFactsText, setTestFactsText] = useState(
    JSON.stringify(
      {
        'contact.name': 'Jane',
        'contact.channel': 'LINE',
        'message.text': 'Hello',
      },
      null,
      2
    )
  );
  const [testResult, setTestResult] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState('');

  // Hydrate form from SWR data
  useEffect(() => {
    if (!rule) { return; }

    // Read trigger data — backend stores trigger as { type, keywords?, match_mode? }
    const trigger = rule.trigger as { type?: string; keywords?: string[]; match_mode?: string } | undefined;
    const triggerType = trigger?.type || rule.triggerEvent || 'message.received';

    setForm({
      name: rule.name,
      description: rule.description || '',
      triggerType,
      priority: rule.priority,
      isActive: rule.isActive,
      stopOnMatch: rule.stopOnMatch,
      keywords: trigger?.keywords || [],
      matchMode: trigger?.match_mode || 'any',
    });
    // Convert engine conditions to query-builder format
    if (
      rule.conditions &&
      typeof rule.conditions === 'object' &&
      ('all' in rule.conditions || 'any' in rule.conditions)
    ) {
      setQuery(engineToQb(rule.conditions as Record<string, unknown>));
    } else {
      setQuery(DEFAULT_QUERY);
    }
    // Normalize: backend stores { type, params }, frontend uses { type, payload }
    setActions(
      (rule.actions || []).map((a: any) => ({
        type: a.type,
        payload: a.payload || a.params || {},
      }))
    );
  }, [rule]);

  // ---- handlers ----

  const updateField = useCallback(
    <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const addKeyword = () => {
    const kw = newKeyword.trim();
    if (kw && !form.keywords.includes(kw)) {
      updateField('keywords', [...form.keywords, kw]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (kw: string) => {
    updateField('keywords', form.keywords.filter((k) => k !== kw));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { return; }
    setSaving(true);
    try {
      // Build trigger object for backend
      const trigger: Record<string, unknown> = { type: form.triggerType };
      if (form.triggerType === 'keyword.matched') {
        trigger.keywords = form.keywords;
        trigger.match_mode = form.matchMode;
      }

      const payload = {
        name: form.name,
        description: form.description,
        trigger,
        priority: form.priority,
        isActive: form.isActive,
        stopOnMatch: form.stopOnMatch,
        conditions: qbToEngine(query),
        actions: actions.map((a) => ({ type: a.type, params: a.payload || {} })),
      };

      if (isNew) {
        const res = await api.post('/automation/rules', payload);
        const newId = res.data.data?.id;
        if (newId) {
          router.push(`/dashboard/automation/${newId}`);
        }
      } else {
        await api.patch(`/automation/rules/${ruleId}`, payload);
        mutate();
      }
    } catch (err) {
      console.error('Failed to save rule:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('確定要刪除此規則嗎？')) { return; }
    setDeleting(true);
    try {
      await api.delete(`/automation/rules/${ruleId}`);
      router.push('/dashboard/automation');
    } catch (err) {
      console.error('Failed to delete rule:', err);
    } finally {
      setDeleting(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      let facts: Record<string, unknown>;
      try {
        facts = JSON.parse(testFactsText);
      } catch {
        setTestResult('錯誤：測試 Facts 的 JSON 格式無效。');
        setTesting(false);
        return;
      }

      const res = await api.post(`/automation/rules/${ruleId}/test`, {
        facts,
      });
      setTestResult(JSON.stringify(res.data, null, 2));
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Test request failed';
      setTestResult(`Error: ${message}`);
    } finally {
      setTesting(false);
    }
  };

  // ---- loading state ----

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title="自動化規則" />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // ---- render ----

  return (
    <div className="flex h-full flex-col">
      <Topbar title={isNew ? '新增自動化規則' : '編輯自動化規則'}>
        <Link href="/dashboard/automation">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Button>
        </Link>
      </Topbar>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* ============ Basic Settings ============ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">基本設定</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Name */}
              <div>
                <label className="mb-1 block text-sm font-medium">名稱</label>
                <Input
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="規則名稱..."
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  描述
                </label>
                <Textarea
                  value={form.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder="此規則的用途？"
                  rows={2}
                />
              </div>

              {/* Trigger Event */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  觸發事件
                </label>
                <Select
                  options={TRIGGER_EVENTS}
                  value={form.triggerType}
                  onChange={(e) => updateField('triggerType', e.target.value)}
                />
              </div>

              {/* Keyword.matched settings */}
              {form.triggerType === 'keyword.matched' && (
                <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      關鍵字
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                        placeholder="輸入關鍵字後按新增..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addKeyword();
                          }
                        }}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={addKeyword}
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        新增
                      </Button>
                    </div>
                    {form.keywords.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {form.keywords.map((kw) => (
                          <span
                            key={kw}
                            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary"
                          >
                            {kw}
                            <button
                              type="button"
                              onClick={() => removeKeyword(kw)}
                              className="ml-1 rounded-full p-0.5 hover:bg-primary/20"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      匹配模式
                    </label>
                    <Select
                      options={MATCH_MODES}
                      value={form.matchMode}
                      onChange={(e) => updateField('matchMode', e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Priority + toggles */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    優先級
                  </label>
                  <Input
                    type="number"
                    value={form.priority}
                    onChange={(e) =>
                      updateField('priority', parseInt(e.target.value, 10) || 0)
                    }
                  />
                </div>
                <div className="space-y-3 pt-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) =>
                        updateField('isActive', e.target.checked)
                      }
                      className="rounded border-input"
                    />
                    啟用
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.stopOnMatch}
                      onChange={(e) =>
                        updateField('stopOnMatch', e.target.checked)
                      }
                      className="rounded border-input"
                    />
                    命中後停止
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ============ Conditions ============ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">條件</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                定義觸發此規則所需滿足的條件。使用下方建構器組合 AND/OR 群組條件。
              </p>
              <ConditionBuilder value={query} onChange={setQuery} />
            </CardContent>
          </Card>

          {/* ============ Actions ============ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">動作</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                定義當上述條件滿足時要執行的動作。動作將依序執行。
              </p>
              <ActionList actions={actions} onChange={setActions} />
            </CardContent>
          </Card>

          {/* ============ Test / Dry Run ============ */}
          {!isNew && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">測試 / 模擬執行</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  提供範例 Facts（JSON 格式）並以模擬模式執行此規則，驗證觸發是否正確。
                </p>
                <textarea
                  value={testFactsText}
                  onChange={(e) => setTestFactsText(e.target.value)}
                  rows={6}
                  spellCheck={false}
                  className="w-full rounded-md border border-input bg-muted/50 p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button
                  variant="secondary"
                  onClick={handleTest}
                  disabled={testing}
                >
                  <Play className="mr-1 h-4 w-4" />
                  {testing ? '執行中...' : '執行測試'}
                </Button>
                {testResult && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {testResult}
                  </pre>
                )}
              </CardContent>
            </Card>
          )}

          <Separator />

          {/* ============ Bottom actions ============ */}
          <div className="flex items-center justify-between">
            <div>
              {!isNew && (
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  {deleting ? '刪除中...' : '刪除規則'}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Link href="/dashboard/automation">
                <Button variant="outline">取消</Button>
              </Link>
              <Button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
              >
                <Save className="mr-1 h-4 w-4" />
                {saving ? '儲存中...' : '儲存規則'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
