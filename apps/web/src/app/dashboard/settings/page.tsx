"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChannelManagement } from "@/components/settings/ChannelManagement";
import { AgentManagement } from "@/components/settings/AgentManagement";
import { TagManagement } from "@/components/settings/TagManagement";
import { SlaManagement } from "@/components/settings/SlaManagement";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { OfficeHoursSettings } from "@/components/settings/OfficeHoursSettings";
import { ApiKeyManagement } from "@/components/settings/ApiKeyManagement";
import { TrackingSettings } from "@/components/settings/TrackingSettings";
import { IdentityBindingSettings } from "@/components/settings/IdentityBindingSettings";
import { WebTalkSettings } from "@/components/settings/WebTalkSettings";
import { CliSessionManagement } from "@/components/settings/CliSessionManagement";
import { RolePermissionMatrix } from "@/components/settings/RolePermissionMatrix";
import { PasskeyManagement } from "@/components/settings/PasskeyManagement";
import { Badge } from "@/components/ui/badge";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { StoreManagement } from "@/components/settings/stores/StoreManagement";
import { usePermission } from "@/providers/AuthProvider";
import api from "@/lib/api";

const SETTINGS_TABS = [
  { key: "channels", label: "渠道管理" },
  { key: "agents", label: "人員管理" },
  { key: "roles", label: "角色權限", perm: "role.view" },
  { key: "tags", label: "標籤管理" },
  { key: "sla", label: "SLA 政策" },
  { key: "office-hours", label: "營業時間" },
  { key: "tracking", label: "追蹤設定" },
  { key: "stores", label: "門市與核銷帳號", perm: "store.view" },
  { key: "identity-binding", label: "跨渠道綁定", perm: "settings.manage" },
  { key: "webtalk", label: "WebTalk 協作", perm: "settings.manage" },
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
  const canViewStores = usePermission("store.view");

  return (
    // 依 Figma：設定頁不再有上方標題列，內容區內距 32，最上方是麵包屑
    <div className="flex min-h-full flex-col gap-3 p-7">
      <p className="text-sm leading-5 text-foreground">設定 &gt; {SETTINGS_TABS.find((tab) => tab.key === activeTab)?.label}</p>

      <div>
          {activeTab === "channels" && <ChannelManagement />}
          {activeTab === "agents" && <AgentManagement />}
          {activeTab === "roles" && (canViewRoles ? <RolePermissionMatrix /> : <PermissionDenied />)}
          {activeTab === "tags" && <TagManagement />}
          {activeTab === "sla" && <SlaManagement />}
          {activeTab === "office-hours" && <OfficeHoursSettings />}
          {activeTab === "tracking" && <TrackingSettings />}
          {activeTab === "stores" && (canViewStores ? <StoreManagement /> : <PermissionDenied />)}
          {activeTab === "identity-binding" && (canManageSettings ? <IdentityBindingSettings /> : <PermissionDenied />)}
          {activeTab === "webtalk" && (canManageSettings ? <WebTalkSettings /> : <PermissionDenied />)}
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
  return <div className="rounded-lg border border-dashed p-7 text-center text-sm text-muted-foreground">你沒有查看此設定的權限。</div>;
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
    // 版面依 Claude Design「A2A」：標題區、連線狀態卡（狀態燈＋唯讀、欄位列表、憑證說明）；依 Figma 微調
    <section className="flex max-w-[760px] flex-col gap-5">
      <SettingsHeader title="A2A" description="標準 A2A 長駐連線的安全狀態與執行資訊" />
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-lg font-semibold text-foreground">連線狀態</span>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
            <span
              className={`h-2 w-2 rounded-full ${status?.connectionState === 'connected' ? 'bg-online' : 'bg-status-neutral'}`}
              aria-hidden="true"
            />
            {status?.connectionState ?? '載入中…'}
          </span>
          <Badge variant="secondary" className="ml-auto">唯讀</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          A2A bridge 的連線狀態由伺服器端提供，Hub key 與 Agent token 僅能透過部署 secret 設定，不會在瀏覽器顯示。
        </p>
        {error && <p role="alert" className="rounded-md bg-destructive-subtle p-3 text-sm text-destructive">{error}</p>}
        <dl className="grid gap-x-6 gap-y-4 border-t border-border pt-4 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">協定</dt><dd className="mt-1 font-medium text-foreground">{status?.protocol ?? '載入中…'}</dd></div>
          <div><dt className="text-muted-foreground">傳輸層</dt><dd className="mt-1 font-medium text-foreground">{status?.transport ?? '載入中…'}</dd></div>
          <div><dt className="text-muted-foreground">Hub</dt><dd className="mt-1 break-all font-medium text-foreground">{status?.hubUrl ?? '載入中…'}</dd></div>
          <div>
            <dt className="text-muted-foreground">Agent ID</dt>
            {/* 依設計稿只顯示末四碼 */}
            <dd className="mt-1 font-mono font-medium text-foreground">{status?.agentId ? `••••${status.agentId.slice(-4)}` : '未設定'}</dd>
          </div>
          <div><dt className="text-muted-foreground">Tenant 綁定</dt><dd className="mt-1 font-medium text-foreground">{status?.tenantBinding ?? '載入中…'}</dd></div>
          <div><dt className="text-muted-foreground">Hub key</dt><dd className="mt-1 font-medium text-foreground">部署 secret 管理</dd></div>
          <div><dt className="text-muted-foreground">Agent token</dt><dd className="mt-1 font-medium text-foreground">bridge credentials 管理</dd></div>
        </dl>
        <p className="rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
          憑證值一律不會回傳至前端。需輪替金鑰時請由部署環境的 secret 管理更新，bridge 會在下次重連時套用。
        </p>
      </div>
    </section>
  );
}
