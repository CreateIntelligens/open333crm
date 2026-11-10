-- 加購 AI token 改成只計入核准當月（台灣時間），不再寫 limitOverrides（change make-token-topup-monthly，design D6）。
-- 舊版核准加購把「當時有效額度 + 加購量」寫進 limitOverrides.monthlyTokens，等於永久提高每月額度（AUDIT PLAN-02、PLAN-05）。
-- 這個 key 唯一的寫入端是核准加購，所以全部移除；其他覆寫值不動。
-- 部署當月已核准的加購仍由已核准的 plan_change_requests 計入，更早月份的加購不再計入。
-- 可重複執行：第二次沒有符合的列。
UPDATE "tenants"
SET "limitOverrides" = "limitOverrides" - 'monthlyTokens'
WHERE "limitOverrides" ? 'monthlyTokens';
