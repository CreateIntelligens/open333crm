"use client";

import React from "react";
import { useSocket } from "@/providers/SocketProvider";

interface TopbarProps {
  title: string;
  children?: React.ReactNode;
}

// 頁面標題列。通知、帳號選單、操作說明已移到全站頂部（AppHeader），這裡只留標題與連線狀態。
export function Topbar({ title, children }: TopbarProps) {
  const { isConnected, connectionLost } = useSocket();

  return (
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3">
      <div className="flex min-w-0 items-center gap-4">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children}
      </div>

      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${isConnected ? "bg-success" : "bg-destructive"}`}
        />
        {connectionLost ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs text-destructive underline-offset-2 hover:underline"
            title="即時訊息連線中斷，重新整理頁面以恢復"
          >
            即時連線中斷，請重新整理
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">{isConnected ? "已連線" : "未連線"}</span>
        )}
      </div>
    </header>
  );
}
