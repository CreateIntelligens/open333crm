## MODIFIED Requirements

### Requirement: 停用租戶的進站事件直接丟棄
渠道所屬的租戶停用（含試用到期自動停用）時，即使渠道本身仍啟用，系統 SHALL 丟棄該渠道收到的進站事件：不建立渠道身分、聯絡人、對話與訊息，只記錄 warn log。所有渠道共用的進站入口 `processInboundMessage` SHALL 做這個檢查；查不到租戶時視為停用。webhook 在驗簽之前也提早丟棄。

租戶停用是預期內的情況，不是錯誤。LINE 的 webhook 路由 SHALL 照常回 HTTP 200，平台不會因此重送事件。

#### Scenario: 停用租戶的渠道收到訊息
- **WHEN** 租戶已停用、渠道仍啟用，渠道收到一則簽章正確的訊息事件
- **THEN** 系統沒有建立渠道身分、聯絡人、對話與訊息；同時間啟用中租戶的渠道收到的訊息照常建立渠道身分

#### Scenario: LINE 的 webhook 路由照常回 200
- **WHEN** 租戶已停用，該租戶的 LINE 渠道收到一則簽章正確的 webhook 請求
- **THEN** 路由回 HTTP 200

#### Scenario: 共用入口 processInboundMessage 丟棄停用租戶的進站事件
- **WHEN** 租戶已停用，呼叫端直接以該租戶的渠道呼叫 `processInboundMessage` 處理一則文字訊息
- **THEN** `processInboundMessage` 回傳 `undefined`，沒有建立渠道身分與訊息

## ADDED Requirements

### Requirement: 停用租戶的網站聊天室入口回 404
租戶停用（含試用到期自動停用）時，網站聊天室建立工作階段、送訊息、bootstrap 與訪客 socket（`/visitor`）驗證工作階段 SHALL 比照渠道停用回 HTTP 404，`error.code` 是 `NOT_FOUND`。系統 SHALL NOT 建立聯絡人、對話或訊息。租戶啟用時行為不變。

#### Scenario: 啟用中的租戶：訪客送訊息照常寫入（對照組）
- **WHEN** 租戶啟用中，訪客以認領過的工作階段送一則文字訊息
- **THEN** 系統寫入一則進站訊息

#### Scenario: 既有的工作階段在租戶停用後送訊息
- **WHEN** 訪客在租戶啟用時開了工作階段，租戶停用之後訪客以同一個工作階段送一則文字訊息
- **THEN** 系統回 404 `NOT_FOUND`，沒有寫入訊息

#### Scenario: 租戶停用後新訪客建立工作階段
- **WHEN** 租戶已停用，新訪客以渠道公開金鑰建立工作階段
- **THEN** 系統回 404 `NOT_FOUND`，沒有建立聯絡人與對話

#### Scenario: 租戶停用後訪客 socket 驗證工作階段
- **WHEN** 租戶停用之後，訪客以既有的工作階段與認領憑證連線 `/visitor`
- **THEN** 驗證工作階段回 404 `NOT_FOUND`，連線被拒
