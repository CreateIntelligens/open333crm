'use client';

/**
 * 角色與權限設定頁（對應 rbac-granular-permissions 的租戶層 RBAC UI）
 *
 * 逐角色編輯：左選角色 → 右依 group 折疊勾選權限。
 * 含 dependsOn 連動、implies 唯讀說明、狀態視覺（越權/鎖定/防自鎖）、
 * 編輯緩衝 + 明確儲存、新增/改名/刪除自訂角色。
 * 前端 gating 為 UX，後端 requirePermission 為權威。
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Loader2, Plus, Pencil, Trash2, ChevronDown, Search, Lock, Info } from 'lucide-react';
import api from '@/lib/api';
import { usePermission } from '@/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface RoleItem {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
  permissionCount: number;
  agentCount: number;
}

interface PermDef {
  code: string;
  label: string;
  description: string;
  dependsOn: string[];
  implies: string[];
  adminLock: boolean;
}
interface MatrixGroup {
  group: string;
  permissions: PermDef[];
}

export function RolePermissionMatrix() {
  const canManage = usePermission('role.manage');

  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [matrix, setMatrix] = useState<MatrixGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [baseline, setBaseline] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // 逐角色權限載入失敗旗標：避免用「舊角色」的 draft/baseline 誤存到「新角色」
  const [permLoadError, setPermLoadError] = useState(false);
  const [permLoading, setPermLoading] = useState(false);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');

  const [dialogMode, setDialogMode] = useState<'create' | 'rename' | null>(null);
  const [dialogName, setDialogName] = useState('');
  const [dialogTarget, setDialogTarget] = useState<RoleItem | null>(null);
  const [dialogErr, setDialogErr] = useState<string | null>(null);
  const [delTarget, setDelTarget] = useState<RoleItem | null>(null);

  const codeToDef = useMemo(() => {
    const m = new Map<string, PermDef>();
    matrix.forEach((g) => g.permissions.forEach((p) => m.set(p.code, p)));
    return m;
  }, [matrix]);

  const selectedRole = roles.find((r) => r.id === selectedId) ?? null;

  // 初次載入：角色 + 權限矩陣
  useEffect(() => {
    Promise.all([api.get('/roles'), api.get('/roles/matrix')])
      .then(([rolesRes, matrixRes]) => {
        const rs: RoleItem[] = rolesRes.data.data.roles;
        setRoles(rs);
        setMatrix(matrixRes.data.data.groups);
        if (rs.length) setSelectedId(rs[0].id);
      })
      .catch(() => setError('載入失敗'))
      .finally(() => setLoading(false));
  }, []);

  // 切換角色：載入其權限
  const loadRolePerms = useCallback((roleId: string) => {
    setError(null);
    setOkMsg(null);
    setPermLoadError(false);
    setPermLoading(true);
    api
      .get(`/roles/${roleId}/permissions`)
      .then((res) => {
        const perms = new Set<string>(res.data.data.permissions);
        setDraft(new Set(perms));
        setBaseline(new Set(perms));
      })
      .catch(() => {
        // 關鍵：載入失敗時清空 draft/baseline，避免沿用「上一個角色」的權限，
        // 否則使用者以為在編輯新角色、按下儲存會把新角色權限覆蓋成錯的集合。
        setDraft(new Set());
        setBaseline(new Set());
        setPermLoadError(true);
        setError('載入角色權限失敗，請重試');
      })
      .finally(() => setPermLoading(false));
  }, []);

  useEffect(() => {
    if (selectedId) loadRolePerms(selectedId);
  }, [selectedId, loadRolePerms]);

  const hasChanges = useMemo(() => {
    if (draft.size !== baseline.size) return true;
    for (const c of draft) if (!baseline.has(c)) return true;
    return false;
  }, [draft, baseline]);

  const changeCount = useMemo(() => {
    const all = new Set([...draft, ...baseline]);
    let n = 0;
    all.forEach((c) => {
      if (draft.has(c) !== baseline.has(c)) n++;
    });
    return n;
  }, [draft, baseline]);

  // 依 code 找出反向相依（哪些權限 dependsOn 這個 code）
  const dependents = useCallback(
    (code: string) =>
      matrix.flatMap((g) => g.permissions).filter((p) => p.dependsOn.includes(code)).map((p) => p.code),
    [matrix]
  );

  function togglePerm(code: string, want: boolean) {
    if (!canManage) return;
    // 載入中或載入失敗時 draft 不可信，禁止編輯
    if (permLoadError || permLoading) return;
    const next = new Set(draft);
    const def = codeToDef.get(code);
    if (want) {
      next.add(code);
      // dependsOn：自動補前置
      def?.dependsOn.forEach((d) => next.add(d));
    } else {
      // 取消父權限 → 連帶關閉相依子權限（先確認）
      const kids = dependents(code).filter((c) => next.has(c));
      if (kids.length) {
        const names = kids.map((c) => codeToDef.get(c)?.label ?? c).join('、');
        if (!confirm(`關閉「${codeToDef.get(code)?.label}」會一併關閉相依的：${names}。確定？`)) return;
        kids.forEach((c) => next.delete(c));
      }
      next.delete(code);
    }
    setDraft(next);
  }

  function toggleGroup(g: MatrixGroup, turnOn: boolean) {
    if (!canManage) return;
    if (permLoadError || permLoading) return;
    const next = new Set(draft);
    g.permissions.forEach((p) => {
      if (isBlocked(p)) return;
      if (turnOn) {
        next.add(p.code);
        p.dependsOn.forEach((d) => next.add(d));
      } else {
        next.delete(p.code);
      }
    });
    setDraft(next);
  }

  // 越權：admin 角色以外，超出「自己有效權限」無法授予。前端無法完全知道自己的權限集合，
  // 這裡以「後端會擋」為權威；前端僅對 adminLock/自身角色做視覺提示，越權交後端 403。
  function isBlocked(_p: PermDef) {
    return !canManage;
  }
  function isAdminLocked(p: PermDef) {
    return selectedRole?.slug === 'admin' && selectedRole?.isSystem && p.adminLock;
  }

  async function save() {
    if (!selectedId) return;
    // 載入失敗時 draft/baseline 已被清空，禁止儲存以免把角色權限覆寫成空集合
    if (permLoadError || permLoading) return;
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      await api.put(`/roles/${selectedId}/permissions`, { permissions: [...draft] });
      setBaseline(new Set(draft));
      setOkMsg('已儲存');
      // 更新左欄權限數
      setRoles((rs) => rs.map((r) => (r.id === selectedId ? { ...r, permissionCount: draft.size } : r)));
      setTimeout(() => setOkMsg(null), 2500);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.response?.data?.error?.message ?? '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(new Set(baseline));
    setError(null);
  }

  // 角色 CRUD
  async function submitDialog() {
    setDialogErr(null);
    const name = dialogName.trim();
    if (!name) {
      setDialogErr('請輸入角色名稱');
      return;
    }
    try {
      if (dialogMode === 'create') {
        const res = await api.post('/roles', { name });
        const created = res.data.data;
        const newRole: RoleItem = { ...created, permissionCount: 0, agentCount: 0 };
        setRoles((rs) => [...rs, newRole]);
        setSelectedId(newRole.id);
        setFilter('all');
        setQuery('');
      } else if (dialogMode === 'rename' && dialogTarget) {
        await api.patch(`/roles/${dialogTarget.id}`, { name });
        setRoles((rs) => rs.map((r) => (r.id === dialogTarget.id ? { ...r, name } : r)));
      }
      setDialogMode(null);
    } catch (e: any) {
      setDialogErr(e?.response?.data?.message ?? '操作失敗');
    }
  }

  async function confirmDelete() {
    if (!delTarget) return;
    try {
      await api.delete(`/roles/${delTarget.id}`);
      setRoles((rs) => rs.filter((r) => r.id !== delTarget.id));
      if (selectedId === delTarget.id) setSelectedId(roles.find((r) => r.id !== delTarget.id)?.id ?? null);
      setDelTarget(null);
    } catch (e: any) {
      // 仍被指派 → 顯示阻擋訊息（保留 dialog）
      setDialogErr(e?.response?.data?.message ?? '刪除失敗');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 載入中…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">角色與權限</h2>
        <p className="text-sm text-muted-foreground">
          選左側角色，右側依功能領域勾選可用權限。
          {!canManage && '（你沒有「管理角色權限」權限，此頁為唯讀）'}
        </p>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-4">
        {/* 左欄：角色清單 */}
        <div className="rounded-xl border bg-card p-2 shadow-soft h-fit">
          <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            角色
          </div>
          {roles.map((r) => (
            <div
              key={r.id}
              onClick={() => {
                if (hasChanges && !confirm('尚有未儲存變更，切換角色會放棄變更，確定？')) return;
                setSelectedId(r.id);
              }}
              className={`group flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 ${
                r.id === selectedId
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-transparent hover:bg-muted'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <span className={r.id === selectedId ? 'text-primary' : ''}>{r.name}</span>
                  {r.isSystem && (
                    <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
                      內建
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                  {r.permissionCount} 項權限{!r.isSystem && ` · ${r.agentCount} 位成員`}
                </div>
              </div>
              {!r.isSystem && canManage && (
                <div className="hidden gap-0.5 group-hover:flex">
                  <button
                    className="rounded p-1 text-muted-foreground hover:bg-border hover:text-foreground"
                    title="改名"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDialogTarget(r);
                      setDialogName(r.name);
                      setDialogErr(null);
                      setDialogMode('rename');
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="rounded p-1 text-muted-foreground hover:bg-border hover:text-destructive"
                    title="刪除"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDialogErr(null);
                      setDelTarget(r);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
          {canManage && (
            <button
              onClick={() => {
                setDialogTarget(null);
                setDialogName('');
                setDialogErr(null);
                setDialogMode('create');
              }}
              className="mt-1.5 w-full rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
            >
              ＋ 新增角色
            </button>
          )}
        </div>

        {/* 右欄：權限編輯 */}
        <div className="rounded-xl border bg-card shadow-soft overflow-hidden">
          <div className="flex flex-col gap-3 border-b p-4">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">{selectedRole?.name ?? '—'}</h3>
              {selectedRole?.isSystem ? (
                <Badge variant="secondary">內建</Badge>
              ) : (
                <Badge variant="outline">自訂角色</Badge>
              )}
              <span className="ml-auto rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground tabular-nums">
                已開 {draft.size} 項
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜尋權限…"
                  className="pl-8"
                />
              </div>
              <div className="inline-flex overflow-hidden rounded-md border">
                {(['all', 'on', 'off'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 text-xs ${
                      filter === f
                        ? 'bg-primary/10 font-semibold text-primary'
                        : 'text-muted-foreground hover:bg-muted'
                    } ${f !== 'all' ? 'border-l' : ''}`}
                  >
                    {f === 'all' ? '全部' : f === 'on' ? '只看已開' : '只看未開'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 逐角色權限載入失敗：明確提示 + 重試（避免靜默沿用舊角色權限） */}
          {permLoadError && (
            <div className="m-2 flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <span className="flex-1">
                無法載入此角色的權限，為避免存到錯誤資料，已停用儲存。請重試。
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => selectedId && loadRolePerms(selectedId)}
                disabled={permLoading}
              >
                重試
              </Button>
            </div>
          )}

          <div className="p-2">
            {matrix.map((g) => {
              const visible = g.permissions.filter((p) => {
                const q = query.toLowerCase();
                const matchQ =
                  !q ||
                  p.label.toLowerCase().includes(q) ||
                  p.code.toLowerCase().includes(q) ||
                  p.description.toLowerCase().includes(q);
                const matchF =
                  filter === 'all' || (filter === 'on' ? draft.has(p.code) : !draft.has(p.code));
                return matchQ && matchF;
              });
              if (!visible.length) return null;
              const onCount = g.permissions.filter((p) => draft.has(p.code)).length;
              const isCol = collapsed.has(g.group);
              return (
                <div key={g.group} className="border-b last:border-b-0">
                  <div
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-3 hover:bg-muted/50"
                    onClick={() => {
                      const next = new Set(collapsed);
                      isCol ? next.delete(g.group) : next.add(g.group);
                      setCollapsed(next);
                    }}
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                        isCol ? '-rotate-90' : ''
                      }`}
                    />
                    <span className="flex-1 text-sm font-semibold">{g.group}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      已開 {onCount}/{g.permissions.length}
                    </span>
                    {canManage && (
                      <button
                        className="rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleGroup(g, onCount < g.permissions.length);
                        }}
                      >
                        {onCount < g.permissions.length ? '全開' : '全關'}
                      </button>
                    )}
                  </div>
                  {!isCol && (
                    <div className="pb-2">
                      {visible.map((p) => {
                        const on = draft.has(p.code);
                        const adminLocked = isAdminLocked(p);
                        const autoOn =
                          on && p.dependsOn.some((d) => draft.has(d)) && p.dependsOn.length > 0;
                        const disabled = !canManage || adminLocked || permLoadError || permLoading;
                        return (
                          <div
                            key={p.code}
                            className={`flex items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-muted/40 ${
                              p.dependsOn.length ? 'ml-5' : ''
                            }`}
                          >
                            <Checkbox
                              checked={on}
                              disabled={disabled}
                              onCheckedChange={(v) => togglePerm(p.code, v)}
                              className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                                {p.label}
                                {p.implies.length > 0 && (
                                  <span
                                    title={`啟用時一併需要「${p.implies
                                      .map((c) => codeToDef.get(c)?.label ?? c)
                                      .join('、')}」，系統自動處理`}
                                    className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground"
                                  >
                                    <Info className="h-2.5 w-2.5" />
                                  </span>
                                )}
                                <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                                {autoOn && (
                                  <span className="rounded-full bg-warning-subtle px-1.5 text-[10px] font-semibold text-warning-foreground">
                                    ↳ 自動開啟
                                  </span>
                                )}
                                {adminLocked && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
                                    <Lock className="h-2.5 w-2.5" /> 內建鎖定
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">{p.description}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 未儲存變更列 */}
      {hasChanges && canManage && (
        <div className="sticky bottom-0 flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-soft">
          <span className="h-2 w-2 rounded-full bg-warning" />
          <span className="flex-1 text-sm tabular-nums">未儲存 {changeCount} 項變更</span>
          {error && <span className="text-sm text-destructive">{error}</span>}
          <Button variant="outline" size="sm" onClick={discard} disabled={saving}>
            放棄
          </Button>
          <Button size="sm" onClick={save} loading={saving} disabled={permLoadError || permLoading}>

            儲存變更
          </Button>
        </div>
      )}
      {okMsg && !hasChanges && <p className="text-sm text-success">✓ {okMsg}</p>}
      {error && !hasChanges && <p className="text-sm text-destructive">{error}</p>}

      {/* 新增/改名 Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={(v) => !v && setDialogMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogMode === 'create' ? '新增角色' : '角色改名'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">角色名稱</label>
            <Input
              value={dialogName}
              onChange={(e) => setDialogName(e.target.value)}
              maxLength={20}
              placeholder="例如：客服組長、行銷專員"
              autoFocus
            />
            {dialogMode === 'create' && (
              <p className="text-xs text-muted-foreground">
                建立後為空白角色，接著在右側自行勾選這個角色可用的權限。
              </p>
            )}
            {dialogErr && <p className="text-sm text-destructive">{dialogErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogMode(null)}>
              取消
            </Button>
            <Button onClick={submitDialog}>{dialogMode === 'create' ? '建立並設定權限' : '儲存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 刪除 Dialog */}
      <Dialog open={delTarget !== null} onOpenChange={(v) => !v && setDelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>刪除角色</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            確定要刪除角色「{delTarget?.name}」嗎？此動作無法復原。
          </p>
          {dialogErr && (
            <p className="rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning-foreground">
              ⚠ {dialogErr}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              刪除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
