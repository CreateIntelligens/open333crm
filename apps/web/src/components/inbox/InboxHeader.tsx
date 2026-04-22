"use client";

import { LogOut } from "lucide-react";
import React from "react";

import { NotificationBell } from "@/components/notification/NotificationBell";
import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/providers/AuthProvider";

export function InboxHeader() {
  const { agent, logout } = useAuth();

  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between border-b bg-background px-6">
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-[#1e2939] px-4 py-1.5 text-sm font-medium text-white">
          大同家電股份有限公司
        </span>
      </div>

      <div className="flex items-center gap-4">
        <NotificationBell />

        <DropdownMenu
          align="right"
          trigger={
            <div className="flex items-center gap-2 cursor-pointer">
              <Avatar alt={agent?.name || "使用者"} size="sm" />
              <span className="text-sm font-medium hidden sm:inline">{agent?.name}</span>
            </div>
          }
        >
          <DropdownMenuItem>
            <span className="text-sm text-muted-foreground">{agent?.email}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>登出</span>
          </DropdownMenuItem>
        </DropdownMenu>
      </div>
    </header>
  );
}
