-- 素材級點擊歸因：ShortLink 加 materialId，讓短連結點擊可歸因回產生它的素材。
-- change: material-click-attribution
-- 非破壞性：nullable 欄 + FK onDelete SET NULL（素材刪除時短連結與點擊歷史保留）。
-- short_links 已在 RLS 管轄（20260827100000），新欄不影響 tenant_isolation policy。

ALTER TABLE "short_links" ADD COLUMN "materialId" UUID;
CREATE INDEX "short_links_materialId_idx" ON "short_links"("materialId");
ALTER TABLE "short_links"
  ADD CONSTRAINT "short_links_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
