-- 「所有好友的預設選單」與「聊天室打開時展開選單」拆成兩個欄位（change migrate-line-tenant-ctx）。
-- selected 改回 LINE 的原意（展開）；既有選單的 selected 同時代表預設，所以以它填入 isDefault。
ALTER TABLE "rich_menus" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
UPDATE "rich_menus" SET "isDefault" = "selected";
ALTER TABLE "rich_menus" ALTER COLUMN "selected" SET DEFAULT true;
