"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";

// 追蹤碼會被注入短連結轉址頁的 <script>，字元必須限制在安全集合，否則可構成儲存型 XSS。
// 與後端 settings.routes.ts 的 GA4_ID_RE / META_PIXEL_ID_RE 同一組規則。
const GA4_ID_RE = /^G-[A-Z0-9]{4,20}$/;
const META_PIXEL_ID_RE = /^\d{10,20}$/;

export function TrackingSettings() {
  const [gaId, setGaId] = useState("");
  const [metaPixelId, setMetaPixelId] = useState("");
  const [gaError, setGaError] = useState("");
  const [pixelError, setPixelError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await api.get("/settings/tracking");
      const data = res.data.data;
      setGaId(data.gaId || "");
      setMetaPixelId(data.metaPixelId || "");
    } catch (err) {
      console.error("Failed to fetch tracking settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    const ga = gaId.trim();
    const pixel = metaPixelId.trim();
    const gaMsg = ga && !GA4_ID_RE.test(ga) ? "GA4 ID 格式不正確（須為 G- 開頭的大寫英數）" : "";
    const pixelMsg = pixel && !META_PIXEL_ID_RE.test(pixel) ? "Meta Pixel ID 格式不正確（須為純數字）" : "";
    setGaError(gaMsg);
    setPixelError(pixelMsg);
    if (gaMsg || pixelMsg) return;

    setSaving(true);
    setSaved(false);
    try {
      await api.put("/settings/tracking", {
        gaId: ga || null,
        metaPixelId: pixel || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save tracking settings:", err);
      alert("儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-muted-foreground">載入中...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold mb-4">追蹤設定</h2>
        <p className="text-sm text-muted-foreground mb-4">
          設定外部追蹤服務的 ID，短連結的 redirect
          頁面會自動注入對應的追蹤腳本。
          設定後，所有短連結的點擊數據會同步發送到 GA4 和 Meta Business Suite。
        </p>
      </div>

      {/* Google Analytics 4 */}
      <div className="space-y-2">
        <label htmlFor="ga-id" className="text-sm font-medium">Google Analytics 4 ID</label>
        <Input
          id="ga-id"
          value={gaId}
          onChange={(e) => setGaId(e.target.value)}
          placeholder="G-XXXXXXXXXX"
          className="max-w-md"
        />
        {gaError ? (
          <p className="text-xs text-destructive">{gaError}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            從 Google Analytics 的資料串流設定中取得。格式為 G- 開頭。
          </p>
        )}
      </div>

      {/* Meta Pixel */}
      <div className="space-y-2">
        <label htmlFor="meta-pixel-id" className="text-sm font-medium">Meta Pixel ID</label>
        <Input
          id="meta-pixel-id"
          value={metaPixelId}
          onChange={(e) => setMetaPixelId(e.target.value)}
          placeholder="1234567890"
          className="max-w-md"
        />
        {pixelError ? (
          <p className="text-xs text-destructive">{pixelError}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            從 Meta Events Manager 取得。純數字 ID。
          </p>
        )}
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "儲存中..." : "儲存設定"}
        </Button>
        {saved && <span className="text-sm text-success">已儲存</span>}
      </div>
    </div>
  );
}
