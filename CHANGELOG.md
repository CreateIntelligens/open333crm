# Changelog

All notable changes to **open333CRM** will be documented in this file.

## [2026-10-06]

### Fixed

- **角色與權限頁可以關閉 admin 角色的內建鎖定權限** — 對 admin 角色的「人員與權限」按「全關」，會連「管理成員」「管理角色權限」這兩個內建鎖定的權限一起關閉，儲存時一定失敗。在 admin 角色取消「檢視角色權限」也一樣，因為「管理角色權限」需要「檢視角色權限」。現在 admin 角色的內建鎖定權限，以及這些權限需要的前置權限，都在頁面上鎖定；「全關」也會略過這些權限。後端一直都會拒絕這種設定，沒有存入錯誤的資料。
- **角色與權限頁的「全關」不處理其他群組的相依權限** — 例如「聯絡人」全關後，「審核識別建議」與「刪除聯絡人資料」仍然勾選，儲存時一定失敗。現在「全關」會先列出其他群組要一起關閉的權限，成員確認後一併關閉；「全開」也會一併勾選其他群組的前置權限。後端一直都會拒絕這種設定，沒有存入錯誤的資料。
- **「自動開啟」標籤標錯權限** — 標籤原本顯示在相依的權限上，只要它的前置權限已勾選就會出現。現在只標示這次編輯中被系統自動勾選的前置權限，並說明是哪個權限需要它，例如「因「回覆對話」需要而自動開啟」。
- **以 Passkey 登入後，側邊選單少了項目** — 以 Passkey 登入後，前端沒有載入成員的權限。側邊選單因此隱藏所有需要權限的項目，設定頁的「角色與權限」也顯示沒有權限。成員要重新整理頁面才恢復。現在 Passkey 登入後也會載入權限，與密碼登入相同。

## [2026-10-05]

### Security

- **渠道可見範圍改回 fail-closed** — 沒有綁定任何團隊或成員的渠道，原本所有成員都看得到，而且是完整權限，管理員也無法在建立時限制（#217）。這是 `channel-scoped-visibility` 上線時沒做回填、改用相容分支頂替的過渡做法。現在沒有綁定的渠道只有總店（`channel.view_all`）看得到。上線時 migration 先把既有的這類渠道綁給該租戶所有啟用中的成員，每個人看到的渠道不變。新增渠道時可以選哪些成員看得到（預設全選；Facebook 登入連結的粉專一律給所有啟用中的成員），新增成員時可以選看得到哪些渠道（預設為建立者能選的全部渠道）。沒有總店權限的建立者不能把自己看不到的渠道指派給新成員，新成員的層級也不會高於建立者；建立渠道時建立者會自動加入可見成員。自動派案只派給看得到、而且能回覆該渠道的成員。

- **刪除會把 Telegram bot token 寫進 log 的外掛空殼** — `packages/channel-plugins/src/telegram/index.ts` 是 `TelegramPlugin` 的第二份類別，由套件入口匯出。它的 `sendMessage()` 把 bot token 寫進 info log，而且沒有呼叫 Telegram 就回傳成功。目前沒有程式註冊這個類別，租戶也無法建立 Telegram 渠道，所以沒有 token 實際外洩。這份檔案已經刪除，套件入口改為匯出 `telegram.ts` 的類別，與 `./telegram` 子路徑一致（issue #217）。

### Changed

- **自動化規則頁改成一般管理員看得懂** — 列表與編輯頁用一句話說明規則在做什麼，例如「當收到訊息時，如果開啟案件數等於 0，就建立工單「客戶諮詢」」。列表的觸發事件改顯示中文、名稱過長時截斷（原本會把其他欄位擠出畫面），並加上名稱搜尋與啟用狀態篩選；拿掉從 `9255245` 起就停止更新的執行次數（AUDIT AUTO-02）。編輯頁的「優先級」改名「執行順序」並說明數字越大越先檢查，「命中後停止」改成「這條規則執行後，不再檢查其他規則」；條件區的 AND／OR、+ Rule、+ Group 全部改成中文；觸發事件下方顯示說明，6 種目前不會觸發的事件在選單上標示（AUDIT AUTO-05）。「試試看這條規則」改成依條件填表單，結果用中文說明會不會觸發、會執行哪些動作，不必再手寫 JSON。「指派客服」改成從客服名單選人，不必填 UUID。關鍵字規則的摘要會寫出關鍵字。操作手冊第 4 章同步改寫。

### Fixed

- **自動化規則的「移除標籤」終於會執行；拿掉從未實作的 3 種動作** — 「移除標籤」「指派機器人」「KB 知識庫回覆」「LLM 智能回覆」列在規則編輯器裡，workers 卻從未實作（AUDIT AUTO-01）。「移除標籤」補上實作：聯絡人身上有這個標籤就移除，沒有就不做任何事、不會新建標籤。其他 3 種從契約拿掉：機器人負責的對話本來就會用知識庫與 AI 回覆，規則再觸發一次可能讓客人收到兩則回覆。部署時以資料 migration 清理既有規則：還有其他動作的規則移除這 3 種動作、繼續執行；只有這 3 種動作的規則改為停用。之後規則若還含它們，畫面會標示「LLM 智能回覆（已停用）」與「規則不會執行」。UAT 上只有 2 條已刪除的 Demo 規則含這些動作，沒有實際影響。

- **新增自動化規則時「啟用」沒勾也會立刻執行** — 建立規則的 API 一律把規則存成啟用，前端送的啟用狀態被丟掉。現在依畫面上的選擇建立；API 沒送啟用狀態時仍預設啟用，CLI 與 MCP 不受影響。
- **自動化規則頁的小問題** — 切換啟用失敗時原本只寫 console，現在會顯示錯誤；動作的下拉選單文字被切掉一截。

- **LINE 的語音與檔案訊息收不到內容** — 客人從 LINE 傳語音或檔案，系統只記下「[audio]」「[file]」，沒有下載內容（issue #206）。原因是 `980781d5` 加入外部媒體判斷時誤刪了這兩種訊息的解析。現在恢復解析並下載：語音帶長度，檔案帶檔名與大小；收件匣的語音顯示播放器，檔案顯示可下載的檔名與大小。下載上限 25 MB；客人傳的檔案一律存成下載用的類型，避免 html、svg 在儲存網域執行；下載失敗時收件匣會顯示原因，不再只寫 log。收件匣收到新訊息後的重新整理也改為不丟掉最後一次通知，下載完成後畫面會更新。
- **LINE 的圖片與影片在收件匣顯示不出來** — 下載完成後只更新了 `content.url`，`content.mediaUrl` 仍是 `line-content:` 佔位值，收件匣優先讀它，拿到瀏覽器打不開的網址。現在下載後兩個欄位都改成儲存後的網址，收件匣也只採用瀏覽器打得開的網址，既有的訊息不用補資料就能顯示。

- **自動化規則列表只顯示前 20 條** — 列表 API 預設一頁 20 條，前端沒有分頁，第 21 條以後的規則在畫面上看不到（UAT 的 Demo Tenant 有 155 條，「一般問題自動開案」排第 29 條）。改為逐頁取回全部規則；關鍵字回覆列表原本只取 100 條，也一併修正。API 排序加上 id，翻頁時不會重複或漏掉規則；載入失敗時顯示錯誤，不再顯示「沒有自動化規則」。
- **含舊動作的自動化規則存不進去** — 編輯頁載入既有規則時只濾掉 4 種尚未支援的動作。契約從來沒有的動作（例如舊規則的 `auto_assign`）留在表單上，儲存一定被拒，畫面也沒說是哪個動作。現在依規則的觸發事件，移除契約沒有提供的所有動作，並分開說明：尚未支援的動作只有自己不執行，其他動作會讓 workers 整條略過規則。規則列表也會在 workers 整條略過的規則旁標示「規則不會執行」，原本這種失敗只寫進 log。
- **自動化規則的錯誤訊息是英文** — 契約驗證的錯誤訊息原本只有開頭是中文，後面是 `actions[1].type is not allowed for message.received: auto_assign` 這類技術訊息。現在全部改成中文，寫第幾個條件或動作，並用中文名稱，例如「第 1 個動作「傳送訊息」不適用於「工單關閉」觸發」；系統沒有的舊動作會寫「第 2 個動作「auto_assign」不是系統提供的動作，請刪除」。

## [2026-10-02]

### Added

- **自動化規則可以自動建立工單** — 規則條件命中時（例如顧客訊息含「客訴」「故障」）自動在該對話上開工單：依優先度套用 SLA、對話關聯到新工單、收件匣與工單列表即時更新，分類從系統分類清單選，不指定時由 AI 依顧客訊息自動分類。規則編輯器的選填下拉選單新增「不指定」：原本沒選時畫面顯示第一個選項，實際卻存成空值。同一段對話已有未結案的工單時不重複開，同時處理也不會開出兩張。只在收到訊息、關鍵字命中、對話建立這類有對話的觸發事件提供，工單與 SLA 事件不提供，避免工單開工單。

### Security

- **重抓 LINE 個人資料的端點限定自己租戶** — `PATCH /api/v1/channels/:channelId/contacts/:lineUid/sync-profile` 原本只驗登入，以繞過 RLS 的連線查渠道與身分、條件不帶租戶：任一租戶的成員只要知道其他租戶 LINE 渠道的 ID 與一個 LINE uid，就能用對方渠道的憑證呼叫 LINE，並改寫對方聯絡人的名稱與頭像（AUDIT RLS-05）。現在改走租戶連線，查詢帶 `tenantId`，要求 `contact.update` 權限與渠道可見範圍；其他租戶、看不到、已停用或非 LINE 的渠道一律回 404。前端、CLI 與 MCP 都沒有呼叫這個端點，不影響現有功能。這個端點的規格原本沒有套用到主規格，現在補在 `openspec/specs/line-contact-profile-sync/spec.md`。
- **工單、對話、標籤、短連結依角色權限授權** — 這四個模組的 45 條路由原本只驗登入，租戶在「角色與權限」設定的限制完全不生效：沒有刪除權限的成員仍可永久刪除工單、只能檢視的角色仍可送訊息給客人（AUDIT RBAC-01）。現在每條路由依權限碼檢查（`case.*`、`inbox.*`、`tag.*`、`shortlink.*`），缺少時回 403；建立或編輯工單時順便指定負責人或團隊另需「指派」、改成「已升級」另需「升級」權限，不能用建立或編輯權限繞過。工單與對話原有的渠道可見範圍檢查保留。既有系統角色都具備這些權限；沒有細粒度角色的成員（RBAC 上線前建立且未回填的帳號）權限為空，上線前須先補上角色。
- **refresh token 不能再當 access token 使用** — 客服的 access token、refresh token、粉絲 token 與 MCP 確認 token 都以同一把 `JWT_SECRET` 簽發，驗證端只看簽章：refresh token（30 天）可以直接拿來呼叫 API，成員被停用後也擋不住；日後接回粉絲 token 的簽發（One ID tasks 9.3.3，優惠券的 Account Link）時，粉絲 token 也會通過客服認證，並透過 socket 收到全租戶的訊息（AUDIT AUTH-05）。access 與 refresh token 改帶用途欄位 `typ`，客服 API 與 socket 只收 access token，`/auth/refresh` 只收 refresh token。上線當下既有的 access token 會失效、由前端自動換發，使用者不會被登出（過渡期接受舊格式的 refresh token）。
- **登入防暴力破解** — `POST /api/v1/auth/login` 原本沒有速率限制也沒有失敗鎖定，可無限次嘗試密碼；登入頁的夾娃娃機小遊戲只在前端判斷，直接呼叫 API 就能繞過（AUDIT SEC-05，issue #197）。現在同一 IP 每分鐘最多 10 次；同一帳號（email 不分大小寫）15 分鐘內失敗 5 次即鎖定到區間結束，鎖定期間密碼正確也不放行，CLI 密碼登入共用同一個計數；每次嘗試一進來就原子計數，同時送出大量請求也最多只驗 5 次密碼；不存在的 email 一樣計數，也一樣做一次密碼雜湊比對，回應內容與時間都不透露帳號是否存在；計數用的 Redis 故障時照常登入並留 log，不會讓全站無法登入。停用帳號改在密碼驗證通過後才回「此帳號已被停用」，避免不知道密碼的人確認某個 email 是停用帳號。
- **來源 IP 無法再偽造** — API 原本設 `trustProxy: true`，`request.ip` 取 `X-Forwarded-For` 最左邊的值，使用者自己帶標頭就能偽造 IP；而部署環境的 Caddy 會丟掉主機 nginx 帶來的標頭，API 看到所有人都是 docker 閘道 IP，所有依 IP 的限流變成全站共用一個額度（AUDIT SEC-04）。改為只信任私有網段與本機的代理，Caddy 設定 `trusted_proxies` 保留 nginx 附加的真實 IP。

### Fixed

- **手動選的工單分類被 AI 覆蓋** — 建立工單後系統會依顧客訊息自動分類，原本一律覆寫分類，客服建單時選的分類會被 AI 結果蓋掉。改為工單已有分類就不自動分類。由於客服手動建單時分類是必填，之後 AI 自動分類實際上只會用在「自動化規則建單、沒有指定分類」的工單。
- **自動化規則存得進去卻不會執行的動作** — 「建立工單」「移除標籤」「指派機器人」「KB 知識庫回覆」「LLM 智能回覆」五種動作在執行搬到 workers 時沒有實作，規則可以存檔、條件也會命中，卻從未真的執行（AUDIT AUTO-01）。現在規則編輯器不再提供、新增或修改規則時會說明「目前尚未支援自動執行」；既有規則照常執行其他動作，規則列表與編輯頁會標示含這些動作。只改啟用狀態或名稱時不再驗證整條規則，含這些動作的規則可以直接停用（同 PR #124）。刪除沒有呼叫端的舊執行器 `action-executor.ts`。
- **即時通知在 API 重啟後斷掉** — 前端 socket 建立時把當下的 access token 固定在連線設定，斷線重連一律沿用；access token 15 分鐘就過期，每次部署重啟 API 後，超過 15 分鐘沒換頁的使用者就收不到即時訊息。改為每次連線讀取最新的 token，被拒時先換發再重連（連續最多 3 次）；仍連不上時，頂端列的連線狀態顯示「即時連線中斷，請重新整理」，點一下即可重新整理。
- **工單「首次回應逾時」假警報** — `Case.firstResponseAt` 原本沒有任何程式寫入，套了 SLA 的工單時間一到必定判定首次回應逾時，通知負責人與主管、寫入工單事件、觸發自動化，而且工單沒結案前每 24 小時再發一次；報表的平均首次回應時間也永遠是空的（AUDIT SLA-01，issue #197；UAT 已累積 74 筆相關事件）。現在客服在工單關聯的對話第一次送出訊息時寫入首次回應時間（不早於工單建立時間；AI 與系統自動回覆不算）；把已有客服回覆的對話掛到既有工單時，也會補上工單建立後最早的那則回覆。記錄失敗不會影響訊息送出。
- **部署注意** — 既有工單以 `apps/api/src/scripts/backfill-case-first-response.ts` 補值（預設 dry-run，`--apply` 才寫入，可重複執行）：取工單建立後、關聯對話中最早一則客服訊息的時間。工單建立前客服已回覆、之後沒再回覆的工單補不到值，仍會判定逾時；手動建立、沒有關聯任何對話的工單永遠不會有首次回應時間，套 SLA 時同樣會判定逾時（另案處理）。
- **「操作太頻繁」顯示成「請求格式不正確」** — 所有限流端點超過上限時，全域錯誤處理把 429 改寫成「請求格式不正確，請重新操作」；改回 `RATE_LIMITED`「操作太頻繁，請稍候再試」。
- **登入失敗一律顯示「請確認帳號密碼」** — 登入頁讀錯錯誤欄位，帳號停用、租戶停用、鎖定等原因都看不到；改為顯示後端的說明。

## [2026-10-01]

### Added

- **FB 粉專重新連結** — 用 Facebook 登入連結的粉專權杖失效（管理員改密碼、被移除管理員身分、在 Facebook 移除應用程式等）時，原本只能刪掉渠道重建，對話紀錄會跟著斷開。現在「用 Facebook 連結粉專」的選擇頁可勾選本租戶已連結的粉專，系統以新權杖更新原渠道，渠道、對話、設定與分店權限全部保留；新權杖訂閱失敗時原渠道完全不動。自備應用程式連結的渠道不會被轉成平台模式（下游 Webhook 轉發只走渠道自己的網址，轉過去會靜默停止轉發），選擇頁會標示並請管理員改在渠道編輯更新權杖。
- **FB／IG 權杖失效通知** — 每 6 小時檢查一次啟用中的 FB／IG 渠道權杖。失效時渠道卡片顯示紅色警示並說明處理方式，同時以站內通知與 email 告知該租戶所有管理員；持續失效每 3 天再提醒一次；手動更新權杖後按「測試連線」成功即清除警示。只有明確的失效訊號（權杖過期／被撤銷、權限被移除）才算失效，網路錯誤、Meta 服務異常、限流與其他無法判斷的錯誤不會誤報；檢查途中權杖剛被更新時不寫入舊結果、不發通知（資料庫端原子比對）。

### Security

- **OAuth 授權碼不進 log** — API 的請求 log 會遮蔽網址上的 `code`、`state`、`access_token`、`token`、`hub.verify_token` 參數，Facebook 授權回呼的授權碼不再以明文寫進 log。

### Changed

- **綁定訊息改用公開帳號名稱** — 跨渠道綁定的邀請、確認與完成訊息原本寫的是後台自取的渠道名稱（例如「Facebook（測試粉專）」「LINE（第二個line串接）」），顧客會看到內部命名。改為平台上的公開帳號：FB 用粉專 username、IG 用 @帳號、LINE 用官方帳號 Basic ID（例如「Facebook（my.shop）」「LINE（@abc1234）」）。FB 沒有 username 時只寫「Facebook」，不顯示數字粉專 ID。後台畫面（收件匣、聯絡人頁、渠道管理）仍顯示渠道名稱。
- **按鈕名稱一致** — 渠道編輯視窗「跨渠道綁定」欄位的提示原本寫「請按『驗證』」，但渠道卡片上的按鈕叫「測試連線」，統一改為「測試連線」。
- **既有 Meta 應用程式可直接當平台應用程式使用** — 同一個 Meta 應用程式底下，「自備應用程式」的渠道與「用 Facebook 登入連結」的渠道可以並存：事件不論從渠道自己的 Webhook 網址或 `/api/v1/webhooks/meta` 進來，都會派給正確的渠道。因此沿用既有應用程式送審時，不必先改回呼網址，既有渠道照常收訊。不同應用程式之間仍互相隔離。
- **修復部署失敗** — 根目錄 `package.json` 的 `@types/node` 改為 `^24.19.0` 後 `pnpm-lock.yaml` 沒有同步，Docker 建置的 `pnpm install --frozen-lockfile` 失敗，合併到 `main` 的部署都會失敗。同步 lockfile 的版本寫法（不升級任何套件）。
- **測試改由 Vitest 統一執行** — 原本每個測試檔用 `tsx` 個別執行，沒有統一指令，有些測試在 `main` 上失敗了幾個月也沒人發現。現在根目錄的 `pnpm test` 會執行所有套件的 unit 測試，不需要任何外部服務；`pnpm test:feature` 執行需要 PostgreSQL 與 Redis 的 feature 測試；`pnpm test:all` 兩組都跑。只想跑部分測試時用檔名篩選，例如 `pnpm --filter @open333crm/api test -- case.service`。原本逐檔執行的 `test:*` script 已移除。
- **測試目錄改為 `tests/unit` 與 `tests/feature`** — 參照 Laravel 的 `tests/Unit` 與 `tests/Feature`，測試從 `src/__tests__` 搬到各套件的 `tests/` 底下，`tests/unit` 的目錄對應 `src/`；只測其他套件的測試搬到該套件。測試以 `#src/` 引用原始碼（`package.json` 的 `imports`）。workers、widget、channel-plugins 的測試原本放在 `src/` 內，會被編進 `dist/`，搬出後不再發生。
- **feature 測試使用獨立的測試資料庫** — 不再寫入開發資料庫。執行前自動建立 `open333crm_test`、套用全部 migration、建立兩個固定測試租戶，並使用 Redis 的獨立資料庫；只允許連到本機。原本 8 個需要資料庫的測試檔在沒有 `DATABASE_URL` 時會默默跳過、看起來像通過，現在一律實際執行。

### Fixed

- **AI 偽造綁定代碼** — 顧客打錯綁定關鍵字（例如「綁定帳號綁定帳號」）時訊息會交給 AI，AI 照對話紀錄裡的綁定訊息編出一整則導流訊息，含系統裡不存在的代碼，顧客照做只會收到「代碼無效」（UAT 實測）。AI 回覆與知識庫自動回覆讀的對話紀錄改為不含系統發的綁定訊息、其他訊息中的代碼遮掉；AI 回覆仍含代碼時整則換成固定說明（綁定啟用時引導傳送綁定關鍵字，未啟用時請洽客服），並在訊息標記 `bindingCodeBlocked`。
- **5 個在 `main` 上失敗的測試** — `cli-session-auth`、`passkey.service`、`tagging.service`、`sla-contract`、`inbox-realtime-source` 都是程式改了、測試沒跟上，逐一查證後沒有發現程式錯誤，已更新測試。刪除標籤另外新增契約測試，確認 route 在租戶交易內呼叫 `deleteTenantTag()`，因為 service 依序刪除，只有在這個交易內才是原子的。
- **滿意度評分可被他人改寫（跨租戶）** — 客人回覆 `csat:<分數>:<工單 ID>` 時，系統原本只依工單 ID 找工單，不檢查工單屬於哪個租戶、哪位客人。任何人只要知道一個工單 ID，就能從任一租戶的官方帳號改寫別的租戶的工單評分，並讓對方的渠道送出感謝訊息、通知主管。現在只寫入「收訊的租戶、而且是這位客人自己」的工單；客服手動記錄時只能寫入自己租戶的工單。不符合的評分訊息仍會被攔下，不寫入、不回覆，也不交給 AI 或自動化。（AUDIT RLS-06）
- **已付費的試用租戶到期仍被停用** — 試用租戶在 `/dashboard/plan` 申請升級、經平台核准後，系統只換了方案，沒有讓租戶脫離試用；到了原本的試用到期日，排程仍會停用這個已付費的租戶，保留期滿後再標記為已清除。現在核准升級申請時，試用租戶會脫離試用、恢復啟用並清除「已清除」標記；試用管理的「轉正式」也會一併清除這個標記。加購申請與在租戶頁改方案不會脫離試用，租戶頁會提示這一點。試用方案不能當成升級申請或「轉正式」的目標，建立與核准都會被拒絕；試用方案依平台的試用設定判斷，不再寫死。部署前要先修復已受影響的租戶，見 `openspec/changes/archive/2026-10-01-fix-csat-intercept-and-trial-upgrade/design.md` 的 Migration Plan。（AUDIT TRIAL-01）

## [2026-09-30]

### Fixed

- **FB／IG 訊息落進錯的租戶（跨租戶資料錯置）** — webhook 原本只依網址上的渠道 ID 判斷訊息屬於誰，不看事件裡的粉專 ID。一個 Meta 應用程式只能設一個回呼網址，多個粉專共用同一個應用程式時，所有粉專的訊息都會寫進回呼網址指向的那個渠道：別的粉專（甚至別的租戶）的顧客出現在錯的收件匣，AI 用錯的粉專權杖回覆而被 Meta 拒收，顧客收不到回覆（UAT 實際發生：Open333test 粉專的訊息落進創造智能租戶）。現改依事件的 `entry.id`（FB 粉專 ID／IG 專業帳號 ID）找出真正的渠道與租戶，一包含多個粉專時各自分派；認領帳號的渠道必須是同一個 Meta 應用程式（應用程式密鑰相同），否則丟棄；沒有任何渠道認領的帳號事件丟棄，不再寫進別的租戶。尚未取得帳號 ID 的舊渠道暫以相容模式照舊收件，避免上線當下斷線。分派異常（收到不屬於本渠道的帳號、應用程式不符、尚未取得帳號 ID）會顯示在「渠道管理」的渠道卡片上，不只寫 log。整包含其他渠道事件時不轉發到下游 Webhook，避免把別的租戶的事件轉出去。設 `META_WEBHOOK_ROUTING=legacy` 可退回舊的純網址分派（上線觀察期的回滾開關）。
- **Instagram 帳號 ID 取錯欄位** — IG 渠道驗證原本讀 `/me` 的 `id`（應用程式範圍的使用者 ID），與 webhook 事件的帳號 ID 對不上；改讀 `user_id`（IG 專業帳號 ID）。
- **FB 權杖檢查會蓋掉系統設定** — 渠道狀態檢查寫回權杖到期日時整包覆寫 settings，可能洗掉導流識別等系統維護欄位；改為資料庫端原子合併。

- **停用的渠道不再佔住粉專** — 渠道停用時釋放它的粉專／IG 帳號 ID；被停用渠道或停用租戶佔住的帳號，在另一個渠道「測試連線」時會自動釋放後連結，啟用中的連結不受影響。
- **分派細節** — 認領帳號的渠道已停用時不再安靜丟掉事件；下游 Webhook 設為 immediate 時遇到混包，此渠道自己的訊息改由系統處理而非遺失；改派到自己設有下游的渠道時在該渠道顯示「未轉發到下游」警示。
- **測試連線更嚴謹** — FB 填成個人使用者權杖時驗證失敗（不會把使用者 ID 當成粉專 ID）；IG 取不到專業帳號 ID 時驗證失敗；更換 FB／IG 權杖後自動重新測試連線。

### Added

- **用 Facebook 登入連結粉專（平台 Meta 應用程式）** — 平台設定 `META_APP_ID`、`META_APP_SECRET`、`META_WEBHOOK_VERIFY_TOKEN`、`META_CONNECT_REDIRECT_URI`（與選填的 `META_LOGIN_CONFIG_ID`）後，「渠道管理」出現「用 Facebook 連結粉專」：管理員授權後勾選要連結的粉專，系統自動建立渠道並訂閱訊息，租戶不需要準備自己的 Meta 應用程式、App Secret 或驗證權杖，也不需設定 Webhook。事件統一由 `/api/v1/webhooks/meta` 接收並依粉專 ID 分派。授權用的 state 一次性、綁定發起的租戶、操作者與瀏覽器（HttpOnly cookie，防止把自己的授權網址丟給別的粉專管理員來搶粉專）、10 分鐘過期；授權失敗一律導回渠道頁並說明原因；刪除以此方式連結的渠道會一併取消粉專訂閱；粉專權杖加密暫存於伺服器、不回傳前端；訂閱失敗會移除剛建立的渠道。既有自備應用程式的渠道照常運作。正式開放前需在 Meta 完成權限審查與商業驗證。

### Changed

- **粉專／IG 帳號同一個只能連結一次** — 渠道新增外部帳號 ID 欄位（明文、全平台唯一），按「測試連線」時由系統用權杖向 Meta 取得並寫入，渠道卡片顯示「粉專 ID／IG 帳號 ID」。同一個帳號已連結到其他渠道（不論哪個租戶）時測試連線回報「此粉專／IG 帳號已連結到其他渠道，同一個帳號只能連結一次」，不會建立第二個連結。帳號 ID **只由測試連線寫入、不接受手填**（共用應用程式時手填別人的粉專 ID 可搶走別的租戶的訊息），因此移除 FB 渠道表單與設定精靈的 Page ID 欄位；更換權杖或應用程式密鑰時會清除帳號 ID，需重新測試連線。
- **部署注意** — 需跑 migration `20260930100000_add_channel_external_account_id`、`20260930110000_release_inactive_channel_account`（須 owner 連線），再以 `apps/api/src/scripts/backfill-channel-external-account-id.ts` 為既有 FB／IG 渠道補帳號 ID（預設 dry-run；同一帳號對到多個渠道時衝突者全部不寫入並列出，須先停用多餘渠道）。

## [2026-09-29]

### Changed

- **統一聯絡人合併引擎（跨渠道 One ID P0，change `add-cross-channel-one-id`）** — 原本有四套各自實作的合併邏輯（手動合併、合併建議核准、LINE Login、FB Login，外加一套無人呼叫的死程式碼），各漏搬不同資料。現收斂為單一 `contact-merge.service`：搬移所有帶 `contactId` 的表（渠道身分、對話、案件、長期記憶、活動報名、點數、身分對應、點擊紀錄、流程執行、KB 回饋、廣播收件），標籤／屬性／廣播收件依唯一鍵去重且 survivor 優先（標籤保留到期日），被合併方一律**封存不刪除**；點數帳本為 append-only，改以轉出／轉入兩筆交易合計餘額（原本直接搬交易會讓餘額變成「兩人中最新那筆」），並把搬移明細寫入新表 `contact_merge_logs`（含 RLS）。
- **合併建議改為租戶隔離** — `packages/core` 的合併建議服務原本使用未綁租戶的全域 `prisma` 單例，且核准／拒絕時不檢查建議是否屬於操作者的租戶；改由呼叫端傳入 `withTenant` 執行器並檢查 `tenantId`，建議狀態與合併在同一交易內完成。

### Added

- **跨渠道綁定（One ID）** — 同一位顧客在 LINE、Facebook、Instagram 的帳號可合併為同一位聯絡人，**不需要客戶自有會員庫、不收個資、不需簡訊**。顧客在任一渠道傳送綁定關鍵字（預設「綁定帳號」，整句相符才觸發），系統回覆其他渠道的導流連結與一次性代碼 `BIND-XXXXXXXXXX`（30 分鐘、單次有效）：LINE 為「加好友 → oaMessage 預填代碼」兩步、FB 為 `m.me/{粉專}?ref=`、IG 為 `ig.me/m/{帳號}?ref=`，並附純文字代碼作退路。顧客在另一渠道送回代碼後，系統先回覆顯示對方帳號名稱的確認訊息，**顧客回覆「確認綁定」才合併**（防止連結被轉傳時點擊者在不知情下被併入他人、點數與個資歸對方；10 分鐘未確認即作廢；代碼在確認時才用掉，別人點開連結但不確認不會讓本人的代碼失效），再以統一合併引擎合併（發碼方為存續聯絡人），`IdentityMap` 記為 `BINDING_CODE`，雙邊對話各收到確認訊息；7 天內可回覆「解除綁定」自助解除（只拆顧客目前所在渠道的那筆綁定）。**同一渠道只能綁一個帳號**：代碼被轉給同一個官方帳號的其他人、或合併後同一渠道會有兩個身分時一律拒絕，代碼放回給本人使用。FB/IG 重送同一 referral 事件（含「開始使用」postback、IG 第一則訊息夾帶的 ref）會被去重。IG Icebreaker 帶 ref 時只當 referral 事件處理，不進收件匣、不觸發 Bot。客服代發綁定連結會檢查渠道存取層級（CM-173）。解除合併時，合併當下從被合併方補到存續聯絡人（及其後續合併對象）的電話／email／頭像會一併清除（仍是當時補上的值才清），不把個資留在對方身上。沒有真的合併（代碼無效、同渠道衝突、索取代碼）的新顧客仍會收到首次招呼語。發碼超過頻率上限只回覆一次；邀請訊息沒送到顧客時回報失敗並作廢代碼。合併、解除、合併建議核准皆以條件式更新佔用，兩個操作同時進來時只有一個成功（避免點數重複轉回）；合併時同時鎖定被合併方與存續方（依 id 排序避免死結）。連環合併不照順序解除時，已轉回的點數會從後續合併紀錄扣抵，不會重複轉移。解除時聯絡人關係一併還原。身分縫合（stitcher）以電話／email 比對時排除已封存的聯絡人。新顧客的招呼語排在確認提示之前送出；沒有待確認時傳「確認綁定」視為一般訊息；確認時若合併失敗會放回代碼與待確認狀態。客服代發綁定連結另計次數，超限只回報給客服。渠道驗證、導流識別 API 與一般渠道設定儲存皆改用資料庫端 JSON 原子更新，系統維護欄位以寫入當下的現值為準，不會互相蓋掉。「傳送綁定連結」按鈕只在租戶啟用跨渠道綁定時顯示。入站管線在首次招呼語與 AI／關鍵字／自動化**之前**攔截，命中時不觸發 Bot。發碼每小時 5 次、兌換失敗每小時 10 次後不再回覆。功能預設關閉，於「設定 → 跨渠道綁定」啟用（`GET/PUT /api/v1/settings/identity-binding`）。
- **顯示渠道名稱** — 同一租戶可能接多個 LINE 官方帳號或粉專：收件匣（對話列表、對話標題、右側聯絡人面板）、聯絡人頁「渠道身份」、渠道編輯視窗的導流識別區塊、綁定確認與完成通知，都改為顯示「類型＋渠道名稱」（收件匣對話列表改為兩行：頭像右下角以官方渠道 logo 表示類型，渠道名稱以灰色小字獨立一行顯示在訊息預覽下方，過長截斷、滑鼠移上看全名；列表時間改為精簡中文格式「14:05／昨天／週一／9/28」，「Bot 中」縮為小標籤）（例如「LINE（總店官方帳號）」），不再只寫 LINE／Facebook。
- **FB／IG referral 解析** — FB `messaging_referrals`（既有對話）、「開始使用」postback 與訊息夾帶的 referral，以及 IG `messaging_referral` 與新對話第一則訊息／Icebreaker 夾帶的 referral，都會帶出 `ref`（原本整批被丟棄）。非綁定代碼的 referral 只記錄、不落地成空白訊息。
- **渠道導流識別** — 渠道其他設定視窗整包儲存 settings 時會保留導流識別與 FB 檢查結果，不會被舊快照洗掉。渠道驗證時自動存 LINE Basic ID、FB 粉專 username（無則 page ID）、IG username，並檢查 FB 是否設定「開始使用」按鈕；渠道編輯視窗可檢視與手動覆寫（`GET/PATCH /api/v1/channels/:id/binding-handle`，只更新這一欄）。附 `apps/api/src/scripts/backfill-binding-handles.ts` 為既有渠道補抓（預設 dry-run）。
- **客服代發綁定連結** — 收件匣聯絡人面板新增「傳送跨渠道綁定連結」（`POST /api/v1/contacts/:id/binding-link`，需 `inbox.reply` 與該渠道回覆層級存取）；聯絡人頁新增「合併紀錄」可逐筆解除。
- **解除合併** — `POST /api/v1/contacts/merge-logs/:logId/revert` 依合併紀錄恢復被合併的聯絡人，並搬回當次移走的所有紀錄（含 AI 長期記憶）與合併後才在該渠道新開的對話與案件（標籤、屬性不回收）；`GET /api/v1/contacts/:id/merge-logs` 查詢合併紀錄。合併與解除皆以 `contact.merge` 權限守門（原 `POST /contacts/merge` 只驗登入；三個預設角色皆有此權限，既有帳號不受影響）。

### Fixed

- **MCP 工具套用分店渠道可見性（CM-173）** — 原本 MCP 所有工具都不看分店渠道限制：任何持有 CLI token 的帳號（包含只綁部分渠道的分店帳號）可經 `crm_search_contacts`／`crm_get_contact`／`crm_list_cases`／`crm_get_case`／`crm_line_list_conversations`／`crm_line_get_conversation` 讀到其他分店的聯絡人、案件與對話，`crm_line_direct_send` 也能對看不到或唯讀的渠道發 LINE 訊息。現與 REST 同一套規則：列表只回可見渠道；單筆渠道不可見時，回應與「查無此資料」完全相同（無法藉此分辨他店資料是否存在，用渠道＋聯絡人查對話也一樣）；發訊息需回覆層級，預覽與確認送出前各檢查一次，預覽後權限被收回也送不出去，被擋時稽核紀錄記為 `rejected`；權限解析失敗時回通用錯誤，不把資料庫等內部訊息回給用戶端。**尚未涵蓋**（REST 與 MCP 相同的既有狀態）：讀自己渠道的單筆對話／案件時，附帶的聯絡人資料仍含其他渠道的身份；群發與報表不依渠道限制。總店（`channel.view_all`）不受影響。另外案件、對話、渠道列表的 service 函式「可見渠道」參數改為必填，新呼叫端漏傳會編譯失敗，不再悄悄不過濾。
- **`inbound-message-refactor` 測試失效** — 測試的假 Prisma 缺 `message.findFirst`（channelMsgId 去重查詢後加的），整支測試在 main 上就已失敗、失去守門作用；補齊後恢復。
- **聯絡人 API 補上權限守門** — `contact.view`／`contact.update` 權限點早已定義，但 10 條 `/api/v1/contacts/*` 路由（列表、詳情、編輯、貼標、時間軸、對話、案件、合併預覽、合併紀錄）只要登入即可存取，沒有權限的自訂角色也能列出所有聯絡人並查看其對話與案件。現改為依權限點守門：讀取需 `contact.view`、編輯與貼標需 `contact.update`、合併預覽需 `contact.merge`，聯絡人的對話另需 `inbox.view`、案件另需 `case.view`。三個預設角色皆已具備這些權限，既有帳號不受影響。另外，聯絡人的對話、案件、時間軸改依分店渠道可見性（CM-173）過濾，分店帳號不能再經由聯絡人頁讀到其他渠道的對話與案件（原本可繞過收件匣與案件列表的渠道限制）；聯絡人列表與詳情回傳的「渠道身份」也只列出可見渠道，不會看到其他分店渠道的名稱、顧客 uid 與暱稱。
- **移除 `POST /api/v1/fan/auth` 身分冒用漏洞** — 該端點憑任意 `{contactId, tenantId}` 即簽發顧客 token，不驗證呼叫者身分，任何人都能冒充任一顧客存取粉絲門戶。經查無任何呼叫者，直接移除。⚠️ 移除後暫無簽發 fan token 的路徑，`/api/v1/fan/*` 受保護路由（活動、點數）暫不可用；目前無顧客端頁面使用，待優惠券分支的 Account Link 驗證或會員登入頁接上。
- **LINE／FB Login 合併失敗** — 舊實作硬刪來源聯絡人，遇到點數或活動報名紀錄（外鍵 RESTRICT）會整筆失敗，且串聯刪除會連帶刪掉其他渠道身分。改走統一合併引擎後改為封存，且不再比對到已封存的聯絡人。

## [2026-09-22]

### Added

- **LINE delivery resilience 與 tenant-scoped MCP 操作** — LINE Push/Multicast/Broadcast/Narrowcast 發送新增 retry key、409 accepted 去重、request ID 與 BroadcastDeliveryAttempt 持久化，直接訊息將 delivery metadata 寫入 Message；新增 `crm_line_list_conversations`、`crm_line_get_conversation`、`crm_line_search_contacts`、`crm_line_get_broadcast` 唯讀工具，以及具 2-phase signed confirmation、scope/RBAC、quota gate、tenant audit 的 `crm_line_direct_send` 與 `crm_line_broadcast_initiate`。MCP 改用 request tenant Prisma，維持 RLS 隔離。

## [2026-09-15]

### Added

- **888a2a-lite A2A Bridge 整合與 dashboard Tree Navigation** — 新增 `open333 a2a:execute` CLI backend，供官方 `a2a bridge` 透過既有 CLI session 將 A2A prompt 交給 Open333CRM Agent；Hub key 僅由 bridge 以 runtime secret (`A2A_HUB_KEY`) 用於 registration/rotation，不進入 CRM adapter、瀏覽器或 repo。CLI 實作 Single-Flight 請求合併與短暫記憶體防重（Idempotency），避免重連時 duplicate delivery 重複觸發 LLM；加入 `SIGINT`/`SIGTERM` 優雅中斷處理（Graceful Shutdown），確保進程終止時非零退出由 bridge 保留任務重試。Dashboard 導覽升級為權限感知的階層式 tree，修正父子節點雙重選中樣式，並使 Knowledge Base、Marketing、LINE、Portal、Shortlinks、Settings 各子模組皆可直達 canonical routes（如 `/dashboard/settings/a2a`、`/dashboard/knowledge/chat-prompt`）。新增 A2A 狀態 API/UI，嚴格遮罩 Agent ID 且完全不暴露金鑰。提供 bridge 獨立守護進程（Systemd 與 Docker Compose）運行手冊。

- **首次進站招呼語（CM-176）** — 粉絲首次加入或第一次來訊時自動送出一則歡迎訊息，三渠道統一（LINE 的 `follow` 加好友事件亦觸發，不必等對方先開口）。招呼語為**真實訊息**：寫入對話紀錄、推播至後台收件匣、並經既有發送管線推送至該渠道（有別於 WEBCHAT 既有的 `welcomeMessage`，後者僅是前端顯示用的 greeting，兩者並存互不影響）。支援 `{{contact.name}}` / `{{contact.phone}}` / `{{contact.email}}` 變數，解析失敗時退回原字串不擋發送。設定存於 `channel.settings.firstContactGreeting`（**無 schema 變更**），留空即關閉，功能預設關閉。「只送一次」的保證來自 `ChannelIdentity` 的 `@@unique([channelId, uid])`——只有成功建立身分的請求會被標記為首次，併發或平台重複投遞的另一方撞 P2002 而不觸發；**刻意不用記憶體快取**，因本專案多實例部署會導致每個實例各送一次。整段 try/catch 隔離，招呼語失敗不影響 inbound 訊息落地（CM-175 教訓）。設定入口在渠道的「機器人設定」彈窗。
- **`contact.created` 事件補上發布點（CM-176）** — 該事件在 `packages/automation` 早有完整的型別、fact-builder 與 listener 支援，但 `apps/api` 從未發布過，自動化規則因此永遠等不到這個觸發點。現於首次建立渠道身分時發布，並在 `automation.worker` 接上訂閱轉為 `automation:evaluate` job。
- **ESM interop 守門（`scripts/check-workspace-esm.mjs`）** — 掃描 CJS 套件是否匯入了 ESM 套件的「轉出式 re-export」符號。此類退化編譯期完全不報錯（副檔名補齊後拿掉 `"type": "module"` 仍可編譯成功，產物只是默默退回 CJS），typecheck 也攔不到，故需獨立守門。`--strict` 供 CI 使用。
- **inbound 聯絡人解析防迴歸測試（`apps/api` `test:inbound-contact`）** — 五組情境：注入式 executor 生效、未綁定 UID 回 null 不拋錯、新 UID 首次進站建檔、既有身分歸戶不重複建檔、跨租戶相同 UID 互不污染。
- **LLM 2md 感知能力與防驚群容錯架構（integrate-2md-grounding-capabilities）** —
  - **防驚群與節點健康追蹤（Anti-Thundering-Herd & Circuit Breaker）**：在 `web-client.ts` 引入 `SingleFlightManager`，並發請求相同網址、搜尋詞或文檔/圖片 hash 時合併為單一 Promise 執行；加入 `BoundedMemoryCache` 提供短暫 TTL 快取；實作節點健康狀態機（Circuit Breaker），當節點連續失敗達到閥值自動進入冷卻狀態（OPEN）並以隨機抖動（Jitter）容錯切換至備援節點，避免瀑布式崩潰。
  - **多模態感知工具（Agent Multimodal Tools）**：在 `tool-registry.ts` 新增 `ocr_image`（呼叫 2md PP-OCRv4 引擎辨識截圖、收據與發票）與 `parse_document`（呼叫 2md AnyDoc 引擎將 PDF/DOCX/XLSX/CSV 解析為 Markdown），皆具備嚴格的 SSRF 防護、大小限制（10MB/20MB）與輸出字元上限。
  - **知識庫文檔解析現代化（KM Ingestion AnyDoc Modernization）**：重構 `packages/brain` 的 `MarkitdownService`，優先以 2md AnyDoc HTTP API 進行多節點文檔轉換，移除容器化環境對本地 Python `.venv` 的硬性依賴。

### Fixed

- **新客第一則訊息全部靜默掉失（CM-175，P0）** — `packages/core` 缺少 `"type": "module"` 被編成 CJS，而 `@open333crm/database` 是純 ESM。在 Node 24（UAT 執行環境）下，CJS `require()` 純 ESM 套件時，`export * from` 的符號可正常取得，但 `export { prisma } from './client.js'` 這類「轉出式 re-export」的符號會遺失，使 `identity-stitcher` 取到的 `prisma` 為 `undefined`，於 `resolveUidToContact` 存取 `.identityMap` 時拋 TypeError。影響面是「尚未建立 IdentityMap 的渠道 UID」——即每位新客的第一則訊息：webhook 進站、驗簽通過、訊息解析成功，但聯絡人建不出來、訊息不落地、收件匣完全看不到，且因 webhook 仍回 200 而無任何外部徵兆。已綁定身分的聯絡人走快路徑不受影響，因此表面上系統看似正常。修法：`packages/core` 補上 `"type": "module"`（產物轉為 ESM，並補齊相對匯入副檔名）；`identity-stitcher` 改為由呼叫端注入 Prisma executor，不再依賴套件層級的全域 `prisma` 單例——此舉同時消除未綁租戶連線在 Postgres RLS 下的隱患（同 CM-171／CM-172 病因）。
- **解除 Agentic LLM 預設關閉與舊版知識庫底層死鎖** — 
  - `AGENTIC_LLM_ENABLED` 於 `env.ts` 與 `.env.api.example` 改為預設啟用（`true`），並在 UAT `deploy.yml` 自動將伺服器配置校正為 `true`，使收件匣對話正常進入 Agent 工具調用迴圈（可使用 `ocr_image`、`parse_document`、`search_web` 等感知工具）。
  - 修訂 `llm.service.ts` 中的預設提示詞 `CRM_REPLY_SYSTEM_PROMPT`，移除死板硬編碼的「家電產品限定」與「未查獲即強迫回覆轉接專人」話術，恢復為通用的親切客服助理。
  - **Gemini 函式宣告結構相容化（`toGeminiParameters`）**：過濾 OpenAPI 3.0 的 `minLength` / `maxLength` 與不支援的 `format: 'uri'`，並將型別統一映射為大寫（`OBJECT` / `STRING`），解決 Google Gemini 嚴格 Schema 驗證拋 400 導致 Agent 靜默失敗而降級至 KB 的問題。
  - **Ollama 容器網路位址適應（`resolveOllamaBaseUrl`）**：在 Docker 容器化環境下，若租戶 DB 預設存有 `http://localhost:11434`，自動優先回退至 `process.env.OLLAMA_BASE_URL`（`http://ollama:11434`），防止連線拒絕。
  - 修訂 `gemini.provider.ts` 與 `ollama.provider.ts` 內嵌之 `kbContext` 提示詞模板，去除強硬的「超出範圍一律拒答轉接專人」文字，並在 `runner.ts` 捕獲 `generateToolTurn` 錯誤時印出詳細日誌。

## [2026-09-08]

### Added

- **人員直綁可用渠道（CM-173 延伸）** — 「一個帳號＝一個分店」場景：人員編輯彈窗新增「可使用的渠道」勾選，直接指定該帳號能看到/操作哪些渠道，跳過 team 中介。新增 `AgentChannelAccess`（`agent_channel_accesses`，正式 migration 含雙 FK RLS policy，比照 `case_relations`）。可見性解析取「agent 直綁 ∪ team 授權」聯集；legacy 語意調整為「未綁任何 team『且』未直綁任何 agent 的渠道才全租戶可見」（渠道一旦被任一種方式綁定即限縮）。新增 API `GET/PUT /agents/:id/channels`（權限 `channel.assign_team`、含稽核、交易內整組替換）。socket 授權同步此語意。team 那套（ChannelTeamAccess/指派 API/UI）保留，供未來「一分店多店員/派單/報表」使用。

- **總店/分店渠道級可見性（CM-173）** — 單一租戶內依帳號控制可見/操作哪些渠道（LINE/FB/IG）來的對話與案件。新增權限點 `channel.view_all`（總店，看全部渠道，給 admin/supervisor）與 `channel.assign_team`（指派渠道給團隊，給 admin）。核心解析 `channel-visibility.ts`（`getAccessibleChannelIds`：agent→teams→ChannelTeamAccess→channelId，未指派團隊的 legacy 渠道維持全租戶可見、無授權則 fail-closed 回空）。對話/案件列表依可見渠道過濾、單筆讀取不可見渠道回 404、對話操作（回覆/指派/關閉/轉真人）不可見回 403。`ChannelTeamAccess` 由 in-memory mock 改 Prisma 真 DB，新增渠道↔團隊指派 API（`GET/POST/DELETE /channels/:channelId/teams`）。socket room 授權的「總店」判定由寫死 ADMIN/SUPERVISOR 改為 `channel.view_all` 權限點。前端渠道編輯彈窗新增「指派團隊」區塊、收件匣渠道篩選改用可見渠道並加空狀態提示。與 Postgres RLS 分層（RLS 管跨租戶、本功能管租戶內渠道）。新增權限點部署後需跑 reconcile + 清權限快取。

- **人員管理拆分「停用」與「刪除」兩個動作（CM-174）** — 後台人員編輯彈窗新增獨立的「停用」與「刪除」入口。停用（`POST /agents/:id/deactivate`，權限 `agent.deactivate`）維持原行為：設 `isActive=false`、可再啟用、保留 email 佔用。刪除（`DELETE /agents/:id`，權限 `agent.purge`）為新功能：於交易內先清理對 `agents` 為 RESTRICT 的關聯（`notifications`/`cli_sessions`/`passkey_credentials`）再永久刪除 Agent，釋放 email 使其可在其他租戶重新加入（不可復原，前端加二次確認）。列表對停用中的人員顯示「已停用・email 仍被佔用」提示。新增權限點 `agent.deactivate`、`agent.purge`（部署後需跑 `scripts/reconcile-system-role-permissions.mjs` 並清權限快取）。

### Changed

- **`DELETE /agents/:id` 語義變更** — 由原本的「停用（軟刪，僅 `isActive=false`）」改為「永久刪除並釋放 email」，權限由 `agent.delete` 改為 `agent.purge`。停用改用新端點 `POST /agents/:id/deactivate`。`agent.delete` 權限點保留但標記淘汰。

## [2026-09-02]

### Added

- **上傳檔案內容類型偵測** — multipart upload 會在 storage/parser 前以 magic bytes 與 Magika 驗證真實類型；presigned upload 改為 quarantine → `complete-upload` scan/promote，並提供 `UPLOAD_CONTENT_DETECTION_ENABLED`（預設開啟）作緊急回退開關。此功能只做內容類型驗證，不代表病毒掃描。
- **Resend Email API 寄信支援** — 新增 `EMAIL_DELIVERY_MODE=resend`，使用 server-side `RESEND_API_KEY` 與已驗證的 `EMAIL_FROM` 發送試用、平台帳號、用量告警與畫布 Email；保留 `log`、`webhook` 與 SMTP rollback 模式。

### Fixed

- **建立不合法 body 的 `line_flex_template` 素材回 500 而非 400** — `assertLineFlexMessageBody` 呼叫 `normalizeLineFlexMessageBody` 時未接住其對不合法 body（如空物件、contents 非 bubble/carousel）拋出的 `LineFlexTemplateError`，導致冒泡成 500 `INTERNAL_ERROR`。修法：用既有的 `flexErrorToAppError` 把該錯誤轉成明確 400，並對 `validateLineFlexMessageBody` 的 `errors[0]` 加防禦性 fallback。本機實測：空 body 回 400 `INVALID_LINE_FLEX_PAYLOAD`、合法 body 仍 201 建立成功。（撰寫 Flex 操作手冊、建測試素材時發現）
- **AI route merge syntax** — 修正最新分支同步時 `/api/v1/ai/rewrite` 路由缺少結束括號，避免 API TypeScript 編譯失敗。
- **Cloudflare security audit findings** — 修正 authenticated Socket.IO 任意 room 訂閱越權；visitor socket 改為只接受 server-issued Chatbox session/claim；legacy WebChat visitor-token session route 改為安全停用/遷移路徑，message/media 加入 secure contract、3 天 session 上限、payload/檔案/IP/session/channel 限流；`xlsx` 替換為 `@e965/xlsx`，並更新 Engine.IO、Socket.IO parser、sharp、PostCSS 等 production-reachable 依賴。
- **Socket 訂閱限流與 RLS CI 修正** — 訂閱/取消訂閱限制改為每條連線每 60 秒 rolling window；Socket plugin 的 `prismaAdmin` 使用補上明確租戶/資源授權白名單，通過 strict RLS 白名單檢查。
- **Gemini 多工具回覆格式修正** — 連續的 tool responses 合併為同一個 Gemini `user` turn，避免多工具呼叫時產生不符合 API 規範的連續 user turns。
- **Agent retention 冪等清理** — 清理工具呼叫暫存資料時排除已標記為 `EXPIRED` 的資料，避免重複更新。
- **PR review 安全修補** — 修正 public Chatbox 的 RLS client、舊版 WebChat embed 相容性、team-scoped conversation room 授權、Agent bot mode/Wiki 權限/feature flag、Agent timeout 與 inbound history 重複，以及 workers retention 清理條件。
- **Agent retention RLS 與敏感內容清理** — standalone worker 優先使用 `DATABASE_URL_ADMIN` 執行跨租戶 retention；過期 AgentRun 會同步清除 user prompt，避免客戶上下文繞過三天保留政策。
- **Worker RLS fail-closed** — standalone workers 若未設定 `DATABASE_URL_ADMIN` 會在啟動時明確失敗，避免 forced RLS 讓 retention/scheduler 靜默變成 no-op。
- **PR review follow-up** — public WebChat 限流改讀 trusted reverse-proxy client IP；Agent 回覆寫入前以 `BOT_HANDLED` 條件 claim 對話；workers 範例改用已 provision 的 `app_admin` role。
- **Chatbox / Agent RLS race 修正** — public Chatbox 改用明確 admin client；Agent bot reply 以交易內條件 claim `BOT_HANDLED` 對話後才建立訊息，避免人工接管後仍送出 bot 回覆。
- **Open channel room 相容性** — 未設定 team access 的 channel 維持租戶內客服可存取；有明確 team 綁定時則嚴格依 team membership 授權。

## [2026-08-28]

### Security

- **UAT 對外暴露面收斂（docs/27 S0 / P1）** — `docker-compose.yml` 所有服務 port 發布改綁 `127.0.0.1`（postgres 5433 / redis 6380 / ollama 11434 / minio 9000-9001 / api 3001 / web 3000 / caddy 8888），對外流量一律走主機 nginx（80/443）；caddy 直接寫 `127.0.0.1:8888:80`，deploy.yml 原 sed 改埠步驟自然失效（no-op）。搭配 AWS Security Group 只留 22/80/443 為雙保險。主機側另已清除 `/tmp` 含密碼的 env 備份、啟用 fail2ban（sshd jail）。

### Security

- **UAT 對外暴露面收斂（docs/27 S0 / P1）** — `docker-compose.yml` 所有服務 port 發布改綁 `127.0.0.1`（postgres 5433 / redis 6380 / ollama 11434 / minio 9000-9001 / api 3001 / web 3000 / caddy 8888），對外流量一律走主機 nginx（80/443）；caddy 直接寫 `127.0.0.1:8888:80`，deploy.yml 原 sed 改埠步驟自然失效（no-op）。搭配 AWS Security Group 只留 22/80/443 為雙保險。主機側另已清除 `/tmp` 含密碼的 env 備份、啟用 fail2ban（sshd jail）。

### Added

- **平台帳號開通與自助管理（platform-user-management）** — 平台後台新增「平台帳號」管理頁，平台管理員可直接開通新的 `PlatformUser` 帳號（不再只能靠手動 SQL），涵蓋完整生命週期：**開通只需輸入 email/name，密碼由系統隨機產生**（高熵英數混合、排除易混淆字元）並寄信告知，帳號標記 `mustChangePassword: true`——**新帳號首次登入後，除「自助改密碼」外的所有平台 API 一律被擋（403 `MUST_CHANGE_PASSWORD`）**，直到改密碼成功、旗標清除為止；列表、編輯（name/email）、停用/啟用（防呆：不可停用自己、至少保留 1 個啟用帳號）、重寄開通信（會產生新臨時密碼取代舊值、重新要求改密碼），帳號詳細頁可查詢該帳號相關的 `PlatformAuditLog` 操作紀錄。同時補上系統原本完全沒有的密碼重設機制：已登入自助改密碼（需驗證舊密碼，成功後清除 `mustChangePassword`）＋忘記密碼自助重設（`resetTokenHash`/`resetTokenExpiresAt` 時效 token、sha256 雜湊、單次使用、防枚舉，比照 `TrialSignup.verifyTokenHash` 模式，成功後同樣清除 `mustChangePassword`）。新端點皆掛 `authenticatePlatformSuperuser` guard（公開的 forgot/reset-password 另加 IP rate limit），寫入操作皆記 `PlatformAuditLog`（不含明文密碼）。新增 `platform-user.service.ts`、`platform-password-recovery.service.ts`、`platform-user-emails.ts`（開通信/重設信模板，純 HTML inline-style，不走 MJML）、`shared/utils/temp-password.ts`（臨時密碼產生工具）；前端新增 `/admin/platform-users`（列表+開通表單，不含密碼欄位）、`/admin/platform-users/[id]`（詳細頁，顯示是否已改密碼）、`/admin/change-password`（支援 `?forced=1` 強制模式，不顯示側邊欄）、`/admin/forgot-password`、`/admin/reset-password`；登入頁與 API 攔截器偵測 `mustChangePassword`/`MUST_CHANGE_PASSWORD` 自動導向。OpenSpec change `platform-user-management`。
- **平台租戶詳細頁（點租戶往下鑽 + 編輯）** — 平台後台租戶管理的租戶名稱改為可點擊，進入 `/admin/tenants/[id]` 詳細頁：資料量統計（客服/渠道/聯絡人/對話/案件）、基本資料編輯（站台名稱、方案切換——方案變更即時失效權限天花板與租戶方案快取，比照 convertToPaid）、啟用/停用、合約期間編輯、成員清單（姓名/Email/角色/狀態）＋成員操作：**修改成員 Email**（即登入帳號，全域唯一衝突回 409）與**重寄開通信**（複用手動開通信模板，不含密碼）。新端點 `GET /platform/tenants/:id`、`PATCH /platform/tenants/:id`、`PATCH /platform/tenants/:id/agents/:agentId`、`POST /platform/tenants/:id/agents/:agentId/resend-welcome`（zod 驗證、寫 PlatformAuditLog）。
- **平台手動開通租戶寄開通信 + 顯示登入網址** — 補上手動開通後「不知道要去哪登入」的斷點：`provisionTenantViaApi` 開通成功後比照 trial 自動寄開通信給管理員 Email（新模板 `sendManualProvisionedEmail`，帶 `${WEB_BASE_URL}/login` 登入按鈕；**不帶密碼**——密碼由開通人員設定，信中註明請洽開通人員並建議登入後改密碼；fire-and-forget 寄信失敗不影響開通）；API 回傳加 `loginUrl`，平台後台開通成功訊息同步顯示登入網址與「已寄信／密碼請自行轉交」提示。

- **LINE 素材可點擊 action 點擊後貼標（點連結自動貼標的全面化）** — 把「短連結被點擊→貼標」擴大到 LINE 素材裡**所有可點擊處**（carousel 按鈕/endPage CTA、flex button、quick reply、imagemap 區域、video endCard）。使用者在素材編輯器每個 action 選一個標籤（來源設定/標籤管理的 CONTACT-scope 標籤），點了就對聯絡人貼標，並自動發 `contact.tagged`→既有自動化訂閱可據以分眾（零額外接線）。兩條路徑、貼標核心完全複用既有：**(1) postback 型**（按鈕/carousel/flex button/quick reply）——選標籤即把 action data 設 `tag:<tagId>`，webhook 新增 `handleTagOnClick` 攔截器（`inbound-postback-interceptors.ts`）收到就 `addTagToTarget(CONTACT, addedBy:system)`，不短路（貼完仍走 CSAT/KB/handoff 與正常訊息流程），標籤不存在/scope 不符/缺 contactId 皆靜默略過不中斷。**(2) uri 型**——選標籤寫進 `action.tagOnClick`，廣播送出時 `convertBodyUrlsToShortLinks` 把 tagId 灌進該 uri 的素材短連結（`findOrCreateMaterialShortLink` 帶入），沿用既有 `trackClick` 貼標；tagOnClick 是內部欄位，送出前 delete 掉不進 LINE payload。前端 `ActionConfigEditor`（carousel/imagemap/flex 共用）加「點擊後貼標」下拉（`useContactTags` hook SWR 快取、只列 CONTACT-scope），postback 選標籤附「接管回傳資料」提示、開啟時從 data 反解還原；message 型（含 imagemap message area）不提供貼標。端到端實測：模擬 LINE postback(正確 HMAC 簽章)→ 聯絡人被貼標(0→1, addedBy=system)、冪等(重複點仍 1)、無效標籤 webhook 仍 200 靜默略過。OpenSpec change `material-action-tagging`。
- **AI 描述生成 Flex 草稿 + AI 潤稿（差異化：一句話產出設計卡）** — Flex 素材（`line_flex_showcase`）新增兩個 AI 能力，接續填空編輯器（階段 1）：**(1) 一句話生成** — 起手空狀態加「✦ 用 AI 描述生成」入口，使用者描述想要的卡片 → 後端 `generateFlexFromPrompt` 組「只輸出合法 LINE Flex bubble JSON + few-shot」系統提示走既有 `llm.service.generateReply`（token 額度硬擋 / 累加 / provider 選擇皆自動生效，不重複包）→ `extractJsonObject` 容錯解析（去 markdown 圍欄、抓 `{…}` 區塊、失敗退階）→ 經既有 `validateLineFlexDraft`（實打 LINE API）驗證，不合法把錯誤餵回 AI 重試一次、再不行回 422 `FLEX_AI_GENERATE_FAILED` 建議改用範本（不硬塞壞 JSON 進編輯器）；產出以 `{ contents, altText, source:'ai' }` 載入**同一個填空編輯器**微調（extractFields 一樣掃出業務分組欄位），範本資訊卡對 AI 來源顯示「AI 生成草稿」。**(2) AI 潤稿** — 填空編輯器 text 類欄位（文字/按鈕文字/按鈕訊息）加「✦ 潤稿」鈕 → 下拉潤飾/縮短/換語氣 → `POST /ai/rewrite`（gemini 等失敗包成 422 `AI_REWRITE_FAILED` 不裸 500），潤稿後更新欄位 + 即時預覽，失敗靜默略過不阻斷編輯。附帶把 showcase 預設 body 改空，讓起手一律進「AI 生成 / 選範本」空狀態。端點：`POST /api/v1/marketing/materials/line-flex/ai-generate`（guard `marketing.manage`、prompt zod min(1)/max(500)）、`POST /api/v1/ai/rewrite`。驗證：後端鏈路 / 路由 / schema 邊界 / 錯誤傳播 curl 實測通過；前端空狀態入口與失敗提示瀏覽器實測；happy path 生成端以 ollama qwen2.5:3b 補驗（AI 產出結構完整合法 Flex、通過本機結構驗證）。無 AI key 時採「樂觀啟用 + 失敗友善提示」不擋範本主線。OpenSpec change `flex-ai-generate`。
- **Flex 範本填空編輯器分組 UI（零程式套用官方設計）** — 「精選範本」（`line_flex_showcase`）的編輯器從「平鋪所有可編輯欄位」升級為「依業務區塊分組填空」，讓非工程人員能像填表般套用官方 Flex 設計、不必理解 box/contents 樹狀結構。(1) `flex-fields.ts` extractFields 為每個掃出的欄位加 `group`（`FlexFieldGroup`：主圖 / 標題與內文 / 按鈕 / 其他），依位置與 kind 推斷（image/icon→主圖、text→標題與內文、button_*→按鈕），並預留 sample.slots 覆寫接口供後續更精準分組；(2) `LineFlexShowcaseEditor` 把欄位裝進業務卡片（帶區塊圖示 header），只顯示有欄位的區塊，欄位標籤用業務語彙（圖片/小圖示/文字/按鈕文字…）取代 JSON path；(3) 技術性的「新增 / 刪除元件」結構操作收進 `⚙ 進階` 摺疊區（`<details>`，預設收合），多數填空使用者不需動結構；(4) 填空即時反映右側手機預覽（沿用既有 renderer），存素材 body 結構（sampleId/contents/altText）不變、通過既有 line-flex validate。端到端實測：餐廳範本欄位正確分組（主圖/標題與內文）、改標題預覽即時更新、進階區容器編輯可展開。OpenSpec change `flex-template-fill`。
- **Rich Menu 分眾綁定（不同受眾看不同圖文選單）** — 台灣 LINE 平台入場券之一。現況零件其實都在（publish 流程完整、channel-plugin bulk-link 已自動每 500 分批），唯缺「把 Rich Menu 綁到分眾」的業務邏輯。補：(1) `resolveAudienceLineUids`——受眾（Segment 走 `calculateSegmentContacts`、或 tag 直接篩 contactTag）→ contactIds → `ChannelIdentity`（channelType LINE + 同 channel）取 uid 去重；(2) `bindRichMenuToAudience` / `unbindRichMenuFromAudience`——檢查 menu 為 published + 有 lineRichMenuId（draft/error 擋「請先發布」），解析 uid 入背景 queue `rich-menu-bind`，立即回 `{ queued: N }`；(3) worker handler 取 channel 憑證 → `plugin.extensions.ui.linkMenuToUsers/unlinkMenuFromUsers`（走背景因受眾大 + LINE bulk-link 有 rate limit）；(4) route `POST /line/rich-menus/:id/{bind,unbind}-audience`（沿用 `richmenu.manage` guard）；(5) 前端已發布 menu 卡片加「綁定受眾」按鈕 + `RichMenuBindDialog`（選分群 → 送出，顯示已綁定人數）。租戶隔離由 contactIds（經 tenantId 篩）+ 本租戶 menu 的 channelId 保證。全體 default 與分眾綁定並存（LINE 規則：per-user 綁定優先於 all-default）。4 項 worker 單元測通過。OpenSpec change `rich-menu-audience-targeting`。
- **素材級點擊歸因（差異化定位「證明哪則訊息有效」）** — 打通「素材 → 短連結 → 點擊 → 歸因回素材」鏈路，讓成效歸因到單則素材（競品只做到按鈕級）。現況原本斷兩處：`ShortLink` 無 `materialId`、且廣播發送完全不經短連結（URL 直發原網址、無點擊可追）。修復：(1) `ShortLink` 加 `materialId`（nullable 外鍵，onDelete SetNull，素材刪除保留短連結與點擊歷史）+ Material 反向關聯；(2) 廣播發送時 `executeBroadcast` 自動把素材 body 內的外部連結（遞迴找 `{type:'uri'}` 與 imagemap `linkUri`，涵蓋所有版型與 Flex）換成帶 materialId 的短連結——素材層共用一條（非 per-recipient）、同素材同 URL 複用既有（`findOrCreateMaterialShortLink`，避免短連結表膨脹）、已是本站短連結不二次包裝；(3) `getMaterialStats` 加點擊數（經 `ShortLink.materialId` 聚合 totalClicks）與點擊率（點擊數 ÷ 使用次數），無短連結歸因資料或未送出時回 null（不假造 0）；(4) 素材詳情頁「素材成效」面板顯示使用次數/點擊數/點擊率/回覆數/開案數，點擊率標「基於廣播發送」。端到端實測：點擊率 12/50=24% 正確、無資料回 null、前端面板正常渲染。OpenSpec change `material-click-attribution`。
- **短連結點擊 → 自動貼標的正規自動化路徑** — 打通「短連結被點擊 → 自動化規則 → 對聯絡人加標籤」這條之前斷掉的鏈路，讓行銷人能在自動化 UI 用「短連結被點擊」當觸發、對點擊者做多種動作（不只硬綁一個 tag）。修復兩處斷點：(1) `automation-engine` 註冊 `link.clicked` 為合法觸發事件（events.ts 加 LINK_CLICKED，category contact、provides contactScopes，合約驗證放行、UI 觸發器下拉自動列出）；(2) worker 動作執行器（`apps/workers/.../automation-actions.ts`）新增 `add_tag` 動作——依 `tagId` 或 `tagName`（找不到則同租戶建立）解析標籤、驗租戶隔離、冪等貼 `contactTag`（addedBy `automation`），缺 contactId/tagId 安全跳過不報錯。`link.clicked` 事件 facts 補 `shortLinkId` / `slug`，規則可判斷點的是哪一條連結。既有 `ShortLink.tagOnClick` 直接路徑保留，兩路徑並存靠 add_tag 冪等防重複。執行路徑：點擊 → link.clicked eventBus → enqueue automation queue → worker `executeWorkerAutomationActions`。5 項單元測試通過（貼標/冪等/缺 contact skip/跨租戶擋/依名稱建立）。OpenSpec change `line-material-basics-and-click-tag`。
- **素材庫治理：分類 / 標籤 / 版本 / 素材級成效** — 素材庫從「表單式單渠道 CRUD」補上治理面（對標競品研究：版本與素材級成效為業界普遍空白）。(1) **巢狀分類**：新增 `MaterialCategory`（tenant-scoped、parentId 自我關聯），列表頁左側分類樹（含每分類素材數）可篩選；分類管理 dialog 可新增 / 改名 / 搬移（後端擋自我循環 CATEGORY_CYCLE）/ 刪除（其下素材 categoryId 由 FK SET NULL 歸「未分類」，不刪素材）；Material 加 `categoryId`，保留舊 `category` 字串過渡。(2) **標籤**：Material 加 `tags[]`，列表頁標籤 chips 篩選（hasSome），`GET /materials/tags` 即時聚合租戶 distinct 標籤（無標籤表）。(3) **複合篩選 + 排序**：列表 `GET /materials` 支援 categoryId / tags / status / channelType / 關鍵字組合 + `sort`（最近使用[nulls last] / 使用次數 / 更新時間 / 名稱）；篩選中膠囊列可逐一移除。(4) **版本控制**：新增 `MaterialVersion`（versionNo 遞增快照），create / update（name 或 body 變動時）寫快照；`GET /materials/:id/versions` 檢視、`POST /materials/:id/versions/:no/restore` 還原（寫回舊內容並產生新版，線性歷史不破壞）；編輯頁時間軸版本歷史面板 + 還原。(5) **素材級成效**：`GET /materials/:id/stats` 由 `BroadcastRecipient` 歸因回覆數 / 開案數，列表使用率長條以租戶內 `maxUsageCount` 正規化 + 顯示既有 `lastUsedAt`（相對時間，null 顯示「—」）；點擊率無短連結歸因資料時回 null（UI 顯示「暫無資料」，不假造 0）。(6) **顯示狀態**：Material 加 `status`（draft / approved 手動切，送審核准狀態機另開 change）。兩張新表納入 Postgres RLS（NULLIF fail-closed policy），實測跨租戶隔離通過。OpenSpec change `improve-material-library-governance`。
- **LINE SafeReply Push Fallback** — LINE 回覆若在原始 webhook 後 30 秒內且仍有有效 `replyToken` 才使用 reply API；Agent 研究、KB 自動回覆或 keyword automation 超過安全窗口時自動改用 push，reply API 明確失敗時再補一次 push。原始 receipt timestamp／replyToken 已貫通 API 與 worker delivery，非 LINE 渠道維持原行為。

- **Agentic LLM 工具循環** — 新增可選啟用的 tenant-scoped Agent runner，支援 Ollama/Gemini tool calling，最多 100 輪並具備總時間、工具數、token、重複呼叫與月額度保護；提供 `search_web`、`read_web_page`、`get_live_weather` 與受權限控管的 `publish_wiki_report`。網頁搜尋／閱讀依序使用 `https://2md.aiurl.tw/`、`https://2md.glsoft.ai/`、`https://create360.ai`；Wiki 回覆只暴露公開 `shareUrl`。Agent 執行 trace、工具紀錄與報告狀態租戶隔離，暫存資料建立後 3 天清理，正式 CRM 對話與已發布 Wiki 內容保留；Agent 失敗時回退既有 KB 自動回覆。預設 `AGENTIC_LLM_ENABLED=false`，需設定相關環境變數後啟用。

- **試用租戶保留期屆滿軟刪 + 復原** — 平台試用政策的「到期後資料保留天數」(trial.dataRetentionDays)先前只儲存不生效，本次落實：trial scheduler 加軟刪分支，掃已停用(isActive=false)且 trialEndsAt 距今超過 dataRetentionDays 天且 purgedAt=null 的試用租戶，設 Tenant.purgedAt=now(標記，不真刪 DB、可復原)+寫稽核 tenant.trial.purge；保留期基準用 trialEndsAt。平台後台 restorePurgedTenant + PATCH /platform/tenants/:id/restore 可復原(清 purgedAt，不動 isActive)；試用管理頁顯示「已清除」狀態 + 復原按鈕。軟刪租戶因 isActive=false 沿用既有 TENANT_DISABLED 擋登入。Tenant 加 purgedAt(nullable migration 非破壞性)。
- **Postgres RLS 租戶隔離（DB 層強制）** — 多租戶隔離從純 app-layer（每 query where tenantId）強化為 **Postgres Row-Level Security**。機制：`app_tenant`（NOBYPASSRLS）連線 + 每個租戶操作於**交易內 `set_config('app.current_tenant', tid, is_local=true)`**（`lib/tenant-db.ts` 的 `withTenant` / `tenantScopedClient` $extends 自動綁定，含 raw query 覆寫），連線歸還池不殘留；白名單（平台/認證/scheduler/OAuth 回調）走 `app_admin`（BYPASSRLS）連線。policy 用 `NULLIF(current_setting(...),'')::uuid` 防未設定時空字串轉型錯（fail-closed）。涵蓋：core 表（contacts/conversations/cases + messages 用 conversationId subquery）、40 個有 tenantId 的租戶表（標準 policy）、23 個無 tenantId 子表（靠外鍵父表 subquery policy）。所有 route 接線：租戶→`request.tenantPrisma`、白名單/平台→`prismaAdmin`、交易 service→`withTenant`、公開端點(webhook)/跨模組(ai/mcp)→保留。實測跨租戶隔離/fail-closed/WITH CHECK 防越權寫入/子表關聯皆通過。**部署注意**：需設 `DATABASE_URL_TENANT`/`DATABASE_URL_ADMIN`（未設 fallback 現況 URL，RLS 未 FORCE 時行為不變）+ 建 app_tenant/app_admin role 密碼；軟回滾＝受約束連線暫切 admin（改 env 重啟，app-layer 仍在不裸奔）。機制與陷阱詳見 skill `postgres-rls-tenant-isolation`。
- **AI 用量告警（80%／100%）** — 租戶 AI token 月額度用量**剛跨越 80%（warning）與 100%（critical）**門檻時，發**站內通知 + email** 給該租戶所有 ADMIN。偵測掛在 `incrMonthlyTokens` 累加後（比較累加前後是否跨越門檻，單次巨量可同時觸發兩級不漏），冪等以 Redis 旗標 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`（SET NX + 月底過期，跨月自動重置）確保每租戶每月每級僅一次。發送走 eventBus `usage.quota.threshold` → notification worker（複用既有 `notification:dispatch`）+ email（`usage-alert-emails.ts`，warning 琥珀／critical 紅，critical 說明 AI 自動回覆暫停、真人不受影響）。僅 `keySource='platform'` 且有 `monthlyTokens` 上限者觸發（BYOK／無上限不告警），全程 fire-and-forget 不阻塞回覆、不影響既有 `PLAN_LIMIT_EXCEEDED` 硬擋；env `USAGE_QUOTA_ALERTS_ENABLED=0` 可灰度停用。
- **租戶操作稽核日誌（TenantAuditLog）** — 新增租戶層操作稽核（有別於平台方看的 `PlatformAuditLog`），記錄租戶內敏感操作：系統設定變更（`settings.update`）、成員與角色權限變更（`agent.create`/`agent.role.assign`/`agent.password.reset`/`agent.delete`/`role.permission.update`）、聯絡人合併（`contact.merge`）、案件刪除（`case.delete`）、渠道建立/刪除（`channel.create`/`channel.delete`）。稽核於 route handler 主操作成功後以 `writeTenantAudit`（非阻斷，失敗只 log）寫入，payload 僅存非 PII 摘要。租戶 ADMIN 可經 `GET /api/v1/tenant/audit-logs`（需 `audit.view` 權限）分頁查詢並依 action/actor/日期篩選，一律 tenantId scoped。新增 `audit.view`/`data.export`/`data.erase` 三個權限點（feature core，預設只給 ADMIN）。
- **GDPR 資料匯出（可攜權，Art.20）** — 租戶可匯出自己的資料（聯絡人/對話/訊息/案件及附屬），非同步走 BullMQ `data-export` worker：cursor 分頁逐表撈本租戶資料 → 產 JSON（保關聯）+ CSV → 打包 zip（自實作 store 模式 ZIP，免第三方依賴）→ 上傳 MinIO（`export/{tenantId}/{requestId}.zip`）→ 站內通知發起者。API：`POST /api/v1/tenant/data-export`（建請求）、`GET /:id`（查狀態）、`GET /:id/download`（驗 completed + 未過期 + 同租戶，產 15 分鐘短時效下載連結、downloadCount++），皆需 `data.export` 權限。檔案預設保留 7 天，由 `data-export-cleanup` repeatable worker 到期標記 expired 並刪 MinIO 物件。
- **GDPR 資料刪除（被遺忘權，Art.17）** — 新增聯絡人粒度的資料刪除功能，兩種模式：(1) **anonymize（匿名化，預設）** — 抹去 `Contact` 的 PII 欄位（`displayName`→佔位、`avatarUrl`/`phone`/`email`→null）、刪除可識別子資料（`ContactAttribute`/`ChannelIdentity`/`IdentityMap`/`LongTermMemory`）、將該聯絡人所屬對話的 inbound 訊息 `content` 改為 redacted 佔位，但保留 `Conversation`/`Case`/`Message` 統計骨架不刪（報表數字不變）。(2) **hard_delete（硬刪）** — 於 transaction 內先算 affected 計數再連鎖刪除：`Conversation`（cascade 帶走 `Message`/`ConversationTag`/`ChatboxSession`）、`Case`（cascade 帶走 `CaseEvent`/`CaseNote`/`CaseTag`/`CaseRelation`）、`PortalSubmission`、`PointTransaction`，最後刪 `Contact`（cascade 帶走 `ContactAttribute`/`ChannelIdentity`/`IdentityMap`/`LongTermMemory`/`ContactTag`/`ContactRelation`），並刪除對應的 MinIO 媒體附件。API：`POST /api/v1/tenant/data-erasure`（建立請求）、`GET /api/v1/tenant/data-erasure/:id`（查狀態），皆需 `data.erase` 權限並先驗目標聯絡人同租戶（跨租戶回 404）。刪除非同步走 BullMQ `data-erasure` worker，只影響目標 contactId；完成後寫 `DataErasureRequest.status`/`affected` 並記租戶稽核（`data.erasure.request`/`data.erasure.complete`，payload 只含 contactId/mode/affected 計數，絕不含 PII）、通知發起者。
- **方案細粒度分級（功能點 deny／渠道數量／渠道 provider 白名單）** — 平台後台「方案與上限」頁擴充三塊管控，全部即時生效、對既有無方案租戶零影響：(1) **功能點細分** — 每個已勾選功能可展開列出其權限點，逐點取消勾選＝`deny`，`Plan.permissionOverrides { deny: string[] }`；有效天花板＝`permsForFeatures(features)` 減去 deny（deny 高階不連坐低階，如 deny `channel.create` 仍保留 `channel.view`）；改動會失效該方案所有租戶的權限快取。(2) **渠道數量上限** — 新增 `maxChannels` 數值上限，`channel.service.createChannel` 建立時 count 硬擋（達上限 `PLAN_LIMIT_EXCEEDED` 403），只算 isActive、比照 `maxAgents`。(3) **渠道 provider 白名單** — `Plan.allowedChannelTypes`（ChannelType[]），非空且欲建類型不在內即 `CHANNEL_TYPE_NOT_ALLOWED` 403；空陣列＝不限制、只擋新建不影響既有渠道。route schema 以 Prisma ChannelType enum 與 core `PERMISSION_CODES` 驗證輸入合法。兩個新 Plan 欄位皆 migration 非破壞性（有 default）。
- **平台方案設定功能清單動態化（可擴展性）** — 平台後台「方案與上限」頁的功能清單先前寫死於前端，後端新增 feature/權限點不會自動反映。改為由後端 `GET /platform/registry` 動態提供（單一資料源＝`@open333crm/core` 的 FEATURES + permissions registry + ChannelType）：`FEATURES` 加 `desc` 欄位、新增 `buildPlatformRegistry()`；前端方案頁改動態載入。未來於 core 新增功能即自動出現在方案設定，無需改前端。
- **平台層租戶合約日期記錄** — 平台後台租戶管理頁可為每個租戶設定與查看合約起訖日（`contractStartDate` / `contractEndDate`），純記錄供平台方管理，不觸發任何自動生命週期行為（與 `trialEndsAt` 的到期自動停用明確區隔）；受平台 superuser 認證保護、變更寫 PlatformAuditLog；迄日不可早於起日（422）。`Tenant` 加兩個 nullable 欄位（migration 非破壞性、對既有租戶零影響）。
- **租戶隔離 CI 檢查（`scripts/check-tenant-scoping.mjs`）** — 靜態掃描所有對 41 個「含 tenantId 欄位」租戶表的 Prisma query，抓出 where 完全未帶 tenantId 的跨租戶洩漏風險；排除平台層/scheduler/認證入口等合法跨租戶查詢，where 為變數時往上追其定義。`--strict` 模式在偵測到疑似漏帶時 exit 1，已接入 CI（Build 後）作回歸防護。目前 codebase 掃描結果 0 洩漏。
- **人員管理支援指派自訂角色** — 前端新增/編輯人員的角色下拉改為列出租戶所有角色（內建 + 自訂），選內建角色送 legacy `role`、選自訂角色送 `roleId`；成員清單以 `roleRef` 顯示角色名（自訂角色紫色 Badge）；並依 `agent.role.assign` 權限 gating、友善呈現 `ROLE_ESCALATION` 等錯誤。
- **Passkey / WebAuthn authentication** — 新增 Agent Passkey 憑證模型、Redis challenge 防重放、註冊/登入/撤銷 API 與嚴格 RP ID、origin、User Verification 驗證。
- **WebMCP 唯讀 CRM 工具** — 登入後的 CRM dashboard 若瀏覽器支援 WebMCP，會以目前登入 Agent 的 JWT 提供聯絡人、案件、分析與目前客服資訊查詢工具；不支援 WebMCP 的瀏覽器維持原有功能。

### Changed

- **API 外掛架構文件改為請求導向** — 將原本以六種設計模式為主線的說明，改為依序解釋 API 組裝、租戶請求生命週期、外掛作用域、依賴提供與註冊順序；設計模式名稱移至附錄，並修正外掛數量、易失效的路由統計、declaration merging 能力邊界，以及 `onClose` 與 HTTP 請求生命週期混用的說法。
- **系統現況文件改為分層導覽** — 將單一 `SYSTEM-MINDMAP.md` 拆成 `docs/ref/system/` 文件組：首頁只保留系統執行圖、核心元件與閱讀入口，部署、應用與套件、基礎設施、開發交付、實作落差分開維護；並集中執行時驗證紀錄，減少總覽中的重複資訊與閱讀尺度切換。
- Passkey 註冊端點新增 rate limit；未設定 WebAuthn 的部署不再顯示無法使用的登入與綁定控制項。
- Passkey 綁定流程新增裝置名稱輸入與既有 credential 重新命名功能；已綁定清單顯示自訂名稱、裝置類型與備份狀態，方便辨識多個 credential。

### Fixed

- **[安全] 已停用平台帳號仍能用未過期 JWT 存取平台 API（授權繞過）** — `authenticatePlatformSuperuser` guard 即時查 DB 只取 `mustChangePassword`，未查 `isActive`，導致管理員停用某平台帳號後，該帳號手上未過期的 JWT（TTL 2 小時）仍可呼叫所有平台 API，停用形同虛設。修法：guard 查詢一併 select `isActive`，停用帳號直接回 401 `PLATFORM_USER_DISABLED`（即時失效，不需等 token 過期）。本機端到端實測：token 原可用 → DB 設 isActive=false → 同一 token 立即被 401 擋 → 復原後恢復。（bot review 於 PR #170 標為 security concern）

- **對已停用平台帳號重寄開通信無意義卻仍執行** — `resendPlatformUserWelcomeEmail` 未檢查 `isActive`，對已停用帳號重寄會換掉臨時密碼、寄出信，但該用戶登入仍被 `isActive=false` 擋下，白做且讓管理員誤以為對方已能登入。修法：加 `isActive` 檢查，停用帳號重寄回 400 `PLATFORM_USER_DISABLED`（需先啟用再重寄）。（bot review 於 PR #170 指出）

- **平台帳號 email 未正規化（大小寫/空白可能繞過唯一檢查或登入失敗）** — `PlatformUser` 的開通/編輯/登入/忘記密碼查詢皆直接用原始 email 比對，而 Postgres text 欄位大小寫敏感：以 `Admin@X.com` 開通、之後用 `admin@x.com` 登入會查無而失敗，或以不同大小寫繞過唯一檢查建出重複帳號。修法：平台帳號 email 於 zod schema 層統一 `.trim().toLowerCase()` 後再驗格式（登入/開通/編輯/忘記密碼四處共用 `platformEmail`），service 層另加 `normalizeEmail`（`shared/utils/email.ts`）作為雙保險。本機實測：全大寫、前後帶空白的 email 皆能正確命中既有小寫帳號、錯密碼仍擋。範圍僅平台帳號鏈路（租戶端 agent 登入沿用未正規化的既有行為，全系統一致，若收斂需配既有資料 migration，另議）。（bot review 於 PR #170 指出）

- **平台帳號「至少保留 1 個啟用帳號」防呆有併發競態** — `setPlatformUserActive` 原本先 `count({ where: { isActive: true } })` 再 `update`，兩步驟未在同一交易中，若兩位平台管理員同時停用最後兩組啟用帳號，兩邊的 count 皆讀到 2 而各自放行，導致啟用帳號歸零、沒人能登入平台後台。修法：把目標帳號存在性/isActive 讀取、count 檢查與 update **全部**包進同一 `$transaction` 並用 `Serializable` 隔離級別（整個判斷鏈在同一快照，交易外只留不依賴 DB 狀態的「不可停用自己」比對），併發時第二個交易因序列化衝突 abort，防呆確實生效。本機實測正常停用/啟用、「停用自己」、不存在帳號防呆均正確。（bot review 於 PR #170 指出併發競態與交易內狀態一致性）

- **粉絲門戶功能在 RLS 上線後完全失效（CM-172）** — 與 CM-171 同族根因：`portal.routes.ts` 全部 12 處端點沿用未綁定租戶的 `app.prisma` 連線，活動 CRUD/發布/結束/抽獎/提交紀錄/積分查詢調整整個模組被 RLS 擋下。修法：路由改用 `request.tenantPrisma`；service 層（`portal.service.ts`/`points.service.ts`）簽章收斂為 `TenantDb`；`updateActivity` 因內部原本自開 `$transaction`（RLS 交易不可巢狀）特別改為呼叫端先 `withTenant(app.prisma, tenantId, tx => updateActivity(tx, ...))` 開好綁定交易、函式內直接用傳入的 `tx` 操作；公開端點（`portal-public.routes.ts`，粉絲 JWT 身分）用到的 `submitActivity`/`getActivityResult` 維持 `PrismaClient` 不變。Wave 5 E2E 測試（tenant-misc.spec.ts）建立測試活動時發現。

- **短連結功能在 RLS 上線後完全失效（CM-171）** — `shortlink.routes.ts` 全部端點沿用未綁定租戶的 `app.prisma` 連線（未設定 `app.current_tenant` session 變數），Postgres RLS policy 的 `tenantId = NULL` 比較永遠為 false，導致建立短連結直接 500（RLS policy violation）、列表查詢則靜默回空陣列（回 200，不報錯，UI 顯示「目前沒有短連結」）——比報錯更隱蔽。修法：路由改用 `request.tenantPrisma`（每次操作自動綁定租戶 RLS context），service 層對應函式簽章由 `PrismaClient` 收斂為 `TenantDb` 聯集型別；公開重定向端點（`/s/:slug`，無租戶身分）沿用的 `getLinkForRedirect`/`getChannelLiffId`/`trackClick` 維持 `PrismaClient` 不變。Wave 5 E2E 測試（tenant-misc.spec.ts）建立測試短連結時發現。

- **儀表板「開啟中案件」統計卡默默壞掉（CM-163）** — 首頁載入時前端送小寫 `status=open`，cases list API 用 `z.string()` 放行後直塞 Prisma enum（合法值大寫 `OPEN`）炸 400；前端 `Promise.allSettled` 吞錯，畫面看似正常但統計卡永遠拿不到資料。修法雙保險：API list schema 的 `status`/`priority` 改為「轉大寫再驗 enum」（亂值回明確 400 而非 Prisma 內部錯）；前端改送 `OPEN`。UAT E2E smoke（console error 檢查）抓到的第一隻 bug。

- **資料庫租戶隔離：6 張表補外鍵 + 收緊 tags.tenantId（CM-155）** — 修一組多租戶完整性缺口。(1) **問題 1**：`teams`/`tags`/`sla_policies`/`km_articles`/`message_templates`/`automation_logs` 過去有 `tenantId` 欄位卻無指向 `tenants` 的外鍵（2026-04-02 多租戶改造時該批 migration 補了欄位卻漏建這 6 條外鍵），可寫入不存在的 `tenantId` 而 DB 不擋、RLS 的 WITH CHECK 也只驗跨租戶不驗租戶存在。補上 `tenant Tenant @relation(... onDelete: Restrict)`（與其餘租戶表慣例一致）；`message_templates.tenantId` 保留 nullable（系統共用模板能力）故關聯為 optional。本機/UAT 均掃描確認 0 孤兒列，migration 不會被既有髒資料擋下。(2) **問題 3**：`tags.tenantId` 收緊為 `NOT NULL`——系統共用標籤（tenantId=null）為 schema 預留但從未實作、全 repo 無使用、DB 0 筆。(3) **問題 4**：收緊後 `@@unique([tenantId, name, scope])` 對所有列真正生效（Postgres 不把多個 NULL 視為重複），一併解決。(4) **問題 2**：清除 RLS 下讀不到的 `tenantId=null` 系統模板死碼——`marketing.service` 三處 `OR: [{ tenantId }, { tenantId: null, isSystem: true }]` 查詢分支簡化為 `tenantId`，`seed.ts` 移除 `tenantId: null` 寫入（未動 RLS policy，依單建議只走死碼清理路徑）。兩支 migration 皆產正式檔並實測外鍵擋下不存在租戶的寫入。

- **AI Chat 健康檢查誤報「GEMINI_API_KEY is not configured」（未走 BYOK three-tier fallback）** — 租戶已在後台自填 BYOK Gemini key，但「重新檢測 / 狀態」仍誤報 provider 異常。根因：健康檢查鏈路（`GET /settings/chat`、`POST /settings/chat/health`）呼叫 `checkChatHealth` 時**沒把租戶 key 傳進去**，`gemini.provider.health()` 只讀全域 env `GEMINI_API_KEY`；環境未設該 env（如 UAT）時即回「not configured」，與實際發訊息走 `resolveGeminiKey`（租戶自填 → 平台 → env）的三層 fallback 行為不一致。修復：`ChatProvider.health` 介面加 `apiKey?`，`gemini.provider.health` 改用 `getApiKey(apiKeyOverride)` 優先吃傳入的租戶 key，`checkChatHealth` 加 `apiKey` 參數轉傳，兩個 route 呼叫端在 provider 為 gemini 時先 `resolveGeminiKey` 取租戶 BYOK key 再傳入（ollama 不受影響）。修好後健康檢查與發訊息用同一把 key，如實反映 key 可用性。本機端到端實測：設租戶假 BYOK key → health 回 `Gemini API 400: API key not valid`（證明用了租戶 key 而非 env）、error 隨 BYOK key 變化。

- **貼標寫入路徑統一 + 補發 `contact.tagged` + 迴圈防護** — 修架構檢視發現的事件鏈斷點：先前貼標散落三處，只有人工貼標（`tagging.service.addTagToTarget`）會發 `contact.tagged`，短連結點擊貼標與自動化 `add_tag` 都繞過、不發事件，導致「以貼標為觸發」的下游自動化不會被這兩條路徑喚起。修復：(1) `addTagToTarget` 加 `addedBy`（'agent'|'system'|'automation'，預設 agent）、agentId 改選填，`contact.tagged` payload 帶 `source`；(2) `shortlink.trackClick` 點擊貼標收斂到 `addTagToTarget`（消除重複的 find→create，補發事件，source 'system'）；(3) worker `add_tag` 因跨 process 無法 import api service，改 `contactTag.upsert` 冪等貼標 + 透過新增的 redis `domain:event` 橋（`socket.plugin` 端 subscriber 轉成 in-process eventBus）發 `contact.tagged`（source 'automation'）；(4) **迴圈防護**：automation.worker 的 `contact.tagged` subscriber 對 source==='automation' 不再觸發評估，斷開「貼標→規則→又貼標」自我循環（人工/點擊貼標仍可觸發）。**⚠️ 行為變更**：短連結點擊貼標現在會發 `contact.tagged`，可能觸發既有的 contact.tagged 自動化規則（此為修復目的，部署前確認既有租戶無非預期規則）。OpenSpec change `unify-tagging-write-path`。
- **LINE imagemap 動作不再默默降級 postback** — LINE imagemap 官方僅支援 uri/message 動作，原本編輯器讓使用者選 postback、發送時才默默降級成 message。`ActionConfigEditor` 加 `allowedTypes` 白名單，imagemap 編輯器改傳 `['uri','message']`，從源頭不給選 postback，避免使用者誤設。
- **RLS 上線後 migration 全炸修補（部署阻斷，重要）** — Postgres RLS 啟用後 app runtime 的 `DATABASE_URL` 指向受 RLS 的 `app_tenant`（NOBYPASSRLS、非 table owner）。entrypoint 的 `prisma migrate deploy` 沿用同一連線跑 DDL（`ALTER TABLE` 等），被 Postgres 以 `must be owner of table X`（42501 / Prisma P3018）擋下——RLS 切換後的第一個新 migration（`add_tenant_purged_at`）即卡死，API 啟動失敗、UAT 部署中斷。`docker-entrypoint.sh` 改為 migrate/seed 一律走新的 `MIGRATE_DATABASE_URL`（指向 table owner，如 `crm`）；未設時 fallback 到 `DATABASE_URL`（相容 RLS 未啟用環境，行為不變）。此舉同時修好 seed 因 RLS WITH CHECK 擋 `INSERT roles` 的錯誤。部署環境需在 `.env.api` 補 `MIGRATE_DATABASE_URL`。
- **UAT 部署 build 因磁碟寫滿失敗（ENOSPC）修補** — 每次部署 `docker compose build` 疊一層 next/webpack build cache 從不清，累積把 40G 根分割區塞爆（曾達 100%），導致 `next build` 寫 `.next/cache` 時 `ENOSPC: no space left on device` → webpack 編譯失敗 → 部署中斷。`deploy.yml` 在 build 前新增 `docker builder prune -af --filter until=48h`（清 48h 前的 build cache、保留當日增量維持 build 速度），避免磁碟無上限累積。
- **啟動驗證加固：registry 必須保留 selfLock 權限** — `validatePermissionRegistry()` 新增第 6 項檢查：registry 若無任何 `selfLock:true` 權限點即啟動失敗（fail-loud）。避免未來重構誤刪 `role.manage` 的 selfLock 導致 agent.service 的「防自我降級鎖死」守門（`SELF_LOCK_CODES` 為空時整段跳過）無聲失效。（PR review bot 提出的邊界條件，加保險。）
- **自我降級鎖死租戶修補（RBAC self-demotion，安全性）** — `PATCH /agents/:id/role` 先前只擋「向上指派超出自身的角色」（`ROLE_ESCALATION`），降級一律放行，且 route 未傳操作者本人 agentId，使最後一位持有 `role.manage`（`selfLock`）的成員可把「自己」改成不含該權限的角色，令整個租戶失去所有能管理角色/權限的人，角色 CRUD 與權限矩陣頁全 403、只能手動改 DB 復原。現 route 將 `request.agent.id` 傳入 `updateAgentRole`；service 在解析出目標 roleId 後，若目標即操作者本人且新角色的有效權限不含任何 registry 標記 `selfLock:true` 的權限碼（動態抽取，非寫死 `role.manage`），即拋 `SELF_LOCK` 422。管理員改別人角色、或把自己改為仍含 `role.manage` 的角色皆不受影響。
- **RBAC 寫入權限退化修補（canvas / identity）（安全性）** — 延續細粒度權限 migration 的系統性疏漏排查：自動化畫布（canvas）與識別建議審核（identity）兩組路由先前僅有 module-level `authenticate`，完全未掛 `requirePermission`，使 registry 的 `canvas.use`、`identity.review` 權限點形同死碼、任何登入者皆可操作。現為 canvas 全部端點（GET 清單/詳情/analytics/executions、POST 建立/activate/trigger、PATCH 更新）補 `requirePermission('canvas.use')`，identity 全部端點（GET suggestions、POST approve/reject）補 `requirePermission('identity.review')`；registry 未定義獨立 view 權限，故讀取端點一併沿用同一 code 守門。預設 supervisor/agent 角色本就具備此兩權限，既有可用角色不受影響。
- **指派自訂角色不再無謂降級 legacy role** — 前端 `buildRolePayload` 對 custom role 固定送 `role: 'AGENT'`，會把成員原本的 legacy role（如 SUPERVISOR）覆寫成 AGENT，影響仍讀 legacy role enum 的舊功能（實際權限走 roleId 不受影響）。變更角色時改用成員當前 role 作為 legacy 回填值；並將 `Agent.role` 型別收窄為 enum union。（PR review bot 提出，經確認採納。）
- **試用信件模板未轉義使用者輸入（XSS 加固）** — trial 信件的 `{{siteName}}` 等變數來自申請時使用者自填（`siteName` 僅限長度、不限字元），原樣經 `renderTemplateBody` 字串替換進 email HTML 未轉義，可注入惡意 HTML。於 `trial-emails.ts` 的 `render()` 對所有變數值先做 HTML escape 再替換（不動共用 `renderTemplateBody`，避免影響行銷 LINE Flex 模板）。（PR review bot 提出，經確認 `siteName` 確為使用者可控故採納。）
- **新租戶儲存 BYOK Gemini key 失敗（P2025/404）** — `setTenantGeminiKey` 用 `prisma.tenantSettings.update`，但 `TenantSettings` 為延遲建立，新開通、尚未動過任何設定的租戶還沒有此列，直接呼叫 `PUT /settings/gemini-key` 會拋 P2025（回 404）導致 key 存不進去。改用 `upsert`（無列則建立、有列則更新），與本檔其他 TenantSettings 寫入一致。
- **角色指派健壯性：租戶缺系統角色時不再用 null 覆蓋既有 roleId（資料完整性）** — `resolveRoleAssignment` 走 legacy role 路徑時，若該租戶缺對應 system role，`resolveRoleId` 回 `null` 會被寫入 `agent.roleId`，使成員 `getEffectivePermissions(null)` 得空集合而被鎖在系統外（且與 legacy role 雙寫不一致）。現改為此情況直接拋 `SYSTEM_ROLE_MISSING` 錯誤（fail-loud），不再靜默用 null 覆蓋既有有效 roleId。正常 seed/provision 一定建齊三個 system role，不受影響；僅資料未正確初始化的租戶會明確報錯以利修復。
- **試用防濫用去重漏洞：Agent 檢查未正規化 email，gmail 別名可繞過（安全性）** — 試用申請的「是否已是某租戶 Agent」檢查 `emailIsAgent` 原以原始 email（僅 trim/lowercase）比對，gmail 別名（`foo.bar@gmail.com` 與 `foobar@gmail.com` 為同一 Google 帳號）被視為不同 email 而查無，讓已被平台手動開通成 Agent（從未走 trial、`TrialSignup.emailNormalized` 無紀錄）的真人得以申請到第二個試用租戶。改為以正規化值（去 gmail 點/+tag）比對：先撈同網域候選 Agent，再於應用層逐一比對正規化 email。
- **方案數值上限輸入非數字被靜默解除（資料完整性）** — 平台方案編輯頁 `setLimit` 對非純數字輸入（如 `abc`）以 `parseInt` 得到 `NaN`，經 `JSON.stringify` 後 `NaN` 序列化成 `null`，被後端誤解為「無上限」，平台管理員打錯字即可靜默解除 `maxAgents`／`monthlyTokens` 等上限。前端改為 `NaN` 時不更新該欄（維持原值），僅明確空字串／`∞` 才視為 `null`；後端 `updatePlanSchema` 的 `limits` 值改用 `z.number().int().nonnegative().nullable()` 作第二道防線，怪值一律回 422 而非靜默寫入。
- 修正月額度硬擋在解析 `keySource` 之前執行、誤擋 BYOK 租戶：`generateReply` 原先在得知 key 來源前就呼叫 `isMonthlyTokenExceeded`，導致租戶先用 platform key 累計到接近上限、之後切換成 BYOK（自備 Gemini key）仍被舊 platform 累計量擋成 `PLAN_LIMIT_EXCEEDED`。現將額度硬擋移到 `resolveGeminiKey` 解析 `keySource` 之後，且僅在 `keySource === 'platform'` 時執行，與 `incrMonthlyTokens` 只累加 platform 的設計一致（BYOK 略過額度檢查、成本租戶自付）。
- 修正月額度 Redis 計數器初始化的併發 lost-update：`getMonthlyTokens` 與 `incrMonthlyTokens` 冷 key 回填原用無條件 `SET` 覆寫，高併發下會蓋掉另一路徑已建立並累加的計數器（計數器低估、`isMonthlyTokenExceeded` fail-open 少擋）。改為原子 `SET NX + PXAT`（只在 key 不存在時寫入、保留月底過期）；`incrMonthlyTokens` 若 NX 沒搶到（別人剛建好 key，其初始值不含本次）補做一次 `incrby(tokens)`，搶到則初始值已含本次不再累加，確保各路徑本次 tokens 恰好計一次。
- **RBAC 寫入權限退化修補（安全性）** — 修正細粒度權限 migration 的系統性疏漏：知識庫、粉絲活動（portal）、行銷（marketing/material）、渠道（channel）、分析報表（analytics）等模組的一批寫入／有副作用路由，先前僅受 module-level `.view` 或群組 authenticate 保護，導致 registry 定義的 `.manage` / `.broadcast` / `.export` 等寫入權限點形同死碼、寫入保護退化為「只要能檢視即可寫入」。現為各寫入路由補上對應的 `requirePermission` per-route preHandler（建/改/刪、publish/archive/end、import/upload/embed、抽獎、點數調整補 `*.manage`；群發 send/cancel 補 `marketing.broadcast`；渠道 verify/setup-webhook/webhook-base-url 補 `channel.update`；`analytics/export` 補 `analytics.export`），GET 唯讀維持 `.view`。
- 修正月額度 Redis 計數器雙重計數：計數器冷 key（月初 / Redis 重啟 / key 過期）回填時，DB 加總已含剛寫入的本次用量，卻又額外 incrby 一次，導致付費租戶月用量灌水、`isMonthlyTokenExceeded` 在約半量時就誤擋 AI 回覆（`PLAN_LIMIT_EXCEEDED`）。回填分支改為只 set DB 值並保留月底過期，僅在 key 已存在時才 incrby。
- 平台側試用轉付費（`convertToPaid`）改 `planId` 後未失效方案快取，導致 RBAC guard 在 60 秒內仍沿用舊試用天花板、誤將剛付費租戶的新功能擋成 403；現改方案後一併失效權限天花板與租戶 plan 快取（比照升級審核路徑）。
- **自訂角色可經 API 指派給成員** — `POST /agents` 與 `PATCH /agents/:id/role` 新增 optional `roleId`（uuid）欄位，與 legacy `role` enum 並存（提供 `roleId` 時以其為準）；roleId 經 `loadTenantRole` 驗證屬同租戶（跨租戶回 404），並依角色 slug 反填 legacy `role`（system role 對映 enum、custom role 沿用既有值）。修正先前前端建立的自訂角色無法指派給任何成員（只能改 DB）的缺陷。
- **角色指派越權防護（安全性）** — 指派角色時比對指派者角色的有效權限集合，若目標角色含指派者本身沒有的權限即擋下（`ROLE_ESCALATION` 403），取代舊有僅擋「SUPERVISOR 指派 ADMIN」的 inline 硬規則；admin system role 指派者不受限。同時 `PATCH /agents/:id/role` 的權限碼由誤用的 `agent.manage` 改為專用的 `agent.role.assign`（`agent.manage` 保留給建立/編輯成員）。
- 修正一般專員（AGENT）開「我的績效」頁被 403：`GET /analytics/my` 原受 module-level `requirePermission('analytics.view')` 攔截，但預設 AGENT 只有 `analytics.view.self`（`analytics.view` 為 SUPERVISOR 以上），導致個人數據頁打不開、`analytics.view.self` 形同死碼。新增 `requireAnyPermission` guard，module-level 改為 `analytics.view` 或 `analytics.view.self` 任一即放行，其餘完整報表路由（overview/message-trend/cases/agents/channels/contacts/csat）各自補回 per-route `requirePermission('analytics.view')` 嚴格把關，確保只有 `view.self` 的 AGENT 僅能看 `/my`、打不到其他 analytics 端點。
- **降權延遲視窗修補（安全性）** — `POST /auth/refresh` 先前原封沿用舊 refresh token 內的 `roleId`／`role` 重簽 access token，導致管理員降權某成員後，該成員可靠 refresh 續命舊角色達 refresh token TTL（可能 30 天）。現改為 refresh 時從 DB 重讀該成員當前 `role`／`roleId`（帶 `tenantId` 且要求 `isActive`、租戶亦須啟用），停用者不再核發新 token。
- **角色權限矩陣切換角色載入失敗造成跨角色權限污染（資料完整性）** — `RolePermissionMatrix` 逐角色載入權限的 `api.get('/roles/:id/permissions')` 只有 `.then` 沒有 `.catch`，網路瞬斷或 403 時失敗完全靜默，draft/baseline 仍留著「上一個角色」的權限，使用者以為在編輯新角色、按下儲存會把新角色權限覆寫成錯的集合。現補上 `.catch`：載入失敗時清空 draft/baseline、設 `permLoadError` 旗標停用儲存與編輯、顯示明確錯誤與「重試」按鈕，並以 `finally` 收尾載入狀態。

## [v0.4.0] - 2026-08-18

### Added

- **Instagram / Threads 渠道支援** — 整合 Meta Graph API 與 Webhook，支援 Instagram Direct Message 訊息收發與渠道管理：
  - 支援 IG 訊息接收、真人私訊收發與 Bot 自動化回應
  - 渠道設定新增 **憑證設定指南（`ChannelFieldGuide`）**，提供 Meta for Developers / LINE Developers 圖文設定指引
  - 支援單一憑證局部安全更新與 Bearer Header 驗證，避免未填欄位覆蓋舊金鑰
- **多租戶登入與安全防護** — 完善多租戶架構之登入與帳號驗證：
  - `Agent.email` 新增全局唯一約束（Global Unique Constraint）資料庫遷移
  - 登入防枚舉機制：租戶啟用檢查移至密碼驗證後，防止惡意探測租戶狀態
- **系統操作手冊** — 建立完整 11 章 HTML 格式之系統操作手冊（位於 `apps/web/public/manual/`）：
  - 包含系統概觀、案件、聯絡人、自動化、知識庫、行銷、LINE、短連結、分析、設定等完整說明與實機截圖
  - 系統頂部導航列（Topbar）新增「操作說明」直接跳轉手冊
  - 新增 Playwright 自動化截圖測試以利維護最新手冊配圖
- **LINE Flex Message 素材匯入與編輯器** — 行銷素材支援 LINE Flex 訊息樣板：
  - 提供 `LineFlexTemplateEditor` 支援 JSON 匯入、即時渲染預覽與參數編輯
  - 自動化關鍵字回覆支援配置 LINE Flex 素材回覆
- **WebTalk 即時協作** — 新增 WebTalk 協作模組與全域組件（`WebTalkGlobal`），支援團隊即時跨組件協同
- **下游 Webhook 轉發（Downstream Webhook）** — 支援將 CRM 接收到的 LINE Webhook 即時轉發給自訂下游第三方系統
- **聯絡人渠道來源標記** — 聯絡人清單標註渠道來源 Provider（LINE、WebChat 等），並隱藏不必要的 WebChat 渠道資訊
- **MCP Streamable HTTP endpoint** — 新增受認證的 `/mcp` endpoint，提供 CRM 唯讀工具給外部 LLM / MCP client：
  - 支援 `initialize`、`tools/list`、`tools/call` 與 JSON response transport
  - 提供目前客服、聯絡人、案件、分析等 tenant-scoped 唯讀工具
  - CLI Token 可選擇授予 `mcp:read` scope，並加入明確 allowed origins、BigInt-safe response serialization 與反向代理路由
- **LLM Skill 快捷按鈕** — Topbar 右上角新增「Skill」按鈕，快速開啟 LLM Skill 文件

### Changed

- **UAT MCP reverse proxy** — Caddy now forwards `/mcp` requests to the API container, matching the Nginx deployment route.
- **MCP/CI hardening** — MCP route now claims Fastify response ownership before transport setup, and GitHub Actions uses Node.js 24-compatible action majors.
- **前端 UI 全面改版（對齊 Figma 設計系統）** — 86 個前端元件與頁面全面重構：
  - 統一 Tailwind 設計 Token、按鈕、分頁、卡片、狀態標籤、對話框與側邊欄樣式
  - 新增 `/design-preview` 設計系統預覽頁面
- **CLI Session 權限** — CLI Token 新增 `CLI_ANALYTICS_READ_SCOPE` 權限範圍
- **Watch 模式** — 開發環境支援檔案變更自動重載

### Fixed

- **MCP 權限與開發環境 Origin** — `/mcp` 僅接受具 `mcp:read` scope 的 CLI token；開發環境未設定 allowed origins 時保留本機同源/localhost MCP 存取。
- **Webhook identity 併發競態** — stitched contact 建立 `channelIdentity` 遇到 P2002 時改用並發請求已建立的 identity，並以 `isArchived` 保留孤兒 contact 的 soft-delete 語意。
- **Passkey 管理端點防護** — passkey rename 與 revoke endpoint 補上 rate limit。
- **Webhook verify token 隨機性** — Channel 編輯表單改用 `crypto.randomUUID()` 產生 Meta webhook verify token。
- **MCP Prisma 型別來源** — MCP server 改由 `@open333crm/database` 提供 PrismaClient 型別。

- **MCP 串流錯誤處理** — response stream 中途失敗且已送出 headers 時主動關閉連線，讓 MCP client 能辨識截斷回應並重試，避免誤判為成功。
- **Webhook Echo 迴圈防護** — 過濾 Meta Webhook 發送者為自身的 Echo 訊息，防止 Bot 自問自答死迴圈
- **訊息去重與併發防護** — 新增 `(conversationId, channelMsgId)` 資料庫唯一約束與 `P2002` 衝突捕捉，徹底防止平台重複重送或併發造成的重複回覆
- **首則真人訊息 Race Condition** — 修復多則訊息幾乎同時進線時 `channelIdentity` 建立的 P2002 衝突，改取已建立者並回收孤兒聯絡人
- **圖片訊息誤觸發 KB 知識庫問題** — 補傳 `contentType` 於訊息事件，Worker 僅對純文字訊息執行知識庫語意檢索
- **收件匣圖片顯示相容性** — 前端訊息氣泡補齊 `mediaUrl` 與 `url` 欄位解析，修復 Instagram 圖片無法正常顯示之問題
- **關鍵字自動回覆重複觸發** — 修復 `keyword.matched` 事件於背景 Worker 佇列處理時因缺乏 `ruleId` context 導致多條規則重複發送的問題
- **廣播錯誤捕捉** — 強化行銷活動廣播發送過程中的例外捕捉與狀態紀錄
- **Caddy Port 自動修正** — rsync 部署後自動將 Caddy port 改回 8888，避免與 nginx 衝突
- **Nginx SSL 設定保留** — 部署 rsync 排除 `Caddyfile.local`，保留伺服器上已有的 nginx SSL 設定

## [v0.3.2] - 2026-07-09

### Added

- **CLI 連線管理** — 設定頁新增「CLI 連線」分頁，支援：
  - 產生 CLI token 給 LLM 或 `open333` CLI 使用
  - 指定 token 名稱與過期時間（7/30/90/365 天或永不過期）
  - 列表顯示所有 token、最後使用時間、權限範圍
  - 一鍵撤銷 token，立即失效
- **LLM Skill 文件** — `public/skill.md` 供 LLM 自動探索可用 API
- **Skill 快捷按鈕** — Topbar 右上角「Skill」按鈕，快速開啟 Skill 文件
- **GitHub Actions CI/CD** — push to main 自動部署至 UAT 伺服器（self-hosted ARM64 runner）

### Changed

- README 新增「LLM / CLI 連線」使用說明

## [v0.3.1] - 2026-07-09

### Added

- **CLI 技能文件** — 新增 `@open333crm/cli` 完整技能文件 (`docs/cli/`) 供 LLM 代理使用：
  - `SKILL.md`：架構、現有 4 指令、類型、擴充模式
  - `references/quick-ref.md`：每日速查卡
  - `references/capability-gap.md`：20+ 系統功能對應 CLI 指令缺口分析
  - `references/capability-map.md`：優先級實作路線圖與 Checklist
  - `scripts/scaffold-command.ts`：新指令自動生成腳本
  - `assets/`：Command / API 端點模板
- **README 新增 CLI 區段** — 文件連結、使用範例、擴充指南

### Changed

- CLI 專案文件完整化，方便 LLM 代理直接上手擴充指令

## [v0.3.0] - 2026-07-08

### Added

- **短連結追蹤設定** — 後台設定頁新增「追蹤設定」分頁，支援租戶層級設定 GA4 Measurement ID 與 Meta Pixel ID。設定後短連結 redirect 微頁面自動注入對應追蹤腳本，BOT 爬蟲不注入。

### Changed

- **LINE/FB 素材分流** — 素材建立改為先選渠道再選內容類型，LINE 與 FB 各自獨立的 contentType。
- **自動化規則事件感知** — 條件與動作選項會依選定事件動態過濾，切換事件時自動移除不相容選項。
- **人員管理完善** — 支援 Admin/Supervisor 新增人員、角色變更、密碼重置、停用帳號。
- **Figma 設計系統對齊** — Dashboard、Inbox、案件建立等元件視覺收尾，新增 E2E Playwright 測試（13 spec）。

### Fixed

- **案件刪除與 SLA 政策選擇** — 案件列表新增 row-level 刪除，SLA policy dropdown 改為 controlled state。
- **IME 安全的 Enter 處理** — 中文/日文輸入法組字時按 Enter 不會誤送訊息。
- **Inbox 即時更新** — 改用 SWR + 分頁載入，handoff/status/assignment 變更即時反映。
- **通知去重** — BullMQ worker 不再重複發送通知。
- **Caddy WebSocket** — 補齊 `/socket.io/*` 路由，修復 Socket.IO 連線逾時。

## [v0.2.0] - 2026-03-25

### Added

- **AI Copilot** — AI 從全自動回覆改為「副駕駛」模式，提供建議由人工採用。支援 AI 生成行銷素材。
- **通知小鈴鐺** — 即時通知中心，WebSocket 推送案件指派、SLA 預警、CSAT 差評等事件。
- **點數耗盡自動化** — AI 點數不足時自動禁用 AI 功能並顯示警告。
- **團隊渠道授權** — 渠道綁定新增「部門授權」步驟，實現資料權限隔離。
- **AI 採用率分析** — 新增 AI 採用率與客服修正率報表。

### Changed

- **Bot 路由邏輯** — 辦公時間內 AI 從「自動回覆」改為「僅建議」。
- **DB Schema** — 新增 Notification 模型、AI 建議生命週期欄位。

## [v0.1.0] - 2026-03-18

### Added

- **Monorepo 架構** — pnpm workspaces + Turborepo，TypeScript 全端。
- **多渠道整合** — LINE / Facebook Messenger / WebChat 統一收件箱。
- **案件管理** — 完整 Ticket 生命週期， BullMQ SLA 監控。
- **自動化引擎** — json-rules-engine 規則引擎，支援 12 種動作類型。
- **知識庫** — LanceDB + BM25 混合搜尋，語意 + 關鍵字雙檢索。
- **長期記憶** — 聯絡人等級的對話摘要與相似度觸發檢索。
- **行銷系統** — 活動管理、廣播排程、模板變數替換。
- **Docker 基礎設施** — PostgreSQL + Redis + MinIO + Ollama + Caddy。
