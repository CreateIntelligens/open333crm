## 1. 後端

- [x] 1.1 feature 測試：建立沒有選項或欄位的草稿仍然允許（既有行為，修正前即通過，以 mutation 驗證）
- [x] 1.2 feature 測試：發布沒有選項的投票或競猜回 400，活動仍是草稿；發布沒有欄位的表單回 400，活動仍是草稿（修正前失敗：回 200 且狀態變成 PUBLISHED）
- [x] 1.3 feature 測試：草稿補上選項或欄位後可以發布
- [x] 1.4 抽出 `assertActivityAnswerable()`，`updateActivity()` 與 `publishActivity()` 共用；發布前數資料庫裡的選項與欄位
- [x] 1.5 E2E（UAT）狀態機測試：發布前先替草稿補上選項

## 2. 文件

- [x] 2.1 更新功能文件 tenant/PORTAL.md、健檢 PORTAL.md、feature-portal skill、CHANGELOG.md

## Mutation 紀錄

- 1.1：在 `createActivity()` 開頭呼叫 `assertActivityAnswerable(data.type, data.options?.length ?? 0, data.fields?.length ?? 0)` → 「建立沒有選項或欄位的草稿仍然允許」失敗；還原後通過。
- 1.3：在 `publishActivity()` 把檢查的數量固定傳 0 → 「草稿補上選項或欄位後可以發布」失敗；還原後通過。
