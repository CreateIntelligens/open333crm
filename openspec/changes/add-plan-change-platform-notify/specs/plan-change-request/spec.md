## ADDED Requirements

### Requirement: 新申請寄信通知平台帳號
租戶成功送出方案異動申請後，系統 SHALL 寄一封信給每個 `isActive=true` 的平台帳號，MUST NOT 寄給停用的平台帳號。信中 SHALL 有租戶名稱、類型（「升級方案」或「加購 Token」）、內容（升級寫目標方案的名稱，加購寫加購量）、租戶備註（沒有備註時寫「未填寫」），以及 `${WEB_BASE_URL}/admin/plan-changes` 的連結。

申請被拒絕（409、400、404）時，系統 MUST NOT 寄信。

#### Scenario: 送出加購申請後寄信給啟用中的平台帳號
- **GIVEN** 平台有兩個啟用中的帳號與一個停用的帳號，租戶名稱是「好物商行」
- **WHEN** 租戶成員送出 `type=token_topup`、`topupTokens=500000`、`note=AI 快用完了`
- **THEN** 系統寄出兩封信，收件人是兩個啟用中的帳號，沒有寄給停用的帳號
- **AND** 每封信含「好物商行」、「加購 Token」、「500,000」、「AI 快用完了」與 `${WEB_BASE_URL}/admin/plan-changes`

#### Scenario: 升級申請的信寫出目標方案名稱
- **GIVEN** 方案 `standard` 的名稱是「標準版」
- **WHEN** 租戶成員送出 `type=upgrade`、`targetPlanSlug=standard`，沒有備註
- **THEN** 信中含「升級方案」、「標準版」與「未填寫」

#### Scenario: 申請被拒絕時不寄信
- **GIVEN** 租戶已經有一筆 `pending` 的申請
- **WHEN** 租戶成員再送出一筆申請
- **THEN** 系統回應 409，沒有寄出任何信

### Requirement: 通知信寄送失敗不影響申請且留下稽核紀錄
寄送通知信 MUST NOT 延遲或改變申請的回應：任一封信寄送失敗時，申請仍 SHALL 成功建立並回應 200，其他收件人的信照常寄出。

每次寄送通知後，系統 SHALL 寫一筆平台稽核紀錄：`action` 是 `plan_change.notify_platform`，`targetType` 是 `plan_change_request`，`targetId` 是申請的 id，`platformUserId` 是 null（系統動作）。`payload` SHALL 含收件人數、寄出數，以及每個寄送失敗的收件人 email 與失敗原因。沒有啟用中的平台帳號時，系統也 SHALL 寫這筆紀錄，收件人數是 0。

#### Scenario: 一封信寄送失敗時申請仍成功
- **GIVEN** 平台有兩個啟用中的帳號，寄給其中 `ops@example.com` 的信會失敗，原因是「SMTP timeout」
- **WHEN** 租戶成員送出加購申請
- **THEN** 系統回應 200，租戶有一筆 `pending` 的申請
- **AND** 另一個帳號收到通知信
- **AND** 平台稽核有一筆 `plan_change.notify_platform`，`targetId` 是這筆申請，`payload` 的收件人數是 2、寄出數是 1，失敗清單是 `ops@example.com` 與「SMTP timeout」

#### Scenario: 沒有啟用中的平台帳號
- **GIVEN** 平台所有帳號都已停用
- **WHEN** 租戶成員送出申請
- **THEN** 系統回應 200，沒有寄出任何信
- **AND** 平台稽核有一筆 `plan_change.notify_platform`，`payload` 的收件人數是 0

### Requirement: 平台側欄顯示待審申請數量
平台後台側欄的「升級申請」SHALL 顯示 `GET /api/v1/platform/plan-change-requests` 回傳的待審申請數量。沒有待審申請時，系統 MUST NOT 顯示數量。平台管理員在升級申請頁核准或駁回申請後，側欄的數量 SHALL 更新。

#### Scenario: 有待審申請時顯示數量
- **GIVEN** 有 2 筆 `pending` 的申請
- **WHEN** 平台管理員打開平台後台
- **THEN** 側欄的「升級申請」旁顯示 2

#### Scenario: 沒有待審申請時不顯示數量
- **GIVEN** 沒有 `pending` 的申請
- **WHEN** 平台管理員打開平台後台
- **THEN** 側欄的「升級申請」旁沒有數量

#### Scenario: 審核後數量更新
- **GIVEN** 有 2 筆 `pending` 的申請，側欄顯示 2
- **WHEN** 平台管理員在升級申請頁核准其中一筆
- **THEN** 側欄的「升級申請」旁顯示 1
