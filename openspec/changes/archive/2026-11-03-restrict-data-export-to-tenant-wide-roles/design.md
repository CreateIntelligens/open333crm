## Context

匯出 worker 讀取全租戶的資料。路由只檢查 `data.export`。issue #428 已決定 `data.export` 是全租戶的資料可攜權。

## Decisions

### D1：以路由檢查 `channel.view_all`，不依渠道篩選匯出內容

依渠道篩選要改 worker 的查詢、manifest 註明範圍，還要處理沒有渠道的資料（例如沒有對話的聯絡人）。產品已決定匯出是全租戶的，
所以只限制誰能使用。`channel.view_all` 就是「不受渠道指派限制，可見全部渠道」的權限，語意吻合。

### D2：不設 `dependsOn`

註冊表只允許一層 `dependsOn`，`channel.view_all` 本身依賴 `channel.view`，不能當前置權限。若改用 `implies`，持有 `data.export`
就會自動得到 `channel.view_all`，反而擴大權限。所以只在路由檢查，並在權限說明寫明需求。

### D3：查詢與下載同樣限制，不限發起者本人

兩個權限都有的成員本來就能看到全租戶資料，下載別人發起的匯出不會多拿到資料。只限發起者本人會讓發起者離職後，
其他管理員無法取得匯出檔。下載連結只回給通過檢查的成員，15 分鐘後失效。下載仍不寫稽核（HC-GOVERNANCE-03，不在本 change）。

### D4：檢查順序與錯誤欄位

先檢查 `data.export`，再檢查 `channel.view_all`，兩者都回 HTTP 403。`error.details.requiredPermission` 指出被哪一個檢查擋下，
測試以此區分。
