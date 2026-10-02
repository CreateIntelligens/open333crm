# 聯絡人與標籤

聯絡人是「客人是誰」。同一個人可能從 LINE、Facebook、網站聊天室各進來一次，系統一開始會把他當成不同的聯絡人，之後可以合併。標籤是貼在聯絡人、對話、工單與素材上的分類，自動化規則與群發都靠它挑對象。

- **資料來源**：`apps/api/src/modules/contact/*`、`apps/api/src/modules/tag/*`、`apps/api/src/modules/webhook/inbound-contact-resolver.ts`、`apps/api/src/modules/line-login/line-login.service.ts`、`apps/api/src/modules/fb-login/fb-login.service.ts`、`apps/api/src/modules/line/line-profile.*`、`packages/core/src/identity/*`、`apps/workers/src/lib/automation-actions.ts`
- **核對日期**：2026-09-30

## 負責的模組

| 模組 | 負責什麼 |
| --- | --- |
| `contact` | 聯絡人清單與搜尋、資料編輯、歷史對話與工單、時間軸、手動合併 |
| `tag` | 標籤的 CRUD，以及對聯絡人、對話、工單貼標與移除（`tagging.service.ts`） |
| `webhook` 的 `inbound-contact-resolver.ts` | 訊息進站時找出或建立聯絡人 |
| `line-login`、`fb-login` | 客人以 LINE 或 Facebook 登入時補上 email，並依 email 自動合併 |
| `canvas` 的 identity 部分 | 審核系統產生的合併建議。沒有頁面 |
| `line` 的 line-profile 部分 | 重新向 LINE 抓取聯絡人的名稱與頭像。沒有頁面 |

## 聯絡人與渠道身分

一個聯絡人（`Contact`）可以有多個渠道身分（`ChannelIdentity`）。渠道身分以 `(channelId, uid)` 唯一，`uid` 是渠道給的使用者 ID，例如 LINE 的 userId、Facebook 的 PSID。

訊息進站時，`resolveInboundContact()` 依下列順序找聯絡人：

1. 查 `ChannelIdentity`，看這個渠道與 uid 是否已有身分。有就用它的聯絡人。
2. 沒有的話，查 `IdentityMap`，看這個渠道類型與 uid 是否已經對應到某個聯絡人。這張表由 LINE／FB 登入流程寫入。有的話，為那個聯絡人建立這個渠道的身分。
3. 都找不到就建立新的聯絡人與渠道身分。

因此同一個人從 LINE 與 Facebook 進來，一開始是兩個聯絡人。要變成一個，只能經過[合併](#合併)。

聯絡人的名稱與頭像取自渠道。系統只在第一次建立聯絡人時向渠道抓取一次，之後不會自動更新。LINE 另有 `PATCH /api/v1/channels/:channelId/contacts/:lineUid/sync-profile` 可以重新抓取，目前沒有頁面呼叫它。這個端點：

- 要求 `contact.update` 權限，渠道也要在成員的可見範圍內。
- 只接受自己租戶、啟用中的 LINE 渠道；其他情況一律回 404。
- 只寫入 `ChannelIdentity` 的 `profileName` 與 `profilePic`，不改 `Contact` 的名稱與頭像，以保留客服的修改。

## 清單與編輯

`GET /contacts` 只列出沒有被封存的聯絡人。支援的篩選：

| 參數 | 作用 |
| --- | --- |
| `q` | 在名稱、電話、email 中做不分大小寫的部分比對 |
| `tagId` | 只列出貼了這個標籤的聯絡人 |
| `channelType` | 只列出在這個渠道類型有身分的聯絡人 |
| `excludeChannelType` | 排除這些渠道類型的身分 |

`PATCH /contacts/:id` 可以改名稱、電話、email、語言與 `isBlocked`。`isBlocked` 沒有任何程式讀取，設成 `true` 不會擋下訊息、機器人或群發，見 `../../system/AUDIT.md` 的 DB-04。

聯絡人詳情頁另外提供該聯絡人的對話、工單與時間軸。時間軸合併了對話、工單與標籤的紀錄。

## 合併

系統有兩套合併實作，觸發方式與搬移的資料都不同：

| | 手動合併 | 登入時自動合併 |
| --- | --- | --- |
| 觸發 | 客服在後台操作，`POST /contacts/merge` | 客人以 LINE 或 Facebook 登入並授權 email，同租戶已有另一個聯絡人使用同一個 email |
| 程式 | `contact.service.ts` 的 `mergeContacts()` | `line-login.service.ts` 與 `fb-login.service.ts` 各有一份 `mergeContactIntoTarget()`，內容相同 |
| 人工確認 | 有，前端先呼叫 `GET /contacts/merge-preview` 預覽 | 沒有 |
| 被合併的聯絡人 | 封存（`isArchived`），`mergedIntoId` 指向主要聯絡人 | 硬刪除 |
| 渠道身分 | 全部搬過去 | 只搬登入用的那一個，其他的隨聯絡人刪除 |
| 對話、工單、標籤、屬性 | 搬過去 | 搬過去 |
| 聯絡人關係 | 搬過去 | 不處理 |
| 長期記憶、`IdentityMap` | 不處理 | 搬過去 |
| 積分、活動提交 | 不處理，留在被封存的聯絡人 | 外鍵為 `RESTRICT`，來源有這兩種資料時整個合併失敗 |

手動合併會寫一筆 `contact.merge` 租戶稽核紀錄，只記兩個聯絡人的 ID。兩套實作的落差見 `../../system/AUDIT.md` 的 CONTACT-01。

**合併建議。** `packages/core/src/identity/` 設計了依電話號碼找出重複聯絡人、產生合併建議（`MergeSuggestion`）、再由人工在 `/api/v1/identity` 核准的流程。唯一會建立建議的函式 `detectPhoneDuplicates()` 沒有呼叫端，因此目前不會有任何建議產生，見 `../../system/AUDIT.md` 的 IDENT-01。

## 標籤

標籤有兩個分類維度：

| 維度 | 值 | 作用 |
| --- | --- | --- |
| `scope` | `CONTACT`、`CONVERSATION`、`CASE`、`MATERIAL` | 標籤能貼在哪種對象上。`tagging.service.ts` 的 `assertTagScope()` 在貼標時拒絕 scope 不符的組合 |
| `type` | `MANUAL`、`AUTO`、`SYSTEM`、`CHANNEL` | 標籤的來源分類。由建立者在建立時選擇，程式不依這個值改變行為 |

同一個租戶內，名稱加 scope 不能重複。因此可以同時有一個 `CONTACT` 的「VIP」和一個 `CASE` 的「VIP」。

**素材標籤存的是字串。** `MATERIAL` scope 的標籤在素材上存成 `Material.tags` 字串陣列，不是關聯表。改名與刪除時，`tagging.service.ts` 會逐一掃過素材替換或移除這個字串。

**標籤怎麼被貼上：**

| 來源 | 程式 | `addedBy` |
| --- | --- | --- |
| 客服手動 | `addTagToTarget()` | `agent` |
| 點擊短連結或素材按鈕 | 短連結轉址與進站攔截器 | `system` |
| 自動化規則 | workers 的 `executeWorkerAutomationActions()` | `automation` |

對聯絡人貼標會發布 `contact.tagged`，事件帶著 `addedBy` 作為來源。自動化規則據此避免「自動化貼標 → 觸發自動化 → 再貼標」的迴圈。workers 貼標後透過 Redis 的 `domain:event` 頻道把事件送回 API 行程的 eventBus，由 `socket.plugin.ts` 轉發。

**自動化以名稱找標籤。** 規則的「貼標」動作存的是標籤名稱。workers 依名稱找標籤時不限 scope，找不到就用這個名稱建立一個新標籤。因此標籤被刪除或改名後，規則會默默重建舊名稱的標籤，見 `../../system/AUDIT.md` 的 AUTO-03。

**刪除標籤。** 刪除時，所有對象上的這個標籤一併移除（外鍵 `Cascade`）。短連結的 `tagOnClick` 以 ID 指向標籤。標籤刪除後，點擊時貼標失敗，只記一行 warning log，轉址照常進行。

**標籤數量沒有上限。** 方案的 `maxTags` 沒有任何檢查點，見 `../../system/AUDIT.md` 的 PLAN-04。

## 誰能做什麼

聯絡人的路由以權限碼守門：讀取要 `contact.view`，修改與貼標要 `contact.update`，合併與解除合併要 `contact.merge`。查看聯絡人的對話另外要 `inbox.view`，查看聯絡人的工單另外要 `case.view`。

標籤的路由（`/api/v1/tags`）只驗登入，沒有權限碼。任何成員都能建立與刪除標籤，見 `../../system/AUDIT.md` 的 RBAC-01。

聯絡人的路由也不套用渠道可見範圍。只能看到某些渠道的成員，在聯絡人頁仍然看得到其他渠道的對話清單與最後一則訊息，見 `../../system/AUDIT.md` 的 RBAC-04。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **兩套合併實作行為不一致** | 手動合併不搬積分；登入時自動合併會硬刪除聯絡人，遇到積分則失敗。詳見 `../../system/AUDIT.md` 的 CONTACT-01 |
| **聯絡人頁不套用渠道可見範圍** | 詳見 `../../system/AUDIT.md` 的 RBAC-04 |
| 自動化貼標不限 scope，會重建已刪除的標籤 | 詳見 `../../system/AUDIT.md` 的 AUTO-03 |
| **LINE、Facebook 登入補 email 時不確認登入者** | 知道渠道身分 ID 的人可以寫入自己的 email，並觸發自動合併。詳見 `../../system/AUDIT.md` 的 IDENT-02 |
| 合併建議沒有產生端 | 詳見 `../../system/AUDIT.md` 的 IDENT-01 |
| `isBlocked` 與 `ContactTag.expiresAt` 沒有作用 | 詳見 `../../system/AUDIT.md` 的 DB-04 與 DB-02 |
| 標籤的路由沒有權限碼 | 詳見 `../../system/AUDIT.md` 的 RBAC-01 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
