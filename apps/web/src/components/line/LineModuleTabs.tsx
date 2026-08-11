'use client';

/**
 * LINE 管理模組共用 Tab 列
 *
 * 切換 tab 走 router push 到對應頁。歡迎訊息 / 加好友自動回應為占位（尚未實作）。
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Props {
  active: string;
}

const TAB_TO_PATH: Record<string, string> = {
  'rich-menus': '/dashboard/line/rich-menus',
  'keyword-replies': '/dashboard/line/keyword-replies',
};

export function LineModuleTabs({ active }: Props) {
  const router = useRouter();

  const handleChange = (val: string) => {
    const path = TAB_TO_PATH[val];
    if (path && val !== active) router.push(path);
  };

  return (
    <div className="border-b px-6 pt-2">
      <Tabs value={active} onValueChange={handleChange}>
        <TabsList>
          <TabsTrigger value="rich-menus">Rich Menu</TabsTrigger>
          <TabsTrigger value="keyword-replies">關鍵字回覆</TabsTrigger>
          {/* 其餘 tab 用 placeholder 顯示「敬請期待」— Tabs 元件不支援 disabled，用樣式抑制 */}
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
      className="inline-flex h-9 cursor-not-allowed items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium text-muted-foreground opacity-60"
      title="敬請期待"
    >
      {label}
    </span>
  );
}
