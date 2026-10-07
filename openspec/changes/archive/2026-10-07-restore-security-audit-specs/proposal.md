## Why

change `fix-security-audit-findings` 在 `aa274cf0` 以改名的方式搬進 `archive/`，delta spec 從來沒有套用（issue #228）。這個 change 的程式已經上線：socket 房間的訂閱要經伺服器授權、渠道憑證的加密不再使用預設金鑰、webhook 訂閱擋下內部網址。但是這些行為都沒有主規格，`docs/ref/system/AUDIT.md` 的「違反主規格的項目至少是 P2」對它們不起作用。

對照現行程式時發現 1 個問題：Workers 的 `apps/workers/src/lib/credentials.ts` 在缺少 `CREDENTIAL_ENCRYPTION_KEY` 時，仍然改用寫在原始碼裡的預設字串解密渠道憑證（AUDIT SEC-01）。API 已經在 `f507fe1` 修正，Workers 還沒有修正。

## What Changes

- 新增主規格 `socket-room-authorization`，4 條需求：連線時加入的房間、訂閱目標的格式、訂閱房間的授權、訂閱次數的限制。
- 新增主規格 `credential-encryption`，1 條需求：缺少加密金鑰時拒絕加解密。
- 新增主規格 `webhook-subscription-egress`，2 條需求：訂閱網址必須是公開的 HTTPS 位址、派送前重新檢查網址且不跟隨轉址。
- 修正 SEC-01：Workers 缺少 `CREDENTIAL_ENCRYPTION_KEY`，或金鑰短於 32 個字元時，解密拋出錯誤，不使用預設字串。
- `socket.plugin.ts` 處理房間的程式移到 `apps/api/src/modules/socket/socket-room-handlers.ts`，行為不變。原本的程式是 `connection` 事件裡的匿名函式，單元測試驗證不到「拒絕時不加入房間」。
- 歸檔規格的寫法與決定：
  - 不補回 `security/dependency-vulnerability-management`。這 3 條需求描述團隊處理套件弱點的流程，不是系統的行為，寫不出測試。#224 以同樣的理由移除了主規格 `dependency-vulnerability-remediation`。
  - `security/legacy-webchat-abuse-controls` 與 `webchat-widget` 的 3 條 MODIFIED 由另一個 change 處理。
  - capability 名稱不使用 `security/` 這一層目錄。`openspec/specs/` 底下的主規格都是單層目錄。
  - 「憑證加密」只寫可以測試的部分：缺少金鑰時拒絕、有金鑰時可以還原。歸檔規格的「不在日誌與回應中暴露明文」沒有寫進主規格，因為沒有測試可以驗證「任何地方都不輸出」。
  - Workers 啟動時不檢查金鑰，第一次解密時才失敗。歸檔規格允許兩者擇一（「environment validation or the first credential operation fails clearly」），所以主規格照現行程式寫。
  - 歸檔規格的「重複訂閱超過上限時記錄安全事件」，現行程式是寫一筆 warn 等級的日誌，主規格照這個寫。

## Capabilities

### New Capabilities

- `socket-room-authorization`：成員的 Socket.IO 連線加入哪些房間、訂閱與取消訂閱的格式、授權與次數限制。
- `credential-encryption`：渠道憑證加解密使用的金鑰。
- `webhook-subscription-egress`：webhook 訂閱的網址檢查與派送。

### Modified Capabilities

（無）

## Impact

- `apps/workers/src/lib/credentials.ts`：修正 SEC-01。
- `apps/api/src/plugins/socket.plugin.ts`、新增 `apps/api/src/modules/socket/socket-room-handlers.ts`：房間處理移出 plugin。
- `docs/ref/system/AUDIT.md` 的 SEC-01 與 `docs/ref/system/AUDIT-REVIEWS.md`。
- `CHANGELOG.md`：SEC-01 的修正。
- 歸檔後，3 份新主規格的 Purpose 是 CLI 產生的佔位文字，要手動改寫。
