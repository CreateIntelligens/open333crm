-- 試用申請不再收密碼（AUDIT TRIAL-05，change trial-set-password-after-verify）。
-- 管理員密碼改在點驗證連結後設定；申請時存的雜湊可能是他人設定的，不再使用，直接移除。
-- 已開通租戶的密碼存在 agents."passwordHash"，不受影響。
ALTER TABLE "trial_signups" DROP COLUMN "passwordHash";
