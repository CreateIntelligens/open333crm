## 1. 後端

- [x] 1.1 feature 測試：發布沒有正確答案的競猜回 400，活動仍是草稿（修正前失敗：回 200 且狀態變成 PUBLISHED）
- [x] 1.2 feature 測試：有正確答案的競猜可以發布；投票沒有正確答案仍然可以發布；沒有正確答案的競猜草稿可以建立與儲存
- [x] 1.3 `assertActivityAnswerable()` 加正確答案數的參數，只有 `publishActivity()` 傳入資料庫裡標為正確的選項數；`updateActivity()` 不傳

## 2. 前端

- [x] 2.1 component 測試：競猜的選項區顯示「發布前至少勾選一個正確答案」，投票不顯示（修正前失敗）
- [x] 2.2 `ActivityFormDialog` 競猜選項區加說明文字

## 3. 文件

- [x] 3.1 更新功能文件 tenant/PORTAL.md、健檢 PORTAL.md、feature-portal skill、手冊 ch11、CHANGELOG.md

## Mutation 紀錄

- 1.2：在 `updateActivity()` 也傳入正確答案數 0（`assertActivityAnswerable(activity.type, data.options?.length, data.fields?.length, 0)`）→ 「沒有正確答案的競猜草稿可以建立與儲存」失敗；還原後通過。
- 1.2：把正確答案的條件改成 `type !== 'POLL'`（投票也檢查）→ 「投票沒有正確答案仍然可以發布」失敗；還原後通過。
- 1.2：發布時把正確答案數固定傳 0 → 「有正確答案的競猜可以發布」失敗；還原後通過。
