# UAT 健檢資料帳本

只記 UAT Demo 租戶（a0000000-0000-0000-0000-000000000001）上由健檢建立或修改的資料。結束時刪除或還原，並在「狀態」欄標記。

| 日期 | 領域 | 類型 | ID | 名稱／內容 | 狀態 |
| --- | --- | --- | --- | --- | --- |
| 2026-10-29 | contacts | 聯絡人（WebChat 訪客，含對話 38d6f95f-935d-444a-ad13-847f1c30171a） | 5fdfa68f-e963-479d-a065-4d1df58455d9 | 原名 Chatbox Visitor 14dbda，訊息「健檢-2026-10-29-A …」（觸發 AI 自動回覆一則） | 保留：系統沒有刪除聯絡人的 API，未經授權不用 GDPR 刪除；已改名帶前綴，未合併、無標籤、email 已清空 |
| 2026-10-29 | contacts | 聯絡人（WebChat 訪客，含對話 c66e9091-fff9-4885-aa4b-6dd02f02c12a） | 6f15a7e2-511e-4914-a2fc-08dfff60d8a9 | 原名 Chatbox Visitor 1ea427，訊息「健檢-2026-10-29-B …」（觸發 AI 自動回覆一則） | 保留：同上；未合併（合併嘗試被 SAME_CHANNEL_CONFLICT 拒絕，資料未變） |
| 2026-10-29 | contacts | 聯絡人欄位修改 | 5fdfa68f-e963-479d-a065-4d1df58455d9、6f15a7e2-511e-4914-a2fc-08dfff60d8a9 | displayName 改為 健檢-2026-10-29-A／B（加前綴，原名見上兩列） | 保留前綴作為測試資料標記（不還原，以便日後辨識清除） |
| 2026-10-29 | contacts | email 修改 | 5fdfa68f-e963-479d-a065-4d1df58455d9 | email 由 null 改為 hc-2026-10-29-a@example.com | 已還原（email = null） |
| 2026-10-29 | contacts | 標籤（CONTACT） | a18ae0d7-6fe9-4b78-98e9-9e7dde442ee3 | 健檢-2026-10-29-標籤（貼到 A 後移除） | 已刪除（從標籤管理頁刪除，GET /tags 確認不存在） |

## marketing

| 日期 | 領域 | 類型 | ID | 名稱／內容 | 狀態 |
| --- | --- | --- | --- | --- | --- |
| 2026-10-29 | marketing | 行銷活動（草稿） | 6a22180a-b691-40bd-8dae-7874a82f52cc | 健檢-2026-10-29-UAT活動 | 已刪除（DELETE 硬刪，GET 回 404） |
| 2026-10-29 | marketing | 受眾分群 | 2e2c7dea-4d05-4912-9d85-df6cb667b279 | 健檢-2026-10-29-UAT分群（條件 createdAfter 2099-01-01，0 人） | 已刪除（DELETE 硬刪，GET 回 404） |
| 2026-10-29 | marketing | 優惠券（草稿，未發布） | 5a9fd04b-08e6-4fa7-81ed-9a1523c16069 | 健檢-2026-10-29-UAT草稿券 | 已刪除（草稿 DELETE 硬刪，GET 回 404） |
| 2026-10-29 | marketing | 素材（LINE 文字，草稿） | bb51d627-f6b6-409b-a235-84408421be70 | 健檢-2026-10-29-UAT LINE文字（建立時後端呼叫 LINE validate API，未發送訊息） | 已刪除（素材只有軟刪：isActive=false，列表搜尋 0 筆；資料列仍在 DB，沒有硬刪 API） |
