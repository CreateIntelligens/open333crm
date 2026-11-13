# 04 Meta 權限、Webhook 與 App Review 規劃

> 對象：不熟技術的使用者與平台管理員。說明「留言關鍵字自動私訊」要向 Meta 申請什麼、在哪裡設定、怎麼送審。
> 範圍：只做規劃和唯讀查詢。本文件撰寫時**沒有修改任何 Meta App 設定**，沒有訂閱 webhook，也沒有送審。
> 查證日期：2026-11-13。App 狀態用 Meta Social Technologies MCP 的唯讀工具查到（`devtools_app_list`、`devtools_app`、
> `devtools_app_review`、`devtools_webhook_list`）。Meta 規則用 `devtools_discovery` 查官方文件，來源網址列在第 9 節。

---

## 0. 先看結論（三分鐘版）

1. **FB 的核心功能（收留言、私訊留言者）可能已經可以用。** 依官方文件，收 `feed` 留言要 `pages_manage_metadata`
   與 `pages_show_list`，送 Private Reply 要 `pages_messaging`。這三個權限創造智能 App 都**已有進階存取權限（Advanced Access）**。
   還沒做的事是：在 App 後台訂閱 `feed` 欄位，並讓每個已連結的粉專重新訂閱一次。上線前要先實測（見 §4）。
2. **FB 的「列出最近貼文」「用網址找貼文」「公開回覆留言」需要 `pages_read_engagement`。** 這個權限**已經被退件兩次**
   （2026-10-17、2026-11-01）。公開回覆另外要 `pages_manage_engagement`，這個權限**從來沒有申請過**。
3. **IG 部分全部要送審。** 需要 `instagram_business_basic`、`instagram_business_manage_comments`（另要確認
   `instagram_business_manage_messages`）。MCP 查到的狀態都是「沒有進階存取權限」。創造智能自己的 IG 帳號現在收得到私訊，
   因為這個帳號屬於擁有 App 的同一個商家，標準存取權限（Standard Access）就夠。其他客戶（租戶）的 IG 帳號一定要先通過審核。
4. **送審前要先修 App 的基本資料**：「資料刪除網址」目前填 `https://www.facebook.com/`，不是真正的刪除說明頁。
   隱私權政策網址指向 `fanpokka.ai`，聯絡信箱還沒驗證。這些都可能害送審被退。
5. **Webhook 共用風險**：留言和私訊用同一個回呼網址（UAT）。留言處理如果拖慢或出錯，連續失敗 1 小時後，Meta 會把
   **整個粉專或 IG 帳號的 webhook 停掉**，私訊也一起收不到。所以留言一定要丟進背景佇列，webhook 要馬上回 200。

---

## 1. 目前 App 狀態（2026-11-13 唯讀查詢結果）

### 1.1 App 基本資料（`devtools_app basic_settings`）

| 項目 | 目前值 | 評估 |
| ---- | ------ | ---- |
| App | 創造智能（`671495162407854`），屬於商家 `1185537018295365` | 你在這個 App 的角色是管理員 |
| 模式 | `live_mode`（已發佈） | 正確。IG 要已發佈才收得到 webhook（記憶 project_ig_threads_channel） |
| 分類 | `MESSENGER_BOT` | 可以 |
| 隱私權政策網址 | `https://fanpokka.ai/privacy-policy` | **要確認**：這個網域和 open333CRM 不同。政策內容要寫到「讀取粉專/IG 留言、傳私訊、資料保存與刪除」 |
| 服務條款網址 | 同上（和隱私權政策同一頁） | 建議分開 |
| 資料刪除網址 | `https://www.facebook.com/` | **一定要修**。要換成真正的「如何刪除資料」說明頁，或資料刪除回呼網址 |
| 聯絡信箱 | `daniel@aicreate360.com`，**未驗證** | 建議先驗證，Meta 的退件通知會寄到這裡 |
| 商家驗證 | `business_verification_passes: true` | **已通過**，不需要再做 |

### 1.2 權限現況（`devtools_app_review privileges`）

| 權限 | 存取等級 | 狀態 |
| ---- | -------- | ---- |
| `pages_show_list` | 進階 | 已核准 |
| `pages_manage_metadata` | 進階 | 已核准 |
| `pages_messaging` | 進階 | 已核准 |
| `pages_read_engagement` | 無 | **已退件**。退件兩次，目前有一份草稿（用途說明已填，**螢幕錄影、API 測試呼叫還沒完成**） |
| `pages_manage_engagement` | — | **不在清單上**，代表從沒申請過 |
| `instagram_business_basic` | 無 | 顯示「REJECTED」 |
| `instagram_business_manage_messages` | 無 | 顯示「REJECTED」 |
| `instagram_business_manage_comments` | 無 | 顯示「REJECTED」 |
| `instagram_manage_comments`（FB 登入版） | 無 | 顯示「REJECTED」，本功能不用 |
| `Human Agent`、`Business Asset User Profile Access` 等 | 無 | 顯示「REJECTED」，本功能不需要 |

> 注意：送審紀錄裡只有兩次送審，兩次都**只包含 FB 權限**（見 1.3），從沒送過 IG 權限。所以 IG 權限顯示「REJECTED」
> 而且沒有退件原因，比較可能代表「沒有進階存取權限」，不是真的被退件。**需在 App Dashboard 的「App Review → 權限和功能」確認。**

### 1.3 送審紀錄（`devtools_app_review history / status`）

| 送審編號 | 送出 | 審完 | 內容 | 結果 |
| -------- | ---- | ---- | ---- | ---- |
| 969577632599604 | （更早） | 2026-10-17 | `pages_show_list`、`pages_manage_metadata`、`pages_messaging`、`pages_read_engagement` | 前三個核准，`pages_read_engagement` 被退 |
| 1100346586189374 | 2026-10-19 | 2026-11-01 | `pages_read_engagement` | 被退（退件原因代碼 `1001091828775933`，MCP 查不到文字說明，要到 App Dashboard 看） |

實際經驗：第二次送審花了 **13 天**。

### 1.4 Webhook 訂閱現況（`devtools_webhook_list list_subscriptions`）

| 主題 | 回呼網址 | 目前訂閱的欄位 | 本功能缺少 |
| ---- | -------- | -------------- | ---------- |
| `page`（FB） | `https://uat.open333crm.create360.ai/...` | `messages`、`messaging_postbacks`、`messaging_optins`、`messaging_optouts`、`message_deliveries`、`message_reads`、`message_echoes`、`message_edits`、`message_reactions`、`messaging_referrals`、`messaging_handovers`、`affiliation` 等 18 個 | **`feed`** |
| `instagram` | 同上 | `messages`、`messaging_postbacks`、`messaging_referral` | **`comments`** |

可訂的欄位清單（`list_topics`）確認 page 主題有 `feed`，instagram 主題有 `comments` 與 `live_comments`。

### 1.5 程式現況（和權限有關的部分）

- `apps/api/src/modules/meta-connect/meta-connect.service.ts`
  - `SUBSCRIBED_FIELDS = ['messages', 'messaging_postbacks', 'messaging_referrals', 'message_echoes']`：粉專連結時用
    `POST /{page-id}/subscribed_apps` 訂閱這 4 個欄位，**沒有 `feed`**。
  - `LEGACY_SCOPES = ['pages_show_list', 'pages_manage_metadata', 'pages_messaging', 'pages_read_engagement']`：
    只在**沒有設定** `META_LOGIN_CONFIG_ID` 時使用。有設定時，要求哪些權限是由 App 後台的「Facebook Login for Business 設定」決定，
    **改程式沒有用，要到後台改那份設定**。
- `packages/channel-plugins/src/threads.ts`：IG 走 Instagram Login（`graph.instagram.com`）。程式裡沒有 IG 的 OAuth 流程，
  IG 渠道的存取權杖是使用者在 App 後台產生後**手動貼進來**的。要加權限，就要在後台重新產生權杖，再貼回渠道設定。

---

## 2. 權限總表

欄位說明：
- **需要審核？**：「是」代表要幫其他客戶（不在 App 上有角色、也不屬於創造智能商家）的粉專/IG 使用，就要有進階存取權限，必須送 App Review。
- **優先級**：必要＝沒有就做不出核心功能；公開回覆才需要；選用＝有了比較好用，沒有可以退而求其次。

### 2.1 Facebook（Facebook Login for Business／粉專權杖）

| 權限 | 白話用途 | 本功能哪一步用到 | 需要審核？ | 目前 App | 優先級 |
| ---- | -------- | ---------------- | ---------- | -------- | ------ |
| `pages_show_list` | 列出使用者管理的粉專，讓他挑要連結哪一個 | 連結粉專；官方文件寫明 `feed` webhook 也需要 | 是 | **已有（進階）** | 必要 |
| `pages_manage_metadata` | 讓 App 訂閱粉專的 webhook | 收留言（訂閱 `feed`） | 是 | **已有（進階）** | 必要 |
| `pages_messaging` | 用粉專身分傳 Messenger 訊息 | 私訊留言者（Private Reply）；留言者回覆後的後續對話 | 是 | **已有（進階）** | 必要 |
| `pages_read_engagement` | 讀粉專的貼文、留言、按讚等內容 | 「從最近貼文挑選」（`GET /{page-id}/published_posts`）、用貼文網址換貼文 ID、讀已選貼文的摘要與縮圖；公開回覆時也要 | 是 | **已被退件兩次** | 列貼文：選用（可退回「手動貼貼文 ID」）；公開回覆：必要 |
| `pages_manage_engagement` | 用粉專身分留言、回覆留言 | 公開回覆留言（`POST /{comment-id}/comments`） | 是 | **從沒申請**；標準存取狀態需在 App Dashboard 確認 | 公開回覆才需要 |
| `pages_read_user_engagement` | 讀留言者等使用者在粉專上的互動資料 | 官方「Comments and @mentions」頁把它列為留言功能的權限之一。若 webhook 的 `from.name`（留言者名稱）拿不到，就要這個 | 是 | 未申請，需在 App Dashboard 確認 | 選用（先實測 webhook 有沒有帶名稱） |
| `Business Asset User Profile Access`（功能） | 用 PSID 查使用者名稱、大頭照 | 補留言者名稱、大頭照（webhook 沒帶時） | 是 | 無 | 選用 |
| `Page Mentioning`（功能） | 公開回覆時 @標記留言者 | **本版不做 @標記**，不需要 | — | — | 不需要 |

> 依據：Private Replies（Messenger）文件只寫需要 `pages_messaging`＋有 MESSAGING 任務的粉專權杖；Webhooks for Pages 文件寫
> `feed` 需要 `pages_manage_metadata`＋`pages_show_list`。所以**收留言＋私訊這兩步不需要 `pages_read_engagement`**。
> 不過 Meta 實際行為偶爾比文件嚴格，第 4 節的實測一定要做。

### 2.2 Instagram（Instagram API with Instagram Login，`graph.instagram.com`）

| 權限 | 白話用途 | 本功能哪一步用到 | 需要審核？ | 目前 App | 優先級 |
| ---- | -------- | ---------------- | ---------- | -------- | ------ |
| `instagram_business_basic` | 讀 IG 專業帳號的基本資料與貼文（media）清單 | 一切 IG 功能的前提；「從最近貼文挑選」（`GET /me/media`）；用貼文網址比對 `permalink` | 是 | 無進階存取（需在 App Dashboard 確認） | 必要 |
| `instagram_business_manage_comments` | 讀留言、回覆留言、收 `comments` webhook | 收留言（`comments` webhook）、讀留言者帳號名稱（2024-08-27 起沒有這個權限就拿不到 `username`）、公開回覆留言（`POST /{ig-comment-id}/replies`）、Private Reply | 是 | 無進階存取 | 必要 |
| `instagram_business_manage_messages` | 傳收 IG 私訊 | Private Reply 走的是私訊 API（`POST /me/messages`）；留言者回覆後的對話。現有 IG 私訊功能本來就要它 | 是 | 無進階存取 | 必要 |
| `instagram_business_content_publish` | 發佈貼文 | 不需要 | — | — | 不需要 |
| `ads_read`／`ads_management` | 讀廣告 | 只有「Instagram API with Facebook Login」且透過企業管理平台取得粉專角色時才需要。我們走 Instagram Login，**不需要** | — | — | 不需要 |

> 補充：IG 的公開回覆和私訊用的是同一個 `instagram_business_manage_comments`，所以 IG 不會像 FB 那樣「私訊可以、公開回覆不行」。
> 只要這個權限沒過，IG 的收留言、私訊、公開回覆全部都不能用在其他客戶身上。

### 2.3 不需要申請的東西

- **商家驗證**：已通過（`business_verification_passes: true`）。
- **`live_comments`**：直播留言這一版不做，不訂閱。
- **Marketing Message API、message tag**：Private Reply 不需要。留言者回覆後走一般 24 小時視窗。

---

## 3. Webhook 訂閱清單

### 3.1 要加的欄位

| 平台 | 主題 | 要加的欄位 | 不加的欄位 | 設定位置 |
| ---- | ---- | ---------- | ---------- | -------- |
| FB | `page` | `feed` | — | App Dashboard → 創造智能 → 「Webhooks」（或 Messenger 使用案例的 Webhooks 設定）→ 物件選「Page」→ `feed` 按「訂閱」 |
| IG | `instagram` | `comments` | `live_comments`（不做）、`mentions` | App Dashboard → 「Instagram」使用案例 →「API setup with Instagram login」→「設定 Webhooks」→ `comments` 按「訂閱」 |

回呼網址和驗證權杖沿用現在的設定，不用改。

> `feed` 欄位會送來很多種事件：發文、按讚、分享、留言編輯、刪除……本功能只處理 `item=comment` 且 `verb=add`，其他一律略過，但
> **還是要快速回 200**。另外按讚通知只有粉絲數低於 1 萬的粉專才會送。廣告貼文本身不會送 webhook，但廣告貼文底下的留言會送，
> 而且可能重複送（IG 文件也寫了這點），所以要防重複。

### 3.2 App 層訂閱和粉專層訂閱是兩件事

FB 要兩層都訂才會收到：

1. **App 層**（上面 3.1）：告訴 Meta「這個 App 想收 `feed`」。一個 App 做一次，**所有粉專共用**。
2. **粉專層**：每個粉專都要用自己的粉專權杖呼叫 `POST /{page-id}/subscribed_apps`，`subscribed_fields` 加上 `feed`。
   目前程式只訂了 4 個 messaging 欄位。

| 情況 | 要不要重新呼叫 `subscribed_apps`？ |
| ---- | ---------------------------------- |
| 新連結的粉專 | 程式把 `feed` 加進 `SUBSCRIBED_FIELDS` 後，連結時自動訂閱 |
| **既有已連結的粉專**（例如 Open333test `1132326913296788`、創造智能 `126104163728610`） | **要**。做法有兩種：(a) UX 規劃的「開啟留言接收」按鈕（`01-ux.md` 狀態 B），用現有粉專權杖補訂閱；(b) 部署時跑一次性腳本。粉專權杖有 `pages_manage_metadata` 就夠，不必重新走 OAuth |
| 舊模式（手動貼權杖、`/fb/:channelId` 網址）的粉專 | 同上，但要確認那把權杖是創造智能 App 產生的。不是的話，訂到的是別的 App |
| 用粉專權杖補訂閱時 | 一定要**把原本的 4 個欄位一起帶上**（`messages,messaging_postbacks,messaging_referrals,message_echoes,feed`）。只帶 `feed` 的話，結果會只剩 `feed`，私訊會收不到 |

IG（Instagram Login）也有帳號層訂閱：`POST graph.instagram.com/me/subscribed_apps?subscribed_fields=messages,comments,...`。
目前 IG 渠道是在後台產生權杖、手動貼進系統，帳號層訂閱可能是在 App 後台產生權杖那一頁打開的。**需在 App Dashboard 確認**，
必要時要補打一次（同樣要帶上原本的 `messages` 等欄位）。

---

## 4. 審核通過前能做什麼（Standard Access）

### 4.1 規則

- Standard Access（標準存取權限）只對兩種帳號生效：
  1. 在 App 上有角色的人（管理員、開發者、測試人員）。
  2. 屬於擁有 App 的同一個商家（創造智能商家 `1185537018295365`）、而且已加進 App 的粉專或 IG 帳號。
     IG 官方文件寫：「你自己擁有或管理、並加進 App 的 IG 專業帳號用 Standard Access 就可以；服務別人的帳號要 Advanced Access」。
- Messenger 的 Private Replies 文件另外寫：「Standard Access 的 App 只能存取 App 上有角色的人的資料」。所以未審核的權限，
  **留言的人**最好也是 App 上有角色的帳號，測試才會穩定。

### 4.2 怎麼測

| 要測的事 | 誰的帳號 | 怎麼做 | 現在能不能測 |
| -------- | -------- | ------ | ------------ |
| FB 收留言＋私訊 | 粉專：Open333test 或創造智能粉專；留言者：任何人（`pages_messaging`、`pages_manage_metadata` 已是進階） | 在 App 層訂閱 `feed`，替粉專補訂閱，再用一般個人帳號在貼文留關鍵字 | 可以，**但會動到正式 App**（UAT 就是正式環境）。動手前要先問使用者 |
| FB 公開回覆 | 粉專管理員必須是 App 上有角色的人；留言者建議也有角色 | 粉專管理員重新連結並同意 `pages_manage_engagement` | 要先在 App Dashboard 把 `pages_manage_engagement` 加進「權限和功能」（標準存取通常預設可用，需確認），以及加進 Facebook Login for Business 設定 |
| FB 列最近貼文 | 同上 | `pages_read_engagement` 標準存取 | 有角色的帳號可測 |
| IG 收留言＋私訊＋公開回覆 | IG 帳號：創造智能 IG（屬於同一商家）或測試用 IG；留言者：加成「Instagram 測試人員」的 IG 帳號 | 在 App 層訂閱 `comments`，重新產生含 `instagram_business_manage_comments` 的權杖，貼回渠道 | 可以，有角色的帳號才會穩定生效 |

### 4.3 要把誰加成測試人員

在 App Dashboard →「應用程式角色」→「角色」：

- **Facebook 測試人員或開發者**：負責錄影的同仁（例如 daniel）、要在 FB 貼文留言的測試帳號。
- **Instagram 測試人員**：在「角色」頁的「Instagram 測試人員」加入 IG 帳號名稱。對方要到 IG App →「設定 → 應用程式和網站 → 測試人員邀請」按接受，才會生效。
- **送審用的審查帳號**：記憶提到有 `meta-reviewer` 審查帳號（CRM 後台登入用）。送審時要提供 Meta 審查員能登入 open333CRM 的帳號密碼，
  以及一個能用的粉專/IG 測試帳號。

> 記憶提醒：Meta 會擋「把企業管理平台成員加成 App 角色」，這是正常的。創造智能 IG 是以企業管理平台成員身分運作，不需要另外加。

---

## 5. App Review 送審準備

### 5.1 每次送審都要準備的東西

| 項目 | 要求 | 目前狀態 |
| ---- | ---- | -------- |
| 隱私權政策網址 | 公開可開、內容寫到會讀取的資料（粉專/IG 留言內容、留言者 ID 與名稱）、用途、保存期限、怎麼刪除 | 有網址，但網域是 `fanpokka.ai`，**內容要檢查** |
| 資料刪除網址或回呼 | 要給一個真正的頁面，說明使用者怎麼要求刪除資料（或實作 Data Deletion Callback） | **目前是 `https://www.facebook.com/`，一定要修** |
| App 圖示、分類、聯絡信箱 | 圖示已有；信箱建議驗證 | 信箱未驗證 |
| 商家驗證 | 進階存取需要 | **已通過** |
| 每個權限的用途說明 | 寫清楚「誰在什麼畫面做了什麼，App 才呼叫這個權限」 | 見 5.2 |
| 每個權限的螢幕錄影 | 從登入開始，完整拍出使用者授權→使用功能→看到結果 | 見 5.3 |
| API 測試呼叫 | 送審前，每個權限在最近 30 天內至少成功呼叫過一次（Dashboard 的「API 測試呼叫」步驟） | `pages_read_engagement` 這一步**還沒完成** |
| 審查員測試帳號與步驟 | CRM 後台帳密、可用的粉專/IG、照著做就能重現的步驟 | 見 5.4 |

### 5.2 用途說明範例（中英）

送審表單要用英文填，中文版給內部對照。

**`pages_read_engagement`**

> 中文：open333CRM 是商家使用的客服系統。商家管理員在「留言自動私訊」頁建立規則時，系統會列出他粉專最近發佈的貼文
> （縮圖、內文前幾個字、發佈時間），讓他挑選規則要套用在哪幾篇貼文。系統也會讀取被選貼文的摘要，顯示在規則列表與觸發紀錄中。
> 我們只讀取商家自己粉專的貼文，不讀取個人動態，也不在資料庫鏡像貼文內容。
>
> English: open333CRM is a customer service platform used by businesses. When a Page admin creates a rule on the
> "Comment Auto-Reply" page, we call `GET /{page-id}/published_posts` to show the Page's recent posts (thumbnail,
> first line of text, publish time) so the admin can choose which posts the rule applies to. We also read the
> summary of selected posts to display it in the rule list and in the trigger log. We only read posts published by
> the business's own Page. We do not store copies of post content.

**`pages_manage_engagement`**

> 中文：商家可以選擇在自動私訊留言者之後，用粉專身分在原留言底下公開回覆一段簡短文字（例如「已私訊給你，請查看 Messenger」），
> 讓其他粉絲知道商家有回應。這個選項預設關閉，商家要自己在規則中開啟並填寫文字。系統對同一則留言最多公開回覆一次，
> 私訊沒有送出時也不會公開回覆。
>
> English: After sending a Private Reply to a commenter, a business can optionally post a short public reply under
> the original comment as the Page (for example, "We've sent you a message, please check Messenger"), so other
> followers can see that the business responded. This option is off by default. The admin must turn it on and
> write the reply text in the rule. We post at most one public reply per comment, and we do not post a public
> reply if the private message was not sent.

**`instagram_business_basic`**

> 中文：商家把 IG 專業帳號連結到 open333CRM 後，系統讀取帳號名稱與大頭照，在渠道清單中顯示。建立留言規則時，
> 系統列出帳號最近的貼文與 Reels（`GET /me/media`），讓商家挑選規則要套用的貼文。
>
> English: After a business connects its Instagram professional account, we read the account's username and profile
> picture to show it in the channel list. When the business creates a comment rule, we call `GET /me/media` to list
> recent posts and Reels so the business can choose which posts the rule applies to.

**`instagram_business_manage_comments`**

> 中文：顧客在商家的 IG 貼文留言時，我們透過 `comments` webhook 收到留言。留言含有商家設定的關鍵字時，系統用
> Private Reply 私訊顧客一次（例如活動領券連結），並在商家選擇開啟時公開回覆這則留言。商家可以在後台看到每則留言的觸發紀錄。
> 我們讀取留言者的帳號名稱，用來在觸發紀錄和收件匣中顯示是誰留言。
>
> English: When a customer comments on the business's Instagram post, we receive the comment through the `comments`
> webhook. If the comment contains a keyword set by the business, we send one Private Reply to the commenter (for
> example, a coupon link for a campaign), and, if the business turned it on, we reply publicly to the comment with
> `POST /{ig-comment-id}/replies`. The business can see a trigger log for each comment. We read the commenter's
> username to show who commented in the trigger log and in the inbox.

**`instagram_business_manage_messages`**（若同一次送審一起送）

> 中文：open333CRM 讓商家的客服人員在同一個收件匣回覆 IG 私訊。顧客收到留言自動私訊後回覆時，對話會進入收件匣，由客服人員接手回覆。
>
> English: open333CRM lets a business's agents answer Instagram Direct messages in one shared inbox. When a customer
> replies to a Private Reply sent after their comment, the conversation appears in the inbox and an agent continues it.

### 5.3 螢幕錄影要拍什麼

一般原則（Meta 常見要求）：

- 介面要切成**英文**，或在影片加英文字幕／旁白，說明每個畫面在做什麼。
- 從頭到尾拍：**登入 → Meta 授權畫面（要看得到要求的權限）→ 使用功能 → 在 Facebook／Instagram 上看到結果**。
- 每個權限一支，或一支影片裡清楚標出每個權限對應的段落。
- 影片中出現的個資要遮蔽（記憶：手冊錄影要遮個資）。

| 權限 | 錄影流程 |
| ---- | -------- |
| `pages_read_engagement` | 登入 open333CRM →「渠道」→ 用 Facebook 連結粉專（授權畫面停 2 秒，看得到 `pages_read_engagement`）→ 「留言自動私訊」→ 新增規則 →「指定貼文」→ 顯示最近貼文清單 → 選一篇 → 儲存 → 規則列表顯示貼文摘要 |
| `pages_manage_engagement` | 承上，規則中打開「公開回覆」、填文字、儲存 → 換另一個帳號到粉專該貼文留言關鍵字 → 回到貼文，看到粉專的公開回覆 → 回到 open333CRM 觸發紀錄，顯示「已私訊、已公開回覆」 |
| `instagram_business_basic` | 登入 → 連結 IG（或展示 IG 渠道）→ 留言自動私訊 → 新增規則選 IG 帳號 → 顯示最近貼文與 Reels → 選一篇 → 儲存 |
| `instagram_business_manage_comments` | 承上，設定關鍵字與私訊內容（＋公開回覆）→ 用測試人員 IG 帳號在該貼文留言關鍵字 → 手機畫面顯示收到私訊（或在「訊息請求」裡）、貼文底下出現公開回覆 → open333CRM 觸發紀錄顯示該筆 |
| `instagram_business_manage_messages` | 承上，測試帳號回覆那則私訊 → open333CRM 收件匣出現對話 → 客服人員回覆 → 手機收到 |

### 5.4 給審查員的測試說明（範本）

```
Test credentials:
  open333CRM login: https://uat.open333crm.create360.ai/  Email: <審查帳號>  Password: <密碼>
  Test Facebook Page: <粉專名稱與網址>   Test Instagram account: @<帳號>

Steps:
1. Log in to open333CRM with the credentials above.
2. Go to "Comment Auto-Reply" in the left menu and open the rule "App Review demo".
3. The rule replies to comments containing the keyword "demo" on the selected post.
4. Comment "demo" on <貼文網址> with any Facebook / Instagram account.
5. Within one minute the commenter receives a private message from the Page / account,
   and (if enabled) a public reply appears under the comment.
6. Back in open333CRM, open the "Trigger log" tab to see the record of this comment.
```

### 5.5 預估時間與常見退件原因

- **時間**：Meta 不保證時程。本 App 上次送審實際花了 13 天（2026-10-19 → 2026-11-01）。被退後要修正再送，再算一輪。
  規劃時建議每一輪預留 **2～3 週**，FB 和 IG 權限一起送最省時間。
- **常見退件原因**（依過去經驗與 Meta 審查指南整理，實際原因要看 App Dashboard 的退件說明）：
  1. 錄影沒拍到 Meta 授權畫面，或沒拍到在 Facebook／Instagram 上真的出現的結果。
  2. 錄影只展示後台設定，看不出這個權限「用在哪裡」。
  3. 審查員照步驟做不出來（測試帳號不能登入、測試粉專沒連好、關鍵字規則沒開）。
  4. 申請了用不到的權限，或用途說明和錄影對不上。
  5. 隱私權政策或資料刪除網址無效（**本 App 的資料刪除網址目前就是無效的**）。
  6. 介面全是中文、沒有字幕說明。
- **`pages_read_engagement` 已被退兩次**：再送前，先到 App Dashboard →「App Review → 要求」看兩次退件的具體說明
  （MCP 只拿到原因代碼 `1001091828775933`）。依代碼看不出內容，但目前草稿的「螢幕錄影」與「API 測試呼叫」都還沒完成，
  這兩項至少要補齊。

---

## 6. 申請順序建議

圖例：〔正式〕＝會影響正式環境（UAT 就是正式環境，創造智能客戶在用）；〔本人〕＝要使用者本人在 Meta 後台操作。

| 步驟 | 做什麼 | 誰 | 影響 |
| ---- | ------ | -- | ---- |
| 0 | 到 App Dashboard 看 `pages_read_engagement` 兩次退件的具體原因；確認 IG 三個權限是「從沒申請」還是「被退」；確認 `pages_manage_engagement` 的標準存取狀態；確認 UAT 有沒有設定 `META_LOGIN_CONFIG_ID` | 使用者 | 〔本人〕唯讀 |
| 1 | 修 App 基本資料：資料刪除網址換成真正的說明頁；確認隱私權政策內容涵蓋留言與私訊；驗證聯絡信箱 | 使用者（網頁內容可以由我們草擬） | 〔本人〕〔正式〕對使用者無感 |
| 2 | 開發完成並部署：程式能正確處理 `feed`／`comments`，**收到不認得的事件一律回 200**，留言丟背景佇列。這一步一定要比步驟 3 先做 | 開發 | 〔正式〕部署 |
| 3 | App 層訂閱：page 主題加 `feed`、instagram 主題加 `comments` | 使用者，或經使用者同意後用 MCP `devtools_webhook_manage` | 〔本人〕〔正式〕。訂閱後所有已訂閱粉專的 `feed` 事件會開始送進 UAT（只有粉專層也訂了才會送） |
| 4 | 粉專層補訂閱：替創造智能粉專（測試先用 Open333test）呼叫 `subscribed_apps`，要帶上原本的欄位再加 `feed`；IG 重新產生含 `instagram_business_manage_comments` 的權杖並貼回渠道 | 開發（腳本或「開啟留言接收」按鈕）＋使用者（IG 權杖要在後台產生） | 〔正式〕 |
| 5 | 用有角色的帳號實測：FB 收留言＋私訊（確認不需要 `pages_read_engagement` 也能動）；IG 收留言＋私訊＋公開回覆；看 webhook 帶不帶留言者名稱 | 開發＋使用者 | 〔正式〕只影響測試貼文 |
| 6 | 在 App Dashboard 把 `pages_manage_engagement`、IG 三個權限加進「權限和功能」；如果用 Facebook Login for Business 設定，也要把 `pages_manage_engagement`、`pages_read_engagement` 加進那份設定 | 使用者 | 〔本人〕〔正式〕之後新連結的粉專會看到多要一個權限 |
| 7 | 完成每個權限的「API 測試呼叫」（步驟 5 的實測通常就會完成） | 開發 | — |
| 8 | 錄影、寫說明、準備審查帳號（§5） | 開發＋使用者 | — |
| 9 | **一次送審**：`pages_read_engagement`、`pages_manage_engagement`、`instagram_business_basic`、`instagram_business_manage_comments`、`instagram_business_manage_messages` | 使用者 | 〔本人〕 |
| 10 | 審核通過後：平台層把「測試階段」提示關掉（`proposal.md` 待決事項 5）；請已連結的客戶粉專「重新連結」，取得新權限 | 開發＋客戶 | 〔正式〕 |

**另一種節奏（建議考慮）**：如果步驟 5 證實 FB 收留言＋私訊不需要新權限，FB 私訊可以**先對所有客戶開放**，不必等審核。
列貼文改成「貼貼文 ID／網址」，公開回覆先顯示「審核中」。IG 和公開回覆等審核通過後再開。

---

## 7. 風險與降級方案

### 7.1 權限被拒時

| 被拒的權限 | 影響 | 降級方案 |
| ---------- | ---- | -------- |
| `pages_read_engagement` | FB 不能「從最近貼文挑選」，也不能用網址換 ID、顯示貼文摘要 | 「指定貼文」改成手動貼貼文 ID；或只提供「全部貼文」。觸發紀錄改用 webhook 帶來的 `post_id`，貼文摘要顯示「—」。私訊不受影響 |
| `pages_manage_engagement` | FB 不能公開回覆 | 規則的「公開回覆」開關停用並顯示說明（`01-ux.md` §3.3 (8) 已設計）；私訊照常 |
| `instagram_business_manage_comments` | IG 整個功能（收留言、私訊、公開回覆）只能用在創造智能自己的帳號與測試人員 | IG 規則只開放給有角色的帳號，其他租戶顯示「Instagram 尚未開放」；FB 照常上線 |
| `instagram_business_basic` | IG 不能列貼文；連帶 IG 其他功能也受影響 | 同上 |

### 7.2 Meta 政策限制（每一條都要做進程式與畫面）

| 限制 | 來源 | 對策 |
| ---- | ---- | ---- |
| 每則留言只能私訊 **1 次** | FB、IG Private Replies 文件 | `@@unique([channelId, commentId])` 防重複；重投的 webhook 直接略過 |
| 留言後 **7 天內**才能私訊（IG 直播只能在直播中） | 同上 | 超過 7 天記為「已過期」；不做直播留言 |
| 留言者**回覆後**才開 24 小時視窗，之後才能繼續傳 | 同上 | 私訊內容要一次講完；後續對話走既有收件匣流程 |
| IG 私訊會進對方的「訊息請求」（對方沒追蹤商家時） | IG Private Replies 文件 | 畫面說明「顧客可能要到訊息請求查看」 |
| 不能私訊給另一個粉專 | FB Private Replies 文件 | 留言者是粉專時略過，並記錄原因 |
| FB 每個粉專每小時最多 **750 次** Private Reply 呼叫（有商店或大型直播的粉專 30,000 次） | Meta Live Shopping「Private Reply API」文件 | 背景佇列要限速；超過時排隊或記為失敗並可重試 |
| 廣告貼文的留言可能**重複送 webhook** | IG Private Replies 文件；FB `feed` 文件說廣告貼文本身不送、廣告留言會送 | 一樣靠 unique 防重複 |
| 同一段公開回覆在同一篇貼文重複幾百次，可能被當垃圾留言 | 實務經驗（`01-ux.md` §3.3 (8)） | 支援多段文字輪流使用；公開回覆預設關閉 |
| Messenger 自動回覆要在 30 秒內回應使用者輸入（自動化機器人） | Messenger Platform policy | 留言者回覆私訊後走既有 AI／客服流程，不受本功能影響 |

### 7.3 Webhook 連續失敗會被自動停用

官方文件寫（Meta Webhooks for Messenger Platform）：送不到會立刻重試幾次；15 分鐘後還送不到，發警告給開發者帳號；
**連續失敗 1 小時，App 會被取消訂閱該粉專或 IG 帳號的 webhook**，修好後要重新訂閱。

本功能特別要注意：

- 留言和私訊**共用同一個回呼網址與同一份訂閱**。留言處理拖垮 webhook，**私訊也會跟著收不到**，影響所有客戶。
- `feed` 事件量可能比私訊多很多（按讚、分享、留言編輯都會送）。webhook 只做驗簽、分派、丟佇列，馬上回 200。
- 監控：平台層的佇列監控要看得到 `comment-reply` 佇列；webhook 回應時間與錯誤率要有告警。被停用時要能用
  `subscribed_apps` 一鍵補訂閱（同一支補訂閱程式可以重複使用）。
- Meta 重送會讓同一則留言重複進來，靠防重複處理。

---

## 8. 需要使用者確認的事

1. **可以動正式 App 嗎？** 步驟 3（App 層訂閱 `feed`／`comments`）、步驟 4（粉專補訂閱）、步驟 6（加權限到後台設定）都會改到創造智能正式 App。
   要你自己操作，還是同意後由我們用 MCP 工具操作？什麼時間點做？
2. **資料刪除網址與隱私權政策**：要用 `fanpokka.ai` 的頁面，還是改用 open333CRM 自己的網域？誰負責撰寫和上架？
3. **`pages_read_engagement` 退件原因**：請到 App Dashboard 看兩次退件的說明並轉給我們。這會決定「列最近貼文」要不要在第一版做，還是先用貼 ID。
4. **IG 權限的真實狀態**：App Dashboard 上 `instagram_business_basic`／`instagram_business_manage_messages`／
   `instagram_business_manage_comments` 是「未申請」還是「已退件」？
5. **UAT 有沒有設定 `META_LOGIN_CONFIG_ID`**（Facebook Login for Business 設定 ID）？有的話，新增權限要改後台那份設定，不是改程式。
6. **送審節奏**：要「FB 私訊先上線、IG 與公開回覆等審核」（§6 另一種節奏），還是全部等審核通過一起上？
7. **測試帳號**：誰當錄影與 Meta 審查員用的測試帳號？哪個粉專、哪個 IG 帳號、哪一篇貼文？`meta-reviewer` 審查帳號還能用嗎？
8. **平台用哪個 App**：記憶寫「平台用哪個 App 未定」。SaaS 化後如果改用另一個平台 App，整套送審要在那個 App 重做一次。本文件以創造智能 App 規劃。

---

## 9. 來源

| 內容 | 來源（查證日期 2026-11-13） |
| ---- | -------------------------- |
| FB Private Replies：只需 `pages_messaging`、1 則、7 天、Standard Access 限制、不能私訊粉專 | https://developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/private-replies |
| FB Private Reply 每小時 750 次上限 | https://developers.facebook.com/documentation/live-shopping/live-video-ads-integration-playbook/private-reply-api |
| `feed` webhook 需 `pages_manage_metadata`＋`pages_show_list`；粉專要呼叫 `subscribed_apps` | https://developers.facebook.com/documentation/pages-api/webhooks-for-pages |
| `feed` 欄位內容；廣告貼文不送、廣告留言會送；按讚通知只限 1 萬粉以下 | https://developers.facebook.com/docs/graph-api/webhooks/reference/page/ |
| FB 公開回覆需 `pages_manage_engagement`、`pages_read_engagement`、`pages_read_user_engagement` | https://developers.facebook.com/documentation/pages-api/comments-mentions |
| IG Private Replies：權限、7 天、直播限制、進訊息請求 | https://developers.facebook.com/documentation/instagram-platform/private-replies |
| IG Private Replies（Messaging 版）：廣告留言可能重複、Standard Access 限制 | https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies |
| IG 留言管理：回覆留言端點、Standard 與 Advanced Access 的差別 | https://developers.facebook.com/documentation/instagram-platform/comment-moderation |
| IG webhook 欄位與權限對照（`comments` 需 `instagram_business_basic`＋`instagram_business_manage_comments`） | https://developers.facebook.com/documentation/instagram-platform/webhooks/fields |
| IG 留言者 `username` 自 2024-08-27 起需 `instagram_business_manage_comments` | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment |
| Webhook 失敗 15 分鐘警告、1 小時停用並取消訂閱 | https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks |
| Messenger／IG 訊息政策（Private Replies、30 秒回應） | https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy |
| App 狀態、權限、送審紀錄、webhook 訂閱 | Meta Social Technologies MCP 唯讀工具（App `671495162407854`） |
