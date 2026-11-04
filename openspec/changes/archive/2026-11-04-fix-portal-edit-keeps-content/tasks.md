## 1. 後端

- [x] 1.1 feature 測試：只改標題時，選項、正確答案與表單欄位都保留（既有行為，修正前即通過，以 mutation 驗證）
- [x] 1.2 feature 測試：投票或競猜的選項送空陣列時回 400；表單的欄位送空陣列時回 400（修正前失敗：回 200 且選項／欄位被刪光）
- [x] 1.3 `updateActivity()` 依活動類型拒絕空的 `options`／`fields`

## 2. 前端

- [x] 2.1 component 測試：編輯對話框帶出完整活動的選項；完整活動載入失敗時顯示錯誤且不能儲存（修正前兩項都失敗）
- [x] 2.2 `ActivityFormDialog` 打開編輯時取完整活動，載入完成前與載入失敗時停用儲存

## 3. 文件

- [x] 3.1 更新 AUDIT.md（移除 PORTAL-03）、AUDIT-REVIEWS.md、健檢 PORTAL.md 與 README、功能文件 tenant/PORTAL.md、feature-portal skill、CHANGELOG.md

## Mutation 紀錄

- 1.1：把 `updateActivity()` 的 `if (data.options)` 改成一律以 `data.options ?? []` 刪除重建 → 「只改標題時，選項、正確答案與表單欄位都保留」失敗；還原後通過。
