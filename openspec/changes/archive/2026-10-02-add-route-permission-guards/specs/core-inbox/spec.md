## ADDED Requirements

### Requirement: 對話、標籤、短連結路由依權限碼授權
對話、標籤、短連結路由 SHALL 依 proposal 對照表檢查權限碼，缺少時回傳 HTTP 403；具備該權限碼（含其依賴的權限碼）時 SHALL 通過權限檢查。

#### Scenario: 只能檢視的角色送訊息
- **WHEN** 只有 `inbox.view` 的成員呼叫 `POST /conversations/:id/messages`
- **THEN** 回傳 HTTP 403

#### Scenario: 具備需要的權限碼
- **WHEN** 成員只具備某條路由需要的權限碼（含依賴）
- **THEN** 通過權限檢查（資料不存在時回 404 等，不回 403）
