-- Reconcile the legacy rich menu tables created in 20260402041711 (old design:
-- rich_menus.configJson/isDefault + rich_menu_user_bindings + rich_menu_aliases).
-- They are absent from the Prisma schema and unused by application code, so drop
-- them before recreating rich_menus with the current design. IF EXISTS + CASCADE
-- keeps this safe on databases where they were already removed.
DROP TABLE IF EXISTS "rich_menu_aliases" CASCADE;
DROP TABLE IF EXISTS "rich_menu_user_bindings" CASCADE;
DROP TABLE IF EXISTS "rich_menus" CASCADE;

-- CreateTable
CREATE TABLE "rich_menus" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "chatBarText" TEXT NOT NULL,
    "size" JSONB NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "areas" JSONB NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "lineRichMenuId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rich_menus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rich_menus_tenantId_channelId_idx" ON "rich_menus"("tenantId", "channelId");

-- CreateIndex
CREATE INDEX "rich_menus_tenantId_status_idx" ON "rich_menus"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "rich_menus" ADD CONSTRAINT "rich_menus_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rich_menus" ADD CONSTRAINT "rich_menus_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
