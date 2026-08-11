"use client";

import React, { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import {
  Plus,
  Loader2,
  Copy,
  Check,
  Trash2,
  Bot,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import api from "@/lib/api";

interface CliSession {
  id: string;
  name: string;
  agent: { id: string; name: string; email: string };
  tokenPrefix: string;
  tokenSuffix: string;
  scopes: string[];
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface CreatedSession {
  token: string;
  session: {
    id: string;
    name: string;
    tokenPrefix: string;
    tokenSuffix: string;
    scopes: string[];
    expiresAt: string;
    createdAt: string;
  };
}

const EXPIRY_OPTIONS = [
  { value: "0", label: "永不過期" },
  { value: "7", label: "7 天" },
  { value: "30", label: "30 天" },
  { value: "90", label: "90 天" },
  { value: "365", label: "1 年" },
];

export function CliSessionManagement() {
  const [sessions, setSessions] = useState<CliSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdSession, setCreatedSession] = useState<CreatedSession | null>(
    null,
  );

  const fetchSessions = useCallback(async () => {
    try {
      const res = await api.get<{ data: CliSession[] }>(
        "/settings/cli-sessions",
      );
      setSessions(res.data.data);
    } catch (err) {
      console.error("Failed to fetch CLI sessions:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleRevoke = async (id: string, name: string) => {
    if (
      !confirm(
        `確定要撤銷「${name}」這個 CLI 連線嗎？撤銷後使用此 token 的 LLM / CLI 會立即無法操作。`,
      )
    )
      return;
    try {
      await api.delete(`/settings/cli-sessions/${id}`);
      fetchSessions();
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { error?: { message?: string } } };
      };
      alert(e.response?.data?.error?.message || "撤銷失敗");
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">CLI / LLM 連線</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            產生 CLI token 讓 LLM 或{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              open333
            </code>{" "}
            CLI 直接操作本系統。每個 token 有獨立權限範圍與過期時間。
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/skill.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Bot className="h-3.5 w-3.5" />
            Skill 文件
            <ExternalLink className="h-3 w-3" />
          </a>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            產生 Token
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <Bot className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium">尚未產生任何 CLI Token</p>
          <p className="mt-1 text-xs text-muted-foreground">
            點「產生 Token」開始建立第一個 LLM / CLI 連線
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">名稱</th>
                <th className="px-4 py-2.5 font-medium">使用者</th>
                <th className="px-4 py-2.5 font-medium">Token</th>
                <th className="px-4 py-2.5 font-medium">權限</th>
                <th className="px-4 py-2.5 font-medium">最後使用</th>
                <th className="px-4 py-2.5 font-medium">過期時間</th>
                <th className="px-4 py-2.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  className="border-b transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-3 text-sm font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {s.agent.name}
                  </td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {s.tokenPrefix}…{s.tokenSuffix}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {s.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="inline-flex items-center rounded-full bg-primary-subtle px-2 py-0.5 text-[10px] font-medium text-primary"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {s.lastUsedAt
                      ? format(new Date(s.lastUsedAt), "yyyy-MM-dd HH:mm")
                      : "從未使用"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {format(new Date(s.expiresAt), "yyyy-MM-dd")}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(s.id, s.name)}
                      className="text-destructive hover:text-destructive"
                      title="撤銷"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateCliSessionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(created) => {
          setCreateOpen(false);
          setCreatedSession(created);
          fetchSessions();
        }}
      />

      <CreatedCliSessionDialog
        sessionData={createdSession}
        onOpenChange={(open) => {
          if (!open) setCreatedSession(null);
        }}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────

function CreateCliSessionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedSession) => void;
}) {
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("30");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setExpiry("30");
    }
  }, [open]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const days = parseInt(expiry, 10);
      const body: { name: string; expiresInDays?: number | null } = {
        name: name.trim(),
      };
      if (days > 0) body.expiresInDays = days;

      const res = await api.post<{ data: CreatedSession }>(
        "/settings/cli-sessions",
        body,
      );
      onCreated(res.data.data);
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { error?: { message?: string } } };
      };
      alert(e.response?.data?.error?.message || "建立失敗");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !creating && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle>產生 CLI Token</DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium">名稱</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：Claude Code / ChatGPT / open333 CLI"
                required
                disabled={creating}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                用來識別這個 token 是給哪個 LLM 或 CLI 使用
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium">
                過期時間
              </label>
              <Select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                options={EXPIRY_OPTIONS}
                disabled={creating}
              />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={creating}
            >
              取消
            </Button>
            <Button type="submit" disabled={creating || !name.trim()}>
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  產生中…
                </>
              ) : (
                "產生 Token"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────

function CreatedCliSessionDialog({
  sessionData,
  onOpenChange,
}: {
  sessionData: CreatedSession | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!sessionData) return;
    try {
      await navigator.clipboard.writeText(sessionData.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert(sessionData.token);
    }
  };

  return (
    <Dialog open={!!sessionData} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Token 已產生</DialogTitle>
        </DialogHeader>

        {sessionData && (
          <div className="mt-2 space-y-4">
            <div className="rounded-md border-2 border-warning/40 bg-warning-subtle p-3 text-xs text-warning">
              ⚠️ <strong>請立刻複製並妥善保存</strong>
              。關閉視窗後將無法再次查看完整 token，列表只會顯示前後遮罩。
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium">
                {sessionData.session.name}
              </label>
              <div className="flex gap-2">
                <code className="flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2.5 font-mono text-xs">
                  {sessionData.token}
                </code>
                <Button onClick={handleCopy} variant="outline" size="default">
                  {copied ? (
                    <>
                      <Check className="mr-1.5 h-4 w-4 text-success" />
                      已複製
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 h-4 w-4" />
                      複製
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">使用方式</p>
              <p className="mt-1">將 token 貼給 LLM，並告訴它：</p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">
                {`API Base URL: https://uat.open333crm.create360.ai
Bearer Token: ${sessionData.token}

在 Headers 中加上：
Authorization: Bearer <token>`}
              </pre>
              <p className="mt-2">或使用 CLI：</p>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">
                {`open333 login --host https://uat.open333crm.create360.ai
# 然後貼上 token`}
              </pre>
            </div>

            <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">LLM 可用功能</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>
                  <code>GET /health</code> — 檢查系統狀態
                </li>
                <li>
                  <code>GET /api/v1/auth/me</code> — 取得目前使用者資訊
                </li>
                <li>
                  <code>GET /api/v1/cli/apis</code> — 探索可用 API 端點
                </li>
                <li>
                  <code>GET /api/v1/cli/analytics/*</code> — 查詢統計數據
                </li>
              </ul>
            </div>
          </div>
        )}

        <DialogFooter className="mt-6">
          <Button onClick={() => onOpenChange(false)}>我已保存，關閉</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
