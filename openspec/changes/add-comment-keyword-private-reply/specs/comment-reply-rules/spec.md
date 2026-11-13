## ADDED Requirements

### Requirement: 建立留言規則
有 `comment_reply.manage` 的成員 SHALL 能以 `POST /api/v1/comment-replies/rules` 建立留言規則：渠道、名稱、關鍵字、比對方式、貼文範圍、私訊內容、每人一次、公開回覆、啟用。系統 SHALL 在後端驗證：渠道的外掛有留言擴充且啟用中；關鍵字 1～20 個、每個 1～50 字、正規化後不重複；文字內容 1～1,000 字；指定貼文時 1～50 篇。驗證失敗回 400，`details.field` 指出欄位。

#### Scenario: 建立 FB 文字規則並讀回
- **WHEN** 有 manage 的成員對 FB 渠道送出名稱「+1 領券」、關鍵字 `["+1","領券"]`、比對方式 any、全部貼文、文字「感謝留言」、公開回覆 3 則文字的規則，再以 `GET /rules/:id` 讀回
- **THEN** 回應 201，讀回的每個欄位與送出時相同，`isActive` 為 true

#### Scenario: 選 LINE 渠道
- **WHEN** 規則的 `channelId` 是 LINE 渠道
- **THEN** 回應 400，`error.code` 是 `CHANNEL_NOT_SUPPORTED`，沒有建立規則

#### Scenario: 關鍵字正規化後重複
- **WHEN** 規則關鍵字是 `["+1","＋１"]`
- **THEN** 回應 400，`details.field` 是 `keywords`

#### Scenario: 指定貼文卻沒有貼文
- **WHEN** 規則 `postScope` 是 `selected`、`posts` 是空陣列
- **THEN** 回應 400，`details.field` 是 `posts`

#### Scenario: 沒有 manage 權限
- **WHEN** 只有 `comment_reply.view` 的成員建立規則
- **THEN** 回應 403，`error.details.requiredPermission` 是 `comment_reply.manage`

### Requirement: 規則私訊內容的限制
規則的私訊內容 SHALL 符合渠道外掛宣告的能力：外掛沒有素材類型（IG）時只能用文字；素材 SHALL 屬於本租戶、啟用中、類型在外掛宣告的私訊類型內。`fb_receipt`、`fb_coupon`、`fb_feedback` 素材 SHALL NOT 可用。文字或素材含顧客專屬券連結時 SHALL 回 400 `COUPON_URL_IN_RULE_MESSAGE`。

#### Scenario: IG 規則選素材
- **WHEN** IG 渠道的規則 `content` 是 `{ type: 'material', materialId }`
- **THEN** 回應 400，`error.code` 是 `MATERIAL_UNSUPPORTED`，`details.field` 是 `content`

#### Scenario: 選收據範本素材
- **WHEN** FB 規則選了 `fb_receipt` 類型的素材
- **THEN** 回應 400，`error.code` 是 `MATERIAL_UNSUPPORTED`

#### Scenario: 其他租戶的素材
- **WHEN** FB 規則的 `materialId` 屬於另一個租戶
- **THEN** 回應 400，`error.code` 是 `MATERIAL_NOT_FOUND`

#### Scenario: 文字含顧客專屬券連結
- **WHEN** 規則文字含顧客專屬券連結的變數
- **THEN** 回應 400，`error.code` 是 `COUPON_URL_IN_RULE_MESSAGE`

### Requirement: 規則的素材選項
`GET /api/v1/comment-replies/material-options?channelId=` SHALL 只回該渠道外掛可用於私訊、啟用中的本租戶素材摘要（id、名稱、類型、預覽文字）。這個端點 SHALL 以 `comment_reply.manage` 守門，不需要 `marketing.view`。

#### Scenario: 沒有行銷權限也能選素材
- **WHEN** 成員有 `comment_reply.manage`、沒有 `marketing.view`，查 FB 渠道的素材選項
- **THEN** 回應 200，清單含該租戶啟用中的 FB 文字與圖片素材，不含 `fb_receipt` 素材與停用的素材

#### Scenario: IG 渠道沒有素材選項
- **WHEN** 查 IG 渠道的素材選項
- **THEN** 回應 200，清單是空陣列

### Requirement: 規則建立後不可改渠道
`PATCH /api/v1/comment-replies/rules/:id` 帶 `channelId` 時 SHALL 回 400 `CHANNEL_IMMUTABLE`，規則不變。其他欄位的驗證與建立時相同。

#### Scenario: 修改時帶渠道
- **WHEN** 有 manage 的成員以 `PATCH /rules/:id` 送 `{ channelId: 另一個渠道 }`
- **THEN** 回應 400，`error.code` 是 `CHANNEL_IMMUTABLE`，規則的渠道不變

### Requirement: 指定貼文 ID 以單一方式正規化
規則存檔時，系統 SHALL 以渠道外掛的 `parsePostReference()` 把每篇指定貼文的 ID 或網址正規化（FB `{pageId}_{postId}`、IG media id），與 webhook 留言事件的貼文 ID 使用同一種格式。無法辨識時 SHALL 回 400 `POST_ID_INVALID`，`details.field` 指出是第幾篇。

#### Scenario: 手動輸入的貼文 ID 命中 webhook 留言
- **WHEN** FB 規則以手動輸入的純數字貼文 ID `123` 存檔，之後收到該粉專 `post_id` 為 `{pageId}_123` 的留言，內容含關鍵字
- **THEN** 規則命中，產生一筆處理中的紀錄

#### Scenario: 從最近貼文挑選的 ID 命中 webhook 留言
- **WHEN** 規則以 `GET /channels/:id/posts` 回傳的 `postId` 存檔，之後收到該貼文的留言，內容含關鍵字
- **THEN** 規則命中

#### Scenario: 無法辨識的貼文參照
- **WHEN** 指定貼文填 `hello`
- **THEN** 回應 400，`error.code` 是 `POST_ID_INVALID`

### Requirement: 公開回覆的設定
規則的公開回覆 SHALL 預設關閉。開啟時 SHALL 有 1～5 則文字、每則 1～300 字。渠道外掛宣告不支援公開回覆時 SHALL 回 400；平台關閉該平台的公開回覆能力時 SHALL 回 400 `CAPABILITY_DISABLED`。

#### Scenario: 沒帶公開回覆
- **WHEN** 建立規則時不帶 `publicReply`
- **THEN** 讀回的 `publicReply.enabled` 是 false，`texts` 是空陣列

#### Scenario: 開啟公開回覆但沒有文字
- **WHEN** 規則 `publicReply` 是 `{ enabled: true, texts: [] }`
- **THEN** 回應 400，`details.field` 是 `publicReply`

#### Scenario: 平台未開放公開回覆
- **WHEN** 平台設定 `commentReply.capabilities.fbPublicReply` 為 false，FB 規則開啟公開回覆
- **THEN** 回應 400，`error.code` 是 `CAPABILITY_DISABLED`，`details.capability` 是 `fbPublicReply`

### Requirement: 規則的優先順序
同一則留言 SHALL 只套用依 `priority` 排序後第一條命中的啟用規則。`PUT /api/v1/comment-replies/rules/order` SHALL 只接受與「檢視者看得到且可編輯的規則」完全相同的集合；不一致時回 409 `RULE_ORDER_MISMATCH`、順序不變；ids 重複時回 400。

#### Scenario: 兩條規則都命中
- **WHEN** 規則 1（排第一）與規則 2 都命中同一則留言
- **THEN** 只產生 1 筆紀錄，`ruleId` 是規則 1，Meta 只收到 1 次私訊

#### Scenario: 調整順序後套用新的第一條
- **WHEN** 以 `PUT /rules/order` 把規則 2 排到最前，再收到另一則命中兩條規則的留言
- **THEN** 新紀錄的 `ruleId` 是規則 2

#### Scenario: 排序清單少一條
- **WHEN** `PUT /rules/order` 的 ids 少了一條看得到的規則
- **THEN** 回應 409，`error.code` 是 `RULE_ORDER_MISMATCH`，順序不變

### Requirement: 關鍵字比對方式
留言比對 SHALL 是包含比對，比對前把關鍵字與留言都做 NFKC 正規化並轉小寫。比對方式 `any` 時任一關鍵字出現即命中，`all` 時全部出現才命中。貼文範圍 `selected` 時只有指定貼文的留言會命中；`all` 時含規則建立後才發布的貼文。沒有文字的留言 SHALL NOT 命中。

#### Scenario: 全形半形與大小寫
- **WHEN** 規則關鍵字是 `+1` 與 `OK`，留言是「＋１」或「ok 好」
- **THEN** 都命中

#### Scenario: 全部關鍵字才命中
- **WHEN** 規則關鍵字是 `領券`、`台北`，比對方式 all，留言是「我要領券」
- **THEN** 不命中；留言「台北領券」則命中

#### Scenario: 短關鍵字包含比對
- **WHEN** 規則關鍵字是 `1`，留言是「100 元」
- **THEN** 命中

#### Scenario: 非指定貼文的留言
- **WHEN** 規則只指定貼文 P1，貼文 P2 的留言含關鍵字
- **THEN** 不命中

#### Scenario: 只有貼圖的留言
- **WHEN** 留言沒有文字
- **THEN** 不命中，也不丟錯

### Requirement: 規則試算不送出
`POST /api/v1/comment-replies/rules/test` SHALL 以與收件相同的比對函式，回傳會套用的規則或「不會觸發」，不建立紀錄、不呼叫 Meta。有 `comment_reply.view` 即可使用。

#### Scenario: 試算與收件結果相同
- **WHEN** 同一組渠道、貼文與文字分別送到 `POST /rules/test` 與 webhook
- **THEN** 試算回傳的 `ruleId` 與收件產生的紀錄 `ruleId` 相同，試算沒有產生紀錄

#### Scenario: 只有檢視權限試算
- **WHEN** 只有 `comment_reply.view` 的成員呼叫 `POST /rules/test`
- **THEN** 回應 200

### Requirement: 規則依渠道可見範圍顯示與編輯
規則的列表、讀取、修改、刪除、啟用切換 SHALL 依檢視者的渠道可見範圍：看不到的渠道的規則 SHALL 不出現在列表，直接讀取回 404 `RULE_NOT_FOUND`；只有 `read_only` 層級的渠道，規則 `canEdit` 為 false，修改回 403 `CHANNEL_ACCESS_DENIED`。其他租戶的規則 SHALL 回 404。

#### Scenario: 分店帳號只看到自己渠道的規則
- **WHEN** 成員只看得到渠道 A，呼叫 `GET /rules`
- **THEN** 回應只含渠道 A 的規則

#### Scenario: 讀看不到的渠道的規則
- **WHEN** 只看得到渠道 A 的成員以 `GET /rules/:id` 讀渠道 B 的規則
- **THEN** 回應 404，`error.code` 是 `RULE_NOT_FOUND`

#### Scenario: 唯讀層級修改規則
- **WHEN** 成員對渠道 A 只有 `read_only` 層級，以 `PATCH /rules/:id` 修改渠道 A 的規則
- **THEN** 回應 403，`error.code` 是 `CHANNEL_ACCESS_DENIED`

#### Scenario: 其他租戶的規則
- **WHEN** 租戶 A 的成員帶租戶 B 的規則 ID 呼叫 `GET /rules/:id`
- **THEN** 回應 404

### Requirement: 刪除規則為軟刪除
`DELETE /api/v1/comment-replies/rules/:id` SHALL 設定 `deletedAt`，不刪除資料列。已刪除的規則 SHALL NOT 命中留言、SHALL NOT 計入啟用規則數；它的觸發紀錄 SHALL 保留並顯示「（已刪除的規則）」。

#### Scenario: 刪除後不再命中
- **WHEN** 規則被刪除後，收到含其關鍵字的留言
- **THEN** 不產生紀錄，該規則先前的紀錄仍可在 `GET /logs` 查到
