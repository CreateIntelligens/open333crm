# Design

## Context

#337 第九批已把四組設定改成入口開交易（見分支的 refactor commit）：

- 營業時間：`settings/office-hours.routes.ts` → `office-hours.flow.ts` → `office-hours.service.ts`。收訊管線的 `inbound-side-effects.ts` 以管線的 client 組成 `TenantCtx`，呼叫 `getOutsideHoursMessage()`。
- API 金鑰與 CLI token：路由在 `settings/`，flow 與 service 在 `auth/`。CLI 登入與登出由 `auth.routes.ts` 呼叫 `cli-session.flow.ts` 的另一組 flow。

現況：

- 營業時間的 Zod schema 寫在路由檔，只檢查 `HH:mm` 的形狀，route 把結果以 `as any` 傳給 flow。
- `getOfficeHours()` 以 `as unknown as OfficeHoursConfig` 轉型已存的 JSON。
- `isWithinOfficeHours()` 以 `Intl.DateTimeFormat` 換算時區。時區不合法時拋出 `RangeError`，收訊管線接住錯誤，只記 log。

## Goals / Non-Goals

**Goals:**

- route 與 service 用同一份 schema 檢查營業時間。寫入時檢查，讀出時也檢查（AGENTS.md「Validation」）。
- 憑證的稽核與憑證的寫入在同一個交易。

**Non-Goals:**

- 前端顯示欄位的錯誤訊息（HC-SETTINGS-08）。
- 支援跨午夜的時段。
- CLI token 的 `scopes` 限制（RBAC-02）。
- 撤銷不存在的 CLI token 回 404（HC-SETTINGS-11 的後半）。
- 其他會建立 `TenantSettings` 的路徑（chat、embedding、identity-binding 設定）。

## Decisions

### 1. 營業時間的 schema 放在模組檔，route 與 service 共用

新增 `settings/office-hours-settings.ts`，內容是 `officeHoursSettingsSchema`（`{ timezone, officeHours }`）、型別與 `readOfficeHoursSettings(row)`。

- route 以 `officeHoursSettingsSchema.parse(body)` 檢查輸入，不再 `as any`。
- `getOfficeHours()` 以 `readOfficeHoursSettings()` 解析已存的 `timezone` 與 `officeHours`。不合法時回傳預設值，`enabled` 是 `false`。
- 做法比照 `portal/portal-settings.ts` 的 `readActivitySettings()`。

**時區與 `officeHours` 一起解析，任一個不合法就整份回傳預設值。** 另一個做法是只把不合法的時區換成 `Asia/Taipei`，保留其他欄位。但這樣會用成員沒有選的時區判斷營業時間，自動回覆的時間點可能跟成員預期的差好幾個小時。停用自動回覆不會送錯訊息給客人，是「不會造成傷害的預設值」。

**時區的檢查**：以 `new Intl.DateTimeFormat('en-US', { timeZone })` 試建立，拋錯就不合法。這是 `isWithinOfficeHours()` 實際使用的 API，所以「檢查通過」等於「換算不會拋錯」。另一個做法是比對 `Intl.supportedValuesOf('timeZone')`，但這份清單不含 `UTC` 等別名，會拒絕一些實際可用的值。

**日期的檢查**：以 `YYYY-MM-DD` 的格式比對後，用 `Date.UTC` 建立日期，再比對年、月、日沒有進位。這樣 `2026-02-30` 不合法，`2028-02-29` 合法。

### 2. 有效天數的 schema 放在各自的路由檔

`expiresInDays` 是 `z.number().int().min(1).max(365).nullable().optional()`。`0` 的錯誤訊息寫明範圍。API 金鑰與 CLI token 的規則相同，但兩個值的意義不同（null 代表永不過期或 30 天），所以兩個路由檔各寫自己的 schema，不共用。

### 3. 稽核由 flow 寫入

- 建立：flow 在交易外產生並雜湊，再在 `inTenant()` 內寫入憑證，接著呼叫 `recordTenantAudit()`。
- 撤銷 API 金鑰：service 用 `update`，找不到時拋出 P2025，回 404，不會寫到稽核。
- 撤銷 CLI token：service 改成回傳更新的筆數（`updateMany` 的 `count`），條件加上 `revokedAt: null`。已經撤銷的 token 不再更新，保留原本的撤銷時間。筆數是 0 時（不存在、另一個租戶、已經撤銷），flow 不寫稽核。回應維持 200 `{ revoked: true }`（Non-Goals）。
- CLI 登入與登出：`actorId` 是登入的成員，`ip` 是請求的 IP。登入的 flow 沒有 `RequestActor`，所以 route 另外傳入 IP。登出時撤銷的筆數是 0（兩次登出同時送出），不寫稽核。

`payload` 不放金鑰、token 的明文，也不放雜湊。

### 4. 設定頁與 CLI 登入用不同的 action

| 入口 | action | targetType | targetId |
| --- | --- | --- | --- |
| 設定頁建立、撤銷 API 金鑰與 CLI token | `settings.update`，`payload.section` 是 `api-keys` 或 `cli-sessions`，`payload.operation` 是 `create` 或 `revoke` | `settings` | 不填，id 放在 `payload` |
| CLI 登入、登出 | `cli_session.login`、`cli_session.logout` | `cli_session` | token 的 id |

- 設定頁的操作沿用 `settings.update`，與設定頁的其他稽核一致。
- CLI 登入與登出不是修改設定，所以另外命名，命名方式比照 `role.create` 這類「對象.動作」。`GET /tenant/audit-logs` 的 `action` 是完全相等的篩選，分開命名後，CLI 登入可以單獨查出。
- 不在 payload 記入口（例如 `source`）。登出撤銷的 token 可能是設定頁建立的，入口不能代表 token 的來源；要查 token 怎麼建立，用 token 的 id 找它的建立稽核。

## Risks / Trade-offs

- [已存的設定不合法的租戶，自動回覆停止] → 這些租戶的自動回覆原本就不正確：時區不合法時整個失效，跨午夜時營業時間內也會回覆。成員打開營業時間頁就會看到「未啟用」，重新設定後恢復。
- [跨午夜的時段，原本存得進去，現在回 400] → 手冊已寫明不支援。前端只顯示通用錯誤（HC-SETTINGS-08），成員可能看不出原因。記在 Non-Goals，由 HC-SETTINGS-08 處理。
- [CLI 登入多一次稽核寫入] → 寫入與 token 在同一個交易，登入的回應時間增加一次 INSERT。

## Migration Plan

沒有 migration。部署後，已存的不合法設定在讀取時回傳預設值；成員下一次儲存時覆蓋。回滾時，舊程式照舊讀取原本的資料，沒有資料需要還原。

## 審查基準

這個分支做 #337 第九批的搬遷，並修正補測試時發現的問題與這份 change 的範圍。搬遷前就存在、這次沒有改變的行為，記錄就好。已知不處理的項目見 Non-Goals。
