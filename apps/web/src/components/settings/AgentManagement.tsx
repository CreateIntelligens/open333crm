'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, Plus, Pencil, KeyRound } from 'lucide-react';
import api from '@/lib/api';
import { useAuth, usePermission } from '@/providers/AuthProvider';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface Agent {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'AGENT';
  // 後端 GET /agents 會回 legacy role（enum）＋ granular roleId ＋關聯 roleRef（角色詳情）。
  // 清單/編輯預選優先用 roleRef / roleId，不再依賴 /roles 清單載入成功。
  roleId?: string | null;
  roleRef?: { id: string; name: string; slug: string; isSystem: boolean } | null;
  avatarUrl?: string;
  isActive: boolean;
  teams: Array<{ team: { id: string; name: string } }>;
  _count: { assignedCases: number };
}

/** 租戶角色（GET /roles 回傳項目）。 */
interface RoleItem {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
  permissionCount: number;
  agentCount: number;
}

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  ADMIN: { label: 'Admin', color: '#dc2626' },
  SUPERVISOR: { label: 'Supervisor', color: '#2563eb' },
  AGENT: { label: 'Agent', color: '#6b7280' },
};

// system role slug → legacy enum role（送出建立/變更角色時，system 角色改送 legacy role）
const SLUG_TO_ENUM: Record<string, 'ADMIN' | 'SUPERVISOR' | 'AGENT'> = {
  admin: 'ADMIN',
  supervisor: 'SUPERVISOR',
  agent: 'AGENT',
};

/** 依角色 slug 給自訂角色 Badge 一個穩定顏色。 */
const CUSTOM_ROLE_COLOR = '#7c3aed';

/**
 * 把使用者選的角色轉成後端要收的 body。
 * - system 角色：送對應 legacy `role`（後端會自動雙寫回填 roleId），roleId 不帶。
 * - custom 角色：送該角色的 `roleId` + legacy `role` 作為回填值（契約要求 role required）。
 *   legacy role 保留成員當前值（currentRole）以免無謂降級（例如原 SUPERVISOR 被覆寫成 AGENT，
 *   影響仍讀 legacy role enum 的舊功能）；建立新成員時無當前值，退回 'AGENT'。
 */
function buildRolePayload(
  role: RoleItem,
  currentRole?: 'ADMIN' | 'SUPERVISOR' | 'AGENT',
): { role: 'ADMIN' | 'SUPERVISOR' | 'AGENT'; roleId?: string } {
  if (role.isSystem && SLUG_TO_ENUM[role.slug]) {
    return { role: SLUG_TO_ENUM[role.slug] };
  }
  return { role: currentRole ?? 'AGENT', roleId: role.id };
}

/** 統一解析 API 錯誤成友善訊息（含 ROLE_ESCALATION 特例）。 */
function resolveApiError(err: unknown, fallback: string): string {
  const error = (err as { response?: { data?: { error?: { code?: string; message?: string; details?: { escalatedPermissions?: string[] } } } } })
    ?.response?.data?.error;
  if (!error) return fallback;
  switch (error.code) {
    case 'CONFLICT':
      return 'Email 已被使用，請換一個電子信箱';
    case 'ROLE_ESCALATION':
      return '無法指派權限高於您自己的角色，請選擇權限範圍不超過您的角色';
    case 'NOT_FOUND':
      return '找不到指定的角色，請重新整理後再試';
    case 'FORBIDDEN':
      return '您沒有權限執行此操作';
    default:
      return error.message || fallback;
  }
}

// ─── Create Agent Dialog ──────────────────────────────────────────────────────

interface CreateDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roles: RoleItem[];
  onCreated: () => void;
}

function CreateAgentDialog({ open, onOpenChange, roles, onCreated }: CreateDialogProps) {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  // 以角色 id 作為下拉選取值（涵蓋 system + custom）
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 對話開啟時預設選 agent 角色
  useEffect(() => {
    if (open) {
      const agentRole = roles.find((r) => r.isSystem && r.slug === 'agent');
      setSelectedRoleId(agentRole?.id ?? roles[0]?.id ?? '');
      setForm({ name: '', email: '', password: '' });
      setError('');
    }
  }, [open, roles]);

  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: r.id, label: r.isSystem ? r.name : `${r.name}（自訂）` })),
    [roles],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const selected = roles.find((r) => r.id === selectedRoleId);
    if (!selected) {
      setError('請選擇角色');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post('/agents', { ...form, ...buildRolePayload(selected) });
      onCreated();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(resolveApiError(err, '建立失敗，請再試一次'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增人員</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">姓名</label>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="王小明"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">電子信箱</label>
            <Input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              placeholder="agent@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">角色</label>
            <Select
              options={roleOptions}
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">初始密碼</label>
            <Input
              required
              type="password"
              value={form.password}
              onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              placeholder="至少 8 個字元"
              minLength={8}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              建立
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Agent Dialog (role + admin reset password + deactivate) ─────────────

interface EditAgentDialogProps {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roles: RoleItem[];
  /** 是否可指派角色（agent.role.assign）；否則角色下拉停用 */
  canAssignRole: boolean;
  /** 是否可重設他人密碼 / 停用帳號（agent.password.reset / agent.delete） */
  canManageAccount: boolean;
  onUpdated: () => void;
}

function EditAgentDialog({
  agent,
  open,
  onOpenChange,
  roles,
  canAssignRole,
  canManageAccount,
  onUpdated,
}: EditAgentDialogProps) {
  // 以角色 id 作為下拉選取值
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState('');

  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: r.id, label: r.isSystem ? r.name : `${r.name}（自訂）` })),
    [roles],
  );

  useEffect(() => {
    if (agent) {
      // 有 roleId 就精準預選該角色；否則（舊資料無 roleId）用 legacy role 對到 system 角色
      const match = agent.roleId
        ? roles.find((r) => r.id === agent.roleId)
        : roles.find((r) => r.isSystem && SLUG_TO_ENUM[r.slug] === agent.role);
      setSelectedRoleId(match?.id ?? '');
      setNewPassword('');
      setError('');
    }
  }, [agent, roles]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!agent) return;
    setSaving(true);
    setError('');
    try {
      if (canAssignRole) {
        const selected = roles.find((r) => r.id === selectedRoleId);
        if (!selected) {
          setError('請選擇角色');
          setSaving(false);
          return;
        }
        await api.patch(`/agents/${agent.id}/role`, buildRolePayload(selected, agent.role));
      }
      if (canManageAccount && newPassword) {
        await api.patch(`/agents/${agent.id}/password`, { newPassword });
      }
      onUpdated();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(resolveApiError(err, '更新失敗，請再試一次'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!agent) return;
    if (!confirm(`確定要停用「${agent.name}」的帳號嗎？此操作無法從此介面復原。`)) return;
    setDeactivating(true);
    setError('');
    try {
      await api.delete(`/agents/${agent.id}`);
      onUpdated();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(resolveApiError(err, '停用失敗，請再試一次'));
    } finally {
      setDeactivating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>編輯人員 — {agent?.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">角色</label>
            <Select
              options={roleOptions}
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(e.target.value)}
              disabled={!canAssignRole}
            />
            {!canAssignRole && (
              <p className="text-xs text-muted-foreground">您沒有指派角色的權限</p>
            )}
          </div>
          {canManageAccount && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">重設密碼 <span className="text-muted-foreground font-normal">（選填，留空表示不修改）</span></label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 8 個字元"
                minLength={newPassword ? 8 : undefined}
              />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="flex-row items-center justify-between sm:justify-between">
            {canManageAccount && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deactivating}
                onClick={handleDeactivate}
              >
                {deactivating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                停用帳號
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                儲存
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Change Password Dialog ───────────────────────────────────────────────────

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await api.patch('/agents/me/password', form);
      setSuccess(true);
      setForm({ currentPassword: '', newPassword: '' });
    } catch (err: unknown) {
      setError(resolveApiError(err, '修改失敗，請再試一次'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); setSuccess(false); setError(''); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改密碼</DialogTitle>
        </DialogHeader>
        {success ? (
          <div className="space-y-4">
            <p className="text-sm text-success">密碼已成功修改！</p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>關閉</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">目前密碼</label>
              <Input
                required
                type="password"
                value={form.currentPassword}
                onChange={(e) => setForm((p) => ({ ...p, currentPassword: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">新密碼</label>
              <Input
                required
                type="password"
                value={form.newPassword}
                onChange={(e) => setForm((p) => ({ ...p, newPassword: e.target.value }))}
                placeholder="至少 8 個字元"
                minLength={8}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                修改密碼
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AgentManagement() {
  const { agent: currentAgent } = useAuth();
  // 權限 gating（前端 UX；後端 requirePermission 為權威）
  const canCreate = usePermission('agent.manage');
  const canAssignRole = usePermission('agent.role.assign');
  const canResetPassword = usePermission('agent.password.reset');
  const canDelete = usePermission('agent.delete');
  const canManageAccount = canResetPassword || canDelete;
  // 開啟「編輯」對話的條件：至少能指派角色，或能管理帳號
  const canEdit = canAssignRole || canManageAccount;

  const [agents, setAgents] = useState<Agent[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState<string>('ALL');

  const [createOpen, setCreateOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  function fetchAgents() {
    setLoading(true);
    api.get('/agents')
      .then((res) => setAgents(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  // 載入租戶角色清單（system + custom）。需 role.view 權限；失敗則靜默退回僅 legacy 角色。
  function fetchRoles() {
    api.get('/roles')
      .then((res) => setRoles(res.data.data.roles || []))
      .catch(() => setRoles([]));
  }

  useEffect(() => { fetchAgents(); fetchRoles(); }, []);

  // 若 /roles 因權限不足而拿不到，退回 legacy 三角色，確保下拉仍可用
  const effectiveRoles: RoleItem[] = useMemo(() => {
    if (roles.length > 0) return roles;
    return (['admin', 'supervisor', 'agent'] as const).map((slug) => ({
      id: `legacy-${slug}`,
      slug,
      name: ROLE_CONFIG[SLUG_TO_ENUM[slug]].label,
      isSystem: true,
      permissionCount: 0,
      agentCount: 0,
    }));
  }, [roles]);

  // 依成員資料推導顯示的角色名稱與 Badge 顏色。
  // 優先用後端關聯 roleRef（system + custom 皆有）：直接顯示其 name，custom 用紫色、system 依 legacy 對照配色；
  // 沒有 roleRef 才 fallback 到 legacy role 對照 ROLE_CONFIG。不再依賴 /roles 清單載入成功。
  function roleBadgeForAgent(agent: Agent): { label: string; color: string } {
    const ref = agent.roleRef;
    if (ref) {
      if (!ref.isSystem) return { label: ref.name, color: CUSTOM_ROLE_COLOR };
      const rc = ROLE_CONFIG[SLUG_TO_ENUM[ref.slug]] || ROLE_CONFIG.AGENT;
      return { label: ref.name, color: rc.color };
    }
    return ROLE_CONFIG[agent.role] || ROLE_CONFIG.AGENT;
  }

  const filtered = filterRole === 'ALL' ? agents : agents.filter((a) => a.role === filterRole);

  const counts = {
    ALL: agents.length,
    ADMIN: agents.filter((a) => a.role === 'ADMIN').length,
    SUPERVISOR: agents.filter((a) => a.role === 'SUPERVISOR').length,
    AGENT: agents.filter((a) => a.role === 'AGENT').length,
  };

  const teamMap = new Map<string, { id: string; name: string; members: string[] }>();
  for (const agent of agents) {
    for (const membership of agent.teams) {
      const t = membership.team;
      if (!teamMap.has(t.id)) teamMap.set(t.id, { id: t.id, name: t.name, members: [] });
      teamMap.get(t.id)!.members.push(agent.name);
    }
  }
  const teams = Array.from(teamMap.values());

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['ALL', 'ADMIN', 'SUPERVISOR', 'AGENT'] as const).map((role) => (
            <button
              key={role}
              onClick={() => setFilterRole(role)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                filterRole === role
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {role === 'ALL' ? '全部' : role} {counts[role]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setChangePasswordOpen(true)}
          >
            <KeyRound className="mr-1.5 h-4 w-4" />
            修改密碼
          </Button>
          {canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              新增人員
            </Button>
          )}
        </div>
      </div>

      {/* Agent list */}
      <div className="rounded-lg border">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>姓名</span>
          <span className="w-24 text-center">角色</span>
          <span className="w-20 text-center">開啟案件</span>
          <span className="w-16 text-center">操作</span>
        </div>
        {filtered.map((agent) => {
          const rc = roleBadgeForAgent(agent);
          return (
            <div
              key={agent.id}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b px-4 py-3 last:border-b-0"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Avatar alt={agent.name} src={agent.avatarUrl} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{agent.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{agent.email}</p>
                </div>
              </div>
              <div className="w-24 text-center">
                <Badge color={rc.color}>{rc.label}</Badge>
              </div>
              <div className="w-20 text-center text-sm">
                {agent._count.assignedCases > 0 ? `${agent._count.assignedCases} 件` : '—'}
              </div>
              <div className="w-16 flex justify-center">
                {canEdit ? (
                  <button
                    title="編輯角色"
                    onClick={() => setEditAgent(agent)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Pencil className="h-3 w-3" />
                    編輯
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            沒有符合條件的人員
          </div>
        )}
      </div>

      {/* Teams section */}
      {teams.length > 0 && (
        <>
          <h3 className="text-lg font-semibold">團隊分組</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {teams.map((team) => (
              <Card key={team.id}>
                <CardContent className="p-4">
                  <p className="font-semibold">{team.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{team.members.join('、')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">共 {team.members.length} 人</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Role descriptions */}
      <div className="rounded-lg border bg-muted/50 p-4 text-xs text-muted-foreground">
        <p><strong>Admin</strong>：完整設定權限，可新增任何角色</p>
        <p><strong>Supervisor</strong>：可查看所有對話/案件，可新增 Agent 與 Supervisor</p>
        <p><strong>Agent</strong>：只能看自己負責的對話/案件</p>
        <p className="mt-1">自訂角色可於「角色與權限」設定，並於此指派給成員。</p>
      </div>

      {/* Dialogs */}
      <CreateAgentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        roles={effectiveRoles}
        onCreated={fetchAgents}
      />
      <EditAgentDialog
        agent={editAgent}
        open={!!editAgent}
        onOpenChange={(v) => { if (!v) setEditAgent(null); }}
        roles={effectiveRoles}
        canAssignRole={canAssignRole}
        canManageAccount={canManageAccount}
        onUpdated={fetchAgents}
      />
      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
      />
    </div>
  );
}
