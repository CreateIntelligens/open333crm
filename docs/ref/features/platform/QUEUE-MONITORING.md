# 佇列監控

佇列監控讓平台管理員查看 API 與 workers 兩個行程的所有 BullMQ 佇列：每個佇列有哪些工作、哪些工作失敗、失敗原因是什麼。管理員可以重送單一個失敗的工作。工作重試用完時，系統發出維運告警。

畫面是 [bull-board](https://github.com/felixmosh/bull-board)，掛在 API 行程的 `/api/v1/platform/queues`。系統只放行讀取與單筆重送，其他操作一律拒絕。

- **資料來源**：`apps/api/src/modules/queue-monitoring/*`、`apps/api/src/modules/ops-alert/*`、`apps/web/src/app/admin/lib/QueueMonitorLink.tsx`、`openspec/specs/queue-monitoring/`、`openspec/specs/ops-alert/`（設計決策見 `openspec/changes/archive/2026-10-27-queue-monitoring/design.md`）
- **核對日期**：2026-10-22

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| 怎麼開啟監控畫面？為什麼回 403 或 401？ | [怎麼進入](#怎麼進入) |
| 畫面上可以做什麼？哪些按鈕按了沒反應？ | [可以做什麼](#可以做什麼) |
| 重送一個工作，副作用會再執行一次嗎？ | [重送與認領](#重送與認領) |
| 什麼時候發出告警？告警送到哪裡？ | [告警](#告警) |
| 要設定哪些環境變數？ | [設定](#設定) |

## 怎麼進入

1. 平台管理員在平台後台的側邊欄點「佇列監控」。
2. 前端以平台 JWT 呼叫 `POST /api/v1/platform/queues/session`，API 設定監控 cookie。
3. 前端在新分頁開啟 `/api/v1/platform/queues`。

每個請求依序經過兩項檢查：

| 檢查 | 不通過時 | 說明 |
| --- | --- | --- |
| 來源 IP 在 `QUEUE_DASHBOARD_ALLOWED_CIDRS` 的網段內 | 403 `FORBIDDEN` | 畫面、靜態檔、API 與換發 cookie 的端點都檢查。沒有設定這個變數時，所有請求都回 403 |
| 換發端點：平台 JWT 有效，平台帳號存在、沒有停用、不需改密碼 | 401 或 403，與其他平台路由相同 | 租戶的 JWT 回 401 |
| 其他路徑：請求帶 `Origin` 時與監控畫面同一個來源 | 403 `FORBIDDEN` | `SameSite=Strict` 擋不住同一個上層網域的其他子網域，全域 CORS 又接受任何來源，所以監控路徑自己檢查 |
| 其他路徑：監控 cookie 的簽章正確、沒有過期，平台帳號存在、沒有停用、不需改密碼 | 401 `UNAUTHORIZED`、401 `PLATFORM_USER_DISABLED` 或 403 `MUST_CHANGE_PASSWORD` | 每個請求都即時查平台帳號，帳號停用後立即生效 |

來源 IP 依 API 的受信任代理設定計算（`apps/api/src/lib/trust-proxy.ts`）。請求自帶的 `X-Forwarded-For` 不會讓網段外的連線通過。

監控 cookie 的性質：

- `HttpOnly`、`SameSite=Strict`，`Path` 是 `/api/v1/platform/queues`，有效 1 小時。過期後從平台後台再點一次「佇列監控」。
- 簽章金鑰由 `PLATFORM_JWT_SECRET` 衍生，與平台 JWT 不同。監控 cookie 不能當作平台 JWT 呼叫其他平台路由；平台 JWT 也不能取代監控 cookie。

## 可以做什麼

| 操作 | 結果 |
| --- | --- |
| 查看佇列、工作清單、工作細節、失敗原因與 stack、排程 | 放行 |
| 查看工作的 log | 403。log 是 processor 寫的任意文字，無法遮蔽 |
| 重送一個狀態是 failed 的工作 | 放行，並寫入平台稽核。實際重送時以 Redis 原子地確認工作仍在 failed set，兩個重送請求同時送出時只有一個生效 |
| 重送一個 completed 的工作 | 403 |
| 重送整個狀態、清除、清空、刪除佇列、暫停、提前執行、修改工作資料或排程、新增工作 | 403 |

bull-board 的畫面仍顯示這些按鈕，按下後畫面顯示錯誤。讀取與寫入都只列出放行的操作，所以 bull-board 升級後新增的操作也會回 403。升級 bull-board 時，要重新核對讀取的放行清單（`operation-allowlist.ts` 的 `ALLOWED_READ_ROUTES`）。

工作資料只顯示識別欄位：最上層的 `name`、`type`，以及任一層名稱為 `id` 或以 `Id` 結尾的欄位。其他欄位顯示為 `[已遮蔽]`，之後新增的欄位也一樣。排程範本的資料依同樣規則遮蔽。失敗原因與 stack 照常顯示，所以可能帶出對方伺服器回應的內容。

重送成功時，API 寫入一筆 `PlatformAuditLog`：action 是 `queue.job.retry`，targetType 是 `queue_job`，targetId 是 `<佇列名稱>:<工作 id>`。被拒絕的請求不寫入稽核。

## 重送與認領

不能重複的副作用（對客人發訊息、規則動作等）執行前先寫一筆認領紀錄，見[事件與背景工作](../../modules/EVENTS.md)的「副作用的認領紀錄」。重送一個工作時，已經認領過的副作用不會再執行。

3 個訂閱者佇列與 `automation` 佇列的工作，回傳值列出這次被認領擋下的副作用：

```json
{ "skippedClaims": [{ "kind": "automation_action", "sourceId": "<事件 id>", "subKey": "<規則 id>#0" }] }
```

沒有副作用被跳過時，回傳值是空的。管理員在工作細節的回傳值看得出哪些副作用沒有再執行。

## 告警

任何佇列（`ops-alert` 除外）的工作移到 failed set 時，API 發出一則告警。重試用完、或工作丟出不可重試的錯誤，都算移到 failed set；還會重試的失敗不告警。

| 項目 | 內容 |
| --- | --- |
| 合併 | 合併鍵是 `queue-failed:<佇列名稱>`。同一個合併鍵 10 分鐘內只送一則；下一則帶上這段期間沒有送出的次數 |
| 內容 | 佇列名稱、工作名稱、工作 id、租戶 id、重試次數與監控畫面的連結。不帶失敗原因與工作資料，兩者都可能含客人的個資 |
| 管道 | 設定 `OPS_ALERT_SLACK_WEBHOOK_URL` 時送到 Slack，否則只寫 log |
| 送出 | 告警經 `ops-alert` 佇列送出，失敗時重試 3 次。保證是至少一次：Slack 收下之後、工作完成之前中斷時，同一則告警會再送一次 |
| 例外 | `ops-alert` 自己的工作重試用完時只寫 log，不再發出告警 |
| 遺漏 | API 停機期間移到 failed set 的工作不會告警。這些工作在 failed set 保留 7 天，監控畫面看得到 |

## 設定

兩個環境變數都寫在 `.env.api`，說明見 `.env.api.example`：

| 變數 | 沒有設定時 |
| --- | --- |
| `QUEUE_DASHBOARD_ALLOWED_CIDRS` | 監控畫面的所有請求回 403，其他平台功能不受影響 |
| `OPS_ALERT_SLACK_WEBHOOK_URL` | 告警只寫 log |

任一個網段格式錯誤時，API 記一行 error log，並把整份清單視為空清單。格式正確的網段是 `<IP 位址>/<十進位前綴>`，例如 `60.248.142.0/24`；`60.248.142.0/` 這類空白前綴也算格式錯誤。

本機以 Docker 執行時，瀏覽器的連線經 Docker 網路的閘道進入容器，API 看到的來源 IP 是閘道的位址（例如 `172.18.0.1`），不是 `127.0.0.1`。`.env.api.example` 因此寫 `172.16.0.0/12`。UAT 與正式環境的來源 IP 是 nginx 附加的使用者 IP，要設定公司網段。
