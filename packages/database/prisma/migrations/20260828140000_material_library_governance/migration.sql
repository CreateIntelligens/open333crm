-- 素材庫治理：巢狀分類 + 標籤 + 版本 + 顯示狀態。
-- change: improve-material-library-governance
--
-- 非破壞性：materials 三個新欄皆 nullable 或帶 default，對既有列零影響；
-- 舊 category 字串欄保留（過渡，新走 categoryId）。
-- 兩張新表納入 RLS（承 20260827100000 的標準 policy，NULLIF 防空字串轉型）。

-- ── 1. material_categories（巢狀分類，parentId 自我關聯） ────────────────────
CREATE TABLE "material_categories" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"  UUID NOT NULL,
  "name"      TEXT NOT NULL,
  "parentId"  UUID,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_categories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "material_categories_tenantId_parentId_idx" ON "material_categories"("tenantId", "parentId");

ALTER TABLE "material_categories"
  ADD CONSTRAINT "material_categories_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_categories"
  ADD CONSTRAINT "material_categories_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "material_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. material_versions（每次編輯快照） ───────────────────────────────────
CREATE TABLE "material_versions" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"   UUID NOT NULL,
  "materialId" UUID NOT NULL,
  "versionNo"  INTEGER NOT NULL,
  "name"       TEXT NOT NULL,
  "body"       JSONB NOT NULL,
  "editedById" UUID,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "material_versions_materialId_versionNo_key" ON "material_versions"("materialId", "versionNo");
CREATE INDEX "material_versions_materialId_versionNo_idx" ON "material_versions"("materialId", "versionNo");

ALTER TABLE "material_versions"
  ADD CONSTRAINT "material_versions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_versions"
  ADD CONSTRAINT "material_versions_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. materials 新欄位 ────────────────────────────────────────────────────
ALTER TABLE "materials" ADD COLUMN "categoryId" UUID;
ALTER TABLE "materials" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "materials" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft';
CREATE INDEX "materials_tenantId_categoryId_idx" ON "materials"("tenantId", "categoryId");
ALTER TABLE "materials"
  ADD CONSTRAINT "materials_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "material_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. RLS：兩張新表納入租戶隔離（承 20260827100000 標準 policy） ──────────
-- app_tenant/app_admin 的 GRANT 由 roles_and_grants 的 ALTER DEFAULT PRIVILEGES 自動涵蓋新表。
DO $$
DECLARE t text;
DECLARE tables text[] := ARRAY['material_categories', 'material_versions'];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING ("tenantId" = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
      'WITH CHECK ("tenantId" = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;
