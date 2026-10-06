-- change channel-visibility-fail-closed（#217）：渠道可見範圍改回 fail-closed。
--
-- 原本 services/channel-visibility.ts 有 legacy 分支：完全沒有綁定任何團隊或成員的渠道，
-- 所有成員都看得到。這次移除該分支；移除前先把這類渠道直綁給該租戶所有啟用中的成員，
-- 部署當下每個人看到的渠道才會和現況相同。
--
-- 部署順序：entrypoint 先以 owner 身分跑 migrate deploy，再啟動新程式，所以回填一定先於
-- 移除 legacy 分支生效。舊程式在回填後、新程式啟動前仍看到相同結果（回填與 legacy 等價）。
--
-- 範圍：
--   - 渠道：含停用的渠道（日後重新啟用時才不會沒人看得到）。
--   - 成員：只含啟用中的成員；停用的成員日後重新啟用時，由管理員指派渠道。
--   - 已有任何團隊或成員綁定的渠道一律不動。
-- 可重複執行：ON CONFLICT DO NOTHING。
--
-- 回滾：此 migration 只新增 agent_channel_accesses 的列。要撤銷時，刪除 grantedById 為 NULL、
-- grantedAt 為本次部署時間附近的列（回填寫入的列沒有授權人）。

-- @guard
-- 渠道與成員表都是 FORCE ROW LEVEL SECURITY。執行身分若不能略過 RLS，下面的 SELECT 會讀到 0 列，
-- 回填「成功」但什麼都沒寫，部署後所有非總店成員突然看不到渠道。寧可讓 migration 失敗。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION '回填需要能略過 RLS 的資料庫身分（superuser 或 BYPASSRLS），目前是 %。請以 MIGRATE_DATABASE_URL 指向 owner 執行 migrate deploy。', current_user;
  END IF;
END
$$;

-- @backfill
INSERT INTO "agent_channel_accesses" ("channelId", "agentId", "accessLevel", "grantedAt", "grantedById")
SELECT c."id", a."id", 'full', CURRENT_TIMESTAMP, NULL
FROM "channels" c
JOIN "agents" a ON a."tenantId" = c."tenantId" AND a."isActive" = true
WHERE NOT EXISTS (SELECT 1 FROM "channel_team_accesses" t WHERE t."channelId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "agent_channel_accesses" x WHERE x."channelId" = c."id")
ON CONFLICT ("channelId", "agentId") DO NOTHING;
