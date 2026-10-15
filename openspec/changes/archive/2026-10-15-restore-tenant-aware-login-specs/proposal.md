## Why

change `add-tenant-aware-login` 在 `aa274cf0` 以改名的方式搬進 `archive/`（issue #228）。它的 delta 用 `MODIFIED`，但 4 條需求的名稱都不在主規格 `auth-session` 裡，所以從來沒有套用。

程式已經實作這 4 條需求，但沒有一條寫進主規格。主規格 `trial-lifecycle` 寫著試用到期後「套用既有停用行為：登入回 `TENANT_DISABLED`、inbound 訊息被丟棄」，這個「既有停用行為」目前沒有任何主規格定義。這個 change 補上這些定義。

## What Changes

- `auth-session` 新增 3 條需求：
  - 登入依 email 解析所屬租戶。
  - 停用租戶的成員不能登入或換發 token。
  - 停用租戶的長效憑證與既有連線失效。現況違反這一條，見下方 AUDIT AUTH-02。
- `inbound-message-processing` 新增 1 條需求：停用租戶的進站事件直接丟棄。
- 新增測試 `apps/api/tests/feature/modules/auth/tenant-disabled-access.test.ts`。
- `AUDIT.md` 的 AUTH-02 補上規格依據，DB-03 註明每日統計的需求沒有補回。
- `agent.service.ts` 的 `createAgent()`：修正註解。程式行為不變。

### 歸檔需求的處理方式

| 歸檔的需求 | 處理 |
| --- | --- |
| Login resolves tenant from globally-unique email | 新增「登入依 email 解析所屬租戶」。歸檔規格寫 `createAgent()` 先以 `findUnique({ email })` 全域檢查再回 409。實際上路由以綁定租戶的連線呼叫 `createAgent()`，在 RLS 生效的環境，這個檢查看不到其他租戶的成員。擋下重複的是資料庫的唯一約束（P2002），再由 `error-handler.plugin.ts` 轉成 409 `CONFLICT`。結果相同，所以需求只寫外部看得到的結果，並修正 `createAgent()` 的註解 |
| Disabled tenant is blocked from login | 新增「停用租戶的成員不能登入或換發 token」。現行程式先驗證密碼，密碼正確才回 `TENANT_DISABLED`，避免不知道密碼的人確認某個 email 屬於停用的租戶。歸檔規格沒有規定順序，需求照現行程式寫。歸檔規格只涵蓋登入；需求另外寫入 refresh 換發與 REST access token 的最長延遲 |
| （無對應） | 新增「停用租戶的長效憑證與既有連線失效」。停用租戶應該擋下所有存取，所以需求照應有的行為寫。CLI token、Partner API 金鑰與既有的 socket 連線目前都不受影響，已記錄在 AUDIT AUTH-02。這條需求的情境要等 AUTH-02 修正後才有測試 |
| Disabled tenant inbound webhooks are dropped | 新增 `inbound-message-processing` 的「停用租戶的進站事件直接丟棄」 |
| Daily analytics aggregation runs per active tenant | **不補回。** 排程每天為每個啟用中的租戶寫入 `DailyStat`，但報表都在查詢當下從原始資料表計算，沒有程式讀 `DailyStat`（AUDIT DB-03）。補回等於把一段沒有用途的計算寫成必須維持的行為。報表改讀 `DailyStat` 或刪除排程，屬於 DB-03 的決定 |

REST 的 access token 在停用後最多仍可使用一個有效期（預設 15 分鐘）。這是刻意接受的延遲：停用租戶的典型情境是欠費停權，15 分鐘可以接受。AUTH-03、AUTH-08 的撤銷機制完成後，可以再縮短這個延遲。

歸檔 change 的任務 7.2（租戶自助開通）已由主規格 `tenant-provisioning` 涵蓋；7.3（部署前檢查跨租戶重複的 email）在 migration 套用到 UAT 時已經完成。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `auth-session`：新增登入解析租戶與停用租戶的 3 條需求。
- `inbound-message-processing`：新增停用租戶的進站事件直接丟棄。

## Impact

- `openspec/specs/auth-session/spec.md`、`openspec/specs/inbound-message-processing/spec.md`（歸檔時套用）
- `apps/api/tests/feature/modules/auth/tenant-disabled-access.test.ts`（新增）
- `apps/api/src/modules/agent/agent.service.ts`（只改註解）
- `docs/ref/system/AUDIT.md`、`docs/ref/system/AUDIT-REVIEWS.md`
