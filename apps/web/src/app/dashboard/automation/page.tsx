'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Search, Zap } from 'lucide-react';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/shared/EmptyState';
import { useAutomationRules } from '@/hooks/useAutomation';
import { findWorkerSkipErrors } from '@/lib/automation/rule-actions';
import { filterRules, ruleEventLabel, type RuleStatusFilter } from '@/lib/automation/rule-list';
import { summarizeRule } from '@/lib/automation/rule-summary';

const STATUS_OPTIONS: Array<{ value: RuleStatusFilter; label: string }> = [
  { value: 'all', label: '全部狀態' },
  { value: 'active', label: '啟用中' },
  { value: 'inactive', label: '已停用' },
];

export default function AutomationPage() {
  const router = useRouter();
  const { rules, isLoading, error, mutate } = useAutomationRules();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<RuleStatusFilter>('all');
  // 摘要與契約驗證只在規則資料變動時算一次；搜尋時只做篩選（規則可能上百條）
  const derived = useMemo(
    () =>
      new Map(
        rules.map((rule) => [
          rule.id,
          {
            summary: summarizeRule(rule),
            skipErrors: findWorkerSkipErrors(rule),
          },
        ]),
      ),
    [rules],
  );
  const visibleRules = useMemo(() => filterRules(rules, { query, status }), [rules, query, status]);

  const toggleActive = async (ruleId: string, currentActive: boolean) => {
    try {
      await api.patch(`/automation/rules/${ruleId}`, {
        isActive: !currentActive,
      });
      mutate();
    } catch (err) {
      // 失敗要讓管理員看到，否則開關沒反應卻不知道原因
      alert(getApiErrorMessage(err, currentActive ? '停用規則失敗，請稍後重試' : '啟用規則失敗，請稍後重試'));
    }
  };

  // 版面依 Figma 5.1.1 自動化
  return (
    <div className="flex h-full flex-col">
      {/* 說明文字：Figma 5.1.1 的說明是從人員管理頁複製來的佔位文字，這裡改成自動化的說明 */}
      <Topbar title="自動化" description="設定觸發條件與動作，讓系統自動貼標籤、開工單或通知同事">
        <Button size="lg" className="w-[140px]" onClick={() => router.push('/dashboard/automation/new')}>
          新增規則
        </Button>
      </Topbar>

      <div className="flex-1 overflow-auto px-8 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error && rules.length === 0 ? (
          // 任一頁載入失敗時 rules 為空；不能顯示「沒有自動化規則」，管理員會以為規則全被刪了
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-destructive">
            <p>{getApiErrorMessage(error, '載入自動化規則失敗，請稍後重試')}</p>
            <Button variant="outline" size="sm" onClick={() => mutate()}>
              重新載入
            </Button>
          </div>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={<Zap className="h-12 w-12" />}
            title="還沒有自動化規則"
            description="自動化規則可以在收到訊息、建立工單等時機，自動幫你貼標籤、開工單或通知同事"
            action={
              <Button onClick={() => router.push('/dashboard/automation/new')}>
                <Plus />
                建立規則
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-5">
            {/* 搜尋與篩選：Figma 沒有畫，但規則可能上百條，保留原有功能 */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜尋規則名稱"
                  aria-label="搜尋規則名稱"
                  className="h-11 pl-10"
                />
              </div>
              <Select
                options={STATUS_OPTIONS}
                value={status}
                onChange={(e) => setStatus(e.target.value as RuleStatusFilter)}
                aria-label="篩選狀態"
                className="w-36"
              />
              <span className="text-sm text-muted-foreground">
                共 {visibleRules.length} 條{visibleRules.length !== rules.length && `（全部 ${rules.length} 條）`}
              </span>
            </div>

            {visibleRules.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">沒有符合條件的規則</p>
            ) : (
              <div role="table" aria-label="自動化規則" className="overflow-hidden rounded-lg border border-border">
                <div role="row" className={`${COLS} border-b border-border bg-muted py-2 text-sm font-medium leading-7 text-muted-foreground`}>
                  <span role="columnheader">名稱</span>
                  <span role="columnheader">概述</span>
                  <span role="columnheader" title="數字越大越先檢查">優先級</span>
                  <span role="columnheader">啟用</span>
                  <span role="columnheader" title="這條規則執行後，不再檢查其他規則">命中後停止</span>
                </div>
                {/* 不顯示執行次數：runCount、lastRunAt 自 9255245 起停止更新（AUDIT AUTO-02），數字會誤導；Figma 的「執行次數」欄待後端修正後再加 */}
                {visibleRules.map((rule) => {
                  const { summary, skipErrors } = derived.get(rule.id) ?? { summary: '', skipErrors: [] };
                  const open = () => router.push(`/dashboard/automation/${rule.id}`);
                  return (
                    <div
                      key={rule.id}
                      role="row"
                      tabIndex={0}
                      onClick={open}
                      onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
                      className={`${COLS} cursor-pointer border-b border-border bg-background py-4 transition-colors last:border-b-0 hover:bg-shell focus-visible:bg-shell focus-visible:outline-none`}
                    >
                      <span role="cell" className="flex min-w-0 flex-col items-start gap-1">
                        <span className="w-full truncate text-sm font-semibold leading-5 text-foreground" title={rule.name}>
                          {rule.name}
                        </span>
                        <span className="flex flex-wrap gap-1">
                          <Badge variant="secondary">{ruleEventLabel(rule)}</Badge>
                          {/* workers 驗證失敗會整條略過、只寫 log；列在這裡管理員才看得到 */}
                          {skipErrors.length > 0 && (
                            <Badge variant="danger" title={skipErrors.join('\n')}>規則不會執行</Badge>
                          )}
                        </span>
                      </span>

                      <span
                        role="cell"
                        className="line-clamp-2 text-sm font-medium leading-5 text-muted-foreground"
                        title={rule.description ? `${summary}\n\n說明：${rule.description}` : summary}
                      >
                        {summary}
                      </span>

                      <span role="cell" className="text-sm font-medium tabular-nums text-foreground">{rule.priority}</span>

                      <span role="cell" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Switch
                          checked={rule.isActive}
                          onCheckedChange={() => toggleActive(rule.id, rule.isActive)}
                          aria-label={rule.isActive ? `停用「${rule.name}」` : `啟用「${rule.name}」`}
                        />
                      </span>

                      <span role="cell">
                        {rule.stopOnMatch ? (
                          <span className="inline-flex h-9 items-center rounded-full border border-control-disabled bg-shell px-5 text-sm font-medium text-tertiary-foreground">是</span>
                        ) : (
                          <span className="inline-flex h-9 items-center px-5 text-sm font-medium text-status-neutral">否</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 欄寬依 Figma：名稱 250、概述彈性（Figma 550）、優先級／啟用／命中後停止各 100，欄距 20
const COLS = 'grid grid-cols-[250px_minmax(0,1fr)_100px_100px_100px] items-center gap-5 px-5';
