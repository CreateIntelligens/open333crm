'use client';

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';

interface Agent {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string;
  isActive: boolean;
  teams: Array<{
    team: { id: string; name: string };
  }>;
  _count: { assignedCases: number };
}

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  ADMIN: { label: 'Admin', color: '#dc2626' },
  SUPERVISOR: { label: 'Supervisor', color: '#2563eb' },
  AGENT: { label: 'Agent', color: '#6b7280' },
};

export function AgentManagement() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState<string>('ALL');

  useEffect(() => {
    api.get('/agents')
      .then((res) => setAgents(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = filterRole === 'ALL'
    ? agents
    : agents.filter((a) => a.role === filterRole);

  // Count by role
  const counts = {
    ALL: agents.length,
    ADMIN: agents.filter((a) => a.role === 'ADMIN').length,
    SUPERVISOR: agents.filter((a) => a.role === 'SUPERVISOR').length,
    AGENT: agents.filter((a) => a.role === 'AGENT').length,
  };

  // Derive teams from agents
  const teamMap = new Map<string, { id: string; name: string; members: string[] }>();
  for (const agent of agents) {
    for (const membership of agent.teams) {
      const t = membership.team;
      if (!teamMap.has(t.id)) {
        teamMap.set(t.id, { id: t.id, name: t.name, members: [] });
      }
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
      {/* Role filter tabs */}
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
        <p className="text-sm text-muted-foreground">
          {agents.length} 人
        </p>
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
                {agent._count.assignedCases > 0
                  ? `${agent._count.assignedCases} 件`
                  : '—'}
              </div>
              <div className="w-16 text-center">
                <button className="text-xs text-primary hover:underline">
                  編輯
                </button>
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
                  <p className="mt-1 text-sm text-muted-foreground">
                    {team.members.join('、')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    共 {team.members.length} 人
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Role descriptions */}
      <div className="rounded-lg border bg-muted/50 p-4 text-xs text-muted-foreground">
        <p><strong>Admin</strong>：完整設定權限</p>
        <p><strong>Supervisor</strong>：可查看所有對話/案件，管理 Agent</p>
        <p><strong>Agent</strong>：只能看自己負責的對話/案件</p>
      </div>
    </div>
  );
}
