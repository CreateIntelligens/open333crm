-- 方案功能點細分：從 feature 天花板再扣掉的權限碼白名單。形狀 { "deny": string[] }。
-- default '{}' = 無 override（天花板不變）。有 default → 對既有 plan 零影響、非破壞性。
ALTER TABLE "plans" ADD COLUMN "permissionOverrides" JSONB NOT NULL DEFAULT '{}';
