-- change enable-channels-on-trial-light-411（issue #411，AUDIT PLAN-14）
--
-- trial（免費試用）與 light（輕量版）方案的 features 原本不含 channels，channel.* 權限碼被方案天花板擋下，
-- 這兩個方案的租戶連管理員都看不到、也建不了渠道。seed 已改成含 channels；這支 migration 在部署時更新既有方案，
-- 不依賴 seed（entrypoint 的 seed 失敗時不中止啟動）。
--
-- 只在 slug 是 trial／light、features 是陣列且還不含 channels 時，把 channels 加到陣列最後。
-- 不動 name、limits、allowedChannelTypes、permissionOverrides、priceMonthly、isActive，也不動其他方案。
-- 可重複執行（第二次執行時沒有符合的列）。
--
-- 權限快取：既有租戶的有效權限在 Redis perms:tenant:* 快取 10 分鐘，部署後最晚 10 分鐘生效；
-- 要立即生效時刪除 perms:tenant:* 的 key（不可 FLUSHDB）。getTenantPlanId 的程序內快取在部署重啟時清空。
--
-- plans 是平台層資料表，沒有 RLS；migration 以 MIGRATE_DATABASE_URL（owner）執行。
--
-- 回滾：UPDATE plans SET features = features - 'channels' WHERE slug IN ('trial', 'light');

UPDATE plans
   SET features = features || '["channels"]'::jsonb,
       "updatedAt" = now()
 WHERE slug IN ('trial', 'light')
   AND jsonb_typeof(features) = 'array'
   AND NOT (features ? 'channels');
