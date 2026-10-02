## ADDED Requirements

### Requirement: 拒絕 workers 尚未支援的動作
`create_case`、`remove_tag`、`assign_bot`、`kb_auto_reply`、`llm_reply` 在 workers 補上實作之前，規則編輯器 SHALL 不提供，新增或修改規則時 SHALL 拒絕；既有規則 SHALL 照常執行其他動作，只跳過這些動作，並在規則列表與編輯頁標示。

#### Scenario: 新增含不支援動作的規則
- **WHEN** 管理員新增或修改規則，動作含「建立工單」
- **THEN** 回傳 HTTP 400，訊息說明「建立工單」目前尚未支援自動執行

#### Scenario: 既有規則照常執行其他動作
- **WHEN** 既有的啟用規則含「傳送訊息」與「建立工單」，條件命中
- **THEN** workers 執行「傳送訊息」、跳過「建立工單」，規則不會整條被跳過

#### Scenario: 停用含不支援動作的規則
- **WHEN** 管理員只修改含不支援動作的規則的啟用狀態或名稱
- **THEN** 更新成功

#### Scenario: 規則列表標示
- **WHEN** 規則含不支援的動作
- **THEN** 規則列表在該規則旁顯示「含未支援的動作」，編輯頁說明哪些動作不會執行、儲存時會被移除
