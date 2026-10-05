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

  const toggleActive = async (
    e: React.MouseEvent,
    ruleId: string,
    currentActive: boolean
  ) => {
    e.stopPropagation();
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

  return (
    <div className="flex h-full flex-col">
      <Topbar title="自動化">
        <Button
          size="sm"
          onClick={() => router.push('/dashboard/automation/new')}
        >
          <Plus className="mr-1 h-4 w-4" />
          新增規則
        </Button>
      </Topbar>

      <div className="flex-1 overflow-auto">
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
              <Button
                onClick={() => router.push('/dashboard/automation/new')}
              >
                <Plus className="mr-1 h-4 w-4" />
                建立規則
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜尋規則名稱"
                  className="pl-9"
                />
              </div>
              <Select
                options={STATUS_OPTIONS}
                value={status}
                onChange={(e) => setStatus(e.target.value as RuleStatusFilter)}
                className="w-36"
              />
              <span className="text-sm text-muted-foreground">
                共 {visibleRules.length} 條{visibleRules.length !== rules.length && `（全部 ${rules.length} 條）`}
              </span>
            </div>

            {visibleRules.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">沒有符合條件的規則</p>
            ) : (
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">規則</th>
                    <th className="w-36 px-4 py-3 text-xs font-medium text-muted-foreground">檢查時機</th>
                    <th className="w-24 px-4 py-3 text-xs font-medium text-muted-foreground" title="數字越大越先檢查">
                      執行順序
                    </th>
                    <th className="w-24 px-4 py-3 text-xs font-medium text-muted-foreground">啟用</th>
                  </tr>
                </thead>
                {/* 不顯示執行次數：runCount、lastRunAt 自 9255245 起停止更新（AUDIT AUTO-02），數字會誤導 */}
                <tbody>
                  {visibleRules.map((rule) => {
                    const { summary, skipErrors } = derived.get(rule.id) ?? { summary: '', skipErrors: [] };
                    return (
                      <tr
                        key={rule.id}
                        className="cursor-pointer border-b align-top transition-colors hover:bg-muted/50"
                        onClick={() => router.push(`/dashboard/automation/${rule.id}`)}
                      >
                        {/* 名稱過長時截斷，其他欄位才看得到；摘要說明規則在做什麼 */}
                        <td className="px-4 py-3">
                          <p className="truncate text-sm font-medium" title={rule.name}>
                            {rule.name}
                          </p>
                          {/* 摘要最多兩行；滑鼠移上去看完整摘要與說明 */}
                          <p
                            className="mt-0.5 line-clamp-2 text-xs text-muted-foreground"
                            title={rule.description ? `${summary}\n\n說明：${rule.description}` : summary}
                          >
                            {summary}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1 empty:hidden">
                            {/* workers 驗證失敗會整條略過、只寫 log；列在這裡管理員才看得到 */}
                            {skipErrors.length > 0 && (
                              <Badge variant="destructive" className="text-xs" title={skipErrors.join('\n')}>
                                規則不會執行
                              </Badge>
                            )}
                            {rule.stopOnMatch && (
                              <Badge variant="outline" className="text-xs" title="這條規則執行後，不再檢查其他規則">
                                執行後停止
                              </Badge>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3 text-sm">{ruleEventLabel(rule)}</td>

                        <td className="px-4 py-3 text-sm text-muted-foreground">{rule.priority}</td>

                        <td className="px-4 py-3">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={rule.isActive}
                            aria-label={rule.isActive ? '停用這條規則' : '啟用這條規則'}
                            onClick={(e) => toggleActive(e, rule.id, rule.isActive)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              rule.isActive ? 'bg-primary' : 'bg-muted'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                rule.isActive ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
