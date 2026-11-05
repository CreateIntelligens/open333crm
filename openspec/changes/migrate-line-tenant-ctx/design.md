## Context

#337 階段 4 第一批。規劃與比較見 `tmp/337-入口開交易-規劃.md` 5.4（本機檔案，不在 git）。

`line` 模組有三個 service：

- `quick-reply-preset.service.ts`：已在階段 3 搬完。
- `rich-menu.service.ts`：CRUD、發布、取消發布、分眾綁定。發布與取消發布呼叫 LINE API；綁定以 `queue.add()` 送進 `rich-menu-bind` 佇列。
- `line-profile.service.ts`：讀渠道與身分，呼叫 LINE 的 profile API，再寫回身分。

兩個 service 都只被自己的路由 import。它們呼叫的 `channel.service.ts`（`decryptCredentials`）、`segment.service.ts`（`calculateSegmentContacts`）還沒搬，收 `TenantDb`，傳 `ctx.tx` 即可。

## Goals / Non-Goals

**Goals:**

- `rich-menu.service.ts`、`line-profile.service.ts` 的函式改收 `TenantCtx`，路由改呼叫 flow。
- 發布、取消發布、個人資料同步拆成「交易 → 外部呼叫 → 交易」，並寫明保證（spec）。
- 綁定與解除綁定改由 flow 呼叫 `enqueueJob()`；workers 的綁定前先檢查選單狀態。

**Non-Goals:**

- LINE 與資料庫的定期對帳（另開 issue）。
- Rich Menu alias、排程上下架、單一聯絡人綁定（`CHANNEL_UI_SWITCH`）。
- `services/channel-visibility.ts` 的搬遷。`line-profile.routes.ts` 仍在 flow 之外呼叫 `resolveChannelVisibility(request)`，隨階段 4 的 `channel-visibility` 處理。

**審查基準：** 達到 line-oa-laravel 的圖文選單（`RichmenuService`）與 BullMQ 常見用法的水準。這些專案也會有的情況，記錄在「已知限制」，不另外處理。

## Decisions

### D1. 發布：認領取代全域鎖

line-oa-laravel 以 Redis 的全域寫入鎖（`Cache::lock('richmenus:write')`）讓所有圖文選單的寫入排隊，鎖要撐過 LINE 呼叫。open333 的流程以資料庫狀態認領（`claimOne()` 的寫法），不新增分散式鎖：

1. 交易 1（`inTenant`）：
   - 取渠道的交易級 advisory lock：`pg_advisory_xact_lock(hashtextextended('rich-menu-publish:<channelId>', 0))`，寫法同 `sla.service.ts`。
   - 同一個渠道有其他選單是 `publishing`，而且 `updatedAt` 在 5 分鐘內：回 409 `PUBLISH_IN_PROGRESS`。
   - 條件更新認領：`updateMany where { id, tenantId, OR: [status in (draft, error), status = publishing AND updatedAt < now - 5 分鐘] }`，改成 `publishing`，並把 `updatedAt` 寫成認領時間 `claimedAt`。`count = 0` 時，依目前狀態回 400 `ALREADY_PUBLISHED` 或 409 `PUBLISH_IN_PROGRESS`。
   - `claimedAt` 是這次認領的憑證。交易 2 與放掉認領都以 `status = publishing AND updatedAt = claimedAt` 為條件：中斷超過 5 分鐘的請求恢復後，選單已被另一個請求重新認領，`updatedAt` 不同，舊請求的寫入不生效。做法同 Laravel `Cache::lock` 釋放時比對擁有者。
   - 讀渠道憑證，回傳 access token 與選單內容。
2. 交易外：下載背景圖、建立 LINE 選單（`selected` 送展開狀態）、上傳背景圖。`isDefault` 時設預設（D4）。這時選單仍是 `publishing`，同一個渠道的其他發布被擋下，所以設預設不會和另一個發布交錯。
3. 交易 2：條件更新 `where { id, status: publishing, updatedAt: claimedAt }` 寫入 `published`、`lineRichMenuId`、`publishedAt`、`isDefault`。設預設成功時，同渠道其他已發布選單的 `isDefault` 改成 false。草稿的 `isDefault` 是「發布時設成預設」的設定，不動，與搬遷前只清已發布選單的 `selected` 相同。

advisory lock 只在交易 1 內持有，所以 LINE 呼叫期間不佔連線，也不佔鎖。「同一個渠道只有一個 `publishing`」由交易 1 的檢查保證：檢查與認領在同一把鎖內。

**替代方案：** Redis 鎖（line-oa-laravel 的做法）。不採用：鎖要涵蓋 LINE 呼叫，逾時與續約都要另外處理，而 repo 已經以資料庫狀態認領副作用。

### D2. 補償刪除

LINE 建立選單之後，下列任一情況，flow 呼叫 LINE 刪除剛建立的選單，再以另一個交易把 `status` 改成 `error`（條件：`status = publishing` 而且 `updatedAt = claimedAt`）：

- 上傳背景圖失敗。
- 交易 2 丟出錯誤，或條件更新 `count = 0`（中斷超過 5 分鐘，被另一個請求重新認領）。

刪除失敗時寫 error log，帶 LINE 端的選單 id 與選單 id，供對帳 issue 使用。寫 `error` 的交易也失敗時，選單停在 `publishing`，5 分鐘後可以重新發布（D3）。

LINE 建立選單失敗時，沒有東西要刪，只寫 `error`。

設預設已經成功、之後交易 2 失敗時，LINE 的預設指向即將刪除的選單。補償時先把 LINE 的預設設回交易 1 讀到的舊預設選單（同渠道 `isDefault = true` 的 `lineRichMenuId`），再刪除新選單；沒有舊預設時，刪除新選單後 LINE 沒有預設，與資料庫一致。設回失敗時寫 error log，由對帳 issue 收斂。

### D3. 中斷的發布以 `updatedAt` 判斷

`status` 是字串欄位，`updatedAt` 有 `@updatedAt`，認領時自動更新，所以不需要 migration。門檻 5 分鐘：LINE 每個呼叫加上 30 秒逾時（`AbortSignal.timeout(30_000)`），整段最多 5 次外部呼叫（下載圖、建立、上傳、取消預設、設預設），一般遠低於 5 分鐘。

### D4. 設預設：不先取消全體預設

LINE 的設預設 API 會以新選單取代目前的預設。line-oa-laravel 上架時只呼叫 `setDefault()`，不先取消（`RichmenuService::updatePostCommitSteps()`）。現在的 `unsetCurrentDefault()` 先呼叫「取消全體預設」，所以設預設失敗時，所有好友都失去選單。改成：

- 不呼叫取消全體預設。
- 設預設成功：交易 2 把這個選單寫成 `isDefault = true`，同渠道其他已發布選單寫成 false。
- 設預設失敗：LINE 上原本的預設不受影響。交易 2 把這個選單寫成 `isDefault = false`，不動其他選單，回應帶 `warnings: ['DEFAULT_NOT_SET']`。資料庫與 LINE 一致，不必等對帳。

line-oa-laravel 先 commit `is_default` 再呼叫 LINE，失敗時資料庫與 LINE 不一致，交給每小時的對帳。open333 的設預設在交易 2 之前，失敗時直接把結果寫進資料庫，所以不依賴對帳。

### D5. 取消發布

1. 交易 1：讀選單與憑證。`status` 不是 `published` 或 `error` 時回 400 `NOT_PUBLISHED`（不變）。
2. 交易外：`isDefault` 時，先查 LINE 目前的預設（`GET /v2/bot/user/all/richmenu`），是這個選單才取消全體預設，做法同 line-oa-laravel 的下架。查詢回 404（沒有預設）時不取消。接著刪除 LINE 選單，404 視為已刪除（不變）。
3. 交易 2：條件更新 `where { id, status in (published, error), lineRichMenuId: 讀到的值 }` 寫回 `draft`。`isDefault` 保留，重新發布時仍設成預設（搬遷前取消發布也不改 `selected`）。

兩個取消發布同時執行：LINE 刪除第二次回 404，交易 2 的第二次 `count = 0`，回傳目前的選單。結果相同，所以不需要認領。

### D6. 分眾綁定經 outbox

- `bindRichMenuAudienceFlow`、`unbindRichMenuAudienceFlow`：交易內讀選單、解析受眾的 LINE uid，以 `enqueueJob(scope, publisher, 'rich-menu-bind', 'bind' | 'unbind', data, RICH_MENU_BIND_JOB_OPTIONS)` 寫進 outbox。保留期限（完成 24 小時、失敗 7 天）改由工作的選項指定，刪除自建的 `Queue` 與沒有呼叫端的 `closeRichMenuBindQueue()`。
- job 的 payload 新增 `richMenuId`。
- workers 的 `handleRichMenuBindJob`，`op = 'link'` 時先查 `richMenu`（`id`、`tenantId`）：不是 `published`，或 `lineRichMenuId` 不同時，記 info log 後結束，不丟錯誤。`op = 'unlink'` 不檢查。
- payload 沒有 `richMenuId`（部署前送出的工作）時，照舊執行，不檢查。

line-oa-laravel 的排程工作以 `expectedJobId` 做同樣的事：工作執行時比對資料庫的現況，過期就跳過。

### D7. LINE 個人資料同步

1. 交易 1：讀渠道（`isActive`、`LINE`）與身分，找不到回 404（不變）。回傳憑證與身分 id。
2. 交易外：呼叫 LINE profile API，失敗回 502 `UPSTREAM_ERROR`（不變）。
3. 交易 2：以 `updateMany where { id, channelId }` 寫入名稱與頭像；`count = 0`（身分在期間被刪除）回 404。

寫入是覆寫，重送沒有副作用，不需要認領。

### D8. 每個步驟失敗時的狀態

| 步驟 | 失敗時資料留在哪裡 | 誰重做 | 保證 |
| --- | --- | --- | --- |
| 發布交易 1 | 不變 | 管理員重按 | 不呼叫 LINE |
| 下載背景圖 | 回到發布前的狀態（中斷後重新發布的選單記成 `error`） | 管理員修正圖片後重按 | 不呼叫 LINE |
| 建立 LINE 選單（含逾時、連不上） | `error` | 管理員重按 | LINE 上沒有新選單 |
| 上傳圖、交易 2 | LINE 選單已補償刪除，`error` | 管理員重按 | LINE 上最多一個新選單；補償失敗時留下孤兒（log） |
| 補償後寫 `error` 失敗、處理程序中途結束 | `publishing`；5 分鐘後頁面顯示「發布中斷」 | 管理員重按發布 | 可能留下孤兒 |
| 設預設 | `published`、`isDefault=false`；LINE 上原本的預設不變 | 管理員取消發布，重新勾選預設並儲存，再發布 | 資料庫與 LINE 一致 |
| 取消發布的 LINE 呼叫 | 不變 | 管理員重按 | LINE 404 視為已刪除 |
| 綁定工作送出（outbox） | outbox 列 | outbox-relay | 至少一次 |
| 綁定工作執行 | 佇列的 failed set | BullMQ 重試、bull-board 手動重送 | 綁定是覆寫；選單已下架或已換 id 時跳過 |

### D9. `selected` 拆成 `isDefault` 與 `selected`

LINE 建立選單 API 的 `selected` 是「聊天室打開時展開選單」。change `fix-rich-menu-default-safety` 把同一個欄位改成「設為所有好友的預設選單」，發布時又把它送進 LINE 的 `selected`，兩件事因此綁在一起。line-oa-laravel 曾經用 `is_default` 一個欄位，2026-06 加上 `is_select` 分開（migration `add_global_and_select_to_richmenus_table`，主規格「圖文選單展開狀態」）。

- 新增欄位 `isDefault Boolean @default(false)`。`rich_menus` 的欄位沒有 `@map`，資料庫欄位名稱就是 `isDefault`。migration 以 `UPDATE rich_menus SET "isDefault" = selected` 填入。既有選單在 LINE 上的展開狀態就是 `selected` 的值，所以 `selected` 不改。
- `selected` 的 Prisma 預設值改成 `true`，API 建立時沒有傳入也用 `true`，與 line-oa-laravel 相同。這只影響新建的選單。
- API 的建立、修改、複製多一個 `isDefault`；回應同時帶兩個欄位。發布、取消發布、設預設的判斷都改看 `isDefault`。
- 編輯頁拆成兩個選項。「設為所有好友的預設選單」沿用現在的確認對話框；說明文字拿掉「好友開啟對話時也會自動展開」。新增「聊天室打開時展開選單」。

**替代方案：** 保留 `selected` 當預設、新增 `expanded`。不採用：`selected` 與 LINE API 的欄位同名卻不同義，就是這次要修的問題。

## Risks / Trade-offs

- **[已知限制] 同一個已發布選單的綁定與解除綁定交錯。** 先綁定受眾、再解除綁定，綁定工作晚到時，選單仍是 `published`、id 相同，檢查會通過，客人又被綁回。要排除這個情況，需要記錄每個受眾的綁定狀態（line-oa-laravel 有 `richmenu_users` 資料表），不在範圍。
- **[已知限制] 晚到的解除綁定。** 解除綁定不檢查，晚到時可能解除客人之後被綁定的另一個選單。解除後客人回到全體預設選單。
- **[取捨] 5 分鐘門檻。** 正常的發布不會超過；超過時兩個請求可能都呼叫 LINE，交易 2 的條件更新只讓一個成功，另一個補償刪除。
- **[取捨] 交易 2 失敗時刪除 LINE 選單。** 交易 2 只寫少數欄位，失敗的機率低；刪除之後，管理員要重新發布。

## Migration Plan

- 一個 migration：新增 `rich_menus."isDefault"`，以 `selected` 填入；`selected` 的預設值改成 `true`。migration 只加欄位與更新資料，舊版程式碼仍能執行。
- workers 與 API 要一起部署。順序不影響：workers 先部署時，舊 API 的工作沒有 `richMenuId`，照舊執行；API 先部署時，舊 workers 忽略新欄位。
- 回滾：還原這個 PR。`publishing` 的選單在舊程式裡不能發布、不能取消發布；回滾前確認沒有 `publishing` 的選單，或手動改回 `error`。舊程式只看 `selected`，回滾後 `isDefault` 與 `selected` 不同的選單，以 `selected` 為準。
