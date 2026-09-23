-- 素材標籤統一到 Tag 表：新增 MATERIAL scope。
--
-- 素材標籤原本是 Material.tags（String[] 自由字串），與「設定 → 標籤管理」
-- 的 Tag 表互不相通——同一個概念在兩邊各存一份，無法改名或合併。
--
-- 作法：保留 Material.tags 作為實際儲存（查詢用 hasSome，不需 join），
-- 但寫入時把標籤名稱登記到 Tag 表，讓設定頁能統一管理。
-- 不新增關聯表——TenantDb 是三個 client 型別的聯集，多一張關聯表會讓
-- TS 的多載推導超過上限（實測噴 470 個 TS2349）。
ALTER TYPE "TagScope" ADD VALUE IF NOT EXISTS 'MATERIAL';
