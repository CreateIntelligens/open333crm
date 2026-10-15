"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import api from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-error";

interface WebTalkSettingsData {
  enabled: boolean;
  aiEnabled: boolean;
}

/**
 * WebTalk 協作工具列的租戶設定（change webtalk-multi-tenant）。
 * 對應 API：GET/PUT /api/v1/webtalk/settings、POST /api/v1/webtalk/settings/rotate-room
 */
export function WebTalkSettings() {
  const [enabled, setEnabled] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (data: WebTalkSettingsData) => {
    setEnabled(data.enabled);
    setAiEnabled(data.aiEnabled);
  };

  const fetchSettings = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.get("/webtalk/settings");
      apply(res.data.data);
    } catch (err) {
      setLoadError(getApiErrorMessage(err, "讀取 WebTalk 設定失敗，請重新整理"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    setNotice(null);
    try {
      const res = await api.put("/webtalk/settings", { enabled, aiEnabled });
      apply(res.data.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(getApiErrorMessage(err, "儲存失敗，請稍後重試"));
    } finally {
      setSaving(false);
    }
  };

  const handleRotate = async () => {
    if (!window.confirm("重新產生房間代號後，所有成員要重新整理頁面才會進入新房間，原本房間的聊天紀錄不會帶過去。確定要重新產生嗎？")) {
      return;
    }
    setRotating(true);
    setError(null);
    setNotice(null);
    try {
      await api.post("/webtalk/settings/rotate-room");
      setNotice("已重新產生房間代號。請通知成員重新整理頁面。");
    } catch (err) {
      setError(getApiErrorMessage(err, "重新產生房間代號失敗，請稍後重試"));
    } finally {
      setRotating(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-muted-foreground">載入中...</div>;
  }
  if (loadError) {
    return (
      <div className="max-w-2xl space-y-3">
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{loadError}</div>
        <Button variant="outline" onClick={() => { setLoading(true); fetchSettings(); }}>
          重新載入
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="mb-2 text-lg font-semibold">WebTalk 協作</h2>
        <p className="text-sm text-muted-foreground">
          WebTalk 是後台右下角的多人聊天工具列，讓同一個租戶的成員在後台即時討論。每個租戶有自己的房間，
          其他租戶看不到你們的在線名單與訊息。設定變更後，成員重新整理頁面才會生效。
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-lg border p-4">
        <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} className="mt-0.5" />
        <span className="space-y-1">
          <span className="block text-sm font-medium">啟用 WebTalk</span>
          <span className="block text-xs text-muted-foreground">
            關閉時，後台不會載入 WebTalk，也不會連線到 WebTalk 的外部服務。
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 rounded-lg border p-4">
        <Checkbox checked={aiEnabled} onCheckedChange={(v) => setAiEnabled(v === true)} className="mt-0.5" />
        <span className="space-y-1">
          <span className="block text-sm font-medium">啟用 AI 摘要</span>
          <span className="block text-xs text-muted-foreground">
            成員按下「網頁摘要」時，目前頁面上的所有文字（包含顧客姓名、電話與對話內容）會送到外部 AI 服務。
            請確認符合貴公司的個資政策後再開啟。關閉時，AI 摘要會顯示已停用，頁面內容不會送到外部。
          </span>
        </span>
      </label>

      <div className="space-y-2 rounded-lg border p-4">
        <p className="text-sm font-medium">房間代號</p>
        <p className="text-xs text-muted-foreground">
          知道房間代號的人都可以加入房間。成員離職或懷疑代號外流時，請重新產生房間代號。
        </p>
        <Button variant="outline" onClick={handleRotate} disabled={rotating}>
          {rotating ? "處理中..." : "重新產生房間代號"}
        </Button>
      </div>

      {notice && <div className="rounded-md bg-muted p-3 text-sm">{notice}</div>}
      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "儲存中..." : "儲存設定"}
        </Button>
        {saved && <span className="text-sm text-success">已儲存</span>}
      </div>
    </div>
  );
}
