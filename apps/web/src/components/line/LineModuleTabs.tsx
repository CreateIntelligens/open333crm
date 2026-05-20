'use client';

/**
 * LINE 管理模組共用 Tab 列
 *
 * 目前只實作 Rich Menu；其餘 tab 為占位（disabled，提示「敬請期待」）。
 */

import React from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Props {
  active: string;
}

export function LineModuleTabs({ active }: Props) {
  return (
    <div className="border-b px-6 pt-2">
      <Tabs value={active} onValueChange={() => undefined}>
        <TabsList>
          <TabsTrigger value="rich-menus">Rich Menu</TabsTrigger>
          {/* 其餘 tab 用 placeholder 顯示「敬請期待」— Tabs 元件不支援 disabled，用樣式抑制 */}
          <DisabledTab label="Quick Reply" />
          <DisabledTab label="歡迎訊息" />
          <DisabledTab label="加好友自動回應" />
        </TabsList>
      </Tabs>
    </div>
  );
}

function DisabledTab({ label }: { label: string }) {
  return (
    <span
      className="inline-flex h-9 cursor-not-allowed items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium text-slate-400 opacity-60"
      title="敬請期待"
    >
      {label}
    </span>
  );
}
