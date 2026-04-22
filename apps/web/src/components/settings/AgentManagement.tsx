'use client';

/* eslint-disable jsx-a11y/label-has-associated-control */
import React, { useState, useEffect } from 'react';
import { Loader2, Plus, Pencil, KeyRound } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
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
  role: string;
  avatarUrl?: string;
  isActive: boolean;
  teams: Array<{ team: { id: string; name: string } }>;
  _count: { assignedCases: number };
}

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  ADMIN: { label: 'Admin', color: '#dc2626' },
  SUPERVISOR: { label: 'Supervisor', color: '#2563eb' },
  AGENT: { label: 'Agent', color: '#6b7280' },
};

const ROLE_OPTIONS = [
  { value: 'AGENT', label: 'Agent' },
  { value: 'SUPERVISOR', label: 'Supervisor' },
  { value: 'ADMIN', label: 'Admin' },
];

// ─── Create Agent Dialog ──────────────────────────────────────────────────────

interface CreateDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentRole: string;
  onCreated: () => void;
}

function CreateAgentDialog({ open, onOpenChange, currentRole, onCreated }: CreateDialogProps) {
  const [form, setForm] = useState({ name: '', email: '', role: 'AGENT', password: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const availableRoles = currentRole === 'ADMIN'
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((r) => r.value !== 'ADMIN');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/agents', form);
      onCreated();
      onOpenChange(false);
      setForm({ name: '', email: '', role: 'AGENT', password: '' });
    } catch (err: unknown) {
      const error = (err as any)?.response?.data?.error;

      if (error?.code === 'CONFLICT') {
        setError('Email 已被使用，請換一個電子信箱');
      } else {
        setError(error?.message || '建立失敗，請再試一次');
      }
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
              options={availableRoles}
              value={form.role}
              onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
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
  currentRole: string;
  onUpdated: () => void;
}

function EditAgentDialog({ agent, open, onOpenChange, currentRole, onUpdated }: EditAgentDialogProps) {
  const [role, setRole] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (agent) { setRole(agent.role); setNewPassword(''); setError(''); }
  }, [agent]);

  const availableRoles = currentRole === 'ADMIN'
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((r) => r.value !== 'ADMIN');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!agent) { return; }
    setSaving(true);
    setError('');
    try {
      await api.patch(`/agents/${agent.id}/role`, { role });
      if (currentRole === 'ADMIN' && newPassword) {
        await api.patch(`/agents/${agent.id}/password`, { newPassword });
      }
      onUpdated();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || '更新失敗，請再試一次');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!agent) { return; }
    if (!confirm(`確定要停用「${agent.name}」的帳號嗎？此操作無法從此介面復原。`)) { return; }
    setDeactivating(true);
    setError('');
    try {
      await api.delete(`/agents/${agent.id}`);
      onUpdated();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || '停用失敗，請再試一次');
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
              options={availableRoles}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </div>
          {currentRole === 'ADMIN' && (
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
            {currentRole === 'ADMIN' && (
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
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || '修改失敗，請再試一次');
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
            <p className="text-sm text-green-600">密碼已成功修改！</p>
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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState<string>('ALL');

  const [createOpen, setCreateOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const canManage = currentAgent?.role === 'ADMIN' || currentAgent?.role === 'SUPERVISOR';

  function fetchAgents() {
    setLoading(true);
    api.get('/agents')
      .then((res) => setAgents(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchAgents(); }, []);

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
      if (!teamMap.has(t.id)) { teamMap.set(t.id, { id: t.id, name: t.name, members: [] }); }
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
          {canManage && (
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
          const rc = ROLE_CONFIG[agent.role] || ROLE_CONFIG.AGENT;
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
                {canManage ? (
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
      </div>

      {/* Dialogs */}
      <CreateAgentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        currentRole={currentAgent?.role ?? ''}
        onCreated={fetchAgents}
      />
      <EditAgentDialog
        agent={editAgent}
        open={!!editAgent}
        onOpenChange={(v) => { if (!v) { setEditAgent(null); } }}
        currentRole={currentAgent?.role ?? ''}
        onUpdated={fetchAgents}
      />
      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
      />
    </div>
  );
}

