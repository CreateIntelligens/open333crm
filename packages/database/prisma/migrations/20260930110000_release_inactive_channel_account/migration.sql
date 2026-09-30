-- change fix-meta-webhook-page-routing（code review 高風險修正）：
-- 停用的渠道或停用租戶的渠道仍持有 externalAccountId 時，會永久佔住該粉專／IG 帳號：
-- 新渠道驗證一直 409、事件被丟棄，跨租戶時租戶自己完全無法解開。
--
-- 這個函式只釋放「已停用渠道」或「停用租戶的渠道」持有的帳號 ID，啟用中的連結一律不動。
-- 以 SECURITY DEFINER 執行（owner 身分、不受呼叫者租戶的 RLS 限制），讓租戶在驗證撞到重複時
-- 能拿回被停用渠道佔住的帳號；回傳釋放筆數，不回傳任何租戶資訊。
-- owner 若沒有 BYPASSRLS，函式只看得到呼叫者租戶的列（fail-safe：頂多釋放不到別租戶的停用渠道）。
--
-- 回滾：DROP FUNCTION release_inactive_channel_account("ChannelType", text);
CREATE OR REPLACE FUNCTION release_inactive_channel_account(p_type "ChannelType", p_account text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
-- pg_temp 放最後、表名寫完整 schema：避免呼叫者用同名暫存表（例如假的 tenants）誤導判斷
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH released AS (
    UPDATE public.channels c
       SET "externalAccountId" = NULL, "updatedAt" = now()
     WHERE c."channelType" = p_type
       AND c."externalAccountId" = p_account
       AND (
         c."isActive" = false
         OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = c."tenantId" AND t."isActive" = false)
       )
    RETURNING 1
  )
  SELECT count(*)::integer FROM released;
$$;

REVOKE ALL ON FUNCTION release_inactive_channel_account("ChannelType", text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_inactive_channel_account("ChannelType", text) TO app_tenant, app_admin;

-- 既有資料：已停用的渠道不應持有帳號 ID
UPDATE channels SET "externalAccountId" = NULL WHERE "isActive" = false AND "externalAccountId" IS NOT NULL;
