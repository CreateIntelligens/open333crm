## Context

系統目前無任何券的概念。但發券所需的周邊能力幾乎都已就緒——實查結果：

| 能力 | 狀態 | 位置 |
|---|---|---|
| 發送層（`push`/`reply`/`multicast`/`broadcast`/`narrowcast`） | 現成 | `packages/channel-plugins/src/line/index.ts:315` |
| SafeReply 降級（reply 失敗自動改 push） | 現成 | `conversation.service.ts:651` |
| `replyToken` 傳遞鏈路 | 現成 | webhook → `message.received` → automation worker |
| 貼標 | 現成 | `tagging.service.ts`（已被 5 模組跨模組呼叫） |
| 短網址 + 點擊歸因 + QR | 現成 | `modules/shortlink/` |
| 關鍵字觸發 | 現成 | `keyword.matched` + 專屬管理頁 |
| 圖文選單 | 現成 | Rich Menu 完整管理 |
| 卡片訊息版型 | 現成 | 16 種（LINE 6 / FB 9） |
| 外部 API 呼叫 | 現成 | `executeApiFetchNode`（canvas） |
| LINE 身分驗證（LIFF） | 現成但**前置卡關** | `line-login` 的 `verifyIdToken`；需 LINE Login channel（見 D11） |
| Account Link 發 token／收事件 | 現成 | `channel-plugins/src/line/index.ts:613`／`:282` |
| 粉絲端前端 | **零** | `apps/web/src/app/liff/` 僅 callback／redirect 兩支導流頁 |

因此本 change 的實作重心是**券本身的資料模型、狀態機與 LIFF 前端**，而非發送或觸發機制。

## Goals / Non-Goals

**Goals**
- 券的完整生命週期：建立 → 發放 → 領取 → 核銷，狀態不可逆且防重複。
- 客服可在對話中發券並歸戶該聯絡人（差異化主場）。
- 顧客在 LIFF 內看券夾、出示券、完成核銷。
- 會員綁定的產品層介面：設定驅動，不為單一客戶寫死。

**Non-Goals**
- 跨渠道券夾統一（LIFF 主場架構下不需要）。
- 對接特定客戶的會員 API（客製層）。
- 互動遊戲、POS API 核銷、點數換券。

## Decisions

### D1：LINE 為唯一主場，FB／IG 導流

**理由**：LIFF `id_token` 是平台簽發的可信身分，FB／IG 沒有等價機制（Messenger Extensions SDK 已淡出，IG 完全沒有）。若為 FB／IG 另做簽章連結換 token，會引入「連結被轉發＝身分被轉移」的安全弱點——而券帶金錢價值，這個取捨不划算。

**替代方案（否決）**
- *三渠道各自券夾*：需要跨渠道歸戶才能讓同一人看到同一份券，而歸戶本身是獨立的大題目（見 D6）。
- *簽章連結*：安全強度低於 LIFF id_token，且需額外做短效、一次性、綁定該券等緩解措施。

**代價**：FB／IG 使用者多一次跳轉，且必須是 LINE 用戶。台灣市場此假設多半成立，但客群集中在 IG 且不常用 LINE 的商家會流失轉換——提案時需確認客戶渠道組成。

**但導流本身留下一個洞**（D10 補齊）：FB 使用者在系統中有自己的 `contactId`，跳進 LIFF 後系統看到的卻是 LINE 身分對應的**另一個 `contactId`**，兩者對不起來，券夾會是空的。

### D10：FB／IG 發券走「待領取券 + 一次性領取憑證」

**問題**：發券當下不知道 FB／IG 使用者的 LINE 身分，而 D6 已決定不做跨渠道歸戶，無從以身分比對找回券。

**做法**：券建立時帶 `claimToken`（一次性、短效），狀態為 `issued`；`contactId` 先記發放對象（FB 聯絡人）以保留歸因。顧客點連結進 LIFF、完成 id_token 驗證後，以憑證換券——在交易內條件式更新（`WHERE claimToken = ? AND status = 'issued' AND claimTokenExpiresAt > now()`）把 `contactId` 改為 LINE 聯絡人、狀態轉 `claimed`、憑證清空。受影響列數為 0 即回報憑證已用過或已過期。

**認券不認人**，因此不需要歸戶機制，與 D6 一致。

**取捨**：**領取憑證即所有權**——連結被轉發，別人就能領走。這正是 D1 否決「簽章連結」時所指的弱點，這裡以最小範圍接受它：僅用於領取（不用於核銷或查看他人券夾）、一次性、短效（建議 24–72 小時）、訊息明示勿轉發。**高價值券建議只在 LINE 發放。**

**附帶效果**：公開領券（海報 QR、官網連結、廣告導流）自然成立——同樣是一張待領券，只是憑證不綁特定對象。原規劃對此沒有明確路徑。

**LINE 原生發券不走此路**：座席已知對方 LINE 身分，直接建 `claimed` 券，省去領取步驟。

### D2：不使用 LINE 原生優惠券 API

LINE 已有 `POST /v2/bot/coupon` 等四支端點（建立／停用／列表／詳情），且內建抽獎機率。但**沒有任何端點能取得領取者或核銷名單**，官方文件明載成效只能在 LINE 官方帳號管理後台查看。

自建的理由因此要精確表述為：**不是「LINE 沒有券 API」，而是「有發券 API 但拿不回資料」**。既然核心價值是歸戶與成效追蹤，混合模式（用原生 API 發、自己記發送紀錄）只能拿到發券歸因、拿不到核銷，無法支撐「證明哪則訊息帶來核銷」的定位。

**註**：官方文件的券範例皆為日圓（`currency: JPY`、`timezone: ASIA_TOKYO`），該 API 在台灣 LINE OA 的開放狀況與幣別支援未經實測。此為不採用的次要原因，非主因。

### D3：三張表，狀態機集中在 `CouponInstance`

```
Coupon          券主檔（設定）
CouponInstance  每張券的生命週期（核心表）
CouponCode      序號包庫存（僅 imported_codes 模式使用）
```

狀態流轉：`issued → claimed → opened → redeemed`，另有 `expired` / `revoked` 終態。

**核銷防重複**：核銷在 DB transaction 內以條件式更新搶狀態（`WHERE status = 'claimed'`），受影響列數為 0 即表示已被他人核銷，回報「此券已使用」。不依賴應用層檢查，避免併發下的競態。`TenantDb` 型別已含 `Prisma.TransactionClient`，交易可直接使用。

### D4：會員編號對應沿用 `ContactAttribute`，不新建表

`ContactAttribute` 已有 `key` / `value` / `dataType` 與 `@@unique([contactId, key])`，足以承載「此聯絡人對應的商家會員編號」。新建一張 `ContactExternalId` 只會重複既有能力。

### D5：會員綁定的對外 API 走設定驅動

綁定介面在後台以設定描述（端點位址、認證方式、請求／回應格式、欄位對應），由既有的 `executeApiFetchNode` 執行呼叫，而非為每個客戶寫轉接程式。

**理由**：這決定了日後每接一個客戶是「改設定」還是「改程式」。若寫死，核心程式會隨客戶數量腐化。

**限制**：格式特殊（如需簽章、多步驟 OAuth）的客戶仍需寫轉接程式，此為客製層工作。

### D6：不做跨渠道歸戶

系統已有 `IdentityMap`（含 `source`／`confidence`）與 `MergeSuggestion`（含人工審核流程），五種歸戶來源也已定義。但**實查 UAT 兩張表皆為 0 筆**，且四個歸戶函式中僅讀取用的 `resolveUidToContact` 有呼叫端，三個寫入函式（`stitchByPhone`／`stitchByLiffCookie`／`detectPhoneDuplicates`）**無任何呼叫端**——機制從未啟用。

LIFF 主場架構下券只活在 LINE，沒有跨渠道券夾要合併，故本 change 不需要歸戶。

**且歸戶不應埋在本 change**：它是整個 CRM 的會員識別地基（做起來後對話、標籤、消費歷程都能跨渠道整合），應獨立提案。另需注意**合併錯誤比不合併嚴重**——兩人共用公司電話、家人共用 email 都可能誤判，一旦合併 A 會看到 B 的券甚至能核銷。自動歸戶應只採強證據（OTP 驗證），弱證據走人工確認。

### D7：發券沿用既有發送層，依場景選策略

| 場景 | 策略 | 理由 |
|---|---|---|
| 關鍵字領券 | `reply` | 免費；`replyToken` 有效期短（約 1 分鐘、限用一次），須在收到訊息後立即送出 |
| 加好友禮 | `reply` | `follow` 事件亦帶 `replyToken`，免費 |
| 客服對話發券 | `push` | 座席主動挑券，當下通常已無有效 `replyToken` |
| 分眾群發 | `multicast` | service 層已處理 500/批切分 |

發券只需組出一則帶 LIFF 連結的 `OutboundPayload` 並指定 `strategy`，交給既有 `deliverToChannel`。**券的內容在 LIFF 頁，訊息本身只是入口**。SafeReply 降級已內建，reply 失敗自動改 push，不會漏發。

### D8：fan auth 必須補真實身分驗證（LIFF id_token）

現況 `POST /api/v1/fan/auth` 只收 `{ contactId, tenantId }`，查到 contact 存在就發 24 小時 token，**無任何身分驗證**。

目前僅服務活動與點數，風險尚可控；但**券帶金錢價值後屬上線阻斷**——取得或猜到他人 contactId 即可領走、核銷其券。必須與券夾同時完成，不可延後。

⚠️ **前置條件不成立**：LIFF app 須建於 LINE Login channel 之下，客戶短期內無法取得。過渡期改以 Account Link 驗證身分，見 **D11**；本決策於 channel 到位後生效。「不可僅憑 contactId 發 token」的要求兩階段皆適用。

### D9：使用條款支援有限 HTML，需伺服器端消毒

使用條款要能斷行、放連結（如完整規則頁、客服連結），純文字不敷使用。

**允許的標記**：斷行、段落、連結、粗體、項目清單。**不允許**：script、style、iframe、event handler 屬性（`onclick` 等）、`javascript:` 協議的連結。

**消毒在伺服器端做，不信任前端**。儲存時消毒一次（避免髒資料入庫），顧客端輸出時不再二次轉義。

⚠️ **這是系統的新安全面**：目前 codebase 對使用者輸入一律全 escape（`escapeHtml` 在四處各自實作），沒有「允許部分 HTML」的既有機制，也沒有引入消毒套件。實作時需選定並引入一套成熟的 HTML sanitizer，不可自行以正則實作白名單 —— 正則式的 HTML 過濾幾乎必然有繞過方式。

**顯示位置**：券詳情頁（LIFF 內）。這是條款唯一的呈現位置 —— 對話中的發券訊息只帶連結，不含條款內容。

### D11：LINE Login channel 不可得時，以 Account Link 作為過渡認證

**背景**：D8 要求 fan auth 以 LIFF `id_token` 驗證身分，而 LIFF app 必須建立在 **LINE Login channel** 之下。客戶告知短期內無法取得該 channel，D8 的前置條件不成立。

現況 `POST /api/v1/fan/auth`（`portal-auth.service.ts`）**僅憑 contactId 即簽發 24 小時 token，零驗證**，券帶金錢價值後屬上線阻斷，**不可作為過渡**。

**做法**：改用 LINE 官方的 **Account Link**，它只需 **Messaging API channel access token**，不需 LINE Login。

```
1. 顧客於 LINE 對話點「領取優惠券」
2. 後端以 Messaging API 發 linkToken（POST /v2/bot/user/{userId}/linkToken）
3. 產 nonce（CSPRNG、≥128 bit、Base64），存 nonce → contactId，回一則帶連結的訊息：
   https://access.line.me/dialog/bot/accountLink?linkToken={t}&nonce={n}
4. 顧客點擊 → LINE 平台驗證「開連結者即為發 token 的對象」
5. 驗證通過 → LINE 送 accountLink webhook（result=ok，帶 nonce）
6. 以 nonce 反查 contactId，簽發 fan token
7. 進券夾（一般網頁，非 LIFF）
```

**既有基礎**（實查結果）：

| 能力 | 狀態 | 位置 |
|---|---|---|
| 發 linkToken | **現成** | `channel-plugins/src/line/index.ts:613` `issueAccountLinkToken()` |
| webhook 解析 accountLink 事件（含 `nonce`／`result`） | **現成** | 同檔 `:282` |
| nonce → contactId 的對應與寫入 | **缺** | 本 change 實作 |

**安全性優於 D10 的 `claimToken`**：官方文件明載 LINE 平台會驗證「開啟連結者是否為當初發 token 的對象」，驗證失敗送 `result: failed`。因此**連結被轉發，他人開啟亦無法通過**——`claimToken` 的「憑證即所有權」弱點在此不存在。linkToken 規格為**10 分鐘、一次性**（官方註明效期可能變動，不應寫死假設）。

**代價**

| 項目 | 影響 |
|---|---|
| 多一次 LINE 原生「確認連動」畫面 | 體驗多一步 |
| 券夾在外部瀏覽器開啟，非 LINE webview 內 | 回 LINE 需自行返回 |
| 取不到 `displayName`／頭像 | accountLink 只給 userId；需另呼叫 profile 端點 |
| **FB／IG 不適用** | linkToken 綁 LINE userId；FB／IG 仍走 D10 的 `claimToken`，轉發風險依舊 |

**與 D10 的分工**：LINE 走 Account Link（強驗證），FB／IG 走 `claimToken`（弱驗證、限低價值券）。兩者皆不使用未驗證的舊 fan auth 路徑。

**遷移路徑**：Account Link 結果寫入 `ContactAttribute`（`@@unique([contactId, key])` 已就緒），與 D4 會員編號同一套機制。待 LINE Login channel 到位後改走 LIFF `id_token`，**`CouponInstance` 資料結構不變，僅替換認證入口**，非打掉重做。兩種認證可並存一段時間。

**未決**：客戶取得 LINE Login channel 的時程。若逾三個月，Account Link 應視為主力設計而非過渡，LIFF 轉為後續增強。

### D12：顧客身分改用 One ID 歸戶驗證，取代 D11 的 Account Link（2026-10-20）

**決策**：發券訊息帶「票券連結」（Redis 隨機權杖，綁定租戶、聯絡人與該張券，7 天內可重複開啟）。開啟時若聯絡人已完成歸戶驗證，即換發顧客憑證（fan token）；未歸戶則導向租戶啟用的 One ID 登記頁（手機或 email），送出後回到原票券連結。「已歸戶」指顧客本人曾透過 One ID 登記連結成功送出手機或 email，記錄在聯絡人的 `identityVerifiedAt`；客服手動填寫的不算。

**為什麼不用 D11**：實作後發現 Account Link 完成時 LINE 不會把瀏覽器導回我們的頁面，顧客要回聊天室再點一次；Account Link 是為了連結「商家自己的會員帳號」而設計，要求商家提供登入頁；FB／IG 顧客也走不了。使用者決定沿用已上線的 One ID 登記流程。

**連帶改變**：
- 對話中發出的券對象已知，FB／IG 也直接歸戶為已領取（D10 的領取憑證改為只用於公開領券）。歸戶驗證取代了領取憑證原本要防的事：拿到連結的人必須能完成登記，才看得到券。
- 移除 Account Link 的程式（`fan-auth` 模組、`POST /fan/auth` 的票據交換、webhook 的 accountLink 分流）。
- 粉絲門戶與會員綁定使用同一個顧客憑證，也因此恢復可用的登入入口。

**取捨**：票券連結被轉傳時，收到的人仍須以自己的手機或 email 完成登記，登記會把該渠道身分與他的資料合併。這與 One ID 登記連結本身的風險相同，不另外處理。LINE Login channel 到位後改用 LIFF（A4b），票券頁不需要改。

### D13：店員核銷台用門市共用帳號，與座席帳號分開（2026-10-20）

**決策**：新增門市（`stores`）與門市帳號（`store_accounts`）。店員以門市帳號登入核銷台，取得門市憑證（JWT `sub: 'store'`），不使用座席帳號。帳號名稱在所有租戶間不可重複，登入時以帳號名稱找出租戶（比照座席 email）。

**為什麼**：設計稿（Jira CM-197「店員核銷台 v3」）是同一門市的店員共用一組帳號，海報 QR 讓店員用自己的手機開啟。座席帳號是個人帳號、能進後台，給門市店員共用會擴大權限與稽核問題。

**帳號狀態**：門市帳號帶 `passwordVersion` 與 `sessionVersion`，簽進憑證。重設密碼時 `passwordVersion` 加一，強制登出時 `sessionVersion` 加一；每個核銷台 API 都比對，不符就回 PASSWORD_CHANGED 或 SESSION_REVOKED。強制登出作用在帳號的所有裝置；只登出單一裝置要記錄每台裝置的登入，等「櫃檯共用手機」的規則由 PM 確認後再做。

**核銷**：先查券（不改變狀態）再確認。核銷台只核銷店員掃碼券；店員驗證碼券與顧客自助券在顧客手機上核銷。核銷記錄門市 id 與門市名稱快照。重試鍵存 Redis 10 分鐘，同一個鍵回傳第一次的結果。

**手動輸入序號**：比對時忽略連字號、空白與大小寫，不在前端補連字號。原型依寫死的前綴清單補連字號，未知前綴遇到英文開頭的本體會永遠無法完成。

**不做（待 PM）**：櫃檯共用手機（閒置鎖定、解鎖碼）、單一裝置登出、% 折扣券的實際折抵金額（流程中沒有輸入消費金額）。

### D14：對話發券在同一個交易內送出訊息，送不出就不發券（2026-10-21）

**決策**：對話發券在一個資料庫交易內依序做：鎖住這張券（advisory lock）→ 檢查對話範圍、回覆期限、每人上限 → 建立券 → 送出發券訊息 → 寫入對話訊息。訊息送不出就讓交易回滾，券、序號與標籤都不留下。交易逾時延長到 20 秒，涵蓋渠道 API 的回應時間。

**為什麼**：設計稿（Jira CM-196「對話發券 UX 規格」）要求座席清楚知道券到底發出去了沒有，「顧客封鎖」時顯示「券未發出」。先發券再補償刪除要還原序號包、標籤與已發放張數，容易漏；同一個交易回滾不會漏。鎖住券也讓兩位座席同時發券時依序處理，每人上限與發行總量不會超發。

**取捨**：交易持有資料庫連線直到渠道回應，同一張券的發券會排隊。對話發券是座席手動操作，量小，可以接受。訊息送出後交易提交失敗時，顧客會收到連結但查無此券；這種情況極少，查無此券的頁面會請顧客聯絡客服。

**每人上限**：改為已領取、已開啟、已使用的券都計入，已過期與已撤回的不計入（2026-10-21 使用者依設計稿決定）。關鍵字與群發也套用同一規則。系統沒有排程把券改成 EXPIRED，「已過期」以效期判斷（效期已過、未使用），不只看狀態；發券、領取與對話發券面板共用 core `countsTowardContactLimit`。

**發送鍵**：前端每次開啟確認畫面產生一個發送鍵。結果存 Redis 10 分鐘，鍵含租戶 id。網路逾時時前端以發送鍵查詢結果，查到之前不能重送。

**已領取**：新增 `coupon_instances.viewedAt`，已歸戶的顧客第一次從票券連結開啟這張券時寫入。對話發券直接歸戶，`claimedAt` 在發券當下就有值，不能用來判斷顧客是否看過。

**不做（後續提案，待 PM）**：補償原因、座席每月額度、主管核准、申請例外、依金額分級確認。

### D15：email 登記改為先寄驗證碼，驗證通過才寫入與歸戶（2026-10-21）

**決策**：顧客在登記頁送出 email 後，系統寄 6 位數驗證碼到那個信箱，不寫入任何資料。顧客輸入正確的驗證碼後，才依原本的規則寫入 email 或自動合併。驗證碼 10 分鐘有效，最多輸入錯 5 次；錯 5 次後這組驗證碼作廢，顧客要重新送出 email。同一個登記連結最多寄 3 次驗證碼。驗證碼以雜湊存 Redis，不存明文。寄信失敗回 502，連結仍可再用。

**為什麼**：原本的 email 登記不驗證擁有權（2026-10-07 決定），知道別人 email 的人就能把自己併入對方，進而看到對方的券。票券夾以 One ID 判斷身分（D12），這個缺口會讓券被冒領。UAT 已能寄信，email 驗證不需要額外的廠商；手機需要簡訊商，之後再決定。

**連帶變更**：票券頁需要登記時改為 email 優先（原本手機優先），租戶只啟用手機時才用手機。

### D16：對話發券改為「先保留、交易外發送、失敗作廢」，取代 D14 的交易內發送（2026-10-21）

**決策**：
1. 交易內只鎖住券、檢查範圍與上限，建立券（`deliveryPendingAt` 記下開始發送的時間），然後立即提交。鎖只維持幾毫秒。
2. 交易外呼叫渠道 API 送出發券訊息。
3. 送出成功：清除券的 `deliveryPendingAt`，貼領券標籤，寫入對話訊息。
4. 送出失敗：在新交易中刪除這張券並歸還序號包的序號（券從未送到顧客手上，發行總量以券數計算，刪除才能歸還名額）；領券標籤與對話訊息都在第 3 步才寫入，不必撤回。座席看到「券未發出」，和原本一樣。
5. 排程每分鐘把 `deliveryPendingAt` 超過 5 分鐘的券依第 4 步作廢（程式在第 2 步中途結束時）。
6. 顧客端（票券夾、開啟連結、核銷）一律看不到發送中（`deliveryPendingAt` 有值）與發送失敗的券；發送中的券計入每人上限與發行總量，避免同時發送時超發。

**為什麼**：D14 讓同一張券的鎖持有到渠道回應為止。渠道變慢時，同一張券的其他發放（其他座席、顧客領券、自動化）全部排隊，量大時會耗盡連線。新做法保留 D14 要的結果：座席清楚知道有沒有發出去、送不出就不留下券。

**取捨**：渠道已收到訊息、但第 3 步寫入前程式結束時，排程會把券作廢，顧客收到的連結會顯示券已失效。這種情況極少，比卡住所有發放好。

### D17：時間一律以台灣時間計算（2026-10-21）

固定效期的開始日與結束日、領取後 N 天到期、報表的日界，一律以 Asia/Taipei 計算：開始日為當天 00:00（台灣時間），結束日為當天 23:59:59.999（台灣時間）。

### D18：暫停只停止發放，已發出的券依效期決定能不能用（2026-10-21）

券暫停（PAUSED）後不能再發出新券。已發到顧客手上的券能不能核銷，只看這張券的效期與狀態；暫停不影響核銷。「提前結束」（ENDED）是管理者明確要停掉活動，仍依原設計把未使用的券作廢。

### D19：發券只能由人工發，機器人處理中的對話不能發券（2026-10-21）

對話狀態為 `BOT_HANDLED` 時，前端發券按鈕停用並說明「機器人處理中，請先接手對話」，後端回 409 `CONVERSATION_BOT_HANDLED`。座席接手後才能發。

### D20：LINE 顧客以 LINE Login（LIFF ID token）驗證身分，沿用渠道既有的 LIFF App（2026-10-21）

**決策**：
- 租戶在 LINE 渠道設定填「LINE Login Channel ID」（LIFF App 所在的 Login channel，10 位數字），LIFF App ID 沿用渠道既有的 `liffConfig.liffId`（短連結也用它，Endpoint 為 `/liff/redirect`）。不保存 Channel Secret：LINE 的 ID token 驗證 API 只需要 `id_token` 與 `client_id`。
- 兩個都設定時，從該 LINE 渠道發出的票券連結改為 `https://liff.line.me/{liffId}?ct={票券權杖}&lid={liffId}`；沒設定時維持一般網址，走 One ID 登記（D12）。
- LIFF 入口頁偵測到 `ct` 時：`liff.init` → 未登入就 `liff.login` → `liff.getIDToken()` → `POST /api/v1/fan/coupons/liff-session`。
- 後端從票券權杖（伺服器發的隨機值，存 Redis）取得租戶與收券的 LINE 身分，再以該渠道的 Login Channel ID 為 `client_id` 呼叫 `https://api.line.me/oauth2/v2.1/verify`。LINE 會檢查 `aud`，別的租戶或別的 Login channel 簽的 token 驗不過。租戶不從網址參數或 token 自己宣稱的內容判斷。
- 驗證通過且 `sub` 等於收券的 LINE userId：記錄歸戶驗證（方式 `line`），之後照一般流程開啟票券。`sub` 不同（轉傳給別人）：不驗證、回報帳號不符。驗證失敗或未設定：回到一般票券網址，改走 One ID 登記。

**為什麼**：LINE 顧客不必再登記 email；LINE 驗證過的 userId 沒有冒用風險。沿用既有 LIFF App，租戶只多填一個欄位。

**前提**：Login channel 要與官方帳號同一個 Provider（userId 才相同）；LIFF App 的 Scope 要勾 `openid`；Login channel 要發布（Published）一般使用者才能登入。FB、IG、網站客服的顧客維持 One ID 登記（B5 不做：2026-10-21 使用者決定各渠道一律以 One ID 歸戶，票券夾是網頁，不區分 LINE）。

### D21：發券連結的點擊歸因記在券上，不另建短網址（2026-10-21）

票券連結每張券都不同，且 workers（自動化發券）也要產生連結。若改用短網址，每張券會在短網址表多一筆、後台短網址列表被灌滿，workers 也要另外實作短網址。改為在票券連結被開啟時記錄：`coupon_instances.linkOpenedAt`（第一次開啟）與 `linkOpenCount`（開啟次數），未驗證身分的顧客開啟也算。單張券的成效與數據報表都顯示「開啟連結」張數。

### D22：匯出序號明細超過 5,000 筆改背景產生（2026-10-21）

明細不超過 5,000 筆時維持直接下載。超過時 API 回 202 並在背景產生 CSV，檔案存 Redis 24 小時，完成後以站內通知告知匯出者並附下載連結；產生失敗也發通知說明。下載端點只允許匯出者本人與同租戶。

### D23：「已發優惠券」區塊即時更新（2026-10-21）

券發出、顧客第一次開啟、核銷時，API 以 socket 推送 `coupon.instance.updated`（帶 contactId 與 instanceId）到 `tenant:{tenantId}`。右側區塊收到同一位聯絡人的事件就重新載入。

### D24：票券連結要在驗證過的裝置開啟，否則以原 email 驗證碼確認（2026-10-22）

**問題**：D12 只看聯絡人是否「曾經」完成歸戶驗證（`identityVerifiedAt`）。聯絡人驗證過後，這位顧客的任何票券連結點開都直接換發顧客憑證，FB／IG／網站客服的券連結因此等同登入憑證：被轉傳後，別人不用驗證就能打開票券夾，甚至用「顧客自助」核銷。2026-10-22 在 UAT 實測：同一位顧客先用 LINE（LIFF）驗證，之後 Messenger 的券連結點開就直接進去。

**決策（記住裝置＋只認原 email）**：
- **裝置憑證**：顧客在某台裝置完成驗證後，發一個長效的裝置憑證（JWT，`typ: 'fan-device'`、`sub` 為聯絡人、`tid` 為租戶，效期 180 天，與顧客憑證同一把簽章密鑰）。它只用來判斷開啟票券要不要再驗證，不能當顧客憑證（顧客憑證要求 `sub: 'fan'`）。前端存在 `localStorage`：同一個網域可能有多個租戶，存成最多 5 筆的陣列，新的放前面；讀寫失敗時當作沒有。
- **`POST /fan/coupons/session` 收 `deviceTokens`（最多 5 筆）**。聯絡人已歸戶時：任一裝置憑證有效、租戶相同，且聯絡人（兩邊都經合併鏈解析）等於這張券的聯絡人 → `ok`，並回傳換新的裝置憑證；否則聯絡人有 email → `email_code_required`（遮蔽後的 email，例如 `d***@aicreate360.com`，與渠道類型），不提供輸入 email 的機會；沒有 email → 走 email 登記（D12）。所有渠道一律適用。
- **確認身分**：`POST /fan/coupons/session/code` 寄 6 位數驗證碼到聯絡人既有的 email（10 分鐘有效；同一個票券連結 10 分鐘內最多寄 3 次；主旨不含驗證碼），`POST /fan/coupons/session/code/verify` 比對（先計次再以固定時間比較，同一組最多錯 5 次，錯滿作廢需重寄），正確回傳與 `ok` 相同的資料加上裝置憑證。寄送、比對與次數限制與 email 登記（D15）共用同一套程式，驗證碼以票券連結為單位存 Redis。寄信是外部呼叫，在交易外執行，最多一次（失敗不重試、不計次數）。票券連結不存在或過期一律 410。
- **其他取得裝置憑證的時機**：LIFF 驗證通過（D20）回應 `verified` 時附上；email 登記以驗證碼完成並寫入（或因登記合併到）這位聯絡人時附上，登記頁存下後導回票券連結。`merge_requires_chat` 等沒有完成歸戶的結果、手機登記都不給。

**為什麼**：票券連結會被轉傳，「聯絡人驗證過」不代表「開連結的是本人」。以裝置記住本人，顧客在自己的手機上不受影響；換裝置或被轉傳時，驗證碼只寄到原本的 email，拿到連結的人收不到。不讓顧客改填 email，避免轉傳的人填自己的信箱通過驗證。

**殘留風險**：
- 只以 LINE 驗證、沒有 email 的聯絡人，在 LIFF 以外開啟時仍走 email 登記（從票券頁登記不合併，D12 與「從票券頁登記不自動合併帳號」），轉傳的人可以登記自己的 email 而通過；已記在 issue #344，不在這次處理範圍。
- 聯絡人的 email 若是客服在後台填錯的，驗證碼會寄到那個信箱。
- 裝置憑證存在瀏覽器：同一台裝置的其他使用者、或能讀取 `localStorage` 的 XSS 可以使用它；效期 180 天，無法個別撤銷（需要時可換簽章密鑰全部失效）。
- 顧客清除瀏覽器資料、換瀏覽器或用 LINE 內建瀏覽器與一般瀏覽器交替開啟時，要再驗證一次。

## Risks / Trade-offs

| 風險 | 緩解 |
|---|---|
| FB／IG 使用者流失（需跳轉且須為 LINE 用戶） | 提案時確認客戶渠道組成；LIFF 可設定先引導加好友，將發券轉為獲客誘因 |
| 併發核銷造成重複使用 | DB transaction 條件式更新搶狀態，不依賴應用層檢查 |
| 新增權限點後既有租戶 403 | 部署後執行 reconcile 並清權限快取（列入 tasks） |
| 新表漏接 RLS | RLS policy migration 列為 A1 的一部分，並由 `check-tenant-scoping.mjs` 把關 |
| 設定驅動介面設計不足，客製仍需改程式 | 介面設計階段先蒐集 2–3 個真實客戶的 API 規格驗證涵蓋度 |
| LINE Login channel 遲遲未到位 | 過渡走 Account Link（僅需 Messaging API），認證入口可替換、資料結構不變（D11） |
| linkToken 效期由 LINE 決定且可能變動 | 不寫死 10 分鐘假設；過期以「請重新點選領取」引導重試 |
| 領取憑證被轉發，券遭他人領走 | 憑證一次性、短效、僅供領取；訊息明示勿轉發；高價值券限 LINE 發放 |
| 使用條款的 HTML 造成 XSS | 伺服器端以成熟 sanitizer 白名單消毒；禁 script/style/iframe/event handler 與 `javascript:` 連結；不自行以正則實作 |

## Migration Plan

新增三張表，皆為新表，無既有資料需回填。`CouponInstance` 含 `claimToken`（唯一、可為 null）與 `claimTokenExpiresAt`。`ContactAttribute` 沿用既有結構，不變更。

部署順序：migration → RLS policy → reconcile 權限 → 清快取。

## Open Questions

- 客戶取得 LINE Login channel 的時程？逾三個月則 Account Link 應視為主力設計（見 D11）。

- 券圖的儲存走既有 MinIO 或外部 CDN？（影響 A6 的上傳流程）
- 核銷台是否需要獨立登入（店員非系統座席）？目前假設用座席帳號，若商家不願為店員開帳號則需另設計。
