## 1. 測試

測試名稱以情境名稱開頭。描述現行行為的測試寫好時就通過，所以這些測試改以突變驗證（第 4 節）。描述 bug 的測試先在修正前執行，確認以斷言失敗。

測試檔的簡稱：

- `handlers`：`apps/api/tests/unit/modules/socket/socket-room-handlers.test.ts`
- `authz`：`apps/api/tests/unit/modules/socket/socket-room-authorization.test.ts`
- `api-cred`：`apps/api/tests/unit/modules/channel/channel-credential-security.test.ts`
- `wk-cred`：`apps/workers/tests/unit/lib/credentials.test.ts`
- `egress`：`apps/api/tests/unit/modules/webhook-subscriptions/webhook-subscription-egress.test.ts`

**`socket-room-authorization`**

| 需求 | 情境 | 測試 | 修正前 |
| --- | --- | --- | --- |
| 連線時加入的房間 | 連線後加入自己的租戶與成員房間 | `handlers` | 通過 |
| 訂閱目標的格式 | 不認得的房間名稱 | `authz`（兩個測試）、`handlers` | 通過 |
| 訂閱目標的格式 | 以物件格式訂閱 | `authz`、`handlers` | 通過 |
| 訂閱目標的格式 | 取消訂閱 | `handlers` | 通過 |
| 訂閱房間的授權 | 訂閱自己的租戶房間 | `authz` | 通過 |
| 訂閱房間的授權 | 訂閱其他租戶的房間 | `authz` | 通過 |
| 訂閱房間的授權 | 沒有 channel.view_all 時訂閱其他成員的房間 | `authz` | 通過 |
| 訂閱房間的授權 | 有 channel.view_all 時訂閱其他成員的房間 | `authz` | 通過 |
| 訂閱房間的授權 | 訂閱不屬於自己的團隊 | `authz` | 通過 |
| 訂閱房間的授權 | 訂閱權限範圍內的對話 | `authz` | 通過 |
| 訂閱房間的授權 | 訂閱其他租戶或不存在的對話 | `authz`；授權回 FORBIDDEN 時不加入房間另見 `handlers` | 通過 |
| 訂閱房間的授權 | 對話的渠道看不到 | `authz` | 通過 |
| 訂閱房間的授權 | 團隊對話不因渠道看得到而放行 | `authz` | 通過 |
| 訂閱次數的限制 | 超過訂閱次數 | `handlers` | 通過 |
| 訂閱次數的限制 | 計算區間結束後恢復 | `handlers` | 通過 |

**`credential-encryption`**

| 需求 | 情境 | 測試 | 修正前 |
| --- | --- | --- | --- |
| 缺少加密金鑰時拒絕加解密 | API 啟動時缺少金鑰 | `api-cred` | 通過 |
| 缺少加密金鑰時拒絕加解密 | API 加密時金鑰缺少或太短 | `api-cred` | 通過 |
| 缺少加密金鑰時拒絕加解密 | Workers 解密時金鑰缺少或太短 | `wk-cred` | 失敗：`Missing expected exception`，Workers 改用原始碼裡的字串解密（SEC-01） |
| 缺少加密金鑰時拒絕加解密 | 有金鑰時加密後可以還原 | `api-cred`、`wk-cred` | 通過 |

**`webhook-subscription-egress`**

| 需求 | 情境 | 測試 | 修正前 |
| --- | --- | --- | --- |
| 訂閱網址必須是公開的 HTTPS 位址 | 建立時網址指向雲端 metadata | `egress` | 通過 |
| 訂閱網址必須是公開的 HTTPS 位址 | 建立時網址不是 HTTPS | `egress` | 通過 |
| 訂閱網址必須是公開的 HTTPS 位址 | 建立時主機無法解析 | `egress` | 通過 |
| 訂閱網址必須是公開的 HTTPS 位址 | 更新時網址指向內部位址 | `egress` | 通過 |
| 訂閱網址必須是公開的 HTTPS 位址 | 建立時網址是公開的 HTTPS 位址 | `egress` | 通過 |
| 派送前重新檢查網址，且不跟隨轉址 | 派送時網址指向內部位址 | `egress` | 通過 |
| 派送前重新檢查網址，且不跟隨轉址 | 目的地回應轉址 | `egress` | 通過 |

- [x] 1.1 寫上表的測試，確認標「失敗」的 1 個測試在修正前以斷言失敗

## 2. 修正與重構

- [x] 2.1 `apps/workers/src/lib/credentials.ts`：金鑰缺少或短於 32 個字元時拋出錯誤（SEC-01）
- [x] 2.2 Workers 的 `rich-menu-bind`、`automation-keyword-reply`、`delivery-failure-record` 三個測試原本在沒有金鑰時以同一個字串加密假憑證，改為在測試檔設定測試用的金鑰
- [x] 2.3 `socket.plugin.ts` 處理房間的程式移到 `apps/api/src/modules/socket/socket-room-handlers.ts`，plugin 改呼叫 `registerRoomHandlers()`。移動前沒有測試涵蓋這段程式，因為這段程式是 `connection` 事件裡的匿名函式，所以以逐行對照確認內容不變：日誌訊息、`subscribe` 與 `unsubscribe` 共用的計數、拒絕與例外時的回應都保留

## 3. 文件

- [x] 3.1 `docs/ref/system/AUDIT.md` 移除 SEC-01；`docs/ref/modules/CHANNEL-PLUGINS.md` 與 `docs/ref/features/tenant/CHANNELS.md` 移除指向 SEC-01 的內容
- [x] 3.2 `docs/ref/system/AUDIT-REVIEWS.md` 新增複查紀錄
- [x] 3.3 `CHANGELOG.md` 新增 SEC-01 的修正

## 4. 突變驗證

每個突變改壞一處程式，執行對應的測試，確認測試失敗後還原。

| 檔案 | 突變 | 抓到的測試 |
| --- | --- | --- |
| `socket-room-handlers.ts` | 不加入租戶房間 | 連線後加入自己的租戶與成員房間 |
| `socket-room-handlers.ts` | 授權拒絕後不 `return`，繼續加入房間 | 不認得的房間名稱；授權回 FORBIDDEN 時不加入房間 |
| `socket-room-handlers.ts` | `unsubscribe` 改成加入房間 | 取消訂閱 |
| `socket-room-handlers.ts` | 不檢查次數 | 超過訂閱次數 |
| `socket-room-handlers.ts` | 超過次數時不寫 warn 日誌 | 超過訂閱次數 |
| `socket-subscription-rate-limit.ts` | 計算區間結束後不重新計算 | 計算區間結束後恢復 |
| `socket-room-authorization.ts` | 字串格式的 ID 不檢查 UUID | 不認得的房間名稱 |
| `socket-room-authorization.ts` | 物件格式不檢查類型 | 不認得的房間名稱 |
| `socket-room-authorization.ts` | 不接受物件格式 | 以物件格式訂閱 |
| `socket-room-authorization.ts` | `tenant` 一律拒絕 | 訂閱自己的租戶房間 |
| `socket-room-authorization.ts` | `tenant` 一律放行 | 訂閱其他租戶的房間 |
| `socket-room-authorization.ts` | 其他成員的房間不需要 `channel.view_all` | 沒有 channel.view_all 時訂閱其他成員的房間 |
| `socket-room-authorization.ts` | 有 `channel.view_all` 也不能訂閱其他成員的房間 | 有 channel.view_all 時訂閱其他成員的房間 |
| `socket-room-authorization.ts` | 團隊不檢查成員 | 訂閱不屬於自己的團隊 |
| `socket-room-authorization.ts` | 查詢對話時不帶租戶 | 訂閱其他租戶或不存在的對話 |
| `socket-room-authorization.ts` | 不檢查對話的渠道 | 對話的渠道看不到 |
| `socket-room-authorization.ts` | 團隊對話不檢查團隊 | 團隊對話不因渠道看得到而放行 |
| `socket-room-authorization.ts` | 對話一律拒絕 | 訂閱權限範圍內的對話 |
| `config/env.ts` | `CREDENTIAL_ENCRYPTION_KEY` 改為選填 | API 啟動時缺少金鑰 |
| `channel.service.ts` | 金鑰缺少時改用固定字串 | API 加密時金鑰缺少或太短 |
| `channel.service.ts` | 金鑰推導多加一個字元 | 有金鑰時加密後可以還原 |
| Workers `credentials.ts` | 不檢查長度 | Workers 解密時金鑰缺少或太短 |
| Workers `credentials.ts` | 金鑰推導改用其他 salt | 有金鑰時加密後可以還原 |
| `webhook-subscription.routes.ts` | 建立時不檢查網址 | 建立時網址指向雲端 metadata、不是 HTTPS、主機無法解析 |
| `webhook-subscription.routes.ts` | 更新時不檢查網址 | 更新時網址指向內部位址 |
| `downstream-forwarder.ts` | 也接受 `http` | 建立時網址不是 HTTPS |
| `downstream-forwarder.ts` | DNS 解析失敗時放行 | 建立時主機無法解析 |
| `downstream-forwarder.ts` | 公開位址也擋下 | 建立時網址是公開的 HTTPS 位址 |
| `webhook-dispatcher.ts` | 派送前不檢查網址 | 派送時網址指向內部位址 |
| `webhook-dispatcher.ts` | `redirect` 改為 `follow` | 目的地回應轉址 |

第一輪有 2 個突變沒被抓到，都是測試的問題，修正測試後重跑通過：

- 授權拒絕後繼續加入房間：原本只檢查對話房間不在連線的房間裡，但突變後加入的是 `undefined`。改為檢查連線的房間完全不變。
- API 的金鑰推導改錯：API 的加密與解密用同一個推導，往返仍然成功。改為另外以 Workers 的做法解密 API 加密的內容。

跑突變之前，另外修正了一個 mock：原本的 mock 只在查詢帶租戶 B 時回傳對話，查詢不帶租戶時也回傳空值，「查詢對話時不帶租戶」這個突變會抓不到。mock 改成與資料庫相同，不帶租戶時查得到其他租戶的對話。

- [x] 4.1 執行上表的突變，每個突變都讓對應的測試失敗

## 5. 歸檔

- [x] 5.1 `node scripts/validate-openspec.mjs restore-security-audit-specs` 通過，以 `pnpm exec openspec archive` 歸檔
- [x] 5.2 改寫 3 份新主規格的 Purpose
