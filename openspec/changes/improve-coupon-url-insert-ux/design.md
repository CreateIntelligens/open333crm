## Context

`{{coupon.url}}` 只在附券廣播（`broadcast-coupon.flow.ts`）代入。其他送出素材的路徑：

| 路徑 | 未代入的 `{{coupon.url}}` 會怎樣 |
| ---- | -------------------------------- |
| 一般廣播（`executeBroadcast`） | `renderTemplateBody` 保留原字，顧客看到 `{{coupon.url}}` |
| 自動化規則的 `send_material`（關鍵字回覆、加好友禮、自訂規則；workers `automation-actions.ts`） | `stripUnresolvedPlaceholders` 把它拿掉，顧客收到少了連結的訊息 |

兩種情況顧客都拿不到券。舊說明「用在關鍵字回覆時顧客會看到原樣文字」對關鍵字回覆不正確（手冊第 10、18 章同樣錯誤），本 change 一併修正。

## Decisions

### D1 偵測規則前後端一致

後端：`template-renderer.ts` 新增 `bodyHasCouponUrl(body)`，以既有 `extractVariables(body)` 判斷是否含 `coupon.url`（與附券廣播判斷 `materialHasCouponUrl` 同一個正則，`{{coupon.url}}` 不允許空白）。automation 經由 marketing 的 helper 檔匯入（結構規則 4 允許）。

前端：`apps/web/src/lib/marketing/coupon-url.ts` 以相同正則走訪 body 的所有字串。素材列表 API 已回傳 `body`，不需新 API。

### D2 後端只在新增或修改時檢查

- 自動化規則：沿用 `assertSendMaterialReferences`（只在建立、或更新時送了 `actions` 才執行），查素材時多選 `body`。只改名稱、優先序、啟用／停用不檢查，既有規則仍能停用或改名（自動化規則頁）。
- 廣播：`createBroadcast` 在沒有 `couponId` 且素材含佔位字時回 400（`MATERIAL_NEEDS_COUPON`）。廣播沒有更新 API；已建立的草稿或排程廣播在發送時不檢查，行為不變。
- 錯誤 code 用 `VALIDATION_ERROR`（自動化，與同函式其他錯誤一致）與 `MATERIAL_NEEDS_COUPON`（廣播），訊息說明原因與改法。

### D3 各入口的處理

| 入口 | 前端 | 後端 |
| ---- | ---- | ---- |
| 關鍵字回覆對話框 | 選到時顯示 `role="alert"` 提醒，存檔擋下並顯示同樣訊息 | `createRule`／`updateRule` 400 |
| 自動化規則編輯器（`ActionEditor` 的素材選單） | 選到時顯示提醒；存檔由後端 400 擋下，編輯器顯示錯誤訊息 | 同上 |
| 加好友禮頁 | 不選素材（只發券與文字），不需處理 | 同上（API 呼叫一樣被擋） |
| 建立廣播對話框 | 不附券時顯示提醒，建立按鈕停用並說明原因 | `createBroadcast` 400 |
| 批次發券（券詳情「發送給…」） | 一定有 `couponId`，佔位字會代入，不需處理 | 不擋 |
| MCP 建立廣播 | 無 UI | 走 `createBroadcast`，同樣 400 |
| 傳訊領券、公開領券連結 | 回覆固定文字，不使用素材 | 不適用 |
| 舊版型（MessageTemplate）廣播 | 前端已不能選 | 不檢查：附券廣播不支援舊版型，舊版型的變數清單本來就標示「僅附券廣播」 |

素材編輯器本身不知道素材被哪些規則使用，素材改成含佔位字後，既有關鍵字回覆不會即時提醒；下次編輯該規則時才擋下。這是已知限制。

### D4 預覽標籤

`MaterialPreview` 的 `BubbleText` 與 `ButtonsPreview` 文字經 `renderCouponUrlTokens()` 切開，佔位字換成 `<span>` 標籤「顧客專屬券連結」（`text-primary`、`bg-primary-subtle`、`border-primary-border`、底線，帶 `title` 說明）。標籤自帶背景，在預覽固定白底的手機框內深淺色模式都可讀。編輯框與儲存值不變。

### D5 對既有資料的影響

- 不改任何資料，不需要 migration。
- 已存在、素材含佔位字的關鍵字回覆或自動化規則：照舊執行（佔位字被拿掉）；停用、改名不受影響；在關鍵字回覆頁編輯並存檔時會被擋下，要先換素材或拿掉佔位字。這正是要提醒的錯誤設定。
- 已建立的一般廣播草稿或排程：照舊發送（不在發送時檢查），避免本 change 讓已排好的廣播突然失敗。
- 依使用者指示不查 UAT 現有資料；數量只影響「下次編輯時被擋下」的規則數。

### D6 列出全部可用領券連結的 API

`GET /api/v1/coupons/claim-links`（`coupon-claim-link.routes.ts`，同一檔、同一前綴，路徑為字串字面值），需 `coupon.view` 或 `marketing.manage` 任一（`requireAnyPermission`）：素材編輯者通常只有 `marketing.manage`（使用者 2026-10-28 決定）。service `listAvailableClaimLinks(ctx, webBaseUrl, filter, now)`：

- 條件：`tenantId`、連結 `ACTIVE`、券 `ACTIVE`、連結沒有結束（`endAt` 為空或晚於現在）；帶 `channelType` 時再加上連結渠道的類型。
- 只列同渠道（使用者 2026-10-28 決定）：LINE 素材帶 `LINE`，FB 素材帶 `FB`。FB 渠道的領券連結開的是 Messenger（m.me），Instagram（`THREADS`）開的是 ig.me，Messenger 素材不列 Instagram 的連結。
- 回傳既有 `ClaimLinkView` 加上 `couponName`，網址用既有 `claimPageUrl(WEB_BASE_URL, code)`；最多 200 筆，新的在前。
- Fastify 靜態路徑優先於 `/:id`，不與券詳情路由衝突。

前端：素材編輯器開啟「插入領券連結」面板時才載入，帶素材的渠道；403 說明需要「檢視優惠券」或「管理行銷」，其他錯誤顯示看得到的訊息。沒有連結時說明並提供前往「優惠券」頁的連結。插入沿用游標與字數上限邏輯。

## Risks / Trade-offs

- 後端擋關鍵字規則可能讓少數既有規則下次編輯時存不了 → 訊息寫明原因與改法，停用不受影響。
- 只有 `marketing.manage` 的人也能看到可用領券連結的名稱、券名與公開網址 → 這些網址本來就是公開散布用的，不含名額或顧客資料，可接受。
- 素材改成含 `{{coupon.url}}` 時，不會提醒該素材已被關鍵字規則使用 → 記在 issue #375，不在本 change 處理。
