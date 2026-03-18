'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2, Plus, Zap } from 'lucide-react';
import api from '@/lib/api';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { useAutomationRules } from '@/hooks/useAutomation';

export default function AutomationPage() {
  const router = useRouter();
  const { rules, isLoading, mutate } = useAutomationRules();

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
      console.error('Failed to toggle rule:', err);
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
        ) : rules.length === 0 ? (
          <EmptyState
            icon={<Zap className="h-12 w-12" />}
            title="沒有自動化規則"
            description="建立自動化規則以簡化您的工作流程"
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
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                    名稱
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                    描述
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                    優先級
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                    啟用
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                    命中後停止
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                    執行次數
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                    onClick={() =>
                      router.push(`/dashboard/automation/${rule.id}`)
                    }
                  >
                    {/* Name */}
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium">{rule.name}</p>
                      {(rule.trigger?.type || rule.triggerEvent) && (
                        <Badge variant="secondary" className="mt-1 text-xs">
                          {rule.trigger?.type || rule.triggerEvent}
                        </Badge>
                      )}
                    </td>

                    {/* Description */}
                    <td className="px-4 py-3">
                      <p className="max-w-xs truncate text-sm text-muted-foreground">
                        {rule.description || '--'}
                      </p>
                    </td>

                    {/* Priority */}
                    <td className="px-4 py-3 text-sm">{rule.priority}</td>

                    {/* Active toggle */}
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => toggleActive(e, rule.id, rule.isActive)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          rule.isActive ? 'bg-primary' : 'bg-muted'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            rule.isActive
                              ? 'translate-x-6'
                              : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>

                    {/* Stop on Match */}
                    <td className="px-4 py-3 text-sm">
                      {rule.stopOnMatch ? (
                        <Badge variant="outline" className="text-xs">
                          是
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">否</span>
                      )}
                    </td>

                    {/* Execution count */}
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {rule.runCount ?? 0}
                      {rule.lastRunAt && (
                        <span className="ml-2 text-xs">
                          (最後執行：{' '}
                          {format(
                            new Date(rule.lastRunAt),
                            'MMM d, HH:mm'
                          )}
                          )
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
