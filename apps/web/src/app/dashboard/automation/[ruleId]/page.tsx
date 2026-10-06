'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import type { Field, RuleGroupType, ValueEditorType } from 'react-querybuilder';
import {
  AUTOMATION_EVENT_DEFINITIONS,
  getAutomationActionOptionsForEvent,
  getAutomationFieldOptionsForEvent,
  type AutomationActionDefinition,
} from '@open333crm/automation';
import api from '@/lib/api';
import { droppedActionsMessage, ruleEventName, splitRuleActions, type DroppedAction } from '@/lib/automation/rule-actions';
import { qbToEngine, engineToQb } from '@/lib/automation/qb-to-engine';
import { summarizeRule } from '@/lib/automation/rule-summary';
import {
  buildTestFacts,
  describeTestResult,
  noConditionNote,
  testFormFields,
} from '@/lib/automation/rule-test-form';
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
import { getApiErrorMessage } from '@/lib/api-error';

// ---- constants ----

// 目前不會觸發的事件（AUDIT AUTO-05）在選單上就標出來，免得管理員建了規則卻永遠不會執行
const TRIGGER_EVENTS = AUTOMATION_EVENT_DEFINITIONS.map((event) => ({
  value: event.name,
  label: event.dispatched === false ? `${event.label}（目前不會觸發）` : event.label,
}));

function contractFieldsToQueryBuilderFields(triggerType: string): Field[] {
  return getAutomationFieldOptionsForEvent(triggerType).map((field) => ({
    name: field.name,
    label: field.label,
    inputType: field.inputType === 'datetime-local' ? 'datetime-local' : field.inputType,
    valueEditorType: (operator: string) => {
      const operatorDef = field.operators.find((item) => item.name === operator);
      if (operatorDef && !operatorDef.requiresValue) return null;
      return (field.valueEditorType ?? 'text') as ValueEditorType;
    },
    values: field.values,
    operators: field.operators.map((operator) => ({
      name: operator.name,
      label: operator.label,
    })),
  }));
}

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

function DroppedActionsNotice({ dropped, remainingCount }: { dropped: DroppedAction[]; remainingCount: number }) {
  const message = droppedActionsMessage(dropped, remainingCount);
  if (!message) return null;
  return (
    <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}

// ---- page component ----

export default function AutomationRuleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ruleId = params.ruleId as string;
  const isNew = ruleId === 'new';

  // SWR for existing rules
  const { rule, isLoading, mutate } = useAutomationRule(isNew ? null : ruleId);
  // 載入時依規則存的觸發事件拆出可編輯的動作與被移除的動作（見 splitRuleActions）
  const loadedActions = useMemo(
    () => (rule ? splitRuleActions(rule.actions, ruleEventName(rule)) : null),
    [rule],
  );

  // Local form state
  const [form, setForm] = useState<RuleForm>(DEFAULT_FORM);
  const [query, setQuery] = useState<RuleGroupType>(DEFAULT_QUERY);
  const [actions, setActions] = useState<
    Array<{ type: string; payload: Record<string, unknown> }>
  >([]);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<
    { triggered: boolean; headline: string; actions: string[] } | { error: string } | null
  >(null);
  const [newKeyword, setNewKeyword] = useState('');

  const conditionFields = useMemo(
    () => contractFieldsToQueryBuilderFields(form.triggerType),
    [form.triggerType],
  );

  const actionDefinitions = useMemo(
    () =>
      getAutomationActionOptionsForEvent(form.triggerType).map(
        (option) => option.definition,
      ),
    [form.triggerType],
  );

  // Hydrate form from SWR data
  useEffect(() => {
    if (!rule || !loadedActions) return;

    // Read trigger data — backend stores trigger as { type, keywords?, match_mode? }
    const trigger = rule.trigger as { type?: string; keywords?: string[]; match_mode?: string } | undefined;
    const triggerType = ruleEventName(rule);

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
    // 後端存 { type, params }、編輯器用 { type, payload }；同時濾掉這個觸發事件的契約沒有提供的動作
    setActions(loadedActions.actions);
  }, [rule, loadedActions]);

  // ---- handlers ----

  const updateField = useCallback(
    <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleTriggerTypeChange = (nextTriggerType: string) => {
    updateField('triggerType', nextTriggerType);
    setQuery(DEFAULT_QUERY);
    setActions([]);
  };

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
    if (!form.name.trim()) return;
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
      alert(getApiErrorMessage(err, '儲存規則失敗，請稍後重試'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('確定要刪除此規則嗎？')) return;
    setDeleting(true);
    try {
      await api.delete(`/automation/rules/${ruleId}`);
      router.push('/dashboard/automation');
    } catch (err) {
      console.error('Failed to delete rule:', err);
      alert(getApiErrorMessage(err, '刪除規則失敗，請稍後重試'));
    } finally {
      setDeleting(false);
    }
  };

  // 試跑的是已儲存的版本：表單欄位依「已儲存的條件」產生，與 API 實際評估的規則一致
  const testFields = useMemo(() => testFormFields(rule?.conditions), [rule]);
  // 儲存後規則重新載入：舊的試跑結果與填的值屬於舊版本，清掉
  useEffect(() => {
    setTestResult(null);
    setTestValues({});
  }, [rule]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post(`/automation/rules/${ruleId}/test`, {
        facts: buildTestFacts(testFields, testValues),
      });
      setTestResult(
        describeTestResult(res.data?.data ?? {}, rule?.actions, {
          isActive: rule?.isActive,
          eventName: rule ? ruleEventName(rule) : undefined,
        }),
      );
    } catch (err: unknown) {
      setTestResult({ error: getApiErrorMessage(err, '試跑失敗，請稍後重試') });
    } finally {
      setTesting(false);
    }
  };

  // 依目前畫面上的設定（尚未儲存的修改也算）產生的一句話摘要
  const summary = summarizeRule({
    trigger: { type: form.triggerType },
    conditions: qbToEngine(query),
    actions: actions.map((a) => ({ type: a.type, params: a.payload })),
  });
  const selectedEvent = AUTOMATION_EVENT_DEFINITIONS.find((e) => e.name === form.triggerType);

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
          {/* ============ Summary ============ */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
            <p className="text-xs font-medium text-primary">這條規則會</p>
            <p className="mt-1 text-sm leading-relaxed">{summary}</p>
          </div>

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
                  placeholder="例如：客訴自動開工單"
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  說明（選填）
                </label>
                <Textarea
                  value={form.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder="寫下這條規則的用途，方便其他人了解"
                  rows={2}
                />
              </div>

              {/* Trigger Event */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  什麼時候檢查這條規則
                </label>
                <Select
                  options={TRIGGER_EVENTS}
                  value={form.triggerType}
                  onChange={(e) => handleTriggerTypeChange(e.target.value)}
                />
                {selectedEvent?.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{selectedEvent.description}</p>
                )}
                {selectedEvent?.dispatched === false && (
                  <p className="mt-1 text-xs text-destructive">
                    系統目前不會送出這個事件，以它觸發的規則不會執行。請改選其他時機。
                  </p>
                )}
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
                      比對方式
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
              <div>
                <label className="mb-1 block text-sm font-medium">執行順序</label>
                <Input
                  type="number"
                  className="max-w-[160px]"
                  value={form.priority}
                  onChange={(e) =>
                    updateField('priority', parseInt(e.target.value) || 0)
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  同一個時機有好幾條規則時，數字越大越先檢查。
                </p>
              </div>
              <div className="space-y-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => updateField('isActive', e.target.checked)}
                    className="mt-0.5 rounded border-input"
                  />
                  <span>
                    啟用這條規則
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      不勾選的話，規則會先存起來，但不會執行。
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.stopOnMatch}
                    onChange={(e) => updateField('stopOnMatch', e.target.checked)}
                    className="mt-0.5 rounded border-input"
                  />
                  <span>
                    這條規則執行後，不再檢查其他規則
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      勾選後，執行順序排在後面的規則就算符合也不會執行。
                    </span>
                  </span>
                </label>
              </div>
            </CardContent>
          </Card>

          {/* ============ Conditions ============ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">在什麼情況下</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                符合這些條件時才執行下方的動作。沒有設定條件的話，每次都會執行。
              </p>
              <ConditionBuilder
                value={query}
                onChange={setQuery}
                fields={conditionFields}
              />
            </CardContent>
          </Card>

          {/* ============ Actions ============ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">要做什麼</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                符合條件時要做的事，會照順序一個一個執行。
              </p>
              {/* 載入時被移除的動作要明講，否則動作從畫面上消失、儲存後被刪除，管理員不會發現。
                  改了觸發事件後動作已清空，提示講的是原本的事件，不再顯示 */}
              {rule && loadedActions && form.triggerType === ruleEventName(rule) && (
                <DroppedActionsNotice dropped={loadedActions.dropped} remainingCount={loadedActions.actions.length} />
              )}
              <ActionList
                actions={actions}
                onChange={setActions}
                actionDefinitions={actionDefinitions as AutomationActionDefinition[]}
              />
            </CardContent>
          </Card>

          {/* ============ Test / Dry Run ============ */}
          {!isNew && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">試試看這條規則</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  填入假設的情況，看看規則會不會執行。試跑的是<strong>已儲存</strong>的版本，修改後請先儲存；不會真的執行動作。
                </p>
                {testFields.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{rule ? noConditionNote(rule) : ''}</p>
                ) : (
                  <div className="space-y-3">
                    {testFields.map((field) => (
                      <div key={field.key}>
                        <label className="mb-1 block text-sm font-medium">{field.label}</label>
                        {field.input === 'select' || field.input === 'boolean' ? (
                          <Select
                            options={[
                              { value: '', label: '不指定' },
                              ...(field.input === 'boolean'
                                ? [{ value: 'true', label: '是' }, { value: 'false', label: '否' }]
                                : field.options ?? []),
                            ]}
                            value={testValues[field.key] ?? ''}
                            onChange={(e) => setTestValues((v) => ({ ...v, [field.key]: e.target.value }))}
                          />
                        ) : (
                          <Input
                            type={field.input === 'number' ? 'number' : field.input === 'datetime' ? 'datetime-local' : 'text'}
                            value={testValues[field.key] ?? ''}
                            placeholder={field.input === 'list' ? '多個值用「、」分開' : undefined}
                            onChange={(e) => setTestValues((v) => ({ ...v, [field.key]: e.target.value }))}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <Button variant="secondary" onClick={handleTest} disabled={testing}>
                  <Play className="mr-1 h-4 w-4" />
                  {testing ? '試跑中...' : '試試看'}
                </Button>
                {testResult && 'error' in testResult && (
                  <p className="text-sm text-destructive">{testResult.error}</p>
                )}
                {testResult && 'headline' in testResult && (
                  <div
                    className={
                      testResult.triggered
                        ? 'rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm'
                        : 'rounded-md border bg-muted/50 px-3 py-2 text-sm'
                    }
                  >
                    <p className="font-medium">{testResult.headline}</p>
                    {testResult.actions.length > 0 && (
                      <p className="mt-1 text-muted-foreground">會執行：{testResult.actions.join('、')}</p>
                    )}
                  </div>
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
