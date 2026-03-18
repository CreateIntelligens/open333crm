'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ActionEditor } from './ActionEditor';

interface ActionListProps {
  actions: Array<{ type: string; payload: Record<string, unknown> }>;
  onChange: (
    actions: Array<{ type: string; payload: Record<string, unknown> }>
  ) => void;
}

export function ActionList({ actions, onChange }: ActionListProps) {
  const handleAdd = () => {
    onChange([...actions, { type: 'send_message', payload: {} }]);
  };

  const handleChange = (
    index: number,
    updated: { type: string; payload: Record<string, unknown> }
  ) => {
    const next = [...actions];
    next[index] = updated;
    onChange(next);
  };

  const handleRemove = (index: number) => {
    onChange(actions.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {actions.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          尚未設定動作。新增動作以定義條件滿足時的行為。
        </p>
      )}
      {actions.map((action, index) => (
        <ActionEditor
          key={index}
          action={action}
          onChange={(updated) => handleChange(index, updated)}
          onRemove={() => handleRemove(index)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAdd}
        className="w-full"
      >
        <Plus className="mr-1 h-4 w-4" />
        新增動作
      </Button>
    </div>
  );
}
