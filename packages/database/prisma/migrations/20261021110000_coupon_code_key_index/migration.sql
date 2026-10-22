-- 券號比對鍵（去掉英數以外字元、轉大寫）的唯一索引（add-coupon-system，2026-10-21 code review）。
--
-- 背景：核銷台手動輸入券號時忽略連字號與大小寫，原本以 regexp_replace 比對且 LIMIT 1：
--   1. 序號包允許連字號，AB-CD1234 與 ABCD-1234 會同時存在，查券可能取到另一位顧客的券。
--   2. 對運算式比對用不到索引，每次查券都掃描整個租戶的券。
-- 以與 @open333crm/core couponCodeKey() 相同的運算式建唯一索引：DB 直接擋下正規化後相同的券號，
-- 查券也能走索引。Prisma schema 無法表示運算式索引，所以只寫在 migration（先例：
-- 20260923080000_tag_case_insensitive_unique）。查詢的運算式必須與索引完全相同。
--
-- 共用碼券原本每張都寫入同一組共用碼，撞 coupon_instances_tenantId_code_key；
-- 改為每張券有自己的內部券號（以共用碼為前綴），顧客端仍顯示共用碼。

CREATE UNIQUE INDEX "coupon_instances_tenantId_code_key_norm"
  ON "coupon_instances" ("tenantId", upper(regexp_replace("code", '[^A-Za-z0-9]', '', 'g')));

CREATE UNIQUE INDEX "coupon_codes_tenantId_code_key_norm"
  ON "coupon_codes" ("tenantId", upper(regexp_replace("code", '[^A-Za-z0-9]', '', 'g')));
