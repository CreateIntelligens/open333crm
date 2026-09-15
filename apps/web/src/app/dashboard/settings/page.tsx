"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { ChannelManagement } from "@/components/settings/ChannelManagement";
import { AgentManagement } from "@/components/settings/AgentManagement";
import { TagManagement } from "@/components/settings/TagManagement";
import { SlaManagement } from "@/components/settings/SlaManagement";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { OfficeHoursSettings } from "@/components/settings/OfficeHoursSettings";
import { ApiKeyManagement } from "@/components/settings/ApiKeyManagement";
import { TrackingSettings } from "@/components/settings/TrackingSettings";
import { CliSessionManagement } from "@/components/settings/CliSessionManagement";
import { RolePermissionMatrix } from "@/components/settings/RolePermissionMatrix";
import { PasskeyManagement } from "@/components/settings/PasskeyManagement";
import { Network } from "lucide-react";
import { usePermission } from "@/providers/AuthProvider";
import api from "@/lib/api";

const SETTINGS_TABS = [
  { key: "channels", label: "渠道管理" },
  { key: "agents", label: "人員與權限" },
  { key: "roles", label: "角色與權限", perm: "role.view" },
  { key: "tags", label: "標籤管理" },
  { key: "sla", label: "SLA 政策" },
  { key: "office-hours", label: "營業時間" },
  { key: "tracking", label: "追蹤設定" },
  { key: "api-keys", label: "API 金鑰" },
  { key: "cli-sessions", label: "CLI 連線" },
  { key: "passkeys", label: "Passkey 登入" },
  { key: "general", label: "一般設定" },
  { key: "a2a", label: "A2A" },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

export default function SettingsPage() {
  const pathname = usePathname();
  const section = pathname.split('/').at(-1);
  const activeTab = (SETTINGS_TABS.some((tab) => tab.key === section) ? section : "general") as SettingsTab;
  const canViewRoles = usePermission("role.view");
  const canManageSettings = usePermission("settings.manage");

  return (
    <div className="flex h-full flex-col">
      <Topbar title="設定" />

      <div className="flex-1 overflow-auto p-6">
          {activeTab === "channels" && <ChannelManagement />}
          {activeTab === "agents" && <AgentManagement />}
          {activeTab === "roles" && (canViewRoles ? <RolePermissionMatrix /> : <PermissionDenied />)}
          {activeTab === "tags" && <TagManagement />}
          {activeTab === "sla" && <SlaManagement />}
          {activeTab === "office-hours" && <OfficeHoursSettings />}
          {activeTab === "tracking" && <TrackingSettings />}
          {activeTab === "api-keys" && <ApiKeyManagement />}
          {activeTab === "cli-sessions" && <CliSessionManagement />}
          {activeTab === "passkeys" && <PasskeyManagement />}
          {activeTab === "general" && <GeneralSettings />}
          {activeTab === "a2a" && (canManageSettings ? <A2ASettings /> : <PermissionDenied />)}
      </div>
    </div>
  );
}

function PermissionDenied() {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">你沒有查看此設定的權限。</div>;
}

function A2ASettings() {
  const [status, setStatus] = useState<{
    enabled: boolean;
    transport: string;
    protocol: string;
    hubUrl: string;
    agentId: string | null;
    agentConfigured: boolean;
    connectionState: string;
    tenantBinding: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get('/settings/a2a')
      .then((response) => setStatus(response.data.data))
      .catch(() => setError('目前無法取得 A2A bridge 狀態。'));
  }, []);

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">整合</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">A2A</h1>
        <p className="mt-2 text-sm text-muted-foreground">標準 A2A 長駐連線的安全狀態與執行資訊。</p>
      </div>
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary"><Network className="h-5 w-5" aria-hidden="true" /></div>
          <div>
            <h2 className="font-medium">連線狀態</h2>
            <p className="mt-1 text-sm text-muted-foreground">A2A bridge 的連線狀態將由伺服器端提供。Hub key 與 Agent token 僅能透過部署 secret 設定，不會在瀏覽器顯示。</p>
          </div>
        </div>
        {error && <p className="mt-5 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <dl className="mt-5 grid gap-4 border-t pt-4 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">協定</dt><dd className="mt-1 font-medium">{status?.protocol ?? '載入中…'}</dd></div>
          <div><dt className="text-muted-foreground">傳輸層</dt><dd className="mt-1 font-medium">{status?.transport ?? '載入中…'}</dd></div>
          <div><dt className="text-muted-foreground">Hub</dt><dd className="mt-1 break-all font-medium">{status?.hubUrl ?? '載入中…'}</dd></div>
          <div><dt className="text-muted-foreground">Agent ID</dt><dd className="mt-1 font-medium">{status?.agentId ?? '未設定'}</dd></div>
          <div><dt className="text-muted-foreground">目前狀態</dt><dd className="mt-1 font-medium">{status?.connectionState ?? '載入中…'}</dd></div>
          <div><dt className="text-muted-foreground">Tenant 綁定</dt><dd className="mt-1 font-medium">{status?.tenantBinding ?? '載入中…'}</dd></div>
          <div><dt className="text-muted-foreground">Hub key</dt><dd className="mt-1 font-medium">部署 secret 管理</dd></div>
          <div><dt className="text-muted-foreground">Agent token</dt><dd className="mt-1 font-medium">bridge credentials 管理</dd></div>
        </dl>
      </div>
    </section>
  );
}
