# 平台帳號管理 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e（本機 worktree 比 origin/main 落後 14 個 commit，都是粉絲門戶相關；`git log HEAD..origin/main` 對 `apps/api/src/modules/platform`、`apps/web/src/app/admin`、`auth.plugin.ts` 沒有任何差異）
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build，`EMAIL_DELIVERY_MODE=log`）／ UAT（只讀，未登入平台後台）
- 範圍：`docs/ref/features/feature-map.json` 的 `platform-users`；功能文件 `docs/ref/features/platform/PLATFORM-USERS.md`。平台登入、忘記密碼、改密碼頁本身歸 `platform-auth`（`docs/ref/features/health/PLATFORM-AUTH.md`），本報告只補強制改密碼與本領域相關的部分

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 1 份 spec（`platform-user-management`）、7 個 requirement、14 個 scenario。缺實作 1 個（開通信沒有 email，規格要求要有）。缺測試：只有「須改密碼」2 個 scenario 有行為測試；開通、編輯、停用啟用、重寄 4 個 scenario 只有「有寫稽核」的路由測試（服務被 mock）；其餘 8 個 scenario 沒有任何測試，`platform-user.service.ts` 本身沒有單元或 feature 測試。缺前端入口 0 個 |
| 自動測試 | unit：`platform-audit-routes`、`platform-auth-guard`、`platform-auth-disabled` 3 檔 18 通過，無失敗、無 skip、無 `test.fail`。feature：本領域沒有 feature 測試，未執行 |
| 實際操作 | 8 條流程。正常 3，異常 5（開通的姓名驗證、詳細頁錯誤 id、停用的併發衝突、重寄開通信、操作紀錄顯示），待真機驗 1（正式寄信模式下的開通信送達與失敗） |

## 問題清單（依嚴重度）

P0：無。P1：無。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-PLATFORM-USERS-01 | P2 | 「重寄開通信」對**任何**啟用中帳號都會立刻換掉對方現在的密碼並設回 `mustChangePassword`，包括早已改好密碼、天天在用的同事，也包括自己。按鈕常駐在詳細頁、沒有確認框，文案只寫「重寄開通信」。對自己按下去，下一個請求就被導到強制改密碼頁，而臨時密碼只在信裡，自己手上沒有 | **實測（本機 API）**：自建帳號 B 已改密碼（`mustChangePassword=false`）並登入 → A 對 B 呼叫 `resend-welcome` 回 200 → B 手上 token 打 `/platform-users` 403 `MUST_CHANGE_PASSWORD`、B 用原密碼登入 401。**實測（本機瀏覽器）**：按「重寄開通信」沒有任何確認框（dialog 計數 0）；A 在自己的詳細頁按下後，畫面跳到 `/admin/change-password?forced=1`，要求輸入「臨時密碼（開通信中提供）」 | `apps/api/src/modules/platform/platform-user.service.ts:129-145`；`apps/web/src/app/admin/platform-users/[id]/page.tsx:108-122, 183-185` | AUTH-13 |
| HC-PLATFORM-USERS-02 | P2 | 開通信與重寄開通信寄送失敗時，API 仍回成功，畫面顯示「系統已產生臨時密碼並寄信至…」「開通信已重寄至…」。`safeSend` 把 `sendEmail` 的例外吞掉只寫 log；開通時更是 `void` 不等待。重寄時對方的舊密碼已被覆寫，信又沒寄到，帳號形同鎖死，操作者不知道 | 讀程式（本機 log 模式不會失敗；正式環境 `resend` 模式在缺 `RESEND_API_KEY`、`EMAIL_FROM` 或 Resend 回錯時會 throw） | `apps/api/src/modules/platform/platform-user-emails.ts:96-102`；`platform-user.service.ts:58, 140-143`；`apps/api/src/modules/email/email.service.ts:66-105` | AUTH-14 |
| HC-PLATFORM-USERS-03 | P2 | 兩位管理者同時停用**兩個不同**的帳號，其中一邊回 400 `DATABASE_ERROR`「資料處理失敗，請確認輸入內容後重試」，即使啟用帳號還有很多個。原因是 Serializable 交易對整張表做 `count`，兩筆交易互相讀到對方要改的列，PostgreSQL 判定序列化失敗，程式沒有重試也沒有轉成可讀的錯誤。功能文件說衝突只發生在「同時停用最後兩個帳號」，實際範圍更大 | **實測（本機 API）**：啟用帳號 9 個時，A 停用 C、seed 帳號同時停用 D，連跑 4 輪，4 輪都是一邊 200、另一邊 400 `DATABASE_ERROR` | `platform-user.service.ts:107-125` | AUTH-15 |
| AUTH-04 | 依 AUDIT | 改其他帳號的 email 成功、不通知原信箱 | **實測（本機）**：A 把 B 的 email 改成 `…b2@…`，API log 沒有任何寄往舊信箱的信 | `platform-user.service.ts:64-86` | AUTH-04（仍存在） |
| SEC-02 | 依 AUDIT | 操作紀錄看不到登入與重設密碼 | **實測（本機）**：A 的操作紀錄 23 筆，action 只有 provision、update、enable、disable、resend_welcome、change_password | `platform.routes.ts:115-152` | SEC-02（仍存在） |
| HC-PLATFORM-USERS-04 | P3 | 強制改密碼頁（`?forced=1`）隱藏側欄，連「登出」也一起藏起來，頁面上也沒有「忘記密碼」連結。沒有臨時密碼的人（信沒收到、被重寄給自己、HC-PLATFORM-USERS-01／02）只能等 token 過期（預設 2 小時）或自己清 localStorage 才回得到登入頁走忘記密碼 | **實測（本機瀏覽器）**：`mustChangePassword` 帳號登入後頁面只有表單，側欄與頁面連結數 0 | `apps/web/src/app/admin/layout.tsx:48-55`；`apps/web/src/app/admin/change-password/page.tsx:82-94` | 新 |
| HC-PLATFORM-USERS-05 | P3 | 帳號詳細頁的 id 不存在（404）或不是 uuid（API 回 400 `DATABASE_ERROR`），頁面永遠停在「載入中…」，沒有錯誤訊息、沒有返回連結。`load()` 沒有 `catch`。非 uuid 的 id 也該在路由先驗格式回 404，而不是落到 Prisma 錯誤 | **實測（本機瀏覽器、API）**：開 `/admin/platform-users/abc` 與全 0 的 uuid，3 秒後仍是「載入中…」；API `GET /platform-users/abc`、`/abc/audit-logs` 都 400 `DATABASE_ERROR` | `apps/web/src/app/admin/platform-users/[id]/page.tsx:54-67, 124-126`；`platform.routes.ts:182-184, 235-237` | 新 |
| HC-PLATFORM-USERS-06 | P3 | 詳細頁「操作紀錄」只顯示動作、對象（`platform_user / 785c3c34…`）與時間，不顯示**誰**做的，也不顯示 payload。看 C 的頁面時，「停用帳號」「編輯資料」是誰按的、email 改成什麼，畫面上都看不出來；API 其實有回 `platformUserId` 與 `payload`。AUTH-04 說事後唯一線索是 `platform_user.update` 的 payload，介面卻看不到 | **實測（本機瀏覽器）**：C 的操作紀錄 6 列全是「動作／platform_user / 785c3c34…／時間」 | `apps/web/src/app/admin/platform-users/[id]/page.tsx:200-228` | 新 |
| HC-PLATFORM-USERS-07 | P3 | 姓名驗證不一致：開通的 `name` 只有 `min(1)`，全空白、300 字都會建立；編輯限 100 字但也不 trim，全空白可以存。開通表單的 `required` 擋不住空白，列表上出現看不見名字的帳號（連結文字是空白，點不到） | **實測（本機 API、瀏覽器）**：`POST {name:"   "}`、`{name:"x"*300}` 都 200；`PATCH {name:"   "}` 200；瀏覽器開通表單填三個空白也成功，banner 顯示「已開通「 」」 | `apps/api/src/modules/platform/platform.routes.ts:89-98`；`apps/web/src/app/admin/platform-users/page.tsx:126-134` | 新 |
| HC-PLATFORM-USERS-08 | P3 | 稽核記到沒有發生的變更：停用已停用的帳號回 200 並再寫一筆 `platform_user.disable`；詳細頁儲存固定送姓名與 email 兩欄，只改姓名時 payload 也帶著沒變的 email，看紀錄分不出實際改了哪個欄位 | **實測（本機 API）**：對已停用的 B 再 `PATCH active {isActive:false}` 200，多一筆 disable；送與現值相同的 name、email 200，多一筆 update，payload 兩欄都有 | `platform-user.service.ts:112-122`；`platform.routes.ts:197-207`；`[id]/page.tsx:81` | 新 |
| HC-PLATFORM-USERS-09 | P3 | 「停用帳號」沒有確認框；自己的詳細頁也顯示停用鈕，按下才回「無法停用自己的帳號」 | **實測（本機瀏覽器）**：停用 C 時 dialog 計數 0；自己的頁面停用鈕存在，按下顯示錯誤 banner | `[id]/page.tsx:186-193` | 新 |
| HC-PLATFORM-USERS-10 | P3 | 開通信沒有帳號 email。主規格「開通新平台帳號」要求開通信含登入網址、**email**、明文臨時密碼；模板只有姓名、臨時密碼與登入網址，收信人要自己猜登入帳號是哪個信箱（轉寄或共用信箱時會猜錯） | 讀程式 | `apps/api/src/modules/platform/platform-user-emails.ts:61-69, 105-111` | 新（違反規格） |
| HC-PLATFORM-USERS-11 | P3（文件） | 功能文件與歸檔 change 的敘述與實測不符，見「文件過時之處」 | 讀程式＋實測 | `docs/ref/features/platform/PLATFORM-USERS.md` | 新（文件） |

### 已知 AUDIT 項目的現況

| 項目 | 結論 |
| --- | --- |
| AUTH-03 | 本領域相關的兩種情況實測：停用帳號後舊 token 立即 401 `PLATFORM_USER_DISABLED`；重寄開通信後舊 token 只能呼叫改密碼（403 `MUST_CHANGE_PASSWORD`）。自助改密碼後舊 token 仍可用，PLATFORM-AUTH 已實測 |
| AUTH-04 | 仍存在：沒有角色分級，任何平台帳號都能開通、停用、改 email、重寄開通信給其他帳號；改 email 不通知（實測） |
| SEC-02 | 仍存在（實測） |
| PLAN-11 | 相關：平台稽核唯一的查詢端點就是本領域的 `GET /platform-users/:id/audit-logs`，最多 200 筆、不能依租戶或 action 篩選（讀程式，與 AUDIT 描述一致） |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 帳號列表 | 本機（API、瀏覽器）、UAT | 正常：列出全部帳號，「待改密碼」badge 正確；回應不含 `passwordHash`、`resetTokenHash` | — | 未帶 token 401（UAT 同樣 401）；`mustChangePassword` 中 403 | 無分頁、無搜尋 |
| 2 開通帳號 | 本機（API、瀏覽器） | 正常：`  …A@Example.TEST ` 存成小寫、`isActive=true`、`mustChangePassword=true`；稽核 payload 只有 email、name；重新整理後列表有；log 有一封「平台帳號已開通」（metadata 只有 `loginUrl`） | 重複 email（含大小寫差異）409 且不寫稽核；格式錯、姓名空字串 400；**全空白、300 字姓名被接受**（HC-07）；同 email 併發 3 筆：1 筆 200、2 筆 409，只建 1 筆 | 同上 | 臨時密碼不在 log，本機以 DB 設定自建帳號的雜湊走後續流程 |
| 3 詳細頁 | 本機（API、瀏覽器） | 正常 | 錯誤 id 卡在「載入中…」（HC-05） | 同上 | |
| 4 改姓名／email | 本機（API、瀏覽器） | 正常：改名、改 email（大寫加空白存成小寫）後重新整理讀回一致 | 改成別人的 email（大寫）409，畫面顯示「這個電子郵件已被使用，請換一個」；空 body、空姓名、101 字 400；全空白姓名 200（HC-07） | 同上 | 不通知原信箱（AUTH-04） |
| 5 停用／啟用 | 本機（API、瀏覽器） | 正常：停用後對方舊 token 401 `PLATFORM_USER_DISABLED`、登入 401；啟用後可登入；畫面 banner 正確 | 停用自己 400 `CANNOT_DISABLE_SELF`；`isActive:"false"` 400；**併發停用兩個不同帳號一邊 400**（HC-03）；重複停用 200 並多寫稽核（HC-08） | 同上 | 無確認框（HC-09）。「最後一個啟用帳號」防呆在依序操作下碰不到（呼叫者自己一定是啟用的，會先撞到「不能停用自己」），未能在不動 seed 帳號的情況下觸發 |
| 6 重寄開通信 | 本機（API、瀏覽器） | 正常：產生新臨時密碼、舊密碼 401、`mustChangePassword` 設回真、寫稽核 | 停用中帳號 400 `PLATFORM_USER_DISABLED` | 同上 | **對使用中帳號與自己都會換密碼**（HC-01）；寄信失敗仍回成功（HC-02，讀程式） |
| 7 首次登入強制改密碼 | 本機（API、瀏覽器） | 正常：登入回 `mustChangePassword=true` → 導到 `?forced=1`、無側欄；直接開 `/admin/platform-users` 被導回；改完到 `/admin/plans`，其他 API 恢復 | 改密碼前打列表 403 `MUST_CHANGE_PASSWORD`；舊密碼錯 401 被登出（HC-PLATFORM-AUTH-01） | — | 強制頁沒有登出與忘記密碼入口（HC-04） |
| 8 操作紀錄 | 本機（API、瀏覽器） | 正常：包含自己做的與別人對自己做的，新到舊，中文動作名稱正確 | 非 uuid 400 `DATABASE_ERROR` | 同上 | 不顯示操作者與 payload（HC-06） |

測試用的身分：本機自建平台帳號 10 個（`hc-platform-users-a`、`-b`（後改 `-b2`）、`-c`、`-d`、`-space`、`-long`、`-race`、`-ui`、`-ui2`、`-ui-space2`，`@example.test`），結束時全部在 DB 設為停用，全空白與 300 字姓名的兩個帳號改名為 `hc-platform-users-原為空白`、`hc-platform-users-原為300字` 以免在列表上看不見。seed 的 `platform@open333crm.dev` 只用來登入與當作併發測試的第二位操作者，沒有改密碼、狀態或資料（`lastLoginAt` 會因登入更新）。

## 完備度對照

`openspec/specs/platform-user-management/spec.md`：

| Scenario | 實作 | 測試 | 前端入口 |
| --- | --- | --- | --- |
| 成功開通新平台帳號 | 有，但開通信缺 email（HC-10）：`platform-user.service.ts:42-61`、`platform.routes.ts:185-196` | 只有寫稽核（`platform-audit-routes.test.ts`，服務被 mock） | 列表頁表單 |
| Email 重複時拒絕開通 | 有：`platform-user.service.ts:46-48` | 無 | 有（錯誤 banner） |
| 標記須改密碼的帳號嘗試存取其他平台功能 | 有：`platform.routes.ts:155-162` | 有：`platform-auth-guard.test.ts:174` | 有（導向強制頁） |
| 標記須改密碼的帳號可呼叫改密碼 API | 有 | 有：`platform-auth-guard.test.ts:180` | 有 |
| 取得平台帳號列表 | 有：`PUBLIC_SELECT` | 無 | 有 |
| 取得單一平台帳號詳細資料（含 404） | 有 | 無 | 有（404 時畫面卡住，HC-05） |
| 成功編輯帳號資料 | 有 | 只有寫稽核 | 有 |
| 編輯為重複 email 時拒絕 | 有：`platform-user.service.ts:72-76` | 無 | 有 |
| 成功停用其他帳號 | 有 | 只有寫稽核；「停用後登入被拒」由 `platform-auth-guard.test.ts:162` 從 guard 側涵蓋 | 有 |
| 拒絕停用最後一個啟用中帳號 | 有（Serializable 交易） | 無 | 依序操作碰不到 |
| 拒絕停用自己 | 有 | 無 | 有（按鈕不隱藏） |
| 成功重新啟用帳號 | 有 | 只有寫稽核 | 有 |
| 成功重寄開通信 | 有 | 只有寫稽核 | 有（HC-01） |
| 查詢帳號稽核記錄 | 有 | 無 | 有（HC-06） |

**有後端、沒有前端入口**：audit-logs 回傳的 `platformUserId` 與 `payload`。沒有刪除平台帳號、角色或權限設定的 API，規格也沒有要求。

**前端送出的值與後端 Zod**：開通 `{email,name}`、編輯 `{name,email}`（trim 後）、停用 `{isActive:boolean}`，全部被接受；email 的 `type=email` 與後端 `z.string().email()` 一致。沒有發現前端送出、後端拒絕的合法值；反方向是後端接受了不該接受的姓名（HC-07）。

## 待真機驗

- 正式寄信模式（UAT `resend`）下開通信與重寄開通信是否送達、信件內容（臨時密碼、登入網址）、寄信失敗時畫面是否仍顯示成功（HC-02）。本機 log 模式只印 metadata，UAT 平台後台不能做寫入。

## UAT 操作紀錄

只讀，沒有建立任何資料，沒有登入平台後台。取得 UAT 鎖後：未帶 token 打 `GET /api/v1/platform/platform-users` 回 401 `UNAUTHORIZED`（平台後台已啟用、guard 有作用）；開 `/admin/platform-users` 回 200（前端會導回登入頁）。本機與 origin/main 在本領域的程式沒有差異，UAT 行為應與本機相同。

## 建議新增到 AUDIT.md 的項目

- HC-PLATFORM-USERS-01：「重寄開通信」會換掉任何啟用帳號（含自己）的密碼，沒有確認。修正方向：只在 `mustChangePassword=true`（尚未完成首次登入）時顯示與允許，或改名「重設為臨時密碼」並加確認框；禁止對自己重寄。
- HC-PLATFORM-USERS-02：開通信寄送失敗不回報。修正方向：重寄改成寄信失敗就回錯並還原密碼（或寄信成功才寫入新雜湊）；開通至少在回應帶 `emailSent:false`，畫面提示。
- HC-PLATFORM-USERS-03：停用帳號的 Serializable 交易對不相關的併發停用也會失敗。修正方向：捕捉序列化失敗重試，或改用 `SELECT … FOR UPDATE` 鎖住啟用中的列；至少把 P2034 轉成「其他人正在變更帳號，請再試一次」。
- HC-PLATFORM-USERS-10：開通信缺 email，違反主規格。
- HC-PLATFORM-USERS-06：平台帳號頁的操作紀錄不顯示操作者與 payload（可併入 PLAN-11 一節：平台稽核的查詢與呈現）。

## 文件過時之處

- `docs/ref/features/platform/PLATFORM-USERS.md`「停用帳號的兩道防呆」：寫「兩位管理者同時停用最後兩個帳號時……另一邊拿到序列化衝突」。實測任何兩筆同時停用都可能有一邊 400 `DATABASE_ERROR`，與剩下幾個帳號無關（HC-PLATFORM-USERS-03）。
- 同一份文件「重寄開通信會換掉密碼」只談「對方已拿到前一封信但還沒登入」的情況，沒寫對已在使用的帳號、對自己按下去的後果（HC-PLATFORM-USERS-01），也沒寫重寄時寄信失敗一樣回成功（HC-PLATFORM-USERS-02；文件只寫了開通時）。
- 同一份文件沒有提到開通信不含帳號 email、姓名不 trim。
- 歸檔 change `openspec/changes/archive/2026-09-15-platform-user-management/tasks.md` 8.4 說「最後一個帳號的 count 防呆在目前流程下實際上不可達」，依序操作確實如此，但併發時交易本身會讓不相關的停用失敗；8.5 說「重設密碼」出現在 `PlatformAuditLog`，與 SEC-02 的實測不符（歸檔文件不改，僅供讀者注意）。
- 本機 `EMAIL_DELIVERY_MODE=log` 只印信件 metadata，開通信的臨時密碼拿不到；本機測首次登入要用 DB 設定自建帳號的密碼雜湊（PLATFORM-AUTH 已註明）。
