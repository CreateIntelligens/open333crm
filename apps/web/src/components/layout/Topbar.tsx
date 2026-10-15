"use client";

import React from "react";
import Link from "next/link";
import { useSocket } from "@/providers/SocketProvider";
import { useNavTrail } from "@/components/layout/Sidebar";

interface TopbarProps {
  title: string;
  /** 標題下方的說明文字（選填） */
  description?: React.ReactNode;
  /** 放在標題列右側的操作，例如「新增」按鈕、篩選 */
  children?: React.ReactNode;
}

/**
 * 頁面標題列 — 依 Figma 列表頁（7.1.1 行銷活動、10.1.1 連結管理）
 * - 有子選單的區塊顯示麵包屑：14px #37404C，例「行銷 > 行銷活動」
 * - 標題 24px 600、說明 16px #707E93；操作放右側，間距 12
 * - 上下左右內距 32、麵包屑與標題間距 12
 * - 即時連線只在中斷時顯示提醒（Figma 沒有常駐的連線狀態）
 *
 * 標題規則：剛好在子選單那一頁時，標題用子選單名稱（例：行銷活動），
 * 讓標題和左側選中的項目一致；更深的頁面（詳情、新增）沿用頁面傳入的標題。
 */
export function Topbar({ title, description, children }: TopbarProps) {
  const { connectionLost } = useSocket();
  const trail = useNavTrail();

  const showTrail = Boolean(trail.section && (trail.link || !trail.atLink));
  const heading = trail.atLink && trail.link ? trail.link.label : title;

  return (
    <header className="flex flex-none flex-col gap-3 px-8 pb-6 pt-8">
      {showTrail && trail.section && (
        <nav aria-label="麵包屑" className="flex flex-wrap items-center gap-1 text-sm leading-5 text-foreground">
          <span>{trail.section.label}</span>
          {trail.link && (
            <>
              <span aria-hidden="true">&gt;</span>
              {trail.atLink ? (
                <span aria-current="page">{trail.link.label}</span>
              ) : (
                <Link href={trail.link.href} className="text-primary hover:text-primary-hover">
                  {trail.link.label}
                </Link>
              )}
            </>
          )}
          {!trail.atLink && (
            <>
              <span aria-hidden="true">&gt;</span>
              <span aria-current="page">{title}</span>
            </>
          )}
        </nav>
      )}

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-2xl font-semibold leading-7 text-foreground">{heading}</h1>
          {description && <p className="text-base leading-7 text-muted-foreground">{description}</p>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
      </div>

      {connectionLost && (
        <div role="status" className="flex items-center gap-2 rounded-md bg-destructive-subtle px-3 py-2 text-xs text-destructive">
          <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden="true" />
          即時連線中斷，新訊息可能不會自動出現。
          <button type="button" onClick={() => window.location.reload()} className="font-medium underline-offset-2 hover:underline">
            重新整理
          </button>
        </div>
      )}
    </header>
  );
}
