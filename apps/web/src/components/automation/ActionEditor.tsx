'use client';

import React, { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import type { AutomationActionDefinition } from '@open333crm/automation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import useSWR from 'swr';
import api from '@/lib/api';
import { agentOptions, emptyOptionLabel, materialOptions, selectOptionsForParam } from '@/lib/automation/rule-actions';

const ACTION_TYPES = [
  { value: 'send_message', label: '傳送訊息' },
  { value: 'create_case', label: '建立工單' },
  { value: 'update_case_status', label: '更新工單狀態' },
  { value: 'escalate_case', label: '升級工單' },
  { value: 'add_tag', label: '新增標籤' },
  { value: 'remove_tag', label: '移除標籤' },
  { value: 'assign_agent', label: '指派客服' },
  { value: 'notify', label: '傳送通知' },
  { value: 'notify_supervisor', label: '通知主管' },
];

const CASE_STATUSES = [
  { value: 'OPEN', label: '開啟' },
  { value: 'IN_PROGRESS', label: '處理中' },
  { value: 'ESCALATED', label: '已升級' },
  { value: 'RESOLVED', label: '已解決' },
  { value: 'CLOSED', label: '已關閉' },
];

const CASE_PRIORITIES = [
  { value: 'LOW', label: '低' },
  { value: 'MEDIUM', label: '中' },
  { value: 'HIGH', label: '高' },
  { value: 'URGENT', label: '緊急' },
];

interface ActionEditorProps {
  action: { type: string; payload: Record<string, unknown> };
  actionDefinitions?: AutomationActionDefinition[];
  onChange: (action: { type: string; payload: Record<string, unknown> }) => void;
  onRemove: () => void;
}

function PayloadField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 py-1 text-sm"
      />
    </div>
  );
}

function ActionParamsForm({
  type,
  payload: rawPayload,
  onChange,
  definition,
}: {
  type: string;
  payload: Record<string, unknown>;
  onChange: (payload: Record<string, unknown>) => void;
  definition?: AutomationActionDefinition;
}) {
  const payload = rawPayload || {};
  const updateParam = (key: string, value: unknown) => {
    onChange({ ...payload, [key]: value });
  };

  if (definition?.params) {
    return (
      <div className="space-y-2">
        {definition.params.map((param) => {
          const value = String(payload[param.key] ?? '');
          if (param.type === 'agent') {
            return (
              <AgentSelectField
                key={param.key}
                label={param.label}
                emptyLabel={param.required ? '請選擇客服' : emptyOptionLabel(param.key)}
                value={value}
                onChange={(v) => updateParam(param.key, v)}
              />
            );
          }
          if (param.type === 'material') {
            return (
              <MaterialSelectField
                key={param.key}
                label={param.label}
                value={value}
                onChange={(v) => updateParam(param.key, v)}
              />
            );
          }
          if (param.type === 'select') {
            return (
              <div key={param.key}>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {param.label}
                </label>
                <Select
                  options={selectOptionsForParam(param)}
                  // 必填參數沒有「不指定」；未選時要顯示「請選擇…」，否則畫面顯示第一個選項，實際卻是空值
                  placeholder={param.required ? `請選擇${param.label}` : undefined}
                  value={value}
                  onChange={(e) => updateParam(param.key, e.target.value)}
                  className="h-8 py-1 text-sm"
                />
              </div>
            );
          }

          return (
            <PayloadField
              key={param.key}
              label={param.label}
              value={value}
              onChange={(v) => updateParam(param.key, v)}
              placeholder={param.placeholder}
              type={param.type === 'number' ? 'number' : 'text'}
            />
          );
        })}
      </div>
    );
  }

  if (definition) {
    return <p className="text-xs text-muted-foreground">此動作無需額外參數</p>;
  }

  switch (type) {
    case 'send_message':
      return (
        <PayloadField
          label="訊息內容"
          value={(payload.text as string) || ''}
          onChange={(v) => updateParam('text', v)}
          placeholder="輸入要發送的訊息..."
        />
      );

    case 'add_tag':
    case 'remove_tag':
      return (
        <PayloadField
          label="標籤名稱"
          value={(payload.tagName as string) || ''}
          onChange={(v) => updateParam('tagName', v)}
          placeholder="輸入標籤名稱..."
        />
      );

    case 'create_case':
      return (
        <div className="space-y-2">
          <PayloadField
            label="工單標題"
            value={(payload.title as string) || ''}
            onChange={(v) => updateParam('title', v)}
            placeholder="自動建立的工單標題..."
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                優先級
              </label>
              <Select
                options={CASE_PRIORITIES}
                value={(payload.priority as string) || 'MEDIUM'}
                onChange={(e) => updateParam('priority', e.target.value)}
                className="h-8 py-1 text-sm"
              />
            </div>
            <PayloadField
              label="分類"
              value={(payload.category as string) || ''}
              onChange={(v) => updateParam('category', v)}
              placeholder="工單分類..."
            />
          </div>
        </div>
      );

    case 'update_case_status':
      return (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            目標狀態
          </label>
          <Select
            options={CASE_STATUSES}
            value={(payload.status as string) || 'OPEN'}
            onChange={(e) => updateParam('status', e.target.value)}
            className="h-8 py-1 text-sm"
          />
        </div>
      );

    case 'escalate_case':
      return (
        <div className="space-y-2">
          <PayloadField
            label="升級原因"
            value={(payload.reason as string) || ''}
            onChange={(v) => updateParam('reason', v)}
            placeholder="升級原因..."
          />
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              新優先級
            </label>
            <Select
              options={CASE_PRIORITIES}
              value={(payload.newPriority as string) || ''}
              onChange={(e) => updateParam('newPriority', e.target.value)}
              className="h-8 py-1 text-sm"
              placeholder="留空自動提升一級"
            />
          </div>
        </div>
      );

    case 'notify':
    case 'notify_supervisor':
      return (
        <PayloadField
          label="通知訊息"
          value={(payload.message as string) || ''}
          onChange={(v) => updateParam('message', v)}
          placeholder="輸入通知內容..."
        />
      );

    default: {
      // Fallback: raw JSON editor for unknown types
      return <JsonFallbackEditor payload={payload} onChange={onChange} />;
    }
  }
}

/**
 * 指派客服：從客服名單選人（原本要手動填 UUID）。
 * 沒有 agent.view 權限或載入失敗時，退回文字輸入並說明原因。
 */
function AgentSelectField({
  label,
  emptyLabel,
  value,
  onChange,
}: {
  label: string;
  emptyLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { data, error } = useSWR('/agents', async (url: string) => (await api.get(url)).data?.data ?? []);
  if (error) {
    return (
      <div>
        <PayloadField label={label} value={value} onChange={onChange} placeholder="客服 ID" />
        <p className="mt-1 text-xs text-muted-foreground">無法載入客服名單（可能沒有檢視客服的權限），請填入客服 ID。</p>
      </div>
    );
  }
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <Select
        options={agentOptions((data ?? []) as Array<{ id: string; name?: string; email?: string }>, value, data !== undefined, emptyLabel)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 py-1 text-sm"
      />
    </div>
  );
}

/** 素材庫 API 每頁最多 50 筆；逐頁取完所有啟用中的素材（最多 20 頁，避免異常資料讓請求無限進行） */
async function fetchAllActiveMaterials(): Promise<Array<{ id: string; name?: string; channelType?: string }>> {
  const all: Array<{ id: string; name?: string; channelType?: string }> = [];
  for (let page = 1; page <= 20; page++) {
    const res = await api.get(`/marketing/materials?isActive=true&page=${page}&limit=50`);
    all.push(...((res.data?.data ?? []) as typeof all));
    const totalPages = Number(res.data?.meta?.totalPages ?? 1);
    if (page >= totalPages) break;
  }
  return all;
}

/**
 * 傳送素材：從素材庫選（原本要手動貼素材 UUID，問題清單 A04）。
 * 沒有素材檢視權限（marketing.view）或載入失敗時，退回文字輸入並說明原因。
 */
function MaterialSelectField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { data, error } = useSWR('automation:active-materials', fetchAllActiveMaterials);
  if (error) {
    return (
      <div>
        <PayloadField label={label} value={value} onChange={onChange} placeholder="素材 ID" />
        <p className="mt-1 text-xs text-muted-foreground">無法載入素材清單（可能沒有檢視素材庫的權限），請填入素材 ID。</p>
      </div>
    );
  }
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <Select
        options={materialOptions(data ?? [], value, data !== undefined)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 py-1 text-sm"
      />
      <p className="mt-1 text-xs text-muted-foreground">素材的渠道和對話不同時不會送出。</p>
    </div>
  );
}

function JsonFallbackEditor({
  payload,
  onChange,
}: {
  payload: Record<string, unknown>;
  onChange: (payload: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(JSON.stringify(payload, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(JSON.stringify(payload, null, 2));
  }, [payload]);

  const handleBlur = () => {
    try {
      const parsed = JSON.parse(text);
      setError(null);
      onChange(parsed);
    } catch {
      setError('JSON 格式無效');
    }
  };

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        承載資料 (JSON)
      </label>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onBlur={handleBlur}
        rows={4}
        spellCheck={false}
        className="w-full rounded-md border border-input bg-background p-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * 既有規則上的發券動作（add-coupon-system design D25）：發券改在 LINE 關鍵字回覆與加好友禮頁設定，
 * 自動化規則編輯器只顯示券名與說明，可以刪除這個動作，不能新增或換券。
 */
function HiddenActionReadOnly({ definition, payload }: { definition: AutomationActionDefinition; payload: Record<string, unknown> }) {
  const couponId = typeof payload.couponId === 'string' ? payload.couponId : '';
  const { data: coupon, error } = useSWR(
    couponId ? `/coupons/${couponId}` : null,
    async (url: string) => (await api.get(url)).data?.data as { name?: string; displayCode?: string } | undefined,
  );
  const couponLabel = !couponId
    ? '未指定優惠券'
    : coupon?.name
      ? `${coupon.name}${coupon.displayCode ? `（${coupon.displayCode}）` : ''}`
      : error
        ? `找不到的券或沒有檢視權限（${couponId}）`
        : '載入中…';
  return (
    <div className="space-y-1 text-sm">
      <p className="text-xs font-medium text-muted-foreground">{definition.label}</p>
      <p className="font-medium">{couponLabel}</p>
      <p className="text-xs text-muted-foreground">
        發券請到 LINE 關鍵字回覆或加好友禮設定。這個動作會照常執行，這裡只能刪除。
      </p>
    </div>
  );
}

export function ActionEditor({
  action,
  actionDefinitions,
  onChange,
  onRemove,
}: ActionEditorProps) {
  // Normalize: backend may use "params" instead of "payload"
  const payload = action.payload || (action as any).params || {};
  const definition = actionDefinitions?.find((item) => item.type === action.type);
  // 隱藏的動作（發送優惠券）不列在動作選單，只能在專用頁設定
  const actionTypeOptions =
    actionDefinitions
      ?.filter((item) => !item.editorHidden)
      .map((item) => ({ value: item.type, label: item.label })) ??
    ACTION_TYPES;

  if (definition?.editorHidden) {
    return (
      <div className="flex gap-3 rounded-md border border-input bg-muted/30 p-3">
        <div className="flex-1">
          <HiddenActionReadOnly definition={definition} payload={payload} />
        </div>
        <RemoveActionButton onRemove={onRemove} />
      </div>
    );
  }

  return (
    <div className="flex gap-3 rounded-md border border-input bg-muted/30 p-3">
      <div className="flex flex-1 flex-col gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            動作類型
          </label>
          <Select
            options={actionTypeOptions}
            value={action.type}
            onChange={(e) => onChange({ type: e.target.value, payload: {} })}
            placeholder="選擇動作類型..."
            className="h-9 text-sm"
          />
        </div>
        <ActionParamsForm
          type={action.type}
          payload={payload}
          definition={definition}
          onChange={(p) => onChange({ ...action, payload: p })}
        />
      </div>
      <RemoveActionButton onRemove={onRemove} />
    </div>
  );
}

function RemoveActionButton({ onRemove }: { onRemove: () => void }) {
  return (
    <div className="pt-5">
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label="刪除動作"
        title="刪除動作"
        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
