"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";
import { getApiErrorMessage, getFieldErrors } from "@/lib/api-error";

interface IdentityBindingSettingsData {
  enabled: boolean;
  bindKeywords: string[];
  unbindKeywords: string[];
}

/** 以頓號／逗號／換行分隔的關鍵字字串 ↔ 陣列 */
const toText = (list: string[]) => list.join("、");
const toList = (text: string) =>
  text
    .split(/[、,，\n]/)
    .map((k) => k.trim())
    .filter(Boolean);

/**
 * 跨渠道綁定（One ID）設定：開關與顧客觸發用的關鍵字。
 * 對應 API：GET/PUT /api/v1/settings/identity-binding
 */
export function IdentityBindingSettings() {
  const [enabled, setEnabled] = useState(false);
  const [bindText, setBindText] = useState("");
  const [unbindText, setUnbindText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const apply = (data: IdentityBindingSettingsData) => {
    setEnabled(data.enabled);
    setBindText(toText(data.bindKeywords));
    setUnbindText(toText(data.unbindKeywords));
  };

  const fetchSettings = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.get("/settings/identity-binding");
      apply(res.data.data);
    } catch (err) {
      setLoadError(getApiErrorMessage(err, "讀取跨渠道綁定設定失敗，請重新整理"));
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
    setFieldErrors({});
    try {
      const res = await api.put("/settings/identity-binding", {
        enabled,
        bindKeywords: toList(bindText),
        unbindKeywords: toList(unbindText),
      });
      apply(res.data.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setFieldErrors(getFieldErrors(err));
      setError(getApiErrorMessage(err, "儲存失敗，請稍後重試"));
    } finally {
      setSaving(false);
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

  const fieldError = (key: string) =>
    Object.entries(fieldErrors).find(([path]) => path === key || path.startsWith(`${key}.`))?.[1];

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="mb-2 text-lg font-semibold">跨渠道綁定</h2>
        <p className="text-sm text-muted-foreground">
          讓同一位顧客在 LINE、Facebook、Instagram 的帳號合併成同一位聯絡人。顧客在任一渠道傳送綁定關鍵字，
          系統會回覆其他渠道的專屬連結與一次性代碼；顧客點連結到另一個渠道送出代碼，並回覆「確認綁定」後，兩個帳號即合併，
          對話紀錄、標籤、點數會集中在同一位聯絡人底下。
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-lg border p-4">
        <Checkbox checked={enabled} onCheckedChange={setEnabled} className="mt-0.5" />
        <span className="space-y-1">
          <span className="block text-sm font-medium">啟用跨渠道綁定</span>
          <span className="block text-xs text-muted-foreground">
            關閉時，顧客傳送關鍵字或代碼都視為一般訊息，交由 AI 或客服處理。
          </span>
        </span>
      </label>

      <div className="space-y-2">
        <label className="text-sm font-medium">綁定關鍵字</label>
        <Input value={bindText} onChange={(e) => setBindText(e.target.value)} placeholder="綁定帳號" className="max-w-md" />
        <p className="text-xs text-muted-foreground">
          顧客傳送的訊息與關鍵字「完全相同」才會觸發，多個關鍵字以頓號分隔，最多 5 個。
        </p>
        {fieldError("bindKeywords") && <p className="text-xs text-destructive">{fieldError("bindKeywords")}</p>}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">解除關鍵字</label>
        <Input value={unbindText} onChange={(e) => setUnbindText(e.target.value)} placeholder="解除綁定" className="max-w-md" />
        <p className="text-xs text-muted-foreground">
          綁定後 7 天內，顧客傳送此關鍵字可自行解除；超過 7 天需由客服在聯絡人頁面解除。
        </p>
        {fieldError("unbindKeywords") && <p className="text-xs text-destructive">{fieldError("unbindKeywords")}</p>}
      </div>

      <div className="rounded-lg border bg-muted/40 p-4 text-sm">
        <p className="mb-2 font-medium">啟用前請確認</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>各渠道已在「渠道管理」設定導流識別（LINE Basic ID、粉專 username、IG 帳號），未設定的渠道不會出現在連結清單中。</li>
          <li>Facebook 粉專需設定「開始使用」按鈕，第一次私訊的顧客才收得到代碼。</li>
          <li>Instagram 綁定連結僅支援手機 App，且 IG 應用程式須已發佈。</li>
          <li>同一品牌的多個 LINE 官方帳號須建在同一個 Provider，否則無法辨識是同一人。</li>
        </ul>
      </div>

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
