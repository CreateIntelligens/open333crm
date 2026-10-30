# 治理：稽核、匯出與資料刪除 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入後以 `/auth/me` 確認，只讀）
- 範圍：`docs/ref/features/feature-map.json` 的 `governance`；功能文件 `docs/ref/features/tenant/GOVERNANCE.md`。MCP、API 金鑰與 CLI token 的流程歸「設定」領域（`docs/ref/features/health/SETTINGS.md`），本報告只看它們有沒有寫稽核

這一組功能**沒有任何前端頁面**，也沒有 CLI 指令，只能直接呼叫 API。所以「實際操作」全部以 API 執行，沒有瀏覽器流程；「前端是否隱藏」一欄都不適用。

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 4 份 spec、59 個 scenario（tenant-audit-log 10、tenant-data-export 15、tenant-data-erasure 21、webhook-subscription-egress 13）。每個 scenario 都找得到同名測試，沒有缺實作。缺前端入口：全部（稽核查詢、匯出、刪除、Webhook 訂閱都沒有頁面；匯出完成通知連到 404 頁，EXPORT-01） |
| 自動測試 | unit：api 6 檔 52 通過、workers 3 檔 8 通過。feature：8 檔 48 通過（`modules/tenant-audit modules/data-export modules/data-erasure modules/webhook-subscriptions modules/mcp`）。無失敗、無 skip |
| 實際操作 | 12 條流程。正常 4，異常 6，未驗或只讀程式 2 |

### 敏感操作的稽核盤點

以本機實際操作後查 `tenant_audit_logs` 確認（「實測」），或讀程式確認呼叫端（「讀程式」）。

| 有寫稽核 | `action` |
| --- | --- |
| 成員 | `agent.create`、`agent.role.assign`、`agent.password.reset`、`agent.deactivate`、`agent.reactivate`、`agent.purge`、`agent.channels.set`（實測） |
| 角色 | `role.create`、`role.rename`、`role.delete`、`role.permission.update`（實測；功能文件寫「沒有」，已過時） |
| 渠道 | `channel.create`、`channel.delete`、`channel.assign_team`、`channel.revoke_team`；Meta 一鍵串接另寫 `channel.update`（讀程式） |
| 設定 | `settings.update`，`payload.section` 為 office-hours、tracking、identity-binding、embedding、chat、gemini-key、webtalk |
| 聯絡人 | `contact.merge`、`contact.merge_revert`、`contact.binding_link_send`、`contact.email_registration_link_send`、`contact.phone_registration_link_send` |
| 工單 | `case.delete` |
| 資料權利 | `data.export.request`、`data.erasure.request`、`data.erasure.complete`（實測） |
| MCP | `mcp.line.<operation>.<outcome>`（`apps/api/src/modules/mcp/line-mcp-audit.ts`） |

| 沒有寫稽核 | 狀態 |
| --- | --- |
| 登入成功與失敗、Passkey、API 金鑰建立與撤銷、CLI token 建立與撤銷、修改渠道與換憑證、群發、自動化、刪除知識庫文章、刪除標籤 | AUD-01 已記錄。本次實測登入失敗、API 金鑰、CLI token 都沒有紀錄 |
| 對外 Webhook 訂閱的建立、修改、刪除、測試送出 | **新**，HC-GOVERNANCE-04（實測） |
| 下載匯出檔 | **新**，HC-GOVERNANCE-03（實測） |
| 修改聯絡人 email、電話（`PATCH /contacts/:id`） | **新**，HC-GOVERNANCE-09（實測） |
| 門市帳號建立、改密碼、強制登出、刪除；會員綁定設定與手動綁定／解除；SLA 政策增刪改 | **新**，HC-GOVERNANCE-09（讀程式） |
| 優惠券與行銷、數據匯出、改自己的密碼 | 其他領域已報：HC-MARKETING-14、HC-ANALYTICS-13、HC-MEMBERS-09 |

租戶成員沒有任何登入紀錄：`Agent` 沒有 `lastLoginAt`，也沒有登入歷程表（平台帳號與門市帳號才有 `lastLoginAt`）。

## 問題清單（依嚴重度）

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-GOVERNANCE-01 | P1 | **永久刪除成員後，他在稽核裡的操作都變成「沒有操作者」。** `TenantAuditLog.actor` 是 `onDelete: SetNull`；`agent.purge` 稽核又只記 `targetId`，不記被刪成員是誰。匯出請求的 `requestedBy` 也一樣變成 null。結果是「誰匯出了全租戶資料」在這位成員被刪後完全查不到，且 `actor: null` 與系統排程寫的紀錄無法區分。永久刪除是釋放 email 的標準做法（UAT 已有 52 筆 `agent.purge`） | **實測**（本機）：建立成員 X（自訂角色含 `data.export`）→ X 呼叫 `POST /tenant/data-export` → 稽核有一筆 `data.export.request`、`actorId` 是 X → admin 停用並 `DELETE /agents/X` → 同一筆稽核 `actorId` 變 NULL，`GET /tenant/audit-logs?action=data.export.request` 回 `"actor": null`；`data_export_requests.requestedBy` 也變 NULL | `packages/database/prisma/schema.prisma:2132`（`actor` SetNull）、`:2156`、`:2178`；`apps/api/src/modules/agent/agent.flow.ts:150-160`（`agent.purge` 無識別資訊） | AUD-03 |
| HC-GOVERNANCE-02 | P2 | **資料匯出不看渠道可見範圍與其他權限。** 持 `data.export` 的成員，即使沒有 `channel.view_all`、沒有任何渠道授權、沒有 `inbox.view` 與 `case.view`，也能匯出全租戶的聯絡人（含各渠道 uid）、全部對話與訊息、工單（含備註與事件）。權限說明只寫「匯出聯絡人/案件/對話等」，沒提醒會跨越分店範圍；`data.export` 可以加進任何自訂角色 | **實測**（本機）：自訂角色只有 `audit.view, data.export, data.erase, contact.view, webhook.*`、沒有任何渠道 → 匯出 zip 的 manifest.json 為 contacts 36、conversations 32、messages 78、cases 6（等於全租戶） | `apps/workers/src/handlers/data-export.handler.ts:56-112`（只以 tenantId 篩選）；`packages/shared/src/rbac/permissions.ts:131` | RBAC-04（已補列） |
| HC-GOVERNANCE-03 | P2 | 下載匯出檔不寫稽核，只把 `downloadCount` 加一，記不到是誰、何時下載；同租戶任何持 `data.export` 的成員都能下載別人發起的匯出 | **實測**（本機）：`GET /tenant/data-export/:id/download` 取得連結並下載成功 → `tenant_audit_logs` 沒有新紀錄 | `apps/api/src/modules/data-export/data-export.flow.ts:62-69` | AUD-01（已補列） |
| HC-GOVERNANCE-04 | P2 | **對外 Webhook 訂閱的建立、修改、刪除與測試送出都不寫稽核。** 訂閱 `message.received` 就能把所有客人訊息（含 `replyToken`，HOOK-01）持續送到外部網址，這是最直接的資料外送管道，卻沒有任何紀錄。刪除是硬刪除，連同 `WebhookDelivery` 一起刪掉，事後也查不到曾送到哪個網址 | **實測**（本機）：以 `webhook.manage` 建立 `https://example.com/...` 訂閱 → 改網址 → 刪除，三步之間 `tenant_audit_logs` 沒有新增任何一筆 | `apps/api/src/modules/webhook-subscriptions/webhook-subscription.routes.ts:48, 58, 68, 86`；`webhook-subscription.service.ts:73-80`（硬刪除） | AUD-01（已補列） |
| HC-GOVERNANCE-05 | P2 | 資料刪除不看渠道可見範圍：持 `data.erase` 但看不到某渠道的成員，可以匿名化或硬刪除只在那個渠道出現的聯絡人。`GET /contacts/:id` 對他已把渠道身分過濾成空陣列（CM-173），刪除卻不檢查 | **實測**（本機）：上述沒有渠道的自訂角色 → `POST /tenant/data-erasure {contactId: <WebChat 聯絡人>}` 200，worker 完成匿名化 | `apps/api/src/modules/data-erasure/data-erasure.service.ts:45-56` | RBAC-04（已補列） |
| HC-GOVERNANCE-06 | P2 | **刪除後仍可「解除合併」，讓已刪除的人重新出現。** 匿名化主要聯絡人後，合併紀錄的「解除合併」照樣成功，被併入的封存聯絡人恢復成一般聯絡人，姓名與 email 都在，回到聯絡人清單。硬刪除主要聯絡人後，解除合併也回 200，被併入那位同樣復活（他的對話已在硬刪除時一起刪掉） | **實測**（本機）：D（WebChat）← E（LINE，email `hc-governance-e@…`）合併 → 匿名化 D → `POST /contacts/merge-logs/<log>/revert` 200 → E `isArchived=false`、名稱與 email 原樣。F ← G 合併 → 硬刪除 F → 解除合併 200 → `GET /contacts/G` 200、未封存 | `apps/api/src/modules/contact/contact-merge.service.ts:466-475`（只檢查紀錄與被併入方存在）；`apps/workers/src/handlers/data-erasure.handler.ts` 不處理 `ContactMergeLog` | ERASE-01（已補上解除合併） |
| HC-GOVERNANCE-07 | P2 | 刪除沒有防誤刪機制：`hard_delete` 一次 API 呼叫就排進佇列執行，沒有影響筆數預覽、沒有確認步驟、沒有冷靜期或取消，也沒有列出請求的端點（只能用 id 查單筆）。同一位聯絡人可以重複發起。目前沒有前端，誤用風險來自直接呼叫 API 的整合或腳本 | **實測**（本機）：`POST /tenant/data-erasure {mode:"hard_delete"}` 約 1 秒內完成，對話、訊息、工單一併刪除；沒有任何列表 API 可看「待處理」的請求 | `apps/api/src/modules/data-erasure/data-erasure.routes.ts:36-51` | ERASE-02 |
| HC-GOVERNANCE-08 | P2 | 刪除不處理系統內的事件副本與舊匯出檔：`Outbox.payload`（已送出的列不清除，例如 `case.created` 帶工單標題）、`WebhookDelivery.payload`（事件原文，含訊息內容）、刪除前產生、7 天內仍可下載的匯出 zip。三者都沒有保留期或清除排程（匯出檔除外，7 天） | **實測**（本機）：匿名化聯絡人 A 後，`outbox` 仍有 `case.created` payload `"title": "hc-governance-a 客訴"`；已送出的 outbox 列從前一天起一筆都沒清除。WebhookDelivery 讀程式 | `apps/api/src/modules/webhook-subscriptions/webhook-dispatcher.ts:90-96, 195-197`；`apps/workers/src/handlers/data-erasure.handler.ts`（未處理這些表） | ERASE-01（已補列） |
| HC-GOVERNANCE-09 | P2 | 稽核漏掉的敏感操作（AUD-01 沒列）：修改聯絡人 email／電話；門市帳號的建立、重設密碼、強制登出、刪除（`store.manage`）；會員綁定設定與手動綁定、解除；SLA 政策增刪改 | 聯絡人：**實測** `PATCH /contacts/:id {email, phone}` 後沒有稽核。其餘**讀程式**：這些模組沒有呼叫 `recordTenantAudit` 或 `writeTenantAudit` | `apps/api/src/modules/contact/contact.routes.ts:318`；`apps/api/src/modules/store/store.routes.ts:56-100`；`apps/api/src/modules/member-binding/member-binding.routes.ts:54, 109, 122`；`apps/api/src/modules/sla/sla.routes.ts:37-51` | AUD-01（已補列） |
| HC-GOVERNANCE-10 | P2 | `agent.create` 稽核只記舊列舉 `role`（例如 `"AGENT"`），不記實際指派的 `roleId` 與初始可見渠道。用高權限自訂角色建立成員時，稽核看起來像建了一般客服 | **實測**（本機）：以自訂角色（含 `data.export`、`data.erase`）建立成員 → 稽核 `payload` 只有 `{"role": "AGENT"}` | `apps/api/src/modules/agent/agent.flow.ts:60-67` | AUD-04 |
| EXPORT-01 | P3 | 匯出的 `scope` 沒有作用、完成通知連到不存在的頁面 | **實測確認**：`scope: ["contacts"]` 的 zip 仍含對話、訊息、工單；通知 `clickUrl` `/dashboard/settings/data-export/<id>` 在 web 回 404 | `apps/workers/src/handlers/data-export.handler.ts:226, 250` | EXPORT-01（已記錄） |
| ERASE-01 | P3 | 被合併的封存聯絡人不被刪除 | **實測確認**：匿名化 D 後，被併入的 E 仍有名稱與 email | — | ERASE-01（已記錄） |
| HC-GOVERNANCE-11 | P3 | 匯出 CSV 的日期欄位多包一層引號（`"""2026-10-29T08:54:29.280Z"""`，Date 物件走了 `JSON.stringify`）；檔案沒有 UTF-8 BOM，Excel 直接開中文會亂碼；名稱以 `=`、`+`、`-`、`@` 開頭時不做公式注入防護 | 日期與 BOM：**實測**（解開 zip 看 `csv/contacts.csv`）。公式：讀程式 | `apps/workers/src/lib/simple-zip.ts:137-149` | 新 |
| HC-GOVERNANCE-12 | P3 | Webhook 送出紀錄的 `limit` 沒有上限，負數也接受（`limit=100000`、`-5` 都 200）；`limit=abc` 400 但訊息只有「提供的資料格式不正確」；非 UUID 的訂閱 id 回 400 `DATABASE_ERROR` | **實測**（本機） | `apps/api/src/modules/webhook-subscriptions/webhook-subscription.routes.ts:42, 78` | 新 |
| HC-GOVERNANCE-13 | P3 | 稽核查詢只能用 `action` 完全比對，不能依 `targetType`／`targetId` 查（例如「這位聯絡人被誰動過」），不能用前綴（`agent.*`）；稽核沒有匯出、沒有保留期 | **實測**：`?action=agent` 回 0 筆 | `apps/api/src/modules/tenant-audit/tenant-audit.routes.ts:8-15` | 新 |
| HC-GOVERNANCE-14 | P3 | 刪除請求的 `reason` 是自由文字，可能含個資（例如「王小明要求刪除」），`GET /tenant/data-erasure/:id` 原樣回傳，且不在任何刪除範圍；失敗時 `error` 是英文 `Contact … not found for tenant …` | `reason`：**實測**；`error`：讀程式 | `apps/api/src/modules/data-erasure/data-erasure.service.ts:61-68`；`apps/workers/src/handlers/data-erasure.handler.ts`（`throw new Error(\`Contact ${contactId} not found…\`)`） | 新 |
| HC-GOVERNANCE-15 | P3 | 功能文件過時：`docs/ref/features/tenant/GOVERNANCE.md` 把「角色的建立、改名與刪除」列為沒有稽核（實際有 `role.create`、`role.rename`、`role.delete`）；「目前會寫稽核」表缺 `contact.*_link_send`、Meta 串接的 `channel.update`、`mcp.line.*` | 對照 `apps/api/src/modules/role/role.flow.ts:35-90` 與本機稽核紀錄 | `docs/ref/features/tenant/GOVERNANCE.md` 第 22-34 行 | 新（文件） |

### AUDIT 項目現況

| 編號 | 結論 |
| --- | --- |
| AUD-01 | 仍正確。文中「角色的建立改名刪除」已列為有稽核，與程式一致。建議補 HC-GOVERNANCE-03、04、09 的項目 |
| ERASE-01 | 仍正確，實測確認封存聯絡人保留個資。建議補 HC-GOVERNANCE-06（解除合併讓人復活）與 HC-GOVERNANCE-08（outbox、webhook 送出紀錄、舊匯出檔） |
| EXPORT-01 | 仍正確，`scope` 無效與通知 404 實測確認 |
| HOOK-01 | 仍正確，打錯的事件名稱 `message.recieved_typo` 照樣存入（實測） |
| TRIAL-03 | 仍正確：`purgedAt` 只有平台後台讀取，租戶端的存取與資料都沒有變化（讀程式，未在本機改租戶狀態） |
| STO-01 | 本機 workers 直接跑在主機上，匯出上傳 MinIO 成功；這不能證明容器內已修好，沒有改變結論 |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 查詢稽核 `GET /tenant/audit-logs` | 本機、UAT | 正常：依 `action`、`from/to`（`2026-10-30T05:44` 格式可）、分頁查詢；UAT 讀到 942 筆、15 種 action | `pageSize=101`、`page=0`、`actorId=abc`、`from=notadate` 都 400 且訊息正確（`page=0` 訊息是「不可小於 0」，同 HC-CONTACTS-18） | 無 `audit.view`（seed supervisor、自訂唯讀角色）403 `requiredPermission: audit.view` | 只能完全比對 action（HC-GOVERNANCE-13） |
| 2 稽核寫入（各模組） | 本機 | 正常：角色、成員、資料權利的操作都寫入，`ip` 有值 | — | — | **異常**：永久刪除成員後 actor 變 null（HC-GOVERNANCE-01）；`agent.create` 不記 roleId（HC-GOVERNANCE-10）；多項敏感操作沒寫（盤點表） |
| 3 發起匯出 `POST /tenant/data-export` | 本機 | 正常：回 `pending`，約 1 秒 `completed`，寫 `data.export.request`，發起人收到站內通知 | — | 無 `data.export` 403 | **異常**：不看渠道範圍（HC-GOVERNANCE-02）；`scope` 無效、通知連結 404（EXPORT-01） |
| 4 查狀態、下載 | 本機 | 正常：狀態、檔案大小、到期日正確；下載 15 分鐘連結取得 zip，內有 manifest、json、csv | 不存在的 id 404 | 403 正常 | 下載無稽核（HC-GOVERNANCE-03）；CSV 格式（HC-GOVERNANCE-11） |
| 5 匯出保留期清理 | — | 未驗 | — | — | 每小時排程，未等到期；以 workers unit 測試為準 |
| 6 匿名化 `mode: anonymize` | 本機 | 正常：名稱改 `[已刪除]`、email／電話／頭像清空、渠道身分刪除、進站訊息改 `{redacted:true}`、寫 request／complete 稽核且 payload 無個資 | `contactId=abc` 400；不存在的 UUID 404 `CONTACT_NOT_FOUND`；`mode=delete` 400 | 無 `data.erase` 403；**異常**：看不到渠道也能刪（HC-GOVERNANCE-05） | 出站訊息、工單標題與描述保留（ERASE-01 已記錄）；outbox 仍有工單標題（HC-GOVERNANCE-08）；解除合併讓人復活（HC-GOVERNANCE-06） |
| 7 硬刪除 `mode: hard_delete` | 本機 | 正常：聯絡人、對話、訊息、工單都刪除，`affected` 筆數正確 | 同上 | 同上 | 無確認與預覽（HC-GOVERNANCE-07）；硬刪後解除合併仍 200（HC-GOVERNANCE-06） |
| 8 查刪除狀態 | 本機、UAT | 正常：`status`、`affected`、`completedAt` 正確 | 不存在的 UUID 404 `ERASURE_REQUEST_NOT_FOUND`（UAT 同） | 403 正常 | `reason` 原樣回傳（HC-GOVERNANCE-14） |
| 9 Webhook 訂閱增刪改 | 本機、UAT（只列表） | 正常：HTTPS 公開網址 201，自動產生 secret；修改、刪除成功 | `http://` 400、`https://127.0.0.1` 400；打錯的事件名稱被接受（HOOK-01）；`limit` 無上限（HC-GOVERNANCE-12） | seed supervisor 有 `webhook.view`，讀得到 `secret`（文件已寫） | **異常**：全部不寫稽核，刪除是硬刪除（HC-GOVERNANCE-04）。UAT Demo 租戶沒有任何訂閱 |
| 10 Webhook 測試送出與轉送 | — | 未驗 | — | — | 會對外部網址發 HTTP，本次不做；以 feature 測試 `webhook-delivery-retry`、unit `webhook-dispatcher` 為準 |
| 11 試用清除對租戶端的影響 | — | 讀程式 | — | — | `purgedAt` 不影響租戶登入、資料、webhook，也不寫租戶稽核（TRIAL-03）。不能在共用環境改租戶狀態 |
| 12 登入紀錄 | 本機 | — | 登入失敗、成功都沒有任何紀錄 | — | 租戶成員沒有登入歷程或 `lastLoginAt`（AUD-01） |

權限測試用的角色：admin（全部權限）、seed supervisor（有 `webhook.view`，沒有 `audit.view`、`data.*`）、seed agent、本機自建「hc-gov-合規」（`audit.view, data.export, data.erase, contact.view, webhook.view, webhook.manage`，沒有渠道授權）、「hc-gov-唯讀」（`contact.view, inbox.view`）。三個系統角色只有 admin 預設有 `audit.view`、`data.export`、`data.erase`。

## 完備度對照

以 scenario 名稱在 `apps/api/tests`、`apps/workers/tests` 搜尋同名測試。

| Spec | Requirement 數 | Scenario 數 | 找不到同名測試 | 缺實作 | 前端入口 |
| --- | --- | --- | --- | --- | --- |
| tenant-audit-log | 4 | 10 | 0 | 0 | 無 |
| tenant-data-export | 5 | 15 | 0 | 0 | 無（通知連到不存在的頁面） |
| tenant-data-erasure | 7 | 21 | 0 | 0 | 無 |
| webhook-subscription-egress | 6 | 13 | 0 | 0 | 無 |

規格沒有涵蓋的行為：刪除後的合併紀錄（HC-GOVERNANCE-06）、匯出與刪除是否受渠道可見範圍限制（HC-GOVERNANCE-02、05）、稽核 actor 在成員刪除後的保存（HC-GOVERNANCE-01）。`tenant-audit-log` 的清單也沒列 `contact.*_link_send` 與 `mcp.line.*`，程式有寫。

**有後端、沒有前端入口**：`/tenant/audit-logs`、`/tenant/data-export*`、`/tenant/data-erasure*`、`/webhook-subscriptions*` 全部。

**前端送出的值**：沒有前端，不適用。

## 待真機驗

- 對外 Webhook 實際送到外部網址：簽章、重試、轉址不跟隨、`message.received` 帶出 `replyToken`（HOOK-01）。需要可接收的測試端點。
- UAT 的匯出與刪除：依規定 UAT 不做；UAT 只確認端點與權限回應和本機一致。
- 容器部署下 workers 上傳與刪除 MinIO（STO-01、刪除媒體檔與頭像檔）。

## UAT 操作紀錄

只讀：以 Demo 租戶 admin 查詢稽核（10 頁、942 筆）、以不存在的 id 查匯出與刪除請求（404）、列出 Webhook 訂閱（0 筆）。沒有建立或修改任何資料。

本機建立的測試資料（前綴 `hc-governance-`、`hc-gov-`）：7 位聯絡人已全部以 `hard_delete` 刪除；2 個角色、3 個成員已刪除；1 個 Webhook 訂閱、1 把 API 金鑰、1 個 CLI token 已刪除或撤銷。留下的是資料權利紀錄本身：1 筆匯出請求（zip 在 MinIO，7 天後由排程清理）與 9 筆刪除請求，以及對應的稽核。

## 建議新增到 AUDIT.md 的項目

- HC-GOVERNANCE-01：稽核的 actor 在成員永久刪除後變 null（P1）。修正方向：稽核另存操作者名稱與 email 快照，或改成成員有稽核紀錄時不可硬刪除。
- HC-GOVERNANCE-02、05：資料匯出與刪除不受渠道可見範圍限制（可併入 RBAC-04 表格）。
- HC-GOVERNANCE-03、04、09：AUD-01 的未涵蓋清單補「下載匯出檔」「Webhook 訂閱增刪改與測試」「修改聯絡人 email／電話」「門市帳號」「會員綁定」「SLA 政策」。
- HC-GOVERNANCE-06、08：ERASE-01 補「刪除後仍可解除合併，讓被併入的聯絡人復活」與「outbox、webhook 送出紀錄、舊匯出檔」。
- HC-GOVERNANCE-07：刪除沒有預覽、確認與取消。
- HC-GOVERNANCE-10：`agent.create` 稽核不記 roleId 與初始渠道。

## 文件過時之處

- `docs/ref/features/tenant/GOVERNANCE.md` 的「目前會寫稽核的動作」與「沒有寫稽核的重要操作」：角色的建立、改名、刪除已有稽核；缺 `contact.binding_link_send` 等三項、Meta 串接的 `channel.update`、`mcp.line.*`（HC-GOVERNANCE-15）。
- 同一份文件的「完成通知連到不存在的頁面」「`scope` 參數沒有作用」仍正確。
- `openspec/specs/tenant-audit-log/spec.md` 的清單沒列代發連結與 MCP LINE 的稽核（程式多寫了，規格少列，不是缺實作）。
