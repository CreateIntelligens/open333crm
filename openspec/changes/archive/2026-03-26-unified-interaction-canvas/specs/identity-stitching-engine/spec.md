## ADDED Requirements

### Requirement: LIFF 身分碰撞 (LIFF Identity Collision)
系統必須在 LIFF 頁面載入時，自動比對瀏覽器 Cookie 與 LINE UID。若發現匹配的已知 Email/手機，必須自動建立關聯。

#### Scenario: 自動綁定 LINE 與 Email
- **WHEN** 已留過 Email 的用戶從 FB 連結點入 LINE LIFF 頁面
- **THEN** 系統偵測到 Cookie 中的 Email，並自動將當前的 LINE UID 與該 Email 聯繫人合併

### Requirement: AI 合併建議 (AI Merge Suggestions)
當系統發現多個聯繫人具備高度相似的資料（如：手機號碼相同但通路不同）時，系統必須產生一條合併建議。

#### Scenario: 提示管理員合併
- **WHEN** 系統偵測到兩個不同通路的聯繫人擁有相同手機號碼
- **THEN** 系統在管理後台顯示「身分合併建議」，等待管理員手動核准
