'use client';

import React from 'react';
import { QueryBuilder, type RuleGroupType } from 'react-querybuilder';
import 'react-querybuilder/dist/query-builder.css';
import { automationFields } from '@/lib/automation/fields';

interface ConditionBuilderProps {
  value: RuleGroupType;
  onChange: (query: RuleGroupType) => void;
}

export function ConditionBuilder({ value, onChange }: ConditionBuilderProps) {
  return (
    <div className="condition-builder">
      <QueryBuilder
        fields={automationFields}
        query={value}
        onQueryChange={onChange}
        controlClassnames={{
          queryBuilder:
            'rounded-md border border-input bg-background p-4 [&_.ruleGroup]:border [&_.ruleGroup]:border-border [&_.ruleGroup]:rounded-md [&_.ruleGroup]:bg-muted/30 [&_.ruleGroup]:p-3 [&_.ruleGroup]:my-2',
          header: 'flex items-center gap-2 mb-2',
          body: 'space-y-2',
          rule: 'flex items-center gap-2 flex-wrap',
          combinators:
            'h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          addRule:
            'inline-flex items-center justify-center h-8 rounded-md px-3 text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors',
          addGroup:
            'inline-flex items-center justify-center h-8 rounded-md px-3 text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors',
          removeGroup:
            'inline-flex items-center justify-center h-8 w-8 rounded-md text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors',
          removeRule:
            'inline-flex items-center justify-center h-8 w-8 rounded-md text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors',
          fields:
            'h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          operators:
            'h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          value:
            'h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        }}
      />
    </div>
  );
}
