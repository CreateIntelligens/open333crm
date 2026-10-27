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
| 分眾群發 | `multicast` | service 層已處理 500/批切分（附券廣播每人連結不同，改為每人 `push`，見 D29） |

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
- 寄送上限以票券連結為單位：同一位顧客有多張券時，持有多個連結的人可以多寄幾封。信只會寄到顧客自己的 email，連結都是客服發出的，公開端點另有每 IP 每分鐘 60 次的限流，因此不另設聯絡人層級的上限（PR #359 bot 審查）。

**驗證碼的一次性**（PR #359 bot 審查）：比對通過後以 Redis `GETDEL` 取走驗證碼，並行送出同一組碼只有先取走的請求開啟票券；後續開啟票券的交易失敗時，以剩餘效期把驗證碼放回（NX，不覆蓋期間重寄的新碼），顧客可用同一組再試、不必消耗寄送次數。

### 2026-10-22 盤點：發券入口補齊（D25～D33）

**盤點結果**：除了對話發券（A11、D16），只有自動化的「發送優惠券」動作（`issue_coupon`）能發券，而且有下列問題。另有四個功能規格寫了、tasks.md 打了勾，卻沒有實作：

| 項目 | 現況（實查） |
|---|---|
| 自動化選券 | 參數是文字框，要貼券的 UUID（`packages/automation/src/contracts/actions.ts:62-75` 的 `type: 'string'`）；存檔不檢查券存不存在 |
| 自動化發券失敗 | 缺券、券非進行中、已達每人上限、總量或序號用完、找不到渠道身分，全部只寫 log 後 `continue`（`apps/workers/src/lib/automation-actions.ts:561-631`） |
| 自動化訊息送不出 | 先在交易內建券（直接 CLAIMED），再送訊息；`deliverToChannelFromWorker` 的回傳值被忽略，送不出時券留著（:651） |
| reply 從未使用 | `automation.handler.ts:187-200` 沒把 `receivedAt` 傳進動作，`selectSafeLineStrategy` 缺 `receivedAt` 一律回 `push`（`packages/shared/src/safe-reply.ts:14`）。B2.2「關鍵字用 reply」實際上全部走 push、計入訊息額度 |
| 網站客服 | workers 的外掛表只有 LINE／FB／IG（`apps/workers/src/lib/plugin-registry.ts:9-13`，刻意，AUDIT CHAN-02）；WEBCHAT 對話的發券一定送不出，券卻已發出 |
| 關鍵字回覆頁 | 儲存時以固定的 `[send_material]` 覆蓋整個 `actions` 與 `conditions`（`apps/web/src/hooks/useKeywordReplies.ts:106-135`），規則上的 `issue_coupon` 被刪掉 |
| AI 讓步 | `keyword-yield.ts:108` 只把 `send_message` 與同渠道 `send_material` 算成會回覆，只發券的關鍵字規則命中時 AI 仍回覆，顧客一次收到兩則 |
| 歸因 | `issuedVia` 寫觸發事件名稱（`keyword.matched`、`message.received`），後台對照表沒有，序號明細顯示「其他方式」；`issuedRefId` 存券 id，看不出是哪一條規則 |
| 收件匣 | 自動化發券的訊息是純文字（`metadata.source='automation'`），不是券卡；workers 不推 `coupon.instance.updated`，「已發優惠券」不會即時更新 |
| 分眾群發附券（B2.3） | 群發模組（`apps/api/src/modules/marketing/`）完全沒有券；LINE 無變數素材走 multicast，每人連結不同時做不到 |
| 加好友禮（B2.2 的加好友部分） | 沒有 follow 觸發；`follow` 事件以 `contentType='follow'` 的入站訊息經 `message.received` 傳遞，`contact.created` 規則不能選發券 |
| 公開領券（B3.1、B3.3、B3.4 的前提） | `POST /fan/coupons/claim` 還在，但沒有任何程式產生 `claimToken`，也沒有 `/coupon/claim/...` 頁面；海報、圖文選單、短網址沒有可以指向的領券網址 |
| 後台批次發券 | `POST /api/v1/coupons/:id/issue` 沒有畫面、不送訊息、預設 `issuedVia='inbox'`，發出的券被當成對話發券 |

本節的決策以下列原則串起來：**所有發券入口共用同一套「保留 → 送出 → 確認／作廢」（D16）與同一組發放方式代碼（D32）**，失敗一律留下後台看得到的紀錄。2026-10-22 使用者已定案本節所有取捨，以下皆為決策。

### D25：發券改由「關鍵字回覆」與「加好友禮」設定；一般自動化規則不提供發券

**使用者決定**：一般自動化規則不提供「發送優惠券」；關鍵字發券在「LINE 關鍵字回覆」頁設定。加好友禮依同樣原則，在「LINE 管理」新增「加好友禮」設定頁（D28）。

**入口**：
- **自動化規則編輯器**：動作選單不列出「發送優惠券」。契約保留 `issue_coupon`（新增 `editorHidden: true`），否則既有規則會變成「不合契約」而被 workers 整條略過（主規格「不合契約的規則不可啟用」）。
- **既有含 `issue_coupon` 的規則（最小影響）**：照常執行，並套用本節所有後端修正。自動化規則編輯器開啟時，這個動作以唯讀方式顯示券名，註明「發券請到 LINE 關鍵字回覆或加好友禮設定」，可以刪除、不能新增或改券。觸發事件為 `keyword.matched` 的，會出現在關鍵字回覆頁，可在那裡編輯。
- **LINE 關鍵字回覆頁**（`/dashboard/line/keyword-replies`，實查只列 LINE 素材、說明文字寫「對所有 LINE 官方帳號生效」）：表單新增「同時發送優惠券」（下拉選單，只列進行中的券，顯示「券名（CP 券號）· 用途」，行銷與客服補償兩種用途都可以選）與「發不出時回覆顧客」（選填文字，預設空白＝不回覆）。素材改為選填，但素材與優惠券至少要選一個。列表列出含「傳送素材」或「發送優惠券」的關鍵字規則。
- **儲存不再覆蓋**：只更換規則中的「傳送素材」「發送優惠券」動作與關鍵字設定，其他動作（例如加標籤）與其他條件保留原樣。
- **只在 LINE 生效**：這一頁儲存的規則一律帶條件「對話渠道等於 LINE」（已有就不重複加）。實查目前這頁建立的規則沒有渠道條件，在 FB、IG、網站客服的對話也會觸發：素材因渠道不符不送出、留下灰色紀錄，加上發券後就會真的對 FB、IG 發券。加上條件後，頁面說的「LINE 關鍵字回覆」才名副其實。規則傳送的素材不是啟用中的 LINE 素材時（在一般自動化規則建的其他渠道素材、已刪除或已停用），加上 LINE 條件會讓規則從此不再送出，所以這頁擋下存檔並說明原因、列表也標示原因（PR #364 第二輪審查，預防性修正；2026-10-27 UAT 查證 56 條關鍵字規則都是 LINE 素材）。
- **存檔檢查**：API 建立或修改規則時，新增的 `issue_coupon` 動作或更換過的 `couponId` 要是同租戶、進行中的券，否則回 400（比照 `assertSendMaterialReferences`）。這個檢查在 API，所有入口都適用。券沒有更換時不檢查（2026-10-22 審查決定）：券被暫停後，商家仍要能改關鍵字或素材；頁面標示券已暫停，規則觸發時留下 `COUPON_INACTIVE` 紀錄。

**後端流程**（workers，比照 D16）：交易內鎖券、檢查券狀態與渠道、`issueInstances` 建券並寫 `deliveryPendingAt` → 提交 → 交易外送出 → 成功：清除 `deliveryPendingAt`、貼領券標籤、寫入券卡訊息 → 失敗：新交易刪除這張券並歸還序號（`voidPendingInstance` 搬進 `packages/core/src/coupon/`，API 與 workers 共用）。卡住的券由 API 既有的 `coupon-stale-pending-issue` 排程作廢（它本來就掃全部租戶的 `deliveryPendingAt`，不分來源）。

**失敗紀錄**：每一種沒發出的情況都在該對話寫一則系統訊息（`senderType: SYSTEM`、`metadata.source: 'automation'`、`metadata.couponIssueFailed: { ruleId, ruleName, couponId, reason }`），推 `message.new`。渠道拒收的沿用 `deliveryFailed`／`deliveryError`（紅色）；沒有呼叫渠道就決定不發的以灰色提示呈現，文字為「規則「{規則名}」沒有發出優惠券「{券名}」：{原因}」。

| 代碼 | 文字 |
|---|---|
| `COUPON_NOT_FOUND` | 券已刪除或不屬於這個租戶 |
| `COUPON_INACTIVE` | 券不是進行中（已暫停或已結束） |
| `PER_CONTACT_LIMIT_REACHED` | 顧客已達每人領取上限 |
| `TOTAL_LIMIT_REACHED` | 發行總量已發完 |
| `CODES_EXHAUSTED` | 序號包的序號已用完 |
| `NO_CHANNEL_IDENTITY` | 這位聯絡人沒有這個渠道的身分 |
| `CHANNEL_NOT_SUPPORTED` | 這個渠道不支援自動發券（D26） |
| `DELIVERY_FAILED` | 渠道拒收（附渠道錯誤訊息） |

**發不出時回覆顧客**：有填寫時，只在沒有呼叫渠道就決定不發的情況（每人上限、總量、序號用完、券非進行中）送出這段文字；渠道拒收、找不到渠道身分、不支援的渠道不回覆（顧客收不到或不該收到）。

**reply**：`automation.handler.ts` 把 `receivedAt` 傳進動作 context；`keyword.matched` 與 `contact.followed`（D28）帶 `replyToken` 時在 30 秒內走 reply，逾時或失敗改 push（既有 SafeReply）。

**AI 讓步**：`issue_coupon` 算成會回覆的動作，條件是渠道在 `AUTOMATION_DELIVERY_CHANNEL_TYPES` 內且券為 ACTIVE。

**為什麼**：「失敗不可以只寫 log」是專案的硬規則（2026-09-23 關鍵字素材事件）。先建券後送訊息讓送不出的券留在顧客名下、占用名額，與 D16 對話發券的保證不一致。發券設定集中在兩個專用頁，商家不必理解自動化規則編輯器。

**取捨**：既有含 `issue_coupon` 的非關鍵字規則（例如「收到訊息就發券」）仍會執行，顧客達上限後的每則訊息都留下一則灰色提示；不另做節流，提示正好讓商家發現並刪除這種規則。

**殘留風險**：reply 生效後，同一個 replyToken 只能用一次。同一則訊息命中兩條都回覆的規則時，第二條 reply 失敗再改 push，多用一次額度；「每則入站訊息最多一則機器人回覆」已限制大部分情況。

**殘留風險（既有關鍵字規則沒有渠道條件）**：「對話渠道等於 LINE」只在關鍵字回覆頁存檔時補上，不以 migration 批次補到既有規則（2026-10-22 審查決定）。既有規則沒有發券動作，要加發券一定要經過這一頁存檔，存檔時就會補上條件；批次修改既有規則反而會改變商家在 FB、IG 的關鍵字回覆。尚未重新存檔的既有規則仍會在 FB、IG 對話觸發傳送素材，與上線前相同。

### D26：網站客服（WEBCHAT）

**現況**：workers 刻意沒有 WEBCHAT 外掛（`AUTOMATION_DELIVERY_CHANNEL_TYPES = ['LINE','FB','THREADS']`，AUDIT CHAN-02）。WEBCHAT 的 `sendMessage` 是空實作，真正推給訪客的是 API 程序以 Socket.IO `/visitor` namespace 推 `agent:message`。

**決策**：發券的兩個設定入口都只在 LINE 生效（關鍵字回覆頁的規則帶「對話渠道等於 LINE」，加入好友只有 LINE），新設定的規則不會在網站客服觸發，不需要讓 workers 支援 WEBCHAT。只為既有規則保留一道執行時的防線：對話渠道不在 `AUTOMATION_DELIVERY_CHANNEL_TYPES` 內時不建券，留下 `CHANNEL_NOT_SUPPORTED` 灰色提示。

**為什麼**：讓 workers 支援 WEBCHAT 會同時改變 `send_message`、`send_material` 的行為與 AI 讓步規則，屬於自動化整體的變更；入口限定 LINE 之後，發券不再需要它。

### D27：發券規則的歸因與收件匣呈現

**決策**：
- `issuedVia` 改用固定代碼（D32）：`keyword.matched` → `keyword`、`contact.followed` → `follow`、其他事件（只剩既有規則）→ `automation`。`issuedRefId` 改存**規則 id**，`issuedSourceName` 存發券當下的**規則名稱**。序號明細上行顯示規則名稱，下行顯示發放方式。
- 既有資料不回填：後台對照表把 `keyword.matched` 顯示為「關鍵字」，其他含 `.` 的值顯示為「自動化」，不再顯示「其他方式」。
- 送出成功時，workers 寫入的對話訊息改為與對話發券相同的格式：`content: { text, coupon: {...} }`、`senderType: SYSTEM`、`metadata.source: 'automation'`、`metadata.ruleId`／`ruleName`，收件匣畫成券卡，卡片下方寫「由規則「{規則名}」發送」。
- 即時更新：workers 在確認後以 Redis socket 橋接推 `coupon.instance.updated`（`tenant:{tenantId}`，帶 contactId、instanceId、`change: 'issued'`）。這符合 AGENTS.md 的 Path B：事件發生在背景工作，workers 不能用 `fastify.io`。
- **近 90 天補償紀錄不改**（使用者決定）：維持原規格與現有算法。

### D28：加好友禮：新增事件「加入好友」與「加好友禮」設定頁

**現況**：LINE `follow` 事件被當成一則 `contentType='follow'` 的入站訊息處理，經 `message.received` 傳到自動化（帶 `replyToken`），但沒有任何規則能辨認它；`contact.created` 的範圍只有聯絡人，不能選發券；首次招呼語用 push、不用 replyToken。系統沒有記錄加好友、封鎖的時間或次數（`Contact.isBlocked` 只給客服手動設定）。

**決策**：
- 新增自動化事件 `contact.followed`（「加入好友」，只有 LINE 會發出），範圍與訊息事件相同（聯絡人、對話）。API 的 `automation.worker.ts` 收到 `message.received` 且 `contentType='follow'` 時，另外以 `contact.followed` 排入評估，帶 `replyToken`、`receivedAt`、`isFirstFollow`。新增 fact `follow.isFirst`。自動化規則編輯器可用這個事件搭配傳送訊息、傳送素材（不含發券，D25）。
- `channel_identities` 新增 `firstFollowedAt`、`lastFollowedAt`、`followCount`。follow 事件寫入；migration 把既有 LINE 渠道身分的 `firstFollowedAt` 回填為 `linkedAt`。
- **封鎖後再加入不發（使用者決定）**：加好友禮只發給這個渠道身分第一次加入。
- **設定入口**：「LINE 管理」新增「加好友禮」頁：啟用開關、選券（同關鍵字回覆頁的下拉選單）、選填「發不出時回覆顧客」。儲存時建立或更新一條規則：事件 `contact.followed`、條件 `follow.isFirst` 等於是（頁面固定帶上、不能移除）、動作 `issue_coupon`。一個租戶一條，對所有 LINE 官方帳號生效。
- 回覆：用 follow 事件的 replyToken（免費）；30 秒內未送出改 push。發放方式記為 `follow`。

**為什麼**：封鎖再加入刷券是常見的薅羊毛手法；LINE 的 `follow.isUnblocked` 官方註明不保證準確，不能當唯一依據，所以由系統自己記錄。

**取捨**：同時設定招呼語與加好友禮時，顧客會收到兩則（招呼語 push、券 reply）。不合併成一則：招呼語是渠道設定、券是規則，合併要讓兩者知道彼此。

**殘留風險**：回填以 `linkedAt` 推定上線前的好友；上線前只傳過訊息、從未加好友的人第一次真正加好友時拿不到加好友禮。

**實作（A15 15.13～15.16）**：
- **記錄加入**：`processInboundMessage` 存好 follow 訊息之後呼叫 `recordInboundFollow`（`apps/api/src/modules/webhook/inbound-follow-tracking.ts`）。先以條件式更新 `WHERE firstFollowedAt IS NULL` 寫入第一次、最後一次加入時間與次數；更新到 0 列才只更新最後一次加入時間與次數。同一位顧客的兩個 follow 同時處理時只有一個是第一次，加好友禮不會發兩次。判斷依外掛正規化的 `contentType === 'follow'`，不依 `channelType` 分支（結構規則 5）；目前只有 LINE 外掛送出 follow。
- **記錄失敗**：資料庫錯誤時記 log、當成「不是第一次」（寧可少發，不重複發），不擋訊息落地與其他處理；加入事件本身已存成收件匣訊息。
- **事件**：`message.received` 的 payload 在 follow 時帶 `isFirstFollow`。API 的自動化訂閱者收到 `contentType='follow'` 時，`message.received` 的評估不帶文字（不比對關鍵字），另外排入 `contact.followed`：事件 id 相同（規則動作仍以 `<事件 id, 規則 id#序號>` 認領，兩種事件的規則不同），BullMQ job id 為 `<事件 id>-followed`（job id 不能含「:」，也不能與 `message.received` 的相同）。`buildAutomationFacts` 把 `isFirstFollow` 轉成 fact `follow.isFirst`；沒有值時為 null，條件「等於是」不成立（fail-closed）。
- **設定頁**：`useFollowGift` 在自動化規則 API 之上，比照 `useKeywordReplies`：列出事件為 `contact.followed` 的規則，取最早建立、含 `issue_coupon` 的那一條；儲存時固定補上「第一次加入等於是」與「對話渠道等於 LINE」（已有不重複、被移除時補回），只換發券動作的券與「發不出時回覆顧客」，其他動作與條件保留。停用時沒有選券就保留原本的券、只停用。其他不發券的「加入好友」規則（例如歡迎訊息）在頁面上列出並說明兩條都會執行（PR #364 第四輪審查）；加好友禮不併進那些規則，因為它帶「第一次加入」條件，併進去會讓歡迎訊息也只發給第一次加入的人。租戶唯一由頁面維持（不另加資料庫約束）：透過 API 或自動化規則編輯器另建的同類規則仍會執行，頁面只編輯最早的那一條。

**與既有進站流程的互動（2026-10-23 實查）**：一則 LINE follow 事件依序經過：建立聯絡人與渠道身分（第一次出現時發出 `contact.created`）→ 建立對話（沒有進行中的對話時發出 `conversation.created`）→ 存成 `contentType='follow'` 的收件匣訊息 → 記錄加入 → 首次招呼語 → `message.received`（帶 replyToken）→ 營業時間外自動回覆。replyToken 只有一個、只能用一次，各個會送訊息的環節：

| 環節 | 送出方式 | 會不會用掉 replyToken |
|---|---|---|
| 首次招呼語（渠道設定，`sendFirstContactGreeting`） | 在 webhook 內同步 push，`deliverToChannel` 不帶 replyToken | 不會 |
| 營業時間外自動回覆 | 同步 push | 不會 |
| `contact.created`、`conversation.created` 的規則 | payload 沒有 replyToken，workers 一律 push | 不會 |
| `message.received` 的規則（follow 事件也會觸發，既有行為） | 不在回覆類觸發內，push | 不會 |
| 關鍵字規則、AI 回覆 | follow 不帶文字，不比對關鍵字；非文字訊息不做 AI 回覆 | 不會 |
| `contact.followed` 的規則：加好友禮與商家自建的「加入好友」規則 | 30 秒內 reply，失敗改 push（SafeReply） | 會，依規則優先序先到先用 |

所以加好友禮與招呼語不搶 replyToken：招呼語在 webhook 內先 push 送出，顧客先看到招呼語、再看到券。只有商家另外建立「加入好友」並傳送訊息的規則時，兩條規則搶同一個 replyToken：先執行的用 reply，另一條 reply 失敗後改 push，多用一次主動推送額度（與 D25「殘留風險」相同，不另處理）。

**殘留風險（實作）**：
- 上線前已是好友、但從未與官方帳號互動（系統沒有渠道身分、無從回填）的顧客，上線後封鎖再加入時會被當成第一次，領到一次加好友禮。「租戶唯一」原本只靠設定頁維持，使用者決定（2026-10-22）後端也擋：建立或修改規則時，若「加入好友」且含發券的規則已有另一條（未刪除），回 409（`automation.service.ts` `assertSingleFollowGift`）。這是應用層的先查後寫，兩個請求同時建立時仍可能各建一條（PR #364 審查）：不加資料庫約束——規則的動作存在 JSON 裡，部分唯一索引要加 migration，且既有租戶若已有兩條會讓 migration 失敗；規則路由仍用每個查詢各自一個交易的 client，無法在同一交易內加鎖。實際要兩位管理員同時第一次儲存才會發生，兩條規則在規則列表都看得到，指向同一張券時每人上限仍擋下第二張。
- 使用者決定（2026-10-22）：這種顧客視為新好友，可以領一次；之後再封鎖、加回不再發（第一次加入已記錄）。不採用 LINE follow 事件的 `follow.isUnblocked`：官方註明不保證準確，用它會誤擋真正的新好友。
- LINE 重送同一個 follow webhook 時（沒有訊息 id，無法去重），加入次數會多算一次；第二次不是第一次加入，不會重複發券。
- 同一個人加入同一個 provider 下的多個官方帳號時，每個官方帳號的渠道身分各自有「第一次加入」；若兩個身分屬於同一位聯絡人，券的每人領取上限仍會擋下第二張。

### D29：附券廣播：每位收件人各得一張券與自己的票券連結

**現況（實查）**：「行銷活動」（`Campaign`）是容器，旗下有多則「廣播」（`Broadcast`）；一則廣播＝一個渠道＋一個素材＋一個受眾。發送在 API 程序執行（`executeBroadcast`，手動發送在 HTTP 請求內同步跑，排程每 60 秒撈 10 則）。LINE 且素材沒有變數時走 multicast（每批 499），否則每人 push。FB／IG 依 24 小時視窗篩掉視窗外的人。`BroadcastRecipient` 每人一筆但不存失敗原因；LINE 訊息額度只有 MCP 路徑檢查。群發不寫入對話訊息。

**決策**：
- 廣播新增選填的 `couponId`，只能選進行中的行銷券。附券的廣播**一律每人 push**，不走 multicast（每人連結不同）。
- **券的連結放素材可選（使用者決定）**：
  - 素材含 `{{coupon.url}}`：代入收件人自己的票券連結，只送這一則。
  - 素材沒有這個變數：先送素材，再送一則預設的發券文字（含連結）。
  - 沒選素材：只送預設的發券文字。
- **保留／確認／作廢以「帶連結的那則」為準**：每位收件人先保留券，再依序送出；帶連結的訊息送出成功才確認。素材送不出時不送發券文字，券作廢、收件紀錄為失敗。素材成功、發券文字送不出時，券作廢、收件紀錄為失敗、原因註明「素材已送達，優惠券訊息送不出」。LINE 的兩則以同一次推送請求送出（同時成功或失敗）；FB、IG 分兩次呼叫。
- 每位收件人依序：保留（`issueInstances`＋`deliveryPendingAt`，`issuedVia='broadcast'`、`issuedRefId=廣播 id`、`issuedSourceName=廣播名稱`）→ 產生票券連結 → 送出 → 確認或作廢。
- `BroadcastRecipient` 新增 `couponInstanceId`、`skipReason`；`deliveryStatus` 新增 `skipped`。沒拿到券的收件人（已達每人上限、名額或序號用完）**不送訊息**，記 `skipped` 與原因。廣播新增 `couponIssuedCount`；結果頁依原因列出跳過與失敗人數。
- **名額不足**：照名單順序發到名額用完，其餘收件人跳過並回報人數。建立廣播與「可送達人數」預覽時，若受眾大於剩餘名額，顯示警示並要求勾選確認。
- **LINE 訊息額度**：附券廣播發送前以 `getMessageQuota` 檢查，剩餘額度小於「收件人數」就整則不送、不建任何券，回報 `LINE_QUOTA_INSUFFICIENT`。LINE 以收件人數計額度，同一次推送多則訊息只算一次。不附券的廣播是否也檢查，不在本 change 範圍。
- 票券連結：`WalletTokenPayload.conversationId` 改為選填（開啟時沒有讀取它），收件人沒有對話也能產生連結。
  - **實查（2026-10-22）**：開啟票券本身不讀 `conversationId`；只有「需要登記」時，`coupon-wallet.flow.ts` 把它傳給 `reuseOrIssueRegistrationToken`，登記完成後 `identifier-registration.ts` 在那個對話送通知（已登記、需到對話合併、渠道衝突等）。廣播收件人是「在該渠道有身分」的聯絡人，不一定有對話：匯入、合作夥伴寫入、合併帶進來的身分都可能沒有對話。
  - **決策**：登記連結的 `conversationId` 也改選填。連結沒有對話時，登記當下改找顧客在收券渠道最近的對話（顧客收到廣播後常會回訊息，這時已有對話）；仍然沒有就不送通知。登記頁本身會顯示結果，顧客不會漏看。不為了送通知替顧客建立空對話（會出現在收件匣、干擾座席）。
- 執行：附券廣播的「立即發送」改為排入排程立即執行，不在 HTTP 請求內同步跑；同一則廣播重跑時，已有收件紀錄的人不再發券。
- 不在對話寫訊息、不逐人推 `coupon.instance.updated`（與現有群發一致；「已發優惠券」區塊開啟時會載入）。
- **實作備註（2026-10-22）**：
  - 「立即發送」把廣播改為已排程、排程時間為現在，由每 60 秒一次的廣播排程執行（最多約一分鐘後開始），API 回 202。
  - 中斷判定：發送中超過 5 分鐘沒有進度（每處理 20 人更新一次）可以重新排入；收件紀錄在保留券時就寫入，重送時已有紀錄的人（含發送中）一律略過。
  - 執行代次（PR #364 第三輪審查）：「發送中超過 5 分鐘沒有進度」只代表可能中斷，舊的執行也可能只是停滯（例如渠道逾時）而仍在跑。搶占時寫入 `broadcasts.sentAt` 的時間當作這次執行的代次；保留每位收件人前、更新進度、寫入結果與標記失敗時，都要求廣播仍是發送中且 `sentAt` 等於自己的代次，不符就停止、不寫入。已送出訊息的收件人仍照常確認或作廢（那是這位收件人的真實結果）。不加新欄位，沿用 `sentAt`。
  - 重送開始時仍是發送中（pending）的收件紀錄，是上次中斷留下的：改標失敗、原因 `INTERRUPTED`（「發送中斷，無法確認是否送達」），不重送（可能已送達，至多一次）；券仍在發送中，由券的排程作廢並歸還名額。原本這些紀錄永遠停在「發送中」，廣播已完成卻顯示還有人發送中（PR #364 審查）。
  - 收件紀錄的 `skipReason` 同時記跳過（`TOTAL_LIMIT_REACHED`、`PER_CONTACT_LIMIT_REACHED`、`NO_CHANNEL_IDENTITY`、`OUTSIDE_MESSAGING_WINDOW` 等）與失敗（`DELIVERY_FAILED`、`COUPON_MESSAGE_FAILED` 等）的原因；廣播另存 `failureCode`（例如 `LINE_QUOTA_INSUFFICIENT`）。
  - 一次送多則：渠道外掛宣告 `maxMessagesPerSend`（LINE 為 5），呼叫端以 `extraMessages` 帶後續訊息，不在引擎內依渠道類型分支。
  - 券頁批次發券要能回覆所選渠道（渠道可見性 `reply_only`），只列能主動推送的渠道（LINE、Facebook、Instagram）。

**為什麼**：素材可選讓商家能沿用現成的素材，不必為了放連結重做；以帶連結的那則為準，是因為顧客沒收到連結就等於沒拿到券，名額要歸還。

**取捨**：素材沒有連結變數時，顧客收到兩則；素材成功、發券文字失敗時，顧客收到了講這張券的素材卻沒有連結，結果頁會列出這些人。

**殘留風險**：
- 每人 push 對大名單較慢（每人一到兩次 API 呼叫加兩個短交易），也不能用 multicast 節省呼叫次數。LINE 額度以收件人數計，與 multicast 相同，不會多花錢。
- 廣播仍在 API 程序執行（不搬到 workers）；程式在發送途中結束時，發送中的券由排程作廢，廣播狀態停在 sending，需要人工重送（現有群發也是如此）。
- FB／IG 附券廣播依 24 小時視窗只送給視窗內的人（主規格既有行為）。

### D30：公開領券：以「傳訊領券」連結與 QR Code 實作

**問題**：海報、官網、圖文選單上的連結不知道是誰在點。網頁上能確認的身分只有 LIFF（只限 LINE 且要 Login channel）與 email 驗證碼。

**決策：傳訊領券**。每張行銷券可建立多個「領券連結」（各有名稱，例如「門市海報」「官網橫幅」），連結開啟公開的領券頁 `/coupon/claim/{代碼}`，顯示券名與面額，以及各渠道的按鈕：LINE「加入好友」＋「傳送領券訊息」（`line.me/R/oaMessage/{basicId}/?{預填文字}`）、Facebook／Instagram 以 `m.me`、`ig.me` 的 `ref` 帶代碼。顧客送出訊息後，系統在入站處理辨認領券代碼，對這位聯絡人發券並以 reply 回覆（免費），流程同 D25 的保留、送出、確認。

**為什麼不做網頁領券**：email 領券的聯絡人沒有任何渠道身分、無法收訊息；一個人用多個 email 就能繞過每人上限；要新寫建立聯絡人與歸戶的流程。傳訊領券的身分就是渠道身分，顧客會成為好友、券歸戶在有對話的聯絡人；做法與既有的跨渠道綁定代碼（`binding-links.ts` 的 oaMessage 預填、IG／FB 的 `ref` 導流）相同。

**細節**：
- 新表 `coupon_claim_links`（RLS）：`couponId`、`channelId`（領券訊息送到哪個官方帳號或粉專）、`name`、`code`（8 碼，字集同券碼，全系統唯一，因為公開網址不帶租戶）、`status`（ACTIVE／DISABLED）、`startAt`／`endAt`（選填）、`openCount`、`claimCount`、`createdById`。一張券可以有多個連結，供不同投放位置歸因。
- 後台：券詳情頁新增「領券連結」分頁：建立、停用、重新啟用、下載 QR Code（PNG，沿用 `shortlink/qrcode.service.ts`）、複製網址、看開啟數與領取數。**只有行銷券能建立領券連結**（公開散布的券沒有對象，補償券不應公開）。
- 入站：文字含領券代碼的訊息，或帶 `ref=coupon_{代碼}` 的 FB／IG 導流事件，在 AI 與關鍵字規則之前處理，該則訊息不再觸發 AI 回覆與關鍵字規則（比照綁定代碼的處理位置）。
- 領取規則：連結 ACTIVE、在期間內、券 ACTIVE；遵守每人上限與發行總量。成功與失敗都以 reply 回覆顧客（失敗原因：活動已結束、已領過、已發完），並在對話留下系統紀錄。發券訊息本身送不出時，作廢券後再回覆一次「目前無法發送優惠券，請稍後再試一次」（只試一次、不重試；券已作廢，說明與結果一致），對話留下顧客實際收到的說明（PR #364 第四輪審查）。
- 歸因：`issuedVia='public_link'`、`issuedRefId=連結 id`、`issuedSourceName=連結名稱`。
- 代碼只在連結指定的渠道生效；送到同租戶的其他渠道時回覆「請到 {渠道} 領取」，不發券。
- **移除既有的領取憑證**：`POST /fan/coupons/claim` 與 `issueInstances` 的 `requireClaim` 移除（目前沒有任何呼叫端會產生憑證）；`claimToken`、`claimTokenExpiresAt` 欄位先保留，之後另做清理 migration。coupon-redemption 的「待領取的券憑領取憑證歸戶」改寫為「發券一律直接歸戶」。

**殘留風險**：
- 預填文字可以被顧客改掉；系統只認代碼（大小寫、全形、空白不影響）。
- 代碼是公開的，任何人都能傳；每人上限與總量是唯一的防線。高價值券不應做公開領券。
- 非好友在 LINE 送不出訊息，領券頁的「加入好友」步驟不能省。

### D31：後台批次發券與附券廣播合併為同一套引擎

**比較**：

| | 一、各做一套 | 二、合併（採用） |
|---|---|---|
| 入口 | 廣播頁選券；券詳情頁「發送給…」另一套 | 兩個入口，都建立一則附券廣播 |
| 送出、作廢、額度、24 小時視窗、報表 | 兩份 | 一份（D29） |
| 券頁發送的紀錄 | 要另建「批次」表或只留在序號明細 | 在廣播列表與結果頁都看得到 |
| 工作量 | 多約 2～3 天，且兩邊行為會漸漸不一致 | 券頁只多一個精簡表單 |

**決策**：
- 券詳情頁新增「發送給…」：選一個渠道（不跨渠道，與廣播一致）、選對象（標籤、分眾，或搜尋聯絡人逐一勾選，最多 1,000 人）、可選訊息文字（沒填用預設發券文字；有填時連結附在文字後），送出前顯示可送達人數、剩餘名額與已達上限人數。
- 送出時建立一則附券廣播（`issuedVia='batch'`、`issuedByName=操作的使用者`、`issuedSourceName='批次發放 {YYYY-MM-DD HH:mm}'`），走 D29 的引擎；完成後在券詳情頁顯示結果。
- **權限只需要 `coupon.issue`**：券頁建立的廣播只能帶這張券與發券文字，不能選素材，風險與發券相同。行銷與客服補償券都可以批次發（附券廣播的「只限行銷券」只限制廣播頁）。
- **`POST /api/v1/coupons/:id/issue` 保留給系統整合**（CLI、合作夥伴）：不送訊息；`issuedVia` 預設改為 `api`，拒絕 `inbox`、`keyword` 等系統保留的代碼。

### D32：發放方式代碼統一

`issuedVia` 只寫下列代碼。後台對照表與 core 的 `couponSourceName` 同步：

| 代碼 | 顯示 | `issuedRefId` | `issuedSourceName` |
|---|---|---|---|
| `inbox` | 對話發券 | 座席 id | 對話發券 |
| `keyword` | 關鍵字 | 規則 id | 規則名稱 |
| `follow` | 加好友 | 規則 id | 規則名稱 |
| `automation` | 自動化 | 規則 id | 規則名稱（只有既有規則） |
| `broadcast` | 廣播 | 廣播 id | 廣播名稱 |
| `batch` | 批次發放 | 廣播 id | 批次發放 {時間} |
| `public_link` | 公開領券 | 領券連結 id | 連結名稱 |
| `api` | API | 呼叫者帶入 | 呼叫者帶入或「API」 |

舊值 `keyword.matched` 顯示「關鍵字」，其他含 `.` 的舊值顯示「自動化」。

### D33：tasks 打勾但未實作的項目改回未完成

B2.2（關鍵字與加好友用 reply）、B2.3（分眾群發）、B2.5（FB／IG 領取憑證連結，已被 D12 取代）、B3.1、B3.3、B3.4（圖文選單、卡片、短網址指向領券頁：沒有公開的領券網址可以指向）改回未完成或註明取代，新工作列在 tasks「A15」。

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
| 附券廣播對大名單較慢、名額或額度不足 | 每人 push；發送前檢查 LINE 額度與剩餘名額並警示（D29） |
| 公開領券代碼被大量散布、刷券 | 每人上限與發行總量為防線；只限行銷券；連結可設期間與停用（D30） |
| 使用條款的 HTML 造成 XSS | 伺服器端以成熟 sanitizer 白名單消毒；禁 script/style/iframe/event handler 與 `javascript:` 連結；不自行以正則實作 |

## Migration Plan

新增三張表，皆為新表，無既有資料需回填。`CouponInstance` 含 `claimToken`（唯一、可為 null）與 `claimTokenExpiresAt`。`ContactAttribute` 沿用既有結構，不變更。

部署順序：migration → RLS policy → reconcile 權限 → 清快取。

## Open Questions

- 客戶取得 LINE Login channel 的時程？逾三個月則 Account Link 應視為主力設計（見 D11）。

- 券圖的儲存走既有 MinIO 或外部 CDN？（影響 A6 的上傳流程）
- 核銷台是否需要獨立登入（店員非系統座席）？目前假設用座席帳號，若商家不願為店員開帳號則需另設計。
