# 實作落差與驗證紀錄

本文件集中記錄系統盤點時發現的實作落差，只描述各項的現況。其他系統文件只描述主要結構，不重複問題細節；每一項怎麼查證、在哪一次盤點發現，記在[實作落差複查紀錄](./AUDIT-REVIEWS.md)。

摘要表依章節排列，順序與內文相同。點 ID 可跳到該項的內文。

- **驗證環境**：`docker compose -f docker-compose.dev.yml`
- **執行時驗證日期**：2026-09-02
- **最近複查日期**：2026-10-30（功能健檢，25 個領域，報告在 [`docs/ref/features/health/`](../features/health/README.md)）
- **限制**：開發環境沒有 Ollama，因此部分模型問題只能用設定與資料庫狀態驗證。
- **部署決定**：組織因主機資源不足，決定不部署 Ollama（2026-10-01）。LLM 各項依這個決定判斷。

## 優先順序怎麼讀

「優先」欄是**修復順序**，不是嚴重度。**數字越小越優先**，P1 排最前面。

| 優先 | 對應 label | 判定標準 |
| --- | --- | --- |
| P1 | `critical` | 目前就在產生錯誤結果、資料跨租戶或安全暴露，不需要特定操作觸發，也沒有補償措施 |
| P2 | `high` | 會產生錯誤行為，但要滿足特定條件才觸發，或已有可繞過的做法 |
| P3 | `medium` | 設定與實際行為不符、介面與資料不一致、維運與稽核的落差。不影響現有功能的正確性 |
| P4 | `low` | 殘留設定、命名不符、未接線的程式碼。移除或改名即可，不影響任何行為 |

**違反主規格的項目至少是 P2。** 主規格是 `openspec/specs/` 底下的規格。一項的現況違反主規格中的 SHALL 或 MUST 時，即使依上表判定為 P3 或 P4，也標為 P2，並在內文的「規格依據」寫明違反哪一份規格的哪一條需求。只有歸檔 change 的設計文件或未完成的任務、沒有寫進主規格的，不適用這條規則。2026-10-02 已把當時所有 P3、P4 項目逐一對照主規格。

主規格描述的功能從來沒有實作，或已經被其他設計取代時，不在本文件標示例外。這種主規格依 `AGENTS.md` Step 4 的規則移除，或移回 change。issue #217 的盤點之前，這類項目曾標示「主規格待確認」，暫時不套用這條規則；`AUDIT-REVIEWS.md` 的舊紀錄仍會出現這個標示。

排序只反映「先修哪一個」，與修復成本無關。兩項同為 P1 時，先做哪一項由當時的人力與相依關係決定。

最近一次標示日期為 2026-10-02。2026-10-30 功能健檢新增的項目，依[健檢總表](../features/health/README.md)的嚴重度標示：健檢的 P1、P2 對應本文件的 P1、P2，健檢的 P3 沒有寫入本文件。內文的「健檢來源」寫明健檢編號、報告與證據；行號依健檢時的程式版本 `5c81102e`。項目的內容改變時要一併重看它的優先順序。

## 處理狀態怎麼讀

「處理狀態」記的是這一項修到哪裡，「驗證狀態」記的是這一項怎麼被確認，兩者互不影響。

| 處理狀態 | 意思 |
| --- | --- |
| 未處理 | 沒有修正方向，也沒有任何修正 |
| 已提建議 | 內文附有修正方向，還沒決定是否照做 |
| 已定方向 | 修正方向已經討論定案，尚未實作 |
| 部分修正 | 已有 commit 修掉其中一部分。問題描述寫明哪部分已修、哪部分未修，並附修正的 commit |

一項完全修正之後，從本文件移除，修正它的 commit 記在[實作落差複查紀錄](./AUDIT-REVIEWS.md)。

## 摘要

| ID | 範圍 | 優先 | 處理狀態 | 問題 | 驗證狀態 |
| --- | --- | --- | --- | --- | --- |
| [RLS-01](#rls-01) | 租戶隔離與權限 | P2 | 未處理 | Canvas 引擎不走租戶連線；`DATABASE_URL` 為 `app_tenant` 時 Canvas 靜默失效，目前沒有租戶使用 Canvas | 靜態確認 |
| [RLS-03](#rls-03) | 租戶隔離與權限 | P3 | 未處理 | 隔離檢查腳本掃不到 `packages/*` | 靜態確認 |
| [RLS-04](#rls-04) | 租戶隔離與權限 | P3 | 未處理 | `.env.api.example` 沒有 `DATABASE_URL_TENANT` | 靜態確認 |
| [RLS-08](#rls-08) | 租戶隔離與權限 | P2 | 已定方向 | service 收到的 client 決定了它的 RLS 與交易保證；背景工作多半傳 `prismaAdmin`，沒有 RLS | 靜態確認 |
| [RLS-09](#rls-09) | 租戶隔離與權限 | P3 | 已定方向 | Socket 房間只有 `tenant:` 帶租戶 ID，推播端無法檢查 `conversation:`、`agent:` 等房間屬於哪個租戶 | 靜態確認 |
| [RLS-10](#rls-10) | 租戶隔離與權限 | P1 | 未處理 | 租戶連線 `app_tenant` 對平台層資料表有完整讀寫權限：讀得到平台帳號的密碼雜湊，改得了其他租戶的平台設定與價目表 | 執行時確認 |
| [RBAC-01](#rbac-01) | 租戶隔離與權限 | P3 | 部分修正 | 知識庫的讀取路由不檢查 `knowledge.view`；`agent.delete`、`billing.view` 沒有強制點 | 執行時確認 |
| [RBAC-02](#rbac-02) | 租戶隔離與權限 | P2 | 未處理 | CLI token 只看 scope，繞過角色權限與方案天花板；任何成員都能以 CLI 讀全租戶報表 | 靜態確認 |
| [RBAC-03](#rbac-03) | 租戶隔離與權限 | P2 | 未處理 | 工單自動指派、通知收件人（含權杖失效通知）與「最後一位管理員」的保護看舊的角色列舉，不看細粒度角色；持 `agent.manage` 的非管理員可以建立列舉為 `ADMIN` 的成員 | 執行時確認 |
| [RBAC-04](#rbac-04) | 租戶隔離與權限 | P2 | 部分修正 | 渠道可見範圍在 socket 租戶房間、聯絡人清單與合併、`GET /cases/stats` 沒有套用；報表與匯出、工單與對話詳情的渠道身分、資料匯出與刪除、新訊息通知也沒有套用（2026-10-30 健檢）；聯絡人的對話、工單、時間軸（`481452a`）、AI 輔助端點、`POST /cases`（#281）與 `POST /cases/from-conversation/:id` 已修正 | 執行時確認 |
| [RBAC-05](#rbac-05) | 租戶隔離與權限 | P2 | 已提建議 | reconcile 腳本會覆蓋租戶對系統角色的修改，收回的權限被重新授予 | 靜態確認 |
| [RBAC-07](#rbac-07) | 租戶隔離與權限 | P1 | 未處理 | 單筆渠道的讀取、修改、停用、換憑證、刪除都不檢查渠道可見範圍，分店成員知道渠道 ID 就能操作看不到的渠道 | 執行時確認 |
| [RBAC-08](#rbac-08) | 租戶隔離與權限 | P1 | 未處理 | 改成員角色不比較目標的權限，也沒有最後一位管理員保護：主管可以把唯一的管理員降級，之後無人能改回 | 執行時確認 |
| [RBAC-09](#rbac-09) | 租戶隔離與權限 | P2 | 未處理 | 重設他人密碼、停用、刪除成員都不比較目標的權限；持 `agent.password.reset` 的自訂角色可以接管管理員帳號 | 執行時確認 |
| [RBAC-10](#rbac-10) | 租戶隔離與權限 | P2 | 未處理 | 編輯成員可使用的渠道時一律寫 `full`，原本 `read_only`、`reply_only` 的成員被編輯一次就升成完整權限 | 執行時確認 |
| [RBAC-11](#rbac-11) | 租戶隔離與權限 | P2 | 未處理 | 後台多數頁面不依權限隱藏操作，按下才 403；沒有權限時頁面顯示成「沒有資料」 | 執行時確認 |
| [TEAM-01](#team-01) | 租戶隔離與權限 | P2 | 未處理 | 團隊沒有建立與管理成員的途徑，依團隊授權與指派都無法使用；進站訊息不依團隊分流 | 靜態確認 |
| [A2A-01](#a2a-01) | 租戶隔離與權限 | P2 | 未處理 | A2A 橋接以最早建立的租戶執行所有外部任務，使用該租戶的金鑰與額度 | 靜態確認 |
| [A2A-02](#a2a-02) | 租戶隔離與權限 | P2 | 未處理 | A2A 狀態頁只要設定了 `A2A_AGENT_ID` 就顯示已連線，橋接斷線也顯示 `connected` | 靜態確認 |
| [AUTH-01](#auth-01) | 帳號與登入 | P2 | 已定方向 | 租戶端沒有忘記密碼流程，唯一的 ADMIN 忘記密碼就沒有復原途徑 | 靜態確認 |
| [AUTH-02](#auth-02) | 帳號與登入 | P2 | 未處理 | 停用租戶不會中斷既有的 Socket 連線，CLI token 與 Partner API 金鑰也不受影響 | 靜態確認 |
| [AUTH-03](#auth-03) | 帳號與登入 | P2 | 未處理 | 平台帳號改密碼或重設密碼後，已發出的 token 仍然有效 | 靜態確認 |
| [AUTH-04](#auth-04) | 帳號與登入 | P2 | 未處理 | 平台帳號沒有權限分級也沒有第二因子，改 email 不通知原主而可被接管 | 靜態確認 |
| [AUTH-06](#auth-06) | 帳號與登入 | P3 | 已提建議 | 兩個「JWT 或其他憑證」裝飾器的 JWT 分支不填 `roleId`，網頁登入的成員呼叫 `partner-ingest` 一律 403 | 靜態確認 |
| [AUTH-07](#auth-07) | 帳號與登入 | P4 | 未處理 | `JWT_EXPIRES_IN` 沒有讀取端，技術文件卻列為 token 有效期 | 靜態確認 |
| [AUTH-08](#auth-08) | 帳號與登入 | P2 | 未處理 | 租戶成員登出、改密碼或被重設密碼後，已發出的 refresh token 仍可換發，最長 30 天 | 靜態確認 |
| [AUTH-10](#auth-10) | 帳號與登入 | P3 | 未處理 | 成員的 email 區分大小寫：和建立時的大小寫不同就無法登入，也可以建立只差大小寫的兩個帳號 | 執行時確認 |
| [AUTH-11](#auth-11) | 帳號與登入 | P1 | 未處理 | 停用的租戶仍收得到 WebChat 訊息，預約的群發也照常送出 | 執行時確認 |
| [AUTH-12](#auth-12) | 帳號與登入 | P2 | 未處理 | 平台「修改密碼」打錯目前密碼會被整頁登出，看不到錯誤訊息 | 執行時確認 |
| [AUTH-13](#auth-13) | 帳號與登入 | P2 | 未處理 | 平台的「重寄開通信」會立刻換掉任何啟用中帳號的密碼，包括自己，沒有確認 | 執行時確認 |
| [AUTH-14](#auth-14) | 帳號與登入 | P2 | 未處理 | 平台帳號的開通信、重寄開通信與租戶的重寄開通信，寄送失敗時仍回成功 | 靜態確認 |
| [AUTH-15](#auth-15) | 帳號與登入 | P2 | 未處理 | 兩位平台管理者同時停用兩個不同的帳號，其中一邊回 400 `DATABASE_ERROR` | 執行時確認 |
| [AUTH-16](#auth-16) | 帳號與登入 | P2 | 未處理 | 平台停用租戶沒有確認步驟，按一下就讓客戶全員登不進去 | 執行時確認 |
| [SEC-02](#sec-02) | 帳號與登入 | P2 | 未處理 | 平台帳號的登入與密碼重設沒有寫入稽核紀錄 | 靜態確認 |
| [SEC-03](#sec-03) | 帳號與登入 | P3 | 未處理 | rate-limit 在各路由模組內各自註冊，搬移路由時設定會被靜默忽略 | 靜態確認 |
| [SEC-06](#sec-06) | 帳號與登入 | P2 | 已提建議 | 租戶的帳號鎖定只依 email 計數，知道 email 的人可以讓該成員一直無法以密碼登入 | 靜態確認 |
| [SEC-07](#sec-07) | 帳號與登入 | P2 | 未處理 | CLI token 與 API 金鑰的有效天數沒有上限，可以建立到期日在 2300 年的憑證；更大的值回 500 | 執行時確認 |
| [SEC-08](#sec-08) | 帳號與登入 | P2 | 未處理 | 圖文選單發布時伺服器直接請求背景圖網址，不擋內網，可用來探測內網服務 | 執行時確認 |
| [LIC-01](#lic-01) | 金鑰與 License | P4 | 未處理 | API 使用寫死的授權資料 | 間接確認 |
| [LIC-02](#lic-02) | 金鑰與 License | P4 | 未處理 | 可連線的 Core LicenseService 沒有使用者 | 靜態確認 |
| [TRIAL-02](#trial-02) | 試用 | P2 | 已定方向 | 試用政策存在無型別的 KV，錯誤的值會靜默失效或靜默生效；通用端點也能寫壞租戶的個資遮罩設定，讓該租戶所有訊息寫入失敗 | 執行時確認 |
| [TRIAL-03](#trial-03) | 試用 | P2 | 未處理 | 「資料保留天數」到期只做標記，租戶的業務資料永遠不會被刪除 | 靜態確認 |
| [TRIAL-04](#trial-04) | 試用 | P3 | 部分修正 | 租戶頁啟用已過期的試用租戶，只維持到下一輪排程，並重寄到期信；啟用不清除軟刪標記。延長試用已改為清除標記（`9f3c6c1a`） | 執行時確認 |
| [TRIAL-05](#trial-05) | 試用 | P1 | 未處理 | 同一 email 待驗證時再申請一次會覆寫密碼，申請人點信後站台以他人密碼開通；UAT 已開放試用申請 | 執行時確認 |
| [TRIAL-06](#trial-06) | 試用 | P2 | 未處理 | 再送一次試用申請會繞過重寄節流，換 IP 就能對任意信箱無限寄驗證信 | 執行時確認 |
| [TRIAL-07](#trial-07) | 試用 | P2 | 未處理 | 手動開通表單預設「免費試用」方案但不設試用到期日，這類租戶永遠停在試用方案，也不出現在試用管理頁 | 執行時確認 |
| [PLAN-01](#plan-01) | 方案與額度 | P3 | 未處理 | `Plan.isActive` 沒有讀取端，停售的方案仍可指派 | 靜態確認 |
| [PLAN-02](#plan-02) | 方案與額度 | P3 | 未處理 | 加購 token 是永久提高每月額度，不是一次性配額 | 靜態確認 |
| [PLAN-03](#plan-03) | 方案與額度 | P3 | 未處理 | 換方案不會回收既有的超額資源，也不會清除 `limitOverrides` | 靜態確認 |
| [PLAN-04](#plan-04) | 方案與額度 | P2 | 部分修正 | 功能天花板只在掛了 `requirePermission()` 的路由生效；行銷、知識庫、自動化的試跑仍有路由沒掛，`maxTags` 沒有強制點 | 靜態確認 |
| [PLAN-05](#plan-05) | 方案與額度 | P2 | 未處理 | 加購過的租戶升級方案，AI 月額度反而停在升級前的數字 | 靜態確認 |
| [PLAN-07](#plan-07) | 方案與額度 | P3 | 未處理 | 渠道的兩個分級欄位都沒有任何方案填過值，渠道維度完全不分級 | 靜態確認 |
| [PLAN-08](#plan-08) | 方案與額度 | P3 | 未處理 | 角色權限的顯示與儲存都不套方案天花板，介面顯示的授予狀態與實際生效的權限不一致 | 靜態確認 |
| [PLAN-09](#plan-09) | 方案與額度 | P3 | 未處理 | 改方案立即對該方案所有租戶生效，介面不顯示影響範圍，稽核不記舊值 | 靜態確認 |
| [PLAN-10](#plan-10) | 方案與額度 | P3 | 未處理 | 加購沒有金額紀錄，覆寫值也拆不開，事後無法對帳 | 靜態確認 |
| [PLAN-11](#plan-11) | 方案與額度 | P3 | 未處理 | 平台只查得到待審的方案異動申請，已核准與已駁回的沒有讀取途徑 | 靜態確認 |
| [PLAN-12](#plan-12) | 方案與額度 | P3 | 未處理 | AI 不在功能天花板的維度內，停用 AI 只能把 `monthlyTokens` 設成 `0` | 靜態確認 |
| [PLAN-13](#plan-13) | 方案與額度 | P2 | 未處理 | 換方案或調高方案的額度之後，當月的額度告警不會再發 | 靜態確認 |
| [PLAN-14](#plan-14) | 方案與額度 | P1 | 未處理 | 試用與輕量版方案不含 `channels` 功能（seed 與 UAT 相同），這兩個方案的管理員看不到也建不了渠道 | 執行時確認 |
| [PLAN-15](#plan-15) | 方案與額度 | P2 | 未處理 | `/admin/plans` 同時編輯兩張方案卡片時，第二張送出的是舊值，畫面卻顯示已更新 | 執行時確認 |
| [PLAN-16](#plan-16) | 方案與額度 | P2 | 未處理 | 方案異動申請的核准與駁回不是原子操作，同時送出時兩者都成功；「一筆待審」只靠查詢後建立，同時送出可建多筆 | 執行時確認 |
| [PLAN-17](#plan-17) | 方案與額度 | P2 | 未處理 | 方案異動的審核結果傳不回租戶：平台頁沒有審核備註，核准與駁回也不通知租戶 | 執行時確認 |
| [PLAN-18](#plan-18) | 方案與額度 | P2 | 未處理 | 「升級」申請不檢查方向，企業版租戶可以申請「升級」到標準版，核准後就是降級 | 執行時確認 |
| [PLAN-19](#plan-19) | 方案與額度 | P2 | 未處理 | 待審的方案異動申請不能撤回，也沒有逾期；平台不處理就永遠擋住新申請 | 執行時確認 |
| [AI-01](#ai-01) | AI 用量與成本 | P2 | 未處理 | BYOK 金鑰解密失敗會靜默退回平台金鑰，成本轉由平台承擔且開始計入租戶額度 | 靜態確認 |
| [USAGE-01](#usage-01) | AI 用量與成本 | P3 | 未處理 | 用量頁沒有標示統計的母體與筆數上限，相鄰兩張卡的母體不同 | 靜態確認 |
| [USAGE-02](#usage-02) | AI 用量與成本 | P2 | 已提建議 | 價目表只能改 seed 或資料庫，缺價期間的成本永久記 0；租戶可選的 10 個 Gemini 模型只有 3 個有價目 | 執行時確認 |
| [USAGE-03](#usage-03) | AI 用量與成本 | P2 | 未處理 | AI 額度計數器少算用量之後，當月不會再從資料庫校正，租戶可以用超過月額度 | 靜態確認 |
| [USAGE-04](#usage-04) | AI 用量與成本 | P2 | 未處理 | 租戶與平台都看不到「本月已用 AI token／有效上限」；告警信的「查看用量與方案」連到沒有這些資訊的頁面 | 執行時確認 |
| [SLA-02](#sla-02) | SLA | P2 | 未處理 | SLA 掃描每輪上限 100 張工單，且不分租戶 | 靜態確認 |
| [SLA-04](#sla-04) | SLA | P3 | 部分修正 | 工單以政策名稱連結；改名會同步工單、使用中的政策不能刪除、名稱不可重複，但資料庫沒有關聯與唯一約束 | 靜態確認 |
| [SLA-05](#sla-05) | SLA | P2 | 未處理 | 沒有關聯對話的工單永遠沒有首次回應時間，套用 SLA 時必定判定逾時 | 靜態確認 |
| [SLA-06](#sla-06) | SLA | P2 | 未處理 | SLA 以日曆時間連續計算，不扣營業時間、假日，也不在「待處理」時暫停；非營業時間照樣逾時、通知與升級 | 執行時確認 |
| [SLA-07](#sla-07) | SLA | P2 | 未處理 | 工單優先級改變後不重新套用 SLA 政策：升成緊急的工單仍以原優先級的時限計時，逾時升級後也沒有新期限 | 執行時確認 |
| [HOURS-01](#hours-01) | SLA | P1 | 未處理 | 營業時間設定為 `{}` 的租戶，在營業時間頁按「啟用」整頁崩潰，無法從畫面啟用營業時間 | 執行時確認 |
| [HOURS-02](#hours-02) | SLA | P2 | 未處理 | 營業時間不驗證時段與時區：跨午夜時段讓整天都判定為非營業；不合法的時區讓自動回覆整個失效 | 執行時確認 |
| [CONV-01](#conv-01) | 對話、工單與自動化 | P3 | 已提建議 | 對話的閒置自動關閉時限沒有維護介面，租戶無法調整或停用 | 靜態確認 |
| [CONV-02](#conv-02) | 對話、工單與自動化 | P2 | 部分修正 | 指派對話不會通知；關閉已改走 `closeConversation()` | 靜態確認 |
| [CONV-03](#conv-03) | 對話、工單與自動化 | P2 | 未處理 | 對話轉接真人時，主管與管理員收不到通知 | 靜態確認 |
| [CONV-04](#conv-04) | 對話、工單與自動化 | P1 | 未處理 | 收件匣只載入前 50 段對話，沒有分頁；篩選與搜尋都只在這 50 段裡找 | 執行時確認 |
| [CONV-05](#conv-05) | 對話、工單與自動化 | P2 | 未處理 | 重新開啟已關閉的對話，不檢查同一聯絡人在同一渠道是否已有未關閉的對話，造成兩段同時進行 | 執行時確認 |
| [CONV-06](#conv-06) | 對話、工單與自動化 | P2 | 未處理 | 指派對話與工單不驗證負責人：停用的、看不到該渠道的成員都能被指派；停用成員不解除指派，通知只寄給停用的人 | 執行時確認 |
| [CASE-02](#case-02) | 對話、工單與自動化 | P2 | 未處理 | 非 LINE 渠道的客人無法回覆滿意度調查，評分永遠不會被記錄；LINE 的問卷也送不出去，見 CASE-03 | 靜態確認 |
| [CASE-03](#case-03) | 對話、工單與自動化 | P1 | 未處理 | LINE 的滿意度調查送出空白文字，LINE 拒收，失敗沒有紀錄也不重寄 | 靜態確認 |
| [CASE-04](#case-04) | 對話、工單與自動化 | P1 | 未處理 | 工單狀態轉換不維護 `resolvedAt` 與 `csatSentAt`：直接關閉不算已解決，重開保留舊值，報表的已解決數與 SLA 達成率失真，重開再解決的工單 1 分鐘內被自動結案 | 執行時確認 |
| [CASE-05](#case-05) | 對話、工單與自動化 | P2 | 未處理 | 客服記錄滿意度時不檢查工單狀態，直接把工單改成 `CLOSED`，並對顧客送出「感謝評分」訊息 | 執行時確認 |
| [CASE-06](#case-06) | 對話、工單與自動化 | P2 | 未處理 | 連結對話到工單不檢查對話的聯絡人與渠道可見範圍，可以把別的顧客、看不到的渠道的對話掛上 | 執行時確認 |
| [CASE-07](#case-07) | 對話、工單與自動化 | P2 | 未處理 | 建立與修改工單不驗證 `assigneeId`、`teamId` 屬於本租戶，可以把其他租戶的成員寫成負責人 | 執行時確認 |
| [CASE-08](#case-08) | 對話、工單與自動化 | P2 | 未處理 | 工單的「團隊」下拉讀錯欄位，永遠只有「未指定」，畫面上無法觸發依團隊輪流指派 | 執行時確認 |
| [CASE-09](#case-09) | 對話、工單與自動化 | P2 | 未處理 | 建立工單時帶負責人、升級時改派，新負責人都收不到通知；建立時帶負責人的工單狀態也停在 `OPEN` | 執行時確認 |
| [CASE-10](#case-10) | 對話、工單與自動化 | P2 | 未處理 | 工單詳情頁的 SLA「首次回應」以時間軸上第一個客服事件判斷，指派或改狀態就顯示「已達」 | 靜態確認 |
| [AUTO-02](#auto-02) | 對話、工單與自動化 | P3 | 部分修正 | 規則的執行紀錄、執行次數與最後執行時間自 `9255245` 起停止更新；規則列表已不顯示停住的數字 | 靜態確認 |
| [AUTO-03](#auto-03) | 對話、工單與自動化 | P2 | 未處理 | 自動化貼標以名稱找標籤，不分 scope，找不到就重建 | 靜態確認 |
| [AUTO-05](#auto-05) | 對話、工單與自動化 | P2 | 部分修正 | 規則編輯器提供的部分觸發事件永遠不會觸發；編輯器已標示並警告，事件仍未送出 | 靜態確認 |
| [AUTO-06](#auto-06) | 對話、工單與自動化 | P1 | 未處理 | 規則編輯器把純數字的條件值存成數字，「訊息內容 包含 8888」這類條件永遠不成立 | 執行時確認 |
| [AUTO-07](#auto-07) | 對話、工單與自動化 | P2 | 未處理 | SLA 規則的執行路徑不做契約驗證，也不帶 `contactId`：貼標動作永遠被略過，已停用的動作不會被擋下 | 執行時確認 |
| [AUTO-08](#auto-08) | 對話、工單與自動化 | P2 | 未處理 | 「聯絡人加標籤」觸發的規則在聯絡人每被貼上任何標籤時都再執行；重複貼同一個標籤也再發一次事件 | 執行時確認 |
| [AUTO-09](#auto-09) | 對話、工單與自動化 | P2 | 未處理 | 自動化的試跑與執行紀錄只驗登入，沒有 `automation.view` 的成員可以讀到規則的條件與動作全文 | 執行時確認 |
| [AUTO-10](#auto-10) | 對話、工單與自動化 | P2 | 未處理 | workers 的工單類動作繞過工單模組：不驗證狀態轉換、不寫 `resolvedAt` 與工單事件、不通知被指派的人，查詢也不帶 `tenantId` | 執行時確認 |
| [AUTO-11](#auto-11) | 對話、工單與自動化 | P2 | 未處理 | Canvas 用 API 建不出串接的節點，草稿也能觸發；agent 預設可用 Canvas，`API_FETCH` 節點不擋內網 | 執行時確認 |
| [AUTO-12](#auto-12) | 對話、工單與自動化 | P2 | 未處理 | 自動化動作的參數只檢查有填，不檢查值：狀態可存 `"FOO"`，負責人可存其他租戶的成員 | 執行時確認 |
| [AUTO-13](#auto-13) | 對話、工單與自動化 | P2 | 未處理 | 「短連結被點擊」的觸發說明可以依連結決定動作，但契約沒有連結的條件欄位，用到時存檔被拒 | 靜態確認 |
| [IDENT-01](#ident-01) | 聯絡人、行銷與報表 | P2 | 未處理 | 合併建議沒有產生端，審核端點永遠沒有資料 | 靜態確認 |
| [IDENT-03](#ident-03) | 聯絡人、行銷與報表 | P2 | 部分修正 | 一位聯絡人在同一個渠道可以有兩個身分，回覆會送給另一位客人，進站訊息會放進另一段對話；合併已改為拒絕（`89014327`）；UAT 有 8 位 WebChat 測試聯絡人有兩個身分，是修正前 E2E 測試的合併產生；資料庫沒有限制 | 執行時確認 |
| [IDENT-07](#ident-07) | 聯絡人、行銷與報表 | P2 | 未處理 | 合併預覽不準：以渠道類型判斷新增的身分，也不檢查同一渠道衝突，執行時才 409 | 執行時確認 |
| [CONTACT-02](#contact-02) | 聯絡人、行銷與報表 | P2 | 未處理 | 已封存（被併入）的聯絡人仍可以改資料、貼標、當合併的主要聯絡人，頁首沒有標示 | 執行時確認 |
| [CONTACT-03](#contact-03) | 聯絡人、行銷與報表 | P2 | 未處理 | 合併完成後「合併紀錄」卡不更新，看不到剛才的合併，也找不到「解除合併」 | 執行時確認 |
| [CONTACT-04](#contact-04) | 聯絡人、行銷與報表 | P2 | 未處理 | 聯絡人時間軸一次取出全部對話、工單與事件，沒有上限；資料多的聯絡人詳情頁要 60 秒以上 | 執行時確認 |
| [MKT-01](#mkt-01) | 聯絡人、行銷與報表 | P2 | 部分修正 | 群發失敗後重試，逐人送出的群發會對全部對象重送；連按兩次與排程重疊已擋下 | 靜態確認 |
| [MKT-02](#mkt-02) | 聯絡人、行銷與報表 | P1 | 未處理 | 沒有 `marketing.broadcast` 的成員，建立帶排程時間的群發，到期照樣送出 | 執行時確認 |
| [MKT-03](#mkt-03) | 聯絡人、行銷與報表 | P1 | 未處理 | 附券群發繞過 `coupon.issue`，沒有優惠券權限也能發券 | 執行時確認 |
| [MKT-04](#mkt-04) | 聯絡人、行銷與報表 | P1 | 未處理 | 群發不套用渠道可見範圍，分店帳號可以對看不到的渠道預估人數、建立並送出群發 | 執行時確認 |
| [MKT-05](#mkt-05) | 聯絡人、行銷與報表 | P2 | 未處理 | 分群的「建立日期」條件以 UTC 午夜切日，台灣 00:00–07:59 建立的聯絡人算到前一天 | 執行時確認 |
| [MKT-06](#mkt-06) | 聯絡人、行銷與報表 | P2 | 未處理 | 群發的素材選單要 200 筆但後端上限 100，分群下拉只拿第一頁 50 筆 | 執行時確認 |
| [MKT-07](#mkt-07) | 聯絡人、行銷與報表 | P2 | 未處理 | 刪除分群不檢查是否被排程群發引用，群發到期失敗時的原因看不出是分群被刪 | 執行時確認 |
| [MKT-08](#mkt-08) | 聯絡人、行銷與報表 | P2 | 未處理 | LINE 素材建立與修改時，租戶的 LINE 渠道憑證解不開會回 500 | 執行時確認 |
| [MKT-09](#mkt-09) | 聯絡人、行銷與報表 | P2 | 未處理 | 會員綁定有主規格與後端，前端完全沒有入口 | 靜態確認 |
| [MKT-10](#mkt-10) | 聯絡人、行銷與報表 | P2 | 未處理 | 素材的連結動作沒有檢查協定，`javascript:` 等網址只在租戶有可用 LINE 渠道時才被擋 | 靜態確認 |
| [MKT-11](#mkt-11) | 聯絡人、行銷與報表 | P2 | 未處理 | 系統從不把優惠券寫成 `EXPIRED`：「已過期」篩選永遠 0 筆，過期券顯示「已領取」，成效的過期數永遠 0 | 靜態確認 |
| [MKT-12](#mkt-12) | 聯絡人、行銷與報表 | P2 | 未處理 | 已發布的序號包券沒有追加序號的介面；序號用完後一旦暫停，就再也無法恢復 | 靜態確認 |
| [SHORT-01](#short-01) | 聯絡人、行銷與報表 | P3 | 部分修正 | 記錄點擊的公開端點採信呼叫端提供的同租戶聯絡人與 LINE uid，也沒有速率限制；其他租戶的聯絡人已擋下 | 靜態確認 |
| [SHORT-02](#short-02) | 聯絡人、行銷與報表 | P2 | 未處理 | 編輯短連結改了目標網址，社群預覽仍是舊網站 | 執行時確認 |
| [SHORT-03](#short-03) | 聯絡人、行銷與報表 | P2 | 未處理 | 「點擊時自動貼標」不驗證標籤，不存在或工單範圍的標籤照樣存入，點擊時貼標失敗只寫 log | 執行時確認 |
| [SHORT-04](#short-04) | 聯絡人、行銷與報表 | P2 | 未處理 | 建立短連結的路由把所有例外包成 400 並回傳原始訊息，Prisma 錯誤原文顯示在畫面上；跨租戶的自訂代碼重複也走這條路徑 | 執行時確認 |
| [ANA-01](#ana-01) | 聯絡人、行銷與報表 | P3 | 未處理 | 報表以 UTC 切分日期，台灣凌晨的資料算到前一天 | 靜態確認 |
| [ANA-02](#ana-02) | 聯絡人、行銷與報表 | P3 | 已提建議 | 工單報表的 CSV 匯出與 CSAT 報表讀出期間內的所有工單，在 API 行程內計算，回應時間隨工單數增加 | 執行時確認 |
| [ANA-03](#ana-03) | 聯絡人、行銷與報表 | P1 | 未處理 | 報表匯出的 CSV 沒有跳脫：名稱含逗號會跑欄，以 `=` 等字元開頭會被 Excel 當成公式 | 執行時確認 |
| [PORTAL-01](#portal-01) | 聯絡人、行銷與報表 | P2 | 未處理 | 粉絲門戶的活動結果端點回傳測驗的正確答案，也回傳未發布活動的結果；活動詳情端點不看開始與結束時間；票券夾已簽發 fanToken，端點可以進入 | 執行時確認 |
| [PORTAL-02](#portal-02) | 聯絡人、行銷與報表 | P2 | 未處理 | 粉絲門戶送出活動一律回 400，丟掉 404／409 等狀態碼，並把原始錯誤訊息回給公開用戶端 | 執行時確認 |
| [PORTAL-03](#portal-03) | 聯絡人、行銷與報表 | P1 | 未處理 | 編輯草稿活動不帶出原本的選項，只改標題就儲存會清掉所有選項與正確答案 | 執行時確認 |
| [PORTAL-04](#portal-04) | 聯絡人、行銷與報表 | P2 | 未處理 | 粉絲送出活動的答案不驗證：不屬於該活動的選項照收並給點，表單必填欄位空白也收 | 靜態確認 |
| [CHAN-01](#chan-01) | 渠道、稽核與資料權利 | P3 | 部分修正 | 渠道刪除是硬刪除；有對話的渠道刪除改回 409 並可從畫面停用，沒有對話的渠道刪除時仍連帶刪除聯絡人身分 | 靜態確認 |
| [CHAN-02](#chan-02) | 渠道、稽核與資料權利 | P1 | 部分修正 | workers 沒有網站聊天室外掛，關鍵字與自動化規則的回覆送不到網站聊天室；網站聊天室的群發與發券顯示成功，顧客收不到（2026-10-30 健檢）；Instagram 外掛與 AI 讓步判斷已修正（`95d68fc8`） | 執行時確認 |
| [CHAN-06](#chan-06) | 渠道、稽核與資料權利 | P2 | 未處理 | LINE 的「測試連線」不檢查 Channel Secret；Secret 填錯時顯示成功，之後每則 webhook 都因簽章不符被拒，卡片沒有警示 | 靜態確認 |
| [CHAN-07](#chan-07) | 渠道、稽核與資料權利 | P2 | 未處理 | LINE 重送的事件中，沒有訊息 id 的 postback 與 follow 被重複處理：存兩則、再跑一次貼標與轉真人 | 執行時確認 |
| [CHAN-08](#chan-08) | 渠道、稽核與資料權利 | P2 | 未處理 | 客人收回 LINE 訊息時，原訊息照常顯示，另外多一則「不支援的訊息類型」 | 執行時確認 |
| [CHAN-09](#chan-09) | 渠道、稽核與資料權利 | P2 | 未處理 | 下游轉發設為立即模式時，目標網址被 SSRF 防護擋下，訊息既不轉發也不進 CRM，完全消失 | 執行時確認 |
| [CHAN-10](#chan-10) | 渠道、稽核與資料權利 | P2 | 未處理 | 圖文選單綁定受眾的背景工作失敗時不重試、不通知，畫面只顯示「已送出」 | 執行時確認 |
| [CHAN-11](#chan-11) | 渠道、稽核與資料權利 | P2 | 未處理 | 圖文選單的區域動作切成「日期時間選擇」時，模式下拉顯示有值卻沒有寫入，儲存回 400 | 執行時確認 |
| [AUD-01](#aud-01) | 渠道、稽核與資料權利 | P3 | 部分修正 | 租戶稽核不涵蓋登入、長效憑證、渠道憑證變更、優惠券與行銷、匯出下載、對外 Webhook 訂閱等操作 | 執行時確認 |
| [AUD-03](#aud-03) | 渠道、稽核與資料權利 | P1 | 未處理 | 永久刪除成員後，他在稽核紀錄裡的操作都變成沒有操作者，無法再查出是誰做的 | 執行時確認 |
| [AUD-04](#aud-04) | 渠道、稽核與資料權利 | P2 | 未處理 | `agent.create` 稽核只記舊的角色列舉，不記實際指派的角色與可見渠道 | 執行時確認 |
| [ERASE-01](#erase-01) | 渠道、稽核與資料權利 | P3 | 未處理 | **涉及 GDPR**。資料刪除沒有涵蓋所有個人資料，預設模式保留媒體檔與表單答案；被合併的聯絡人的姓名、電話、email、outbox 與 Webhook 送出紀錄兩種模式都保留；刪除後解除合併會讓被併入的人重新出現 | 執行時確認 |
| [ERASE-02](#erase-02) | 渠道、稽核與資料權利 | P2 | 未處理 | 資料刪除沒有防誤刪機制：一次 API 呼叫就執行硬刪除，沒有預覽、確認、冷靜期或取消 | 執行時確認 |
| [EXPORT-01](#export-01) | 渠道、稽核與資料權利 | P3 | 未處理 | 資料匯出的完成通知連到不存在的頁面、範圍參數沒有作用，worker 把整個租戶的資料一次載入記憶體；打包時間長時，同一個請求可能被兩次執行同時處理 | 靜態確認 |
| [HOOK-01](#hook-01) | 渠道、稽核與資料權利 | P2 | 部分修正 | 對外 Webhook 轉送所有內部事件：已有對外事件清單，但第一版等於所有事件；`message.received` 把 LINE 的 `replyToken` 送給外部網址 | 靜態確認 |
| [DEP-01](#dep-01) | 部署與應用程式 | P4 | 未處理 | `video-worker` 只剩殘留 volume 設定 | 靜態確認 |
| [DEP-02](#dep-02) | 部署與應用程式 | P3 | 未處理 | `.env.prod.example` 的變數只送到 nginx 與 certbot，讀取它們的 api、workers 收不到 | 靜態確認 |
| [APP-02](#app-02) | 部署與應用程式 | P3 | 未處理 | 可以建立 WhatsApp 渠道，但沒有外掛，收不到也送不出訊息；Telegram 外掛未註冊 | 執行時確認 |
| [APP-03](#app-03) | 部署與應用程式 | P4 | 未處理 | 啟動 log 少列 Threads | 執行時確認 |
| [APP-04](#app-04) | 部署與應用程式 | P4 | 未處理 | API 的 `*.worker.ts` 實際是 Queue producer | 靜態確認 |
| [APP-05](#app-05) | 部署與應用程式 | P4 | 未處理 | API 行程訂閱的 `sla.warning`、`sla.breached` 沒有發布端 | 靜態確認 |
| [APP-06](#app-06) | 部署與應用程式 | P3 | 未處理 | 訊息模擬器的 API 在正式環境可用，成員可偽造進站訊息 | 靜態確認 |
| [APP-07](#app-07) | 部署與應用程式 | P4 | 已提建議 | Canvas 等待節點的 BullMQ 路徑永遠失敗，佇列也沒有消費者 | 靜態確認 |
| [APP-08](#app-08) | 部署與應用程式 | P3 | 部分修正 | Redis 沒有記憶體上限；所有 BullMQ 佇列已設定完成與失敗工作的保留期限 | 靜態確認 |
| [APP-09](#app-09) | 部署與應用程式 | P3 | 部分修正 | API 行程假設只有一份：Canvas 的 Redis 廣播會重複處理、行程記憶體的狀態各自一份，無法水平擴充；排程已改為每一期只產生一筆 job，job 重跑時大多以條件更新擋住重複處理，只剩 Canvas 等待節點喚醒（#334）；業務事件已改走佇列 | 靜態確認 |
| [APP-10](#app-10) | 部署與應用程式 | P2 | 已提建議 | 沒有獨立的正式環境：合併到 `main` 就直接部署到客戶在用的環境 | 間接確認 |
| [APP-11](#app-11) | 部署與應用程式 | P2 | 未處理 | 後台多處操作失敗時畫面沒有任何訊息，錯誤只成為 console 裡的未處理 rejection | 執行時確認 |
| [APP-12](#app-12) | 部署與應用程式 | P2 | 未處理 | 多個週期工作在頂層吞掉錯誤，job 照常完成；SLA 掃描整輪失敗時佇列監控仍全綠、不告警 | 靜態確認 |
| [APP-13](#app-13) | 部署與應用程式 | P2 | 未處理 | outbox 積壓沒有畫面或告警；送不出去的列每分鐘重送、永不標記，累積 500 筆以上時較新的列永遠輪不到 | 執行時確認 |
| [APP-14](#app-14) | 部署與應用程式 | P2 | 未處理 | workers 行程停止或卡住時沒有告警，`/health` 也不檢查 Redis 與 worker | 靜態確認 |
| [PKG-01](#pkg-01) | 共用套件 | P4 | 未處理 | `types` 與 `shared` 重複定義渠道型別 | 靜態確認 |
| [PKG-02](#pkg-02) | 共用套件 | P3 | 未處理 | `channel-plugins/fb` 子路徑指向錯誤 | 執行時重現 |
| [PKG-03](#pkg-03) | 共用套件 | P4 | 未處理 | `brain` 尚未接線，仍持續建置與監看 | 執行時確認 |
| [PKG-04](#pkg-04) | 共用套件 | P4 | 未處理 | `ui` 是空殼，仍持續建置與監看 | 執行時確認 |
| [PKG-05](#pkg-05) | 共用套件 | P4 | 部分修正 | `core` 匯出沒有呼叫端的服務；`CaseService` 與 `AutomationEngine` 已刪除（#327） | 靜態確認 |
| [PKG-06](#pkg-06) | 共用套件 | P4 | 未處理 | `channel-plugins` 有沒有呼叫端的方法、擴充與檔案 | 靜態確認 |
| [ARCH-01](#arch-01) | 架構規則 | P4 | 未處理 | route 檔直接查詢資料庫 | 靜態確認 |
| [STO-01](#sto-01) | Storage、LLM 與資料庫 | P2 | 未處理 | Workers 的 MinIO 設定名稱不一致 | 執行時重現 |
| [LLM-01](#llm-01) | Storage、LLM 與資料庫 | P2 | 未處理 | 租戶的 Chat 與 Embedding 設定預設使用 Ollama，但組織不部署 Ollama | 靜態確認 |
| [LLM-02](#llm-02) | Storage、LLM 與資料庫 | P4 | 未處理 | 兩個 Compose 檔仍有 `ollama` 服務 | 靜態確認 |
| [LLM-03](#llm-03) | Storage、LLM 與資料庫 | P4 | 未處理 | `OLLAMA_*` 環境變數與 Chat 的位址補救已無作用 | 靜態確認 |
| [LLM-04](#llm-04) | Storage、LLM 與資料庫 | P2 | 未處理 | Embedding 只能呼叫 Ollama；UAT 目前靠 Compose 內的 Ollama 運作，依部署決定拿掉 Ollama 後，知識庫自動回覆、AI 建議回覆與語意搜尋都會失效 | 執行時確認 |
| [LLM-05](#llm-05) | Storage、LLM 與資料庫 | P2 | 未處理 | AI 摘要在 LLM 失敗或額度用完時回傳一段固定範本，轉接真人時以「Bot 對話摘要」寫進對話 | 執行時確認 |
| [KB-01](#kb-01) | Storage、LLM 與資料庫 | P1 | 未處理 | 知識庫追問次數用完時回覆「已為您轉接客服人員」，實際沒有轉接 | 執行時確認 |
| [KB-02](#kb-02) | Storage、LLM 與資料庫 | P1 | 未處理 | 型號守門不分大小寫，把 `Wi-Fi`、`e-mail`、訂單編號當成查不到的型號，對所有租戶生效 | 執行時確認 |
| [KB-03](#kb-03) | Storage、LLM 與資料庫 | P1 | 未處理 | 沒有 BOM 的 UTF-8 CSV 匯入知識庫後中文變亂碼，英文表頭時還會直接發布 | 執行時確認 |
| [KB-04](#kb-04) | Storage、LLM 與資料庫 | P2 | 未處理 | LLM 失敗或額度用完時，知識庫回答把整篇文章原文直接送給客人 | 執行時確認 |
| [KB-05](#kb-05) | Storage、LLM 與資料庫 | P2 | 未處理 | 型號守門命中後寫進對話的 `modelGuard` 永遠不清除，之後的回覆都沿用舊值 | 執行時確認 |
| [DB-01](#db-01) | Storage、LLM 與資料庫 | P2 | 未處理 | Prisma 與資料庫的向量維度不一致 | 執行時重現 |
| [DB-02](#db-02) | Storage、LLM 與資料庫 | P4 | 未處理 | `ContactTag.expiresAt` 沒有設定端，也沒有讀取端 | 靜態確認 |
| [DB-03](#db-03) | Storage、LLM 與資料庫 | P4 | 未處理 | `DailyStat` 每天寫入，報表不讀 | 靜態確認 |
| [DB-04](#db-04) | Storage、LLM 與資料庫 | P4 | 未處理 | schema 有、程式沒有讀寫的欄位：工單合併與關聯、`Contact.isBlocked` | 靜態確認 |
| [CI-01](#ci-01) | CI 與測試 | P2 | 未處理 | 沒有 CI workflow 執行 API 測試 | 靜態確認 |
| [CI-02](#ci-02) | CI 與測試 | P3 | 未處理 | 沒有 CI workflow 執行 lint | 靜態確認 |
| [CI-04](#ci-04) | CI 與測試 | P2 | 未處理 | 試用申請與開通完全沒有自動測試，主規格 `trial-application` 的 9 個 scenario 都沒有測試 | 靜態確認 |

## 租戶隔離與權限

<a id="rls-01"></a>
### RLS-01：Canvas 引擎不走租戶連線

`packages/core/src/canvas/flow-runner.ts` 在檔案開頭匯入 `@open333crm/database` 的 module-level `prisma` singleton。`packages/core/src/canvas/scheduler.ts` 的 `processResumeQueue()` 與 `apps/api/src/modules/canvas/canvas.webhook.ts` 也用同一個 singleton。

這個 client 由 `packages/database/src/client.ts` 以 `new PrismaClient()` 建立，沒有指定 datasource，因此連線字串是 `DATABASE_URL`。這個 singleton 與 `apps/api/src/plugins/prisma.plugin.ts` 建立的租戶連線不是同一條連線，連線上也不會有 `app.current_tenant`。`AGENTS.md` 明文禁止 `packages/*` 使用這個 singleton。

`FlowRunner` 的每一個查詢都以主鍵 `executionId` 定位，`where` 沒有 `tenantId`。`canvas.service.ts` 的 `triggerFlow()` 建立 execution 時用的是受約束的 `TenantDb`，但建立後把 `execution.id` 交給 `FlowRunner.run()`，之後的讀寫就離開租戶連線。

後果依 `DATABASE_URL` 指向哪個 role 而不同：

- 指向 superuser 或帶 BYPASSRLS 的 role（`.env.api.example` 的 `crm` 屬於這類）：Canvas 的所有讀寫跳過 RLS。
- 指向 `app_tenant`：singleton 的連線沒有 `app.current_tenant`，policy fail-closed，`FlowRunner.run()` 在第一個 `findUniqueOrThrow` 就查不到列，Canvas 會靜默停止運作。

`DATABASE_URL` 同時決定 API 的租戶連線：`prisma.plugin.ts` 在沒有設定 `DATABASE_URL_TENANT` 時，租戶連線就用 `DATABASE_URL`。因此 API 要讓 RLS 生效，通常 `DATABASE_URL` 就指向 `app_tenant`，Canvas 落在第二種情況。這時 `inbound-side-effects.ts` 每處理一則進站訊息，都呼叫 `canvas.webhook.ts` 的 `handleWebhookFlowTrigger()`；這個函式以 singleton 查 `interactionFlow`，結果是空陣列，流程永遠不會觸發，也沒有錯誤。

**等待節點也受影響。** Canvas 的等待節點只靠 `canvas.scheduler.ts` 每 60 秒呼叫 `processResumeQueue()` 恢復，BullMQ 路徑從來沒有成功過（[APP-07](#app-07)）。`processResumeQueue()` 也用 singleton，所以同樣受上面兩種情況影響。修正 RLS-01 時，一併處理 APP-07。

**優先順序。** 安全面是 P2：進入 Canvas 的路徑都不接受外部指定的 ID。`handleWebhookFlowTrigger()` 的 `tenantId` 由進站管線解析，`FlowRunner` 的 `executionId` 由租戶連線建立，因此即使 singleton 繞過 RLS，資料也不會流到其他租戶。功能面依正式環境而定：有租戶建立啟用中的 Canvas 流程，而正式環境的 `DATABASE_URL` 指向 `app_tenant` 時，這一項就是功能失效，應該回到 P1。issue #197 回報正式環境的 `DATABASE_URL` 指向 `app_tenant`，而且 `interaction_flows` 與 `flow_executions` 都是 0 筆（2026-10-02），沒有租戶使用 Canvas，因此維持 P2。

<a id="rls-03"></a>
### RLS-03：隔離檢查腳本掃不到 `packages/*`

`scripts/check-tenant-scoping.mjs` 與 `scripts/check-prisma-admin-usage.mjs` 的 `SCAN_DIR` 常數都是 `apps/api/src`。`packages/*` 不在掃描範圍，因此這兩道檢查攔不到 RLS-01 位於 `packages/core` 的程式碼。

兩支腳本檢查的項目是「query 有沒有 `tenantId`」與「有沒有使用 `prismaAdmin`」，沒有檢查「有沒有匯入 module-level singleton」。即使把 `packages/*` 納入掃描範圍，現有規則仍然抓不到這個寫法。

`packages/core` 另有兩個檔案匯入同一個 singleton：`inbox/inbox-service.ts` 與 `contacts/contact-service.ts`。這兩個檔案目前沒有任何 app 使用，情況與 PKG-03 相同。

<a id="rls-04"></a>
### RLS-04：`.env.api.example` 沒有 `DATABASE_URL_TENANT`

`apps/api/src/plugins/prisma.plugin.ts` 的 `prismaPlugin()` 在 `DATABASE_URL_TENANT` 未設定時 fallback 到 `DATABASE_URL`。`.env.api.example` 只提供 `DATABASE_URL`（`crm`）與 `DATABASE_URL_ADMIN`，沒有 `DATABASE_URL_TENANT`。

照著範例檔部署時，`fastify.prisma`、`request.tenantPrisma` 與 `withTenant()` 都會連到 `crm`。RLS 這一層不會生效，而且啟動時沒有任何警告。

`apps/workers/src/index.ts` 的 `main()` 對 `DATABASE_URL_ADMIN` 的處理方式相反：變數缺少就拋錯，Workers 不啟動。API 的租戶連線沒有對應的檢查。

<a id="rls-08"></a>
### RLS-08：service 收到的 client 決定了它的 RLS 與交易保證

service 的 Prisma 參數型別是 `TenantDb`（`apps/api/src/lib/tenant-db.ts`），是三種 client 的聯集。三者的查詢寫法相同，保證不同：

| 傳入的 client | RLS | 連續兩筆寫入是否在同一個交易 |
| --- | --- | --- |
| `withTenant` 的 `tx` | 有 | 是 |
| `request.tenantPrisma` | 有 | 否，每個查詢各開一個交易；它的 `$transaction()` 不設定租戶 |
| `prismaAdmin` | 繞過（BYPASSRLS） | 否，除非 service 自己開 `$transaction` |

只讀 service 的程式，看不出它有沒有 RLS，也看不出寫入會不會一起成功或一起失敗，要往上追呼叫者。已經造成的影響：

- PR #335 只看參數型別，誤判 `sendCsatSurvey()` 可能已在交易內；唯一的呼叫者其實傳 `prismaAdmin`。
- `apps/api/src/index.ts` 把 `prismaAdmin` 傳給 automation、notification、canvas worker 與多數排程。這些路徑的租戶隔離只靠程式裡的 `where tenantId`。RLS-06 就發生在這類路徑上。
- 聯集接近 TypeScript 的推導上限（`tenant-db.ts` 的註解）。
- 在交易內呼叫 `io.emit`、`eventBus.publish` 的 service，會在 commit 之前送出推播與事件。

**方向（#337，2026-10-20 定案）。** 全面改成「入口開一個綁定租戶的交易，service 只收 `TenantCtx`」。change `tenant-transaction-context` 建立了新寫法：`apps/api/src/lib/tenant-ctx.ts` 的 `inTenant()`、`tenantHandler()`，以及 `AGENTS.md` 結構規則 2（change `migrate-role-agent-tenant-ctx` 起，route 一律呼叫 flow，`tenantHandler()` 已刪除）。之後依 #337 的階段逐模組搬遷：

1. 試做 tag、role。
2. 事件改走 outbox（動手前先評估客人收到重複訊息的機率）。
3. 搬沒有外部呼叫的模組，再搬有外部呼叫的模組。
4. 背景工作改成「以 `prismaAdmin` 找出要處理的資料，每一筆各開自己租戶的交易」。
5. Canvas 引擎（RLS-01）。
6. 刪除 `TenantDb`、`tenantScopedClient`、`request.tenantPrisma`。

第 2 步已在 change `outbox-event-delivery` 完成（`9c2aff5c` 起）：`ctx.publish`、`ctx.enqueue`（change `migrate-role-agent-tenant-ctx` 起改成 `publishEvent()`、`enqueueJob()`）在交易內寫 outbox，至少送出一次；三個訂閱者改從 BullMQ 佇列取得事件，對客人發訊息等副作用以 `side_effect_claims` 認領。自動化訂閱者的認領與寫入改用 `inTenant()`，LLM 階段仍用 `prismaAdmin`。還沒搬遷的程式仍呼叫 `eventBus.publish`，保證是最多一次。

搬遷進度看 `scripts/check-tenant-ctx.baseline.json`。`node scripts/check-tenant-ctx.mjs --strict` 在舊寫法增加時失敗。

<a id="rls-09"></a>
### RLS-09：推播端無法檢查房間屬於哪個租戶

Socket.IO 房間只有 `tenant:<tenantId>` 帶租戶 ID。`conversation:<id>`、`agent:<id>`、`visitor:<channelId>:<token>`、`chatbox:<sessionId>` 只帶資料本身的 ID。

前端訂閱房間時，`apps/api/src/modules/socket/socket-room-authorization.ts` 會檢查該資料屬於連線的租戶，所以別的租戶的連線進不了這些房間。推播端沒有對應的檢查：`io.to(room)` 只收一個字串。service 用了請求帶進來、沒有經過租戶查詢的 ID 時，推播會送到別的租戶的房間。用 `ctx.tx` 查出來的 ID 受 RLS 約束，不會有這個問題。目前沒有逐一檢查既有的推播呼叫，還沒有發現實際發生的路徑。

新寫法 `notifyTenant()`（`apps/api/src/events/socket-push.ts`）不讓呼叫端指定房間：`tenant:` 房間由交易綁定的租戶 ID 組成（`apps/api/src/events/socket-push.ts`），所以不會推到別的租戶的 `tenant:` 房間。`notifyAgent()` 推到 `tenant:<tenantId>:agent:<agentId>`，房間也由交易綁定的租戶 ID 組成；成員連線時，伺服器依 token 加入自己的這個房間（`socket-room-handlers.ts`）。所以新寫法的推播都不會送到別的租戶。既有程式直接呼叫 `io.to('agent:…')`，仍然無法檢查。新寫法不提供推到 `conversation:` 房間的方法。

**方向（#342，2026-10-20 定案）。** 定義統一的房間名稱格式，所有房間都以 `tenant:<tenantId>` 開頭，由 `events/socket-push.ts` 組成。新寫法已經做到（`tenant:` 與 `tenant:<tenantId>:agent:` 房間）；剩下的是既有程式的搬遷，以及 `subscribe` 的房間名稱。

<a id="rls-10"></a>
### RLS-10：租戶連線對平台層資料表有完整讀寫權限

平台層資料表沒有 RLS（見文末「已核對的資料庫基線」）。`packages/database/prisma/migrations/20260826160000_rls_roles_and_grants/migration.sql` 第 21、26 行對整個 schema 授權 `app_tenant` `SELECT, INSERT, UPDATE, DELETE`，因此也包含 `platform_settings`、`model_pricings`、`platform_users`。

租戶連線目前的合法用途只有讀：`readAiPrivacyPolicy()` 讀 `platform_settings`、`getPricing()` 讀 `model_pricings`。租戶路徑只要有一處程式錯誤或注入，就能：

- 讀出 `platform_users` 的 `passwordHash`。
- 改其他租戶的個資遮罩（`ai.privacy.<tenantId>`）與試用政策。
- 改全平台的價目表。

RLS 是租戶隔離的第二道防線；對這幾張表，第二道防線不存在。修正方向：收回 `app_tenant` 對平台層資料表的寫入權限，`platform_users` 連讀取一併收回；租戶路徑需要的兩張表只給 `SELECT`。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-SETTINGS-02（[PLATFORM-SETTINGS 健檢](../features/health/PLATFORM-SETTINGS.md)）。證據：本機 psql 在交易內 `SET LOCAL ROLE app_tenant` 並設定 `app.current_tenant`，看得到全部 `platform_settings`、`UPDATE` 其他租戶的 `ai.privacy.*` 成功、`INSERT` 新鍵成功、`UPDATE model_pricings` 成功、`platform_users.passwordHash` 可讀，最後 ROLLBACK（健檢實測）。子代理原列 P2，2026-10-30 使用者決定升為 P1。

<a id="rbac-01"></a>
### RBAC-01：部分權限碼沒有強制點

**部分修正。** 兩個 commit 修正了大部分的路由：

| commit | 修正的路由 |
| --- | --- |
| `481452a`（2026-09-30） | `contact.routes.ts` 的每一條路由 |
| `efbd5f0`（#207，2026-10-02） | `case`、`conversation`、`tag`、`shortlink` 四個模組的每一條路由。改負責人或團隊另外要求 `case.assign`，改成 `ESCALATED` 另外要求 `case.escalate` |

`packages/shared/src/rbac/permissions.ts`（2026-10-29 從 `packages/core` 搬來）宣告 62 個權限碼（2026-10-30 功能健檢核對，本機與 UAT 的 `/roles/matrix` 都是 62 個；2026-10-02 核對時是 56 個）。其中 3 個在 `apps/api/src` 完全沒有出現：

| 權限碼 | 現況 |
| --- | --- |
| `knowledge.view` | `knowledge.routes.ts` 以 `addHook('preHandler')` 只檢查登入。寫入路由另外要求 `knowledge.manage` 或 `knowledge.admin`，但 9 條讀取路由（文章列表、單篇、來源、分類、搜尋、embedding 狀態、模型、回饋數量、回饋列表）沒有權限碼檢查 |
| `agent.delete` | 註冊表標示「已淘汰，改用 `agent.deactivate` / `agent.purge`」 |
| `billing.view` | 描述是「租戶站內方案/用量頁」，但這個頁面不存在：租戶端的 `/dashboard/plan` 只有升級與加購的申請表，以及自己的申請列表（見 PLAN-10） |

2026-10-30 功能健檢實測重現：只有 `inbox.view` 的成員讀文章列表、單篇、分類、來源、型號、回報清單與回報數都回 200（[KNOWLEDGE 健檢](../features/health/KNOWLEDGE.md)）。`agent.delete` 仍在註冊表，角色頁顯示「刪除成員（舊）」（[MEMBERS 健檢](../features/health/MEMBERS.md)）。

知識庫的讀取路由因此有兩個後果：

- 角色設定取消勾選「檢視知識庫」，成員仍然讀得到文章。
- 方案的功能天花板不含 `knowledge` 時，租戶的成員仍然讀得到文章。寫入路由會被天花板擋下。

**規格依據。** 這三項都沒有主規格支持，只有歸檔 change 的設計文件與未完成的任務：

| 權限碼 | 依據 |
| --- | --- |
| `knowledge.view` | `openspec/changes/archive/2026-09-15-rbac-granular-permissions/SPEC.md` 寫明 `knowledge.view` 守「列表、來源、分類、搜尋、feedback」。該 change 的任務 9.2（分批切換路由 guard）沒有勾選就歸檔 |
| `agent.delete` | `openspec/changes/archive/2026-09-15-agent-deactivate-vs-delete/proposal.md` 寫「`agent.delete` 保留相容或標記淘汰」，沒有做決定 |
| `billing.view` | `openspec/changes/archive/2026-09-15-platform-control-plane/tasks.md` 的任務 8.5「新增權限點 `billing.view` 控管此頁存取」沒有勾選，頁面也沒有實作 |

主規格 `rbac` 的「路由以權限碼授權」也不能當依據。這條需求規定需要授權的路由以 `requirePermission()` 檢查，但沒有規定哪些路由需要授權：各路由要求哪個權限碼，以程式為準。

**優先順序是 P3。** 收件匣、工單、標籤與短連結都已經有權限檢查。剩下的知識庫內容是租戶內部的資料，沒有跨租戶的風險，主規格也沒有要求。

啟動時的檢查只驗單向：`validateRouteCodes()` 確認路由用到的碼都存在於 registry，不檢查 registry 的碼有沒有人用。因此宣告了卻沒有強制點的碼不會產生任何警告。

**修正方向**：

- 知識庫的讀取路由加上 `requirePermission('knowledge.view')`。
- `agent.delete` 從註冊表移除。移除前要確認沒有角色仍持有這個碼，或在 reconcile 時一併清掉。
- `billing.view` 等租戶端的方案與用量頁實作時再接上，或先從註冊表移除。

<a id="rbac-02"></a>
### RBAC-02：CLI token 以 scope 授權，繞過角色權限與方案天花板

CLI token 與網頁登入走兩套授權，兩套之間沒有對應：

| | 網頁路由 | CLI 路由與 MCP |
| --- | --- | --- |
| 驗證 | `fastify.authenticate`（JWT） | `authenticateCliSession` 或 `authenticateJwtOrCliSession` |
| 授權 | `requirePermission()`：角色權限 ∩ 方案天花板 | 只檢查 token 的 scope |

一般路由的 `authenticate` 只接受 JWT，`cli_` 開頭的 token 會被擋下。會收 CLI token 的只有 `/auth/me`、`/auth/cli/logout`、`cli.routes.ts` 的各條路由，以及 MCP 端點。

**取得 token 的兩條路徑都不看角色與方案：**

| 路徑 | 誰能用 | 拿到的 scope |
| --- | --- | --- |
| `POST /auth/cli/login` | 任何成員，用帳號密碼即可，不分角色 | `DEFAULT_CLI_SCOPES`：`cli:status`、`cli:apis`、`cli:analytics:read` |
| `POST /settings/cli-sessions` | 持有 `settings.manage` | 請求自帶的 `scopes`。schema 是 `z.array(z.string())`，任何字串都收；`mcpRead: true` 再加上 `mcp:read` |

**後果一：任何成員都能以 CLI 讀全租戶報表。**

| | 網頁 `/analytics/overview` 等 | CLI `/cli/analytics/overview` 等 |
| --- | --- | --- |
| 角色 | 需要 `analytics.view` | 只看 `cli:analytics:read` |
| 方案 | `analytics.view` 屬於 `analytics` feature，受天花板限制 | 不看方案 |

`agent` 系統角色的預設權限只有 `analytics.view.self`，沒有 `analytics.view`。因此任何客服用自己的帳密走 CLI 登入，就能讀到全租戶的總覽、訊息趨勢、案件與渠道報表，而這些在網頁上他看不到。方案不含 `analytics` 的租戶（seed 的 `trial`、`light`、`standard`）也一樣讀得到。

**後果二：MCP 工具不受方案限制。** MCP 端點要求 token 帶 `mcp:read`，個別工具再依 `requiredMcpScopeForTool()` 要求 `mcp:line:read`、`mcp:line:send` 或 `mcp:line:broadcast`。`mcp.server.ts` 的工具（查聯繫人與案件、報表、LINE 對話、直接發送、群發）都不檢查角色權限或方案天花板。只有持 `settings.manage` 的人能發出帶這些 scope 的 token，但發出之後，方案不含 `marketing` 的租戶也能透過 MCP 群發。

**`requirePermission()` 裡另有一段失效開放的程式碼。** 它遇到 `request.agent.isCliSession` 就直接放行，註解寫「防禦性放行」。目前沒有任何路由同時接受 CLI token 又掛 `requirePermission()`，所以碰不到。但哪天有路由改用 `authenticateJwtOrCliSession` 並保留 `requirePermission()`，那條路由對 CLI token 就完全沒有權限檢查。對照之下，`authenticateJwtOrCliSession` 的 JWT 分支沒有設定 `roleId`，網頁使用者在同一條路由上會拿到空的權限集合而被擋下。同一條路由，JWT 失效關閉，CLI 失效開放。

**規格依據。** 主規格 `rbac` 的「CLI token 的授權」規定：CLI 路由與 MCP 工具 SHALL 同時檢查 token 的 scope 與成員的有效權限集合；權限檢查的 guard MUST NOT 直接放行 CLI token。後果一、後果二與失效開放的程式碼都違反這條需求。這條需求依 issue #217 的決定寫入（CLI 選項 A）。

CLI token 的停用問題另見 AUTH-02。

<a id="rbac-03"></a>
### RBAC-03：業務規則看舊的角色列舉，不看細粒度角色

`Agent` 有兩個角色欄位。`role` 是 `AgentRole` 列舉（`ADMIN`、`SUPERVISOR`、`AGENT`），`roleId` 指向可自訂的 `Role`。schema 的註解說明這是過渡期的雙寫，最終要移除列舉。權限檢查已經改看 `roleId`，下列業務規則仍然看 `role`：

| 位置 | 規則 |
| --- | --- |
| `case/assignment.service.ts` 的 `getNextAgent()` | 工單自動指派只從 `role` 為 `AGENT` 的成員挑選 |
| `notification/notification.worker.ts` 的 `getSupervisorAndAdminIds()` | 未指派對話的新訊息與工單升級，通知 `SUPERVISOR` 與 `ADMIN` |
| 同一個檔案訂閱 `usage.quota.threshold` 的處理器 | AI 額度告警只通知 `ADMIN` |
| `apps/workers/src/lib/automation-actions.ts` 的 `getSupervisorAndAdminAgentIds()` | 自動化的「通知主管」動作 |
| `trial/trial.scheduler.ts` 的 `adminEmails()` | 試用到期的通知信只寄給 `ADMIN` |
| `csat/csat.service.ts` 的 `recordCsatScore()` | CSAT 兩分以下只通知 `SUPERVISOR`，不含 `ADMIN` |
| `agent/agent.service.ts` 的 `assertNotLastActiveAdmin()` | 停用與刪除成員時，「最後一位啟用中的管理員」把 `role` 為 `ADMIN` 的成員也算成管理員 |

2026-10-30 功能健檢補上兩點：

- **權杖失效通知也看舊列舉。** `channel/meta-token-health.ts` 的 FB、IG 權杖失效通知只寄給 `role` 為 `ADMIN` 的成員，不看細粒度角色有沒有 `channel.update`，也不看收件人看不看得到這個渠道。自訂「渠道管理員」角色、列舉是 `AGENT` 的人收不到；列舉仍是 `ADMIN`、已改成受限角色的分店成員會收到別店渠道的通知。**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CHANNELS-04（[CHANNELS 健檢](../features/health/CHANNELS.md)）。證據：`apps/api/src/modules/channel/meta-token-health.ts:147-150`（讀程式，並以本機資料確認收件人只有 `admin@open333crm.dev`）。
- **非管理員就能製造列舉為 `ADMIN` 的成員。** 自訂角色時，`createAgent()` 的 `legacyRole = input.role ?? fallbackRole` 讓呼叫端任意指定 `role`，越權防護只檢查 `roleId`。持 `agent.manage` 的非管理員可以建立 `{"role":"ADMIN","roleId":<低權限自訂角色>}` 的成員：這位成員收到所有管理員與主管通知、AI 額度告警與試用到期信，被「最後一位管理員」的保護算成管理員，人員頁也算進「ADMIN」分頁。**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MEMBERS-03（[MEMBERS 健檢](../features/health/MEMBERS.md)）。證據：`apps/api/src/modules/agent/agent.service.ts:101-110`；自訂角色「指派者」`POST /agents {"role":"ADMIN","roleId":<指派者角色>}` 回 201，`agents.role = ADMIN`（健檢實測）。

指派自訂角色時，`agent.service.ts` 的 `resolveRoleAssignment()` 讓 `role` 沿用成員原本的值。因此兩個同屬一個自訂角色的成員，行為可能正好相反：原本是 `ADMIN` 的人會收到所有主管通知，也永遠不會被自動指派工單；原本是 `AGENT` 的人則相反。「人員管理」頁只顯示細粒度角色，管理員看不到這個差異。

**規格依據。** 主規格 `agent-lifecycle` 的「停用成員」與「永久刪除成員」規定：目標是租戶最後一位啟用中、角色為 `admin` 系統角色的成員時，系統 SHALL 拒絕。`assertNotLastActiveAdmin()` 把 `role` 為 `ADMIN`、但角色已改成自訂角色的成員也算進去。例如：租戶只剩一位 `admin` 系統角色的成員 M，另一位成員的角色列舉仍是 `ADMIN`。系統因此認為有兩位管理員，允許停用或刪除 M，租戶可能從此沒有人能管理角色。現況違反這兩條需求，因此由 P3 調為 P2。表中其他規則沒有主規格規定。

<a id="rbac-04"></a>
### RBAC-04：渠道可見範圍有多處沒有套用

渠道可見範圍讓同一個租戶內的成員只看到被授權的渠道，規則在 `services/channel-visibility.ts`。收件匣與工單的 REST 路由、單一對話的 socket 房間有套用；下列路徑沒有：

| 路徑 | 沒有套用的結果 |
| --- | --- |
| `plugins/socket.plugin.ts` 在連線時讓每條 socket 自動加入 `tenant:<租戶 ID>` | `conversation.service.ts` 的 `sendMessage()` 與 `webhook/inbound-socket-presenter.ts` 的 `emitToConversationAndTenant()` 都把含訊息內容的 `message.new` 發到租戶房間。受限的客服即時收到所有渠道的訊息 |
| `contact.routes.ts` 的清單、詳情與合併 | 清單與詳情只過濾回傳的渠道身分，聯絡人本身照樣列出：其他渠道的聯絡人的姓名、電話、email 都看得到。`/merge-preview` 與 `/merge` 不檢查兩個聯絡人的渠道 |
| `case.routes.ts` 的 `GET /stats` | 統計全租戶的工單 |
| `analytics.routes.ts` 的全部報表與匯出、CLI 報表 | 統計全租戶。「SLA 違規案件」回傳整筆工單（標題、描述、`csatComment`、聯絡人名稱），工單匯出列出期間內全部工單的標題與聯絡人名稱。只有 `analytics.view`、沒有 `case.view`、`contact.view` 的成員也拿得到（HC-ANALYTICS-03） |
| `GET /cases/:id` | 回傳聯絡人的全部渠道身分（uid、暱稱），`conversations` 也列出看不到的渠道的對話（HC-CASES-08） |
| `GET /conversations/:id` | 回傳聯絡人的全部渠道身分（HC-INBOX-05） |
| `PATCH /contacts/:id` 的回應、`/merge-preview` | 回傳雙方的全部渠道身分；`GET /contacts/:id` 已過濾（HC-CONTACTS-10） |
| 資料匯出（`data-export.handler.ts`） | 只以 `tenantId` 篩選。持 `data.export` 的成員即使沒有任何渠道授權、沒有 `inbox.view` 與 `case.view`，也能匯出全租戶的聯絡人（含各渠道 uid）、對話、訊息與工單（HC-GOVERNANCE-02） |
| 資料刪除（`data-erasure.service.ts`） | 持 `data.erase` 但看不到某渠道的成員，可以匿名化或硬刪除只在那個渠道出現的聯絡人（HC-GOVERNANCE-05） |
| `notification.worker.ts` 的未指派對話新訊息通知 | 通知所有 `ADMIN`、`SUPERVISOR`，不看渠道。只看得到分店渠道的主管仍收到其他渠道客人的名稱，點進去是 404（HC-NOTIFICATIONS-01） |

第一項影響最大：只要受限客服的畫面連著 socket，渠道可見範圍在即時事件上等於不存在。2026-10-30 功能健檢實測重現：沒有任何渠道授權的成員訂閱對話房間被拒，但仍從租戶房間收到 WebChat 的 `message.new`，含訊息全文（[INBOX 健檢](../features/health/INBOX.md)）。

**2026-10-30 功能健檢新增的路徑。** 上表 `GET /stats` 之後的七列都是健檢實測發現的。影響較大或修法不同的另列一項：單筆渠道的路由（RBAC-07，P1）、群發（MKT-04，P1）、連結對話到工單（CASE-06）、指派給看不到渠道的成員（CONV-06）。**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-ANALYTICS-03（[ANALYTICS 健檢](../features/health/ANALYTICS.md)）、HC-CASES-08（[CASES 健檢](../features/health/CASES.md)）、HC-INBOX-05（[INBOX 健檢](../features/health/INBOX.md)）、HC-CONTACTS-10（[CONTACTS 健檢](../features/health/CONTACTS.md)）、HC-GOVERNANCE-02（[GOVERNANCE 健檢](../features/health/GOVERNANCE.md)）、HC-GOVERNANCE-05（[GOVERNANCE 健檢](../features/health/GOVERNANCE.md)）、HC-NOTIFICATIONS-01（[NOTIFICATIONS 健檢](../features/health/NOTIFICATIONS.md)）。證據：各報告以只綁一個渠道或沒有渠道授權的自訂角色實測，例如 `apps/api/src/modules/analytics/analytics.service.ts:282-294`、`apps/api/src/modules/case/case.service.ts:150-157`、`apps/api/src/modules/conversation/conversation.service.ts:184-206`、`apps/api/src/modules/contact/contact.service.ts:236-244`、`apps/workers/src/handlers/data-export.handler.ts:56-112`、`apps/api/src/modules/data-erasure/data-erasure.service.ts:45-56`、`apps/api/src/modules/notification/notification.worker.ts:61-74, 217-236`。

**規格依據。** 主規格 `channel-scoped-visibility` 的「與即時推播一致」，現況沒有做到：

- 「與即時推播一致」：不可見渠道的訊息事件 MUST NOT 送達成員，包括送到租戶房間的事件。第一項違反這條需求。

聯絡人與 `GET /cases/stats` 不在這份規格的範圍內：規格只規定對話與工單的列表、單筆讀取與操作。

**部分修正。** `481452a`（#185，2026-09-30）讓聯絡人的 `/:id/conversations`、`/:id/cases`、`/:id/timeline` 依可見範圍過濾，清單與詳情也只回傳可見渠道的身分。聯絡人本身要不要依渠道過濾，`add-cross-channel-one-id` 的任務 9.3.9 記為「跨渠道聯絡人的歸屬規則需另行設計」。

2026-10-15，#281（`ee79c5ae`）讓 `POST /cases` 以 `assertChannelVisible(…, 'full')` 檢查指定的渠道，看不到的渠道回 404。2026-10-16，`POST /cases/from-conversation/:conversationId` 改為和 `POST /conversations/:id/case` 一樣，先以 `assertConversationChannelVisible(…, 'full')` 檢查對話的渠道；修正前看不到該渠道的成員只要知道對話 ID，就能替那則對話建立工單並連結。

2026-10-07，`ai.routes.ts` 的 `/suggest-reply`、`/summarize`、帶 `conversationId` 的 `/agent/run`，以及關聯對話的 `GET /agent/runs/:id`，改為先以 `assertConversationChannelVisible(…, 'read_only')` 檢查；不可見渠道的對話回 404，不呼叫 AI。

<a id="rbac-05"></a>
### RBAC-05：reconcile 腳本會覆蓋租戶對系統角色的修改

新增權限碼之後，既有租戶的角色不會自動取得，連 `admin` 也不會。補上的唯一途徑是手動執行 `scripts/reconcile-system-role-permissions.mjs`。這個腳本對每個租戶呼叫 `seedRolesForTenant()`，而 `seed-roles.ts` 的 `seedRolesForTenant()` 對三個系統角色都是先 `rolePermission.deleteMany()`，再依 `DEFAULT_ROLE_PERMISSIONS` 重建。

租戶管理員可以修改系統角色的權限碼：`role.service.ts` 的 `setRolePermissions()` 只禁止移除 `admin` 的鎖定碼，不禁止修改系統角色。因此執行 reconcile 之後：

| 租戶做過的修改 | reconcile 之後 |
| --- | --- |
| 從 `supervisor` 或 `agent` 移除某個權限碼，例如 `marketing.broadcast` | 重新授予，租戶不會收到任何通知 |
| 給 `supervisor` 或 `agent` 加上預設沒有的權限碼 | 被移除 |
| 自訂角色 | 不受影響 |

腳本的註解寫「只動 system role；租戶自訂角色不受影響」，沒有提到系統角色的修改會遺失。

另外兩個相關的缺口：

- 腳本不清除 Redis 的 `perms:*` 快取，重建後最多 10 分鐘才生效。`openspec/changes/archive/2026-09-15-channel-scoped-visibility/design.md` 把「清權限快取」列為部署時的手動步驟。
- `.github/workflows/deploy.yml` 不執行這個腳本，執行與否完全依賴部署的人記得。漏掉時，新功能的路由對所有既有租戶回 403。

**規格依據。** 主規格 `role-management` 的「系統角色權限可以調整，但有安全鎖」規定：租戶對系統角色權限的修改 SHALL 在權限註冊表更新之後保留。同步預設權限的流程 MUST NOT 重新授予租戶已經移除的權限碼，也 MUST NOT 移除租戶已經加上的權限碼。reconcile 腳本兩者都違反。規格只規定結果；新權限碼怎麼給既有租戶，由修正這一項的 change 決定（issue #217）。

**修正方向**：reconcile 只補上「預設有、但租戶從未設定過」的新權限碼，不刪除也不重加既有的碼；這需要記錄每個角色已經同步到哪一版註冊表。腳本結束前清除 `perms:*` 快取，並納入部署流程。

**部分緩解（2026-10-21，add-coupon-system）**：新增 `scripts/grant-new-role-permissions.mjs`。它只把「指定的權限碼 ∩ 該角色的預設權限」補到各租戶的系統角色，已存在的略過，不刪除也不重建，所以不會覆蓋租戶的修改。新增權限碼時改用這支腳本，例如優惠券上線：`node scripts/grant-new-role-permissions.mjs coupon.view coupon.manage coupon.issue coupon.redeem store.view store.manage`。仍未解決：要由部署的人指定這次新增的碼、腳本不清除 `perms:*` 快取（只印出提醒）、沒有納入部署流程；reconcile 腳本本身沒有改。

<a id="rbac-07"></a>
### RBAC-07：單筆渠道的路由不檢查渠道可見範圍

`GET /channels` 與 `GET /channels/:id/status` 依渠道可見範圍過濾，單筆渠道的其他路由沒有。持有 `channel.update` 或 `channel.delete`、沒有 `channel.view_all` 的成員，可以對看不到的渠道：

- 讀取渠道設定（含遮罩憑證與明文 `verifyToken`）、嵌入碼與導流識別。
- 改名、停用、更換憑證（例如換掉 FB 的 `pageAccessToken`）、測試連線、設定 webhook、改聊天室外觀。
- 刪除渠道。

換憑證不寫稽核（AUD-01），事後查不到是誰做的。

**規格依據。** 主規格 `channel-visibility-defaults` 的「Unbound Channel Is Not Visible」規定：沒有綁定的渠道在列表與單筆存取檢查中都不可見。現況違反這條需求。其他沒有套用可見範圍的路徑見 RBAC-04。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CHANNELS-01（[CHANNELS 健檢](../features/health/CHANNELS.md)）。證據：`apps/api/src/modules/channel/channel.routes.ts:326-414`、`:450`、`:460`、`:499-567`、`:570`，`channel.service.ts:687`；自訂角色只綁 LINE-A，`GET /channels/<FB>` 200，`PATCH` 改名、停用、換權杖都 200，admin 讀回權杖已換（健檢實測）。

<a id="rbac-08"></a>
### RBAC-08：改成員角色沒有越權與最後一位管理員保護

`agent.service.ts` 的 `updateAgentRole()` 只檢查「新角色」是否超出操作者的權限，不檢查「目標成員目前的角色」是否比操作者高，也不呼叫 `assertNotLastActiveAdmin()`（只有停用與刪除呼叫）。

`supervisor` 系統角色預設有 `agent.role.assign`，因此主管可以把管理員改成 Supervisor 或 Agent。租戶只有一位管理員時（多數租戶的情況），一個操作之後就沒有人持有 `role.manage`、`agent.deactivate`、`agent.purge`；主管也不能把人改回 Admin（`ROLE_ESCALATION`），只能直接改資料庫。

**規格依據。** 主規格 `agent-lifecycle` 只規定停用與刪除要有最後一位管理員保護；`role-management` 的越權防護只比對目標角色。這一項沒有直接違反主規格，依影響判定為 P1。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MEMBERS-01（[MEMBERS 健檢](../features/health/MEMBERS.md)）。證據：`apps/api/src/modules/agent/agent.service.ts:240-287`；以 seed supervisor `PATCH /agents/<admin2>/role {"role":"SUPERVISOR"}` 回 200（健檢實測）；「最後一位管理員」情況為讀程式，沒有對 seed 帳號實測。

<a id="rbac-09"></a>
### RBAC-09：重設密碼、停用、刪除成員不比較目標的權限

`resetAgentPassword()`、`deactivateAgent()`、`purgeAgent()` 只檢查操作者有沒有對應的權限碼，不檢查目標成員的權限是否比操作者高：

- 持 `agent.password.reset` 的自訂角色可以重設管理員的密碼，再以管理員身分登入，等於繞過 `ROLE_ESCALATION` 取得全部權限。
- 持 `agent.deactivate`、`agent.purge` 的自訂角色可以停用或刪除管理員（不是最後一位時）。

這三個碼預設只有 `admin` 持有，要管理員先把它們授予自訂角色才會發生，因此列為 P2。角色權限頁沒有任何提示說明這三個碼等同管理員。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MEMBERS-02（[MEMBERS 健檢](../features/health/MEMBERS.md)）。證據：`agent.service.ts:317-334`、`:376-396`、`:408-425`；自訂角色只有 `agent.view, agent.password.reset`，重設 admin2 的密碼後以新密碼登入成功；另一個自訂角色停用 admin2 回 204（健檢實測）。

<a id="rbac-10"></a>
### RBAC-10：編輯成員的渠道一律寫成 `full`

`apps/api/src/services/channel-team-access.ts` 整組替換成員的渠道授權時，`accessLevel` 寫死 `'full'`（第 181 行）。由沒有 `channel.view_all` 的建立者建立、繼承到 `read_only` 或 `reply_only` 的成員，被管理員在人員頁編輯渠道一次，就升成 `full`，可以回覆、指派與結案。人員頁只有勾選框，沒有層級欄位，管理員看不到原本的層級。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MEMBERS-04（[MEMBERS 健檢](../features/health/MEMBERS.md)）。證據：`apps/api/src/services/channel-team-access.ts:161-185`、`apps/web/src/components/settings/AgentManagement.tsx:446-475`；`read_only` 子帳號經 `PUT /agents/:id/channels` 同一個渠道後層級變成 `full`（健檢實測）。

<a id="rbac-11"></a>
### RBAC-11：後台頁面不依權限隱藏操作，403 顯示成「沒有資料」

多個領域的頁面不讀權限，對沒有寫入權限的成員照樣顯示新增、編輯、刪除、發布等按鈕，按下之後才由後端回 403。後端的 403 都正確，問題在前端：

| 頁面 | 不依權限顯示的操作 | 健檢編號 |
| --- | --- | --- |
| 自動化 | 新增規則、啟用開關、儲存規則、刪除規則 | HC-AUTOMATION-09 |
| 工單 | 新增工單、刪除、關閉案件、狀態等 6 個下拉、備註 | HC-CASES-10 |
| 渠道管理 | 套用、設定精靈、新增渠道、停用、測試連線、編輯、刪除 | HC-CHANNELS-02 |
| 聯絡人與標籤 | 合併聯絡人、貼標與移除標籤、標籤管理的新增編輯刪除 | HC-CONTACTS-06、HC-CONTACTS-07 |
| 收件匣 | 結案、交回 Bot、接管、負責人與狀態下拉、輸入框、建立工單；存取層級不足時顯示英文 `Forbidden: channel access level insufficient` | HC-INBOX-04 |
| 知識庫 | 新增文章、匯入、編輯、發布、封存、刪除 | HC-KNOWLEDGE-05 |
| 行銷 | 新增活動、分群、建立廣播、從版型建立、啟動、存為素材 | HC-MARKETING-05 |
| 會員入口 | 建立活動、發布、編輯、刪除、結束、抽獎、手動調整積分 | HC-PORTAL-07 |
| 設定 | 側欄的營業時間、追蹤設定、API 金鑰、CLI 連線沒有 `perm`；API 金鑰與 CLI 頁仍顯示建立按鈕 | HC-SETTINGS-02 |

另一種形狀是讀取被擋時顯示成空資料：行銷頁對沒有 `marketing.view` 的成員顯示「尚無行銷活動」，旁邊還有可按的「新增活動」；沒有 `channel.view`、`tag.view` 時，群發與分群的渠道、標籤選單是空的，沒有說明（HC-MARKETING-06）。

**規格依據。** 主規格 `permission-check` 的「前端依權限顯示選單」與 `dashboard-tree-navigation` 的「Permission-aware tree rendering」規定使用者沒有權限的目的地 SHALL 不顯示。設定頁的四個側欄項目違反這兩條需求（HC-SETTINGS-02）。頁面內的按鈕沒有主規格規定。側欄收件匣一帶的選單見 PLAN-04。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-AUTOMATION-09（[AUTOMATION 健檢](../features/health/AUTOMATION.md)）、HC-CASES-10（[CASES 健檢](../features/health/CASES.md)）、HC-CHANNELS-02（[CHANNELS 健檢](../features/health/CHANNELS.md)）、HC-CONTACTS-06（[CONTACTS 健檢](../features/health/CONTACTS.md)）、HC-CONTACTS-07（[CONTACTS 健檢](../features/health/CONTACTS.md)）、HC-INBOX-04（[INBOX 健檢](../features/health/INBOX.md)）、HC-KNOWLEDGE-05（[KNOWLEDGE 健檢](../features/health/KNOWLEDGE.md)）、HC-MARKETING-05（[MARKETING 健檢](../features/health/MARKETING.md)）、HC-MARKETING-06（[MARKETING 健檢](../features/health/MARKETING.md)）、HC-PORTAL-07（[PORTAL 健檢](../features/health/PORTAL.md)）、HC-SETTINGS-02（[SETTINGS 健檢](../features/health/SETTINGS.md)）。證據：各報告以只有檢視權限的自訂角色或 seed 角色開頁面，按鈕可見、按下後端回 403（健檢實測）；位置見各報告的「位置」欄，例如 `apps/web/src/components/settings/ChannelManagement.tsx:314-330`、`apps/web/src/components/layout/Sidebar.tsx:107-113`。

<a id="team-01"></a>
### TEAM-01：團隊沒有建立與管理成員的途徑，進站訊息也不依團隊分流

`Team` 與 `AgentTeamMember` 沒有任何寫入端。API、workers、種子資料與前端都沒有建立團隊、加入成員或移除成員的功能。

依賴團隊的功能因此都只能直接改資料庫才用得起來：

- 渠道授權給團隊。渠道管理頁的團隊授權只能從 `GET /channels/teams` 列出的既有團隊中選擇。
- 工單依團隊自動指派。`autoAssignCase()` 只在工單有 `teamId` 時觸發，候選人是該團隊的成員。

**進站訊息不依團隊分流。** `Conversation.teamId` 沒有寫入端。`channel-visibility.ts` 的 `assertConversationChannelVisible()` 有一段「對話綁了團隊時，只有該團隊成員能操作」的檢查，因此永遠不會觸發。`apps/api/src/services/inbound-router.ts` 的 `InboundRouterService` 是依團隊分流的骨架：查詢對話與渠道預設團隊的程式只寫在註解裡，也沒有任何呼叫端。`Channel` 也沒有預設團隊的欄位，建立渠道時無法指定。

**規格依據。** 主規格 `channel-team-access` 的兩條需求，現況都沒有做到：

- 「Message Routing via ChannelTeamAccess」：新聯絡人的訊息 SHALL 分流到渠道的預設團隊，並建立帶有該 `teamId` 的對話。
- 「Channel Creation with Default Team」：建立渠道時 SHALL 可以指定 `defaultTeamId`，並自動建立該團隊的授權。

因此由 P3 調為 P2。主規格沒有要求團隊的建立與成員管理，這部分沒有規格依據。

<a id="a2a-01"></a>
### A2A-01：A2A 橋接以最早建立的租戶執行外部任務

`A2A_BRIDGE_ENABLED` 為 `true` 時，`settings/a2a-bridge.worker.ts` 的 `startA2ABridgeWorker()` 在 API 行程常駐輪詢 A2A Hub。收到外部 agent 的任務後，它用 `prismaAdmin` 查出 `isActive` 為 `true`、`createdAt` 最早的租戶，再以該租戶的身分執行 `runAgentReply()`。

橋接的身分（`A2A_AGENT_ID`、`A2A_AGENT_TOKEN`）是整個部署共用的環境變數，任務本身不帶租戶。後果如下：

- 多租戶部署中，所有外部任務都以同一個租戶執行。AI 呼叫使用該租戶的金鑰設定，包含租戶自備的 Gemini 金鑰，用量也記在該租戶名下。
- 那個租戶被停用後，任務改由次早建立的租戶執行，沒有任何通知。
- 每個租戶的「設定 → 整合 → A2A」都顯示同一個橋接的狀態，看起來像是自己租戶的設定。

只有一個租戶的部署不受影響。

**規格依據。** 主規格 `a2a-agent-tenant-routing` 的「Explicit A2A Agent to tenant binding」規定兩件事：

- 每個橋接身分 SHALL 先綁定明確設定的租戶，才能處理外部任務。
- 沒有有效的綁定、或綁定的租戶已停用時，橋接 SHALL 拒絕新任務。

現況沒有任何綁定，依建立時間選租戶；選中的租戶停用後，改由次早建立的租戶執行。現況違反這條需求。

<a id="a2a-02"></a>
### A2A-02：A2A 狀態頁斷線也顯示已連線

`apps/api/src/modules/settings/a2a-status.service.ts` 的 `buildA2AStatus()` 以 `|| Boolean(agentId)` 判斷連線狀態。橋接連線失敗時 worker 把狀態設成 `not_reported`，但只要環境變數有 `A2A_AGENT_ID`，這段判斷就把它蓋成 `connected`。單元測試 `apps/api/tests/unit/modules/settings/a2a-status.test.ts:14` 把這個行為寫成預期。A2A 的租戶綁定問題見 A2A-01。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-SETTINGS-05（[SETTINGS 健檢](../features/health/SETTINGS.md)）。證據：`apps/api/src/modules/settings/a2a-status.service.ts:28-32`（讀程式）；UAT Demo 顯示 `connected`，無法從頁面判斷實際是否連線。

## 帳號與登入

功能說明見[平台帳號認證](../features/platform/AUTH.md)與[平台帳號管理](../features/platform/PLATFORM-USERS.md)。租戶端各種憑證的簽發、驗證與失效時間，見[認證與憑證](../modules/AUTHENTICATION.md)。

<a id="auth-01"></a>
### AUTH-01：租戶端沒有密碼復原流程

租戶使用者的密碼一律由「建立這個帳號的人」設定：

| 帳號 | 建立者 | 密碼來源 |
| --- | --- | --- |
| 租戶的第一位 ADMIN | 平台人員在 `/admin/tenants` 開通 | 操作者在表單上自己填 |
| 其餘成員 | 租戶自己的 ADMIN | 建立者在表單上自己填 |

兩端的介面都寫明密碼要由建立者轉交：`/admin/tenants` 開通成功的訊息是「（密碼請自行轉交給管理員）」，開通信的內文是「登入密碼由開通人員為您設定，請向開通人員索取；登入後建議立即修改密碼」。這一點沒有落差，落差在後面。

**「建議修改」沒有任何強制機制。** `Agent` 沒有 `mustChangePassword` 欄位，也沒有對應的 guard。建立者知道的那組密碼不會過期，也不會有任何提示要求更換。平台帳號的同一件事是強制的：`mustChangePassword` 加上 `blockIfMustChangePassword`，不改密碼就只能呼叫改密碼那一條。

**租戶端沒有忘記密碼流程。** 三處都沒有：

| 層 | 平台端 | 租戶端 |
| --- | --- | --- |
| 路由 | `POST /platform/auth/forgot-password`、`/reset-password` | 無。`auth.routes.ts` 只有 login、passkey、refresh、logout、me |
| 資料表 | `platform_users.resetTokenHash`、`resetTokenExpiresAt` | 無。`Agent` 沒有對應欄位 |
| 頁面 | `/admin/forgot-password`、`/admin/reset-password` | 無。`/login` 沒有「忘記密碼」連結 |

因此復原只能靠別人代為重設：

| 情況 | 復原途徑 |
| --- | --- |
| 一般成員忘記密碼 | 租戶的 ADMIN 用 `PATCH /agents/:id/password` 重設（需 `agent.password.reset` 權限） |
| 租戶唯一的 ADMIN 忘記密碼 | **沒有任何介面可以復原** |

平台後台幫不上忙。它對租戶成員只有兩個端點：改 email（`PATCH /tenants/:id/agents/:agentId`）與重寄開通信（`POST /tenants/:id/agents/:agentId/resend-welcome`）。重寄的那封信不帶密碼，也不會重設密碼，收件者拿到信之後仍然登入不了。平台沒有重設租戶成員密碼的路由。唯一的辦法是直接改資料庫。

Passkey 不是復原途徑。註冊 passkey 的端點掛在 `fastify.authenticate` 之下，要先登入才能註冊，已經被鎖在外面的人用不到。

**修正方向（2026-09-24 決定，尚未實作）**

補上租戶端的忘記密碼流程，照 `platform-password-recovery.service.ts` 的既有作法：`Agent` 增加 `resetTokenHash` 與 `resetTokenExpiresAt`、兩條公開路由、一個信件模板，以及 `/forgot-password` 與 `/reset-password` 兩頁。`Agent.email` 全域唯一，不需要處理「同一個信箱屬於哪個租戶」的歧義。

同時建議加上 `Agent.mustChangePassword`，讓建立者設定的密碼在第一次登入後就失效。這一項單獨做沒有意義，反而會提高忘記密碼的機率，只有在復原流程存在之後才成立。

兩個前置條件：

- **寄信管道要先確認。** `EMAIL_DELIVERY_MODE` 預設是 `log`，此時所有信件只寫進 log，包含現有的開通信與試用提醒信。倉庫內的 `.env.api` 沒有設定這個變數，因此本機一律走 `log`；`.env.api.example` 的範本值是 `resend`。生產環境的值在伺服器上的 `.env.api`，不在倉庫內。

  部署說明不會提醒設定它。`docker-compose.prod.yml` 開頭的步驟只寫「複製 `.env.prod.example` 成 `.env.prod`，填入 `DOMAIN` 與 `CERTBOT_EMAIL`」，而 `.env.prod` 只給 nginx 與 certbot 使用；api 讀的是 `.env.api`，沒有對應的生產範本。`.env.prod.example` 本身也沒有任何 email 變數。照這份步驟部署的人不會被提醒寄信管道需要設定，而寄不出信不會有任何錯誤，`sendEmail()` 在 `log` 模式下正常返回。

  設定值本身有驗證：`config/env.ts` 的 `superRefine` 規定 `resend` 模式必填 `RESEND_API_KEY` 與 `EMAIL_FROM`、`smtp` 模式必填 `SMTP_HOST`，缺少時 API 啟動就失敗。因此只要線上 API 啟動成功且模式不是 `log`，寄信設定就是完整的。要確認的只有模式本身。

- **新端點要自己設定速率限制。** 新增的是公開端點，擋濫用只能靠速率限制。`auth.routes.ts` 以 `global: false` 註冊速率限制外掛，新路由沒有設定 `config.rateLimit` 就不受限制。速率限制使用的來源 IP 已經無法偽造（`44582d1`）。

<a id="auth-02"></a>
### AUTH-02：停用租戶不會中斷既有的連線與 token

`PATCH /platform/tenants/:id/active` 把 `isActive` 設成 `false` 之後，三個存取面的反應不同：

| 存取面 | 會不會被擋 | 最長延遲 |
| --- | --- | --- |
| REST（access token） | 會 | 一個 access token 的有效期。`ACCESS_TOKEN_EXPIRES_IN` 預設 15 分鐘 |
| Socket.IO 既有連線 | **不會** | 連線不中斷就一直有效 |
| CLI token | **不會** | CLI session 自己的有效期。`DEFAULT_EXPIRES_DAYS` 是 30 天 |
| Partner API 金鑰 | **不會** | 金鑰自己的有效期。建立時不指定就永不過期 |

REST 這一面是有界的：`authenticate` 只驗簽章不回查資料庫，但 `login()` 與 `POST /auth/refresh` 都會擋下停用的租戶，換不到新的 access token。

**Socket.IO 只在 handshake 驗一次。** `socket.plugin.ts` 的 `io.use()` 驗完 JWT 就把 `agentId`、`tenantId` 寫進 `socket.data`，之後沒有任何地方重驗，也沒有在租戶停用時主動斷線。連線建立後自動加入的 `tenant:{tenantId}` 與 `agent:{agentId}` 兩個房間不需要 `subscribe`，因此推播到這兩個房間的事件會持續送達。`subscribe` 其他房間時 `authorizeSocketRoom()` 會回查資料庫，但那只檢查渠道權限，不檢查租戶是否停用。

斷線後重連會重跑 handshake，此時過期的 token 會被擋下。所以實際的暴露時間取決於連線活多久，WebSocket 長連線可以維持數天。

**CLI token 沒有檢查租戶狀態。** `verifyCliSession()` 依序檢查 `revokedAt`、`expiresAt` 與 `agent.isActive`，**沒有檢查 `tenant.isActive`**。停用租戶之後，該租戶成員手上的 CLI token 仍然可以呼叫 API，直到 token 自己過期或被撤銷。

停用個別成員的情況比較好但不完整：CLI 端有 `agent.isActive` 的檢查會擋下，Socket 端同樣不會斷線。

**Partner API 金鑰不檢查租戶，也不檢查建立者。** `partner-api-key.service.ts` 的 `verifyPartnerApiKey()` 只檢查金鑰是否啟用、是否過期。`PartnerApiKey.createdById` 沒有外鍵，清除建立者時金鑰不會跟著刪除；之後以這把金鑰呼叫，`request.agent.id` 指向已經不存在的成員。

對照平台端：`authenticatePlatformSuperuser` 每個請求都回查 `platform_users`，停用即時生效，而平台後台沒有 Socket 或 CLI 通道。兩邊的差距不是刻意設計，是租戶端多了兩個當初沒有一起處理的入口。

**規格依據。** 主規格 `auth-session` 的「停用租戶的長效憑證與既有連線失效」規定：租戶停用之後，系統 SHALL 拒絕 CLI token 與 Partner API 金鑰，並 SHALL 中斷既有的 Socket.IO 連線。現況違反這條需求。REST 的延遲在同一份主規格的「停用租戶的成員不能登入或換發 token」中明訂為可接受，最長一個 access token 的有效期。

<a id="auth-03"></a>
### AUTH-03：平台帳號改密碼後，已發出的 token 仍然有效

`auth.plugin.ts` 的 `authenticatePlatformSuperuser` 在驗完簽章後會查一次資料庫，但只檢查 `isActive` 與 `mustChangePassword`。`PlatformUser` 沒有 `tokenVersion` 或 `passwordChangedAt` 這類欄位，簽發時間無從比對。平台也沒有登出路由，登出只是前端丟掉 token。

所以以下三種操作都不會讓已發出的 token 失效：

| 操作 | 位置 |
| --- | --- |
| 自助改密碼 | `platform-password-recovery.service.ts` 的改密碼函式 |
| 忘記密碼後重設 | 同一檔案的重設函式 |
| 登出 | 沒有伺服器端路由 |

情境是平台帳號外洩。管理者發現後重設密碼，攻擊者手上的 JWT 仍然可以用到過期為止，期限是 `PLATFORM_JWT_EXPIRES_IN`（預設 `2h`）。能立刻止血的只有停用帳號，而停用會連帳號本人一起擋掉。

`auth.plugin.ts` 的註解寫「帳號停用或改密碼後立即生效」。這裡的「改密碼」指的是 `mustChangePassword` 旗標被重新標記，不是撤銷 token，讀起來容易誤會。

<a id="auth-04"></a>
### AUTH-04：平台帳號沒有權限分級，也沒有第二因子

所有平台帳號的 JWT 都帶 `role: 'PLATFORM_SUPERUSER'`，平台側沒有權限表。平台端也沒有 MFA 或 passkey；passkey 只有租戶端有。

這個身分可以跨租戶開通、停用、改方案、看用量，也能建立與停用其他平台帳號。單一密碼就是全部權限。平台的登入端點只依來源 IP 限制每分鐘 10 次，沒有帳號層級的鎖定：從多個 IP 輪流嘗試，就能持續猜同一個帳號的密碼。租戶端的密碼登入已經有帳號鎖定（`44582d1`），平台端沒有。

**同級帳號之間可以互相接管。**

1. 平台帳號 A 以 `PATCH /platform-users/:id` 把帳號 B 的 email 改成自己的。系統不通知 B，B 手上的 token 也不受影響，因為 token 認的是帳號 id。
2. A 對這個 email 呼叫忘記密碼，重設信寄到 A 手上。
3. A 重設 B 的密碼，之後以 B 的身分登入。

B 手上的 token 在過期前仍然可用（見 AUTH-03），過期後 B 就登不進來，而 B 自己走忘記密碼，信會寄到 A 的信箱。

A 的權限沒有因此提高，所有平台帳號本來就同級。問題在稽核歸屬：之後的操作都記在 B 名下。事後的線索只有一條，就是第一步留下的 `platform_user.update` 稽核，payload 記著新的 email。第二、三步的忘記密碼與重設沒有稽核（見 SEC-02）。

<a id="auth-06"></a>
### AUTH-06：兩個「JWT 或其他憑證」裝飾器的 JWT 分支不填 `roleId`

`auth.plugin.ts` 有兩個裝飾器同時接受 JWT 與另一種憑證。兩者的 JWT 分支都只寫入 `id`、`tenantId` 與 `role`，沒有寫入 `roleId`：

| 裝飾器 | 另一種憑證 | 使用的路由 | JWT 分支的後果 |
| --- | --- | --- | --- |
| `authenticateJwtOrCliSession` | CLI token | `GET /auth/me`、MCP 端點 | 目前沒有影響：`/auth/me` 不檢查權限，MCP 會先擋下不是 CLI token 的請求 |
| `authenticateJwtOrPartnerKey` | Partner API 金鑰 | `POST /knowledge/partner-ingest` | 這條路由掛 `requirePermission('knowledge.admin')`。`roleId` 為空時權限集合為空，**網頁登入的成員即使有 `knowledge.admin` 也一律 403** |

`authenticate` 本身有填 `roleId`。三個裝飾器的 JWT 分支是各自複製的程式碼，後來 `authenticate` 加上 `roleId` 時，另外兩份沒有跟著改。

`partner-ingest` 的設計對象是外部夥伴系統，網頁前端沒有呼叫它，所以目前只有以 JWT 測試這條路由的人會遇到。但任何新路由改用這兩個裝飾器、同時掛 `requirePermission()`，網頁使用者都會被擋下；CLI 分支則因為 `requirePermission()` 對 CLI 直接放行而完全不受檢查，見 RBAC-02。

**修正方向**：三個裝飾器的 JWT 分支共用一個函式，由它寫入完整的 `request.agent`，包括 `roleId`。

<a id="auth-07"></a>
### AUTH-07：`JWT_EXPIRES_IN` 沒有讀取端

`apps/api/src/config/env.ts` 定義了 `JWT_EXPIRES_IN`，預設 `7d`，程式沒有任何地方讀取。token 的有效期實際由 `ACCESS_TOKEN_EXPIRES_IN` 與 `REFRESH_TOKEN_EXPIRES_IN` 決定。

`docs/10_TECH_STACK.md` 的環境變數範例列出 `JWT_EXPIRES_IN=7d`。讀者照著設定，會以為 token 有效 7 天，而實際的 access token 有效期不受影響。

<a id="auth-08"></a>
### AUTH-08：租戶成員登出或改密碼後，refresh token 仍然有效

客服的 refresh token 是以 `JWT_SECRET` 簽發的 JWT，有效期是 `REFRESH_TOKEN_EXPIRES_IN`（預設 30 天），存在 httpOnly、`SameSite=strict` 的 cookie。`POST /auth/refresh` 驗完簽章後，以 `getActiveAgentForAuth()` 確認成員仍然啟用，就發出新的 access token 與 refresh token。

`Agent` 沒有 `tokenVersion` 或 `passwordChangedAt` 這類欄位，換發時無從比對 token 的簽發時間。因此下列操作都不會讓已發出的 refresh token 失效：

| 操作 | 位置 | 結果 |
| --- | --- | --- |
| 登出 | `POST /auth/logout` | 只清掉瀏覽器的 cookie |
| 成員自己改密碼 | `agent.routes.ts` 的改密碼路由 | 不影響 token |
| 管理員重設成員的密碼 | `agent.routes.ts` 的重設密碼路由 | 不影響 token |

refresh token 外洩之後，持有者可以持續換發 access token，直到 refresh token 過期。成員發現帳號外洩而改密碼，也擋不下持有者。只有停用成員或停用租戶會讓換發失敗。

`e12103c` 之前，refresh token 還能直接當 access token 使用，這個問題因此更嚴重。`e12103c` 之後，refresh token 只能用在 `POST /auth/refresh`。

平台帳號有同樣的問題，見 AUTH-03。

**修正方向**：`Agent` 加上 `tokenVersion`，refresh token 帶上這個值；改密碼、重設密碼與登出時遞增，`POST /auth/refresh` 比對不符就拒絕。

<a id="auth-10"></a>
### AUTH-10：成員的 email 區分大小寫

`Agent.email` 的唯一約束是 `@@unique([email])`，資料庫以原字串比對。寫入與查詢 email 的程式都沒有先轉成小寫：

| 位置 | 用途 |
| --- | --- |
| `auth.service.ts` 的 `login()` | 網頁登入與 CLI 密碼登入，`findUnique({ where: { email } })` |
| `auth.routes.ts` 的 passkey 登入選項 | 依 email 找成員的 passkey |
| `agent.service.ts` 的 `createAgent()` | 建立成員前查重 |
| `platform-tenant.service.ts` | 平台改成員的 email、開通租戶時建立第一位管理員，兩處都先查重 |

只有登入失敗的計數（`login-attempts.ts`）先轉成小寫，因此主規格 `auth-session` 的「登入失敗達上限時鎖定帳號」把大小寫不同的 email 視為同一個帳號。

2026-10-15 在本機開發環境確認：

- 以 `Admin@open333crm.dev` 與正確密碼登入既有的 `admin@open333crm.dev`，回 401 `INVALID_CREDENTIALS`。
- 已有 `agent@open333crm.dev` 時，建立 `AGENT@open333crm.dev` 回 201，資料庫多了一位成員。

結果：

- 成員輸入的 email 大小寫和建立時不同，就無法登入，畫面顯示的是「電子郵件或密碼不正確」。
- 同一個信箱可以以不同的大小寫建立兩位成員，分屬不同租戶也可以。主規格 `auth-session` 的「登入依 email 解析所屬租戶」要求 email 在所有租戶之間唯一，但沒有規定大小寫，因此不算違反主規格。

UAT 上有沒有只差大小寫的成員，還沒有查過。

**修正方向**：建立、修改與登入時都先把 email 去掉頭尾空白並轉成小寫，查詢也以小寫比對。上線前先查出只差大小寫的成員，決定保留哪一位，再把既有的 email 全部轉成小寫。主規格補上「email 不分大小寫」。

<a id="auth-11"></a>
### AUTH-11：停用的租戶仍收得到 WebChat 訊息，排程群發照常送出

停用租戶之後，有兩條路徑不檢查 `tenant.isActive`：

| 路徑 | 現況 |
| --- | --- |
| WebChat（Chatbox）進站 | `chatbox.service.ts` 的 `resolveChatboxChannel()` 只看渠道的 `isActive`，`handleChatboxMessage()` 直接呼叫 `processInboundMessage()`。既有的訪客工作階段可以繼續送訊息，新訪客也能建立工作階段；系統照常建立聯絡人、對話與訊息，後續的自動化與 AI 回覆流程也照常進入。LINE、FB、IG 的 webhook 有檢查（`webhook.service.ts:86`） |
| 排程群發 | `broadcast.scheduler.ts` 只依 `status = 'scheduled'` 與 `scheduledAt` 撈全部租戶的群發，不看租戶是否停用。停用（含試用到期自動停用）的租戶預約的群發照樣送給顧客 |

AUTH-02 記錄的是停用租戶後既有的連線與憑證；這一項是進站訊息與背景工作。

**規格依據。** 主規格 `inbound-message-processing` 的「停用租戶的進站事件直接丟棄」，以及 `trial-lifecycle` 的「到期停用」（inbound 訊息被丟棄）。WebChat 進站違反這兩條需求。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-TENANTS-01（[PLATFORM-TENANTS 健檢](../features/health/PLATFORM-TENANTS.md)）、HC-PLATFORM-TENANTS-04（[PLATFORM-TENANTS 健檢](../features/health/PLATFORM-TENANTS.md)）。證據：`apps/api/src/modules/chatbox/chatbox.service.ts:354-366`、`:598-640`；停用租戶後同一工作階段與新工作階段各送一則都回 200，資料庫多 3 則 INBOUND 訊息（健檢實測）。排程群發 `apps/api/src/modules/marketing/broadcast.scheduler.ts:25-31`（讀程式）。HC-PLATFORM-TRIALS 報告引用同一個問題。

<a id="auth-12"></a>
### AUTH-12：平台改密碼打錯目前密碼會被登出

`platform-password-recovery.service.ts` 對「舊密碼不正確」回 401 `UNAUTHORIZED`。平台前端的攔截器（`apps/web/src/app/admin/lib/platform-api.ts`）把所有 401 當成 token 失效：清掉 `platformToken`、整頁導回 `/admin/login`，使用者看不到錯誤訊息。強制改密碼（`?forced=1`）時打錯臨時密碼也一樣被登出。業務錯誤應改用 400 或 403。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-AUTH-01（[PLATFORM-AUTH 健檢](../features/health/PLATFORM-AUTH.md)）。證據：`apps/api/src/modules/platform/platform-password-recovery.service.ts:35`、`apps/web/src/app/admin/lib/platform-api.ts:51-55`；本機瀏覽器填錯目前密碼後網址變成 `/admin/login`、localStorage 沒有 `platformToken`（健檢實測）。

<a id="auth-13"></a>
### AUTH-13：平台「重寄開通信」換掉在用帳號的密碼

`platform-user.service.ts` 的重寄開通信對**任何**啟用中的平台帳號都會產生新的臨時密碼、覆寫舊密碼，並設回 `mustChangePassword`。按鈕常駐在帳號詳細頁，沒有確認框，文案只寫「重寄開通信」。

- 對已經改好密碼、天天在用的同事按下去，對方原密碼立即失效，手上的 token 只剩改密碼一條路。
- 對自己按下去，下一個請求就被導到強制改密碼頁，而臨時密碼只在信裡。寄信失敗時見 AUTH-14。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-USERS-01（[PLATFORM-USERS 健檢](../features/health/PLATFORM-USERS.md)）。證據：`apps/api/src/modules/platform/platform-user.service.ts:129-145`、`apps/web/src/app/admin/platform-users/[id]/page.tsx:108-122`；帳號 B 已改密碼，A 呼叫 `resend-welcome` 後 B 的 token 回 403 `MUST_CHANGE_PASSWORD`、原密碼登入 401；按鈕沒有確認框（健檢實測）。

<a id="auth-14"></a>
### AUTH-14：開通信寄送失敗仍回成功

三個寄信操作都透過 `safeSend()` 寄出，`safeSend()` 把 `sendEmail()` 的例外吞掉只寫 log：

| 操作 | 結果 |
| --- | --- |
| 開通平台帳號 | `void` 不等待寄信，畫面顯示「系統已產生臨時密碼並寄信至…」 |
| 重寄平台帳號的開通信 | 回成功。對方的舊密碼已被覆寫（AUTH-13），信又沒寄到，帳號形同鎖死 |
| 重寄租戶成員的開通信 | 回 `{ok: true}`，畫面顯示「開通信已重寄至…」，稽核照寫 |

`EMAIL_DELIVERY_MODE` 為 `resend` 時，缺 `RESEND_API_KEY`、`EMAIL_FROM` 或 Resend 回錯都會拋例外。操作者不會知道信沒有寄出。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-USERS-02（[PLATFORM-USERS 健檢](../features/health/PLATFORM-USERS.md)）、HC-PLATFORM-TENANTS-06（[PLATFORM-TENANTS 健檢](../features/health/PLATFORM-TENANTS.md)）。證據：`apps/api/src/modules/platform/platform-user-emails.ts:96-102`、`platform-user.service.ts:58, 140-143`、`apps/api/src/modules/trial/trial-emails.ts:145-151, 175-181`、`platform-tenant.service.ts:113-129`（讀程式；本機是 log 模式，不會失敗）。

<a id="auth-15"></a>
### AUTH-15：同時停用兩個平台帳號，其中一邊失敗

停用平台帳號時，`platform-user.service.ts` 以 Serializable 交易對整張表 `count` 啟用中的帳號，確認不是最後一個。兩筆交易同時進行時互相讀到對方要改的列，PostgreSQL 判定序列化失敗。程式沒有重試，也沒有轉成可讀的錯誤，回 400 `DATABASE_ERROR`「資料處理失敗，請確認輸入內容後重試」。功能文件說衝突只發生在「同時停用最後兩個帳號」，實際上停用任意兩個帳號都會發生。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-USERS-03（[PLATFORM-USERS 健檢](../features/health/PLATFORM-USERS.md)）。證據：`apps/api/src/modules/platform/platform-user.service.ts:107-125`；啟用帳號 9 個時同時停用兩個不同帳號，連跑 4 輪都是一邊 200、一邊 400（健檢實測）。

<a id="auth-16"></a>
### AUTH-16：平台停用租戶沒有確認步驟

`/admin/tenants` 列表每一列「合約」旁就是「停用」，按一下立即停用；租戶詳細頁的「停用租戶」與「儲存」並排，也沒有確認。停用之後租戶全員登不進去，LINE、FB 訊息被丟棄。UAT 就是正式環境（APP-10），列表上有真實客戶。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-TENANTS-02（[PLATFORM-TENANTS 健檢](../features/health/PLATFORM-TENANTS.md)）。證據：`apps/web/src/app/admin/tenants/page.tsx:37-40, 152-154`、`apps/web/src/app/admin/tenants/[id]/page.tsx:152-166, 251-257`；列表與詳細頁各按一次，`dialog` 事件 0 次，租戶立即變成停用（健檢實測）。

<a id="sec-02"></a>
### SEC-02：平台帳號的登入與密碼重設沒有稽核紀錄

`apps/api/src/modules/platform/platform-audit.service.ts` 的 `writePlatformAudit()` 把平台操作寫進 `platform_audit_logs`。`platform.routes.ts` 的異動路由呼叫它，服務層不重複寫，`trial-admin.service.ts` 的 `restorePurgedTenant()` 註解說明了這個分工。

以下四條異動路由沒有呼叫 `writePlatformAudit()`，對應的服務內部也沒有寫：

| 路由 | 服務 |
| --- | --- |
| `POST /api/v1/platform/auth/login` | `platform-auth.service.ts` |
| `POST /api/v1/platform/auth/forgot-password` | `platform-password-recovery.service.ts` |
| `POST /api/v1/platform/auth/reset-password` | `platform-password-recovery.service.ts` |
| `POST /api/v1/platform/trial-signups/:id/resend` | `trial-admin.service.ts` |

平台帳號可以開通與停用租戶、修改方案、讀取跨租戶用量。這個身分的登入與密碼重設目前在 `platform_audit_logs` 裡查不到紀錄，事後無法判斷某次異動之前是誰登入、密碼是否被重設過。

`/platform-users/:id/audit-logs` 查得到的是該帳號的操作紀錄，不包含登入事件。

**規格依據。** 主規格 `platform-password-recovery` 的「使用者可用有效重設連結完成密碼重設」規定：重設成功後 SHALL 寫入 `PlatformAuditLog`。`reset-password` 沒有寫，現況違反這條需求，因此由 P3 調為 P2。同一份規格的「已登入平台管理員可自助改密碼」也要求寫稽核，`change-password` 有寫，符合規格。登入、忘記密碼與重寄開通信，主規格沒有要求寫稽核。

<a id="sec-03"></a>
### SEC-03：rate-limit 在各路由模組內各自註冊

`@fastify/rate-limit` 沒有在根層註冊，而是在五個路由模組內各自註冊一次。兩種註冊方式的效果不同：

| 模組 | 註冊處 | 註冊方式 | 效果 |
| --- | --- | --- | --- |
| 租戶認證 | `auth.routes.ts` | `global: false` | 只有設定 `config.rateLimit` 的路由受限 |
| 試用申請 | `trial.routes.ts` | `global: false` | 同上 |
| 平台後台 | `platform.routes.ts` 的 `platformRoutes()` | `global: false` | 同上 |
| 公開 Chatbox | `chatbox.routes.ts` | 沒有寫 `global`，外掛預設為 `true` | 模組內每條路由都以來源 IP 限制每分鐘 60 次；個別路由再以 `config.rateLimit` 收緊 |
| 舊版 Webchat | `webchat.routes.ts` | 同上 | 同上 |

目前五處都運作正常，因為每條帶 `config.rateLimit` 的路由，與它依賴的 `register` 呼叫在同一個 Fastify encapsulation scope 內。

問題是這個寫法與 `apps/api/src/plugins/` 的慣例不同。那裡的外掛以 `fastify-plugin` 匯出、在 `index.ts` 的根層註冊，因此不受 scope 限制。

因此存在一個沒有警告的陷阱。把帶 `config.rateLimit` 的路由搬到另一個檔案、再從 `index.ts` 另行 `register`，那些路由就落到沒有註冊這個外掛的 scope。`config.rateLimit` 會被**靜默忽略**，不報錯也不警告，登入端點就失去暴力破解保護。

搬移之前，要先把 rate-limit 的註冊移到根層，並以連續請求實際驗證 429 仍會出現。`platform` 模組沒有任何測試，這類改動不會被測試擋下。

<a id="sec-06"></a>
### SEC-06：帳號鎖定只依 email 計數

`44582d1` 為租戶的密碼登入加上帳號鎖定。`auth/login-attempts.ts` 以 email 為鍵，在 Redis 累計嘗試次數：15 分鐘內第 6 次嘗試起一律回 429 `ACCOUNT_LOCKED`，密碼正確也不放行，直到區間結束。`POST /auth/cli/login` 共用同一個計數。

計數只看 email，不看來源。知道某位成員 email 的人，每 15 分鐘故意輸錯 6 次密碼，就能讓這位成員一直無法以密碼登入，也無法以密碼登入 CLI。email 不存在時同樣計數，因此回應不透露帳號是否存在。攻擊者也因此不需要先確認 email 是否存在。

可繞過的做法：被鎖的成員仍可用 Passkey 登入，Passkey 不經過這個計數。

**規格依據。** 這是規格明文規定的行為。主規格 `auth-session` 的「登入失敗達上限時鎖定帳號」規定：系統 SHALL 依 email 計算失敗次數，不存在的 email 以相同方式計算，CLI 的密碼登入共用同一個計數。現況符合這條需求；`login-attempts.ts` 的註解也記下這是已知的取捨。這一項列為 P2，是因為任何人都能讓指定的成員無法以密碼登入，與是否違反規格無關。

帳號被鎖時，`login()` 會寫一筆 warn log（`[Auth] 登入因失敗次數過多被擋`，帶 email 雜湊），可以從 log 發現有人反覆鎖同一個帳號。

**修正方向**：`login-attempts.ts` 的註解建議改以 email 加來源 IP 計數。改用這個鍵之後，攻擊者的失敗嘗試只鎖住攻擊者自己的 IP，成員從其他 IP 仍可登入。代價是：從多個 IP 分散猜同一個帳號時，每個 IP 各自計數，只剩每個 IP 的速率限制能擋。另一個做法是保留 email 計數，但鎖定期間改為要求額外驗證，而不是直接拒絕。兩種做法都會改變主規格規定的行為，修正的 PR 要以 MODIFIED 修改「登入失敗達上限時鎖定帳號」。

<a id="sec-07"></a>
### SEC-07：CLI token 與 API 金鑰的有效天數沒有上限

`settings.routes.ts` 建立 CLI token 與 API 金鑰時，`expiresInDays` 只驗是正整數，沒有上限。CLI 頁寫「每個 Token 都有到期日」，但 API 接受 100000 天（到期日 2300 年）；3650000 天讓日期溢位，回 500 `INTERNAL_ERROR`。scope 不受限的問題見 RBAC-02。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-SETTINGS-06（[SETTINGS 健檢](../features/health/SETTINGS.md)）。證據：`apps/api/src/modules/settings/settings.routes.ts:397-399, 468-470, 533, 579`；`POST /settings/cli-sessions {expiresInDays:100000}` 回 201、`expiresAt: 2300-08-15`，`3650000` 回 500（健檢實測，測試資料已撤銷）。

<a id="sec-08"></a>
### SEC-08：圖文選單的背景圖網址可以打內網

`rich-menu.service.ts` 發布圖文選單時以 `fetch(imageUrl)` 下載背景圖，網址只驗 `z.string().url()`，沒有呼叫 `isBlockedUrl()`（下游轉發已在用）。持 `richmenu.manage` 的成員（主管預設就有）可以讓 API 請求內網位址；錯誤訊息回傳對方的 Content-Type 或「無法取得背景圖」，可以用來探測內網服務與連接埠。整個過程發生在呼叫 LINE API 之前，不需要有效的 Access Token。Canvas 的 `API_FETCH` 節點有同樣的缺口，見 AUTO-11。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-LINE-04（[LINE 健檢](../features/health/LINE.md)）。證據：`apps/api/src/modules/line/rich-menu.service.ts:346`；草稿 `imageUrl: http://localhost:3001/health` 發布時回「背景圖格式必須是 JPEG 或 PNG（實際：application/json…）」，`localhost:5433` 回「無法取得背景圖」（健檢實測）。

## 金鑰與 License

<a id="lic-01"></a>
<a id="lic-02"></a>
### LIC-01、LIC-02：兩份 LicenseService

`license.guard.ts` 使用 `apps/api/src/services/license.ts`。該實作直接建立寫死的授權資料，不會連線到授權伺服器。

`packages/core/src/license/license-service.ts` 會呼叫 `LICENSE_FETCH_URL`，但沒有實際使用者。

**主規格已移除。** 主規格 `license-service` 與 `team-license` 描述系統從授權伺服器取得授權資料，與現況不符。issue #217 確認功能天花板與額度改由 `tenant-plan`、`plan-limits-core`、`granular-plan-entitlement` 負責，移除了這兩份主規格。這一項沒有違反主規格，維持 P4。

## 試用

功能說明見[試用管理](../features/platform/TRIALS.md)與[平台設定](../features/platform/SETTINGS.md)。

<a id="trial-02"></a>
### TRIAL-02：試用政策存在無型別的 KV

試用政策的每個參數是 `PlatformSetting` 的一列，`value` 是任意 JSON。`PUT /settings/:key` 的驗證只有 `z.object({ value: z.unknown() })`，沒有鍵名白名單，也沒有值的型別與範圍。讀取端 `getTrialPolicy()` 只做 `typeof` 檢查，不符就改用 `DEFAULTS`。

因此寫錯的值會往兩個相反的方向出錯，兩個方向都沒有任何訊息：

| 寫入的值 | 讀取端的判斷 | 結果 |
| --- | --- | --- |
| 型別錯，例如 `trial.durationDays` 寫成 `"30"` | `typeof` 不是 `number` | 靜默失效：設定存進去了，行為仍是預設的 14 天 |
| 型別對但範圍錯，例如 `0` 或負數 | `typeof` 通過 | 靜默生效：照用錯誤的值 |
| `trial.planSlug` 寫了不存在的方案 | `typeof` 通過 | 之後每一筆試用驗證都在最後一步失敗，回 500 `TRIAL_MISCONFIGURED`（`trial.service.ts` 的 `verifyAndProvision()`） |

範圍錯的值實際造成的結果：

| 參數 | 錯誤的值 | 結果 |
| --- | --- | --- |
| `trial.durationDays` | `0` 或負數 | 新開通租戶的 `trialEndsAt` 已經過去，下一輪排程（最多一小時）就被停用 |
| `trial.dataRetentionDays` | `0` | 租戶到期停用後，下一輪排程就標記軟刪 |
| `trial.verifyTokenTtlHours` | `0` | 驗證信寄出時連結就已過期，`verifyAndProvision()` 回 410 |

**介面擋不住。** `/admin/trial` 的「設定」分頁在欄位 `onBlur` 時直接呼叫 `PUT`，沒有確認步驟，數字欄位也沒有 `min`。清空數字欄位再離開時，`parseInt('')` 得到 `NaN`，JSON 序列化成 `null`。這筆寫入會成功（200，存成 JSON `null`），畫面顯示「已更新」，讀取端的 `typeof` 檢查不通過，靜默退回預設值。原本這裡記為「寫入會失敗」，2026-10-30 功能健檢實測更正（[PLATFORM-SETTINGS 健檢](../features/health/PLATFORM-SETTINGS.md)）。`saveSetting()` 沒有 `catch`，寫入真的失敗時，頁面既不顯示成功也不顯示失敗。`trial.planSlug` 不在這個分頁上，只能直接呼叫 API，而 API 不檢查方案是否存在。

**管理面也有缺口：**

- 沒有刪除端點。寫錯的鍵刪不掉，也沒有「恢復預設」，只能手動寫回預設值，而預設值只存在於原始碼的 `DEFAULTS`。
- 稽核只記鍵名，不記新舊值（見[平台設定](../features/platform/SETTINGS.md)）。
- 每個參數各自一次 `PUT`。彼此相關的參數（例如試用天數與提醒檔位）無法一起改，中間狀態會被排程讀到。

**通用端點也能寫壞租戶的個資遮罩設定（2026-10-30 功能健檢）。** `ai.privacy.<tenantId>` 與 `trial.*` 存在同一張表，通用的 `PUT /settings/:key` 不檢查鍵名，也不檢查值。對 `ai.privacy.<tenantId>` 寫入不是嚴格 `{enabled: boolean}` 的值之後，`ai-privacy.service.ts` 的 `readAiPrivacyPolicy()` 每次讀取都拋 503 `AI_PRIVACY_POLICY_UNAVAILABLE`：該租戶的進站訊息、客服回覆、AI 回覆、自動化訊息與素材存檔全部失敗，平台租戶詳細頁的開關也讀不出來。這次寫入只留一筆不含值的 `setting.update` 稽核，繞過專用路由在同一交易寫的 `tenant.ai_privacy.update`。以專用路由 `PATCH /platform/tenants/:id/ai-privacy` 可以修回。

一次平台操作就能讓一個租戶的訊息全部寫入失敗，因此這一項由 P3 調為 P2。下面的修正方向「拿掉通用的 `PUT /settings/:key`」一併解決這個問題。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-SETTINGS-01（[PLATFORM-SETTINGS 健檢](../features/health/PLATFORM-SETTINGS.md)）。證據：`apps/api/src/modules/platform/platform.routes.ts:492-506`、`apps/api/src/modules/platform/ai-privacy.service.ts:10-17`、`apps/api/src/modules/webhook/inbound-message-writer.ts:53`；測試租戶 `PUT /platform/settings/ai.privacy.<tid> {"value":"on"}` 回 200 之後，同一則模擬訊息回 503，以專用路由修回後恢復（健檢實測）。

**修正方向（2026-09-30 討論，尚未實作）**

KV 表保留為底層儲存，不承擔型別。上面加一層殼層，每個設定群有自己的 API 路徑，型別、範圍、預設值與檢查都由殼層負責：

```text
/admin/trial 設定分頁
        │  PUT /settings/trial
        ▼
殼層：trial 設定群
  schema、預設值、範圍
  跨欄位檢查（提醒檔位不大於試用天數）
  參照檢查（planSlug 對應的方案存在）
  稽核 { before, after }
        │
        ▼
PlatformSetting（KV，不知道型別）
```

要先定下來的決策：

- **拿掉通用的 `PUT /settings/:key`。** 只要這個端點還在，殼層的驗證就能被繞過。讀取可以保留給除錯用，寫入只能走各設定群的路徑。
- **底層採一群一列。** `trial` 一列，值是整份 `TrialPolicy`。整份一起驗證、一起寫入，沒有中間狀態，讀取也只查一次。部分更新用 `PATCH`，先與現值合併，再驗證合併後的整份。跨欄位檢查在這種形狀下最容易做。
- **殼層由註冊表產生。** 每個設定群註冊 `{ group, schema, defaults, validate }`，由同一個 handler 提供 `GET`／`PUT`／`PATCH /settings/:group`。新增一個設定群只要註冊一次，路由、驗證與稽核就一併具備。做法與 `/registry` 由 `FEATURES` 推導清單相同。
- **讀取端解析失敗要留下紀錄。** `getTrialPolicy()` 改成殼層的讀取函式，用同一份 schema 解析。資料庫沒有這一列時使用預設值，屬於正常情況。資料庫有值但解析失敗時，要先記 error log 再退回預設值。寫入端擋住之後，這種情況只會出現在手動改資料庫時，正好需要被看見。

其餘項目併入殼層：`trial.planSlug` 加進設定分頁，PLAN-01 修好之後一併檢查方案未停售；前端 `saveSetting()` 補上 `catch`，顯示殼層回傳的 422 欄位錯誤。

遷移：現有的 `trial.*` 各列要合併成一列 `trial`。可以讓讀取端在一段期間內相容兩種形狀，也可以寫一次性的 migration，合併之後刪除舊列。

<a id="trial-03"></a>
### TRIAL-03：「資料保留天數」到期不會刪除任何資料

`trial.dataRetentionDays` 在 `/admin/trial` 設定分頁的標籤是「到期後資料保留天數」。這個名稱承諾的是「保留期滿後刪除」，實作只有標記：

- `trial.scheduler.ts` 的第二輪掃描在保留期滿時，只把 `tenant.purgedAt` 設成當下，原始碼註解也寫明「標記，不真刪 DB，可復原」。
- `purgedAt` 的讀取端只有平台後台的狀態顯示（`trial-admin.service.ts`）與復原功能 `restorePurgedTenant()`。
- 全 repo 沒有任何程式依 `tenantId` 刪除業務資料，平台也沒有刪除租戶的路由。

因此一個試用過就離開的租戶，他的聯繫人、對話、訊息會一直留在資料庫裡。這些資料的主體是**租戶的客戶**，不是租戶本身。營運方若依這個設定對外說明保留期限，實際上做不到。

`purgedAt` 帶來的唯一行為差異是平台清單上的狀態顯示「已清除」。租戶在試用到期時已經被停用，因此標記前後，租戶端的存取沒有任何改變。入站 webhook 在停用時就已經不處理（`webhook.service.ts` 的 `processWebhookEvent()` 檢查 `tenant.isActive`），也與 `purgedAt` 無關。

`trial.enabled` 的預設值是 `false`。正式環境若從未開放試用，目前沒有受影響的資料。這一點要到線上確認。

<a id="trial-04"></a>
### TRIAL-04：租戶頁的啟用不處理試用狀態

試用生命週期排程每小時執行一次，依序停用到期的租戶、標記保留期滿的租戶（`trial.scheduler.ts`）。平台在租戶頁按「啟用」（`PATCH /platform/tenants/:id/active`，`setTenantActive()`）只設 `isActive`，不改 `trialEndsAt` 與 `purgedAt`。對試用已過期的租戶會發生下列情況：

- 下一輪排程看到租戶仍啟用、`trialEndsAt` 已過，又停用租戶，再寄一次到期通知信給租戶的管理員，並再寫一筆 `tenant.trial.expire` 稽核。啟用最多只維持一小時。
- 租戶原本已清除時，`purgedAt` 一直有值，租戶啟用期間後台仍顯示「已清除」。

試用還沒到期的租戶與非試用的租戶不受影響。要讓過期的試用租戶繼續使用，應該用試用管理頁的「延長」或「轉正式」。`purgedAt` 不影響存取（TRIAL-03），所以標記本身只影響後台顯示。2026-10-16 決定暫時維持現狀。

**已修正的部分**：延長試用原本不清除 `purgedAt`，直接呼叫 API 延長已清除的租戶後，租戶已經可以登入，後台仍顯示「已清除」。`9f3c6c1a` 改為在同一次更新中清除，和轉正式一致。

**不是問題的部分**：復原只清除 `purgedAt`，租戶仍停用，下一輪排程會再標記。這是預期的行為：復原是讓平台人員接著延長或轉正式；誤按復原時，排程再標記也沒關係。主規格 `trial-data-purge` 的「平台復原軟刪標記」已寫明。

**修正方向**：暫時維持現狀。之後要處理時，可以考慮讓啟用一併清除 `purgedAt`，或對試用已過期的租戶拒絕啟用，提示改用「延長」。

<a id="trial-05"></a>
### TRIAL-05：再次申請試用會覆寫待驗證申請的密碼

`trial.service.ts` 的 `requestTrial()` 遇到同一 email 已有待驗證的申請時，直接以新送的值覆寫 `passwordHash` 與 `siteName`，並寄一封新的驗證信給該 email（舊連結失效）。開通時沿用 `signupRow.passwordHash`。

因此任何人知道申請人的 email，就能在對方點信之前再送一次申請：申請人點最新那封信，租戶以攻擊者的密碼開通。攻擊者可以登入這個站台的 ADMIN 帳號，看到申請人之後放進去的客戶資料；申請人自己的密碼反而登不進去。攻擊者也可以對從未申請的 email 先送申請，對方點信就落入同一個情況。申請人唯一看得出異狀的地方，是第二封信主旨帶著攻擊者填的站台名稱。

正式環境可以被利用：2026-10-30 以平台 API 唯讀查詢，UAT（即正式環境，APP-10）的 `trial.enabled` 是 `true`，公開試用申請開放中。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-TRIALS-01（[PLATFORM-TRIALS 健檢](../features/health/PLATFORM-TRIALS.md)）。證據：`apps/api/src/modules/trial/trial.service.ts:87-101`、`:200`；兩個 IP 以同一 email、不同密碼申請，點第二封信開通後，第一個密碼登入 401、第二個密碼 200（健檢實測）。

<a id="trial-06"></a>
### TRIAL-06：再送一次試用申請繞過重寄節流

`/resend` 有「間隔 60 秒、最多 5 次」的節流，但 `/signups` 遇到待驗證的申請時每次都換 token 寄信，只受「每個 IP 每 10 分鐘 5 次」的速率限制。換 IP 就能對任意信箱無限寄驗證信，以平台名義寄信轟炸，也會耗掉寄信額度與網域信譽。UAT 的 `trial.enabled` 是 `true`（2026-10-30 平台 API 唯讀確認），正式環境可以被利用。健檢在本機以 `X-Forwarded-For` 換 IP；正式環境只採信 nginx 附加的來源 IP（`apps/api/src/lib/trust-proxy.ts`），要換真實的來源 IP。

**規格依據。** 主規格 `trial-application` 的「防枚舉統一回應」規定：待驗證且未過期的申請再送一次時，依節流規則重寄。現況違反這條需求。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-TRIALS-02（[PLATFORM-TRIALS 健檢](../features/health/PLATFORM-TRIALS.md)）。證據：`apps/api/src/modules/trial/trial.service.ts:87-118`（節流只在 `:131-135` 的 `resendTrial`）；7 個不同的 `X-Forwarded-For` 對同一信箱送申請，幾秒內寄出 7 封驗證信（健檢實測）。

<a id="trial-07"></a>
### TRIAL-07：手動開通預設試用方案，卻不設到期日

`/admin/tenants` 的手動開通表單，方案預設是「免費試用」，但手動開通不設 `trialEndsAt`（功能文件已說明手動開通不設到期日，問題在預設值）。用預設值開通的租戶：

- 永遠停在功能受限的試用方案，不會到期。
- 不出現在 `/admin/trial`，無法用「轉正式」處理，只能從租戶詳細頁改方案。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-TENANTS-05（[PLATFORM-TENANTS 健檢](../features/health/PLATFORM-TENANTS.md)）。證據：`apps/web/src/app/admin/tenants/page.tsx:26, 80, 168-174`、`apps/api/src/modules/platform/platform-tenant.service.ts:178-206`；以預設方案開通後 `trialEndsAt` 為 null、`GET /trial-tenants` 不含它（健檢實測）。HC-PLATFORM-TRIALS 報告引用同一個問題。

## 方案與額度

功能說明見[方案與上限](../features/platform/PLANS.md)與[方案異動審核](../features/platform/PLAN-CHANGES.md)。

<a id="plan-01"></a>
### PLAN-01：`Plan.isActive` 沒有讀取端

`Plan.isActive` 的 schema 註解寫「停售軟下架」，`PATCH /platform/plans/:id` 可以寫入它。原本這裡寫「`/admin/plans` 也能切換它」；2026-10-30 功能健檢確認頁面自 #145 起沒有停售、名稱、月費的欄位，只能直接呼叫 API（[PLATFORM-PLANS 健檢](../features/health/PLATFORM-PLANS.md)）。但整個 repo 沒有任何查詢以它為條件。

`grep -rn "isActive" apps/api/src apps/web/src` 的命中全部屬於 `Tenant`、`Agent` 或 `PlatformUser`，沒有一處是 `Plan`。三條指派方案的路徑都只以 `slug` 查方案，查到就用：

| 路徑 | 位置 |
| --- | --- |
| 平台改租戶方案 | `platform-tenant.service.ts` 的 `updateTenant()` |
| 核准升級申請 | `plan-change.service.ts` 的 `approveRequest()` |
| 試用開通綁定方案 | `trial.service.ts`，方案來自 `trial.planSlug` |

因此把一個方案設為停售，只會改變資料庫裡的這個欄位。它仍然可以被指派給新的或既有的租戶，既有租戶也完全不受影響。

這與已修正的 SLA-03（SLA 政策的 `isDefault`，見 `AUDIT-REVIEWS.md` 2026-10-15）是同一種形狀：欄位有寫入端與介面，沒有讀取端，操作者以為的效果不會發生。

<a id="plan-02"></a>
### PLAN-02：加購 token 是永久提高每月額度

`approveRequest()` 核准 `token_topup` 時，把加購量加進 `tenant.limitOverrides.monthlyTokens`。

這個欄位是每月額度的上限，不是可消耗的餘額：

- 額度的判斷在 `token-quota.service.ts` 的 `isMonthlyTokenExceeded()`，拿當月累計用量與 `getEffectiveLimit(..., 'monthlyTokens')` 比較。
- 計數器的 Redis key 是 `aiquota:{tenantId}:{YYYY-MM}`，月底過期，每個月從零開始。
- `limitOverrides` 沒有期限欄位，核准後一直留著。

所以核准一次加購，是把該租戶往後每一個月的額度都提高同樣的量，不是給他一次性的配額。

兩邊介面寫的都是「加購 Token」：租戶端 `/dashboard/plan` 的說明是「申請升級方案或加購 AI token 額度」，平台端 `/admin/plan-changes` 顯示 `+N token`。兩者都看不出是一次性還是長期，審核者也沒有「這是第幾次加購、目前累計多少」的資訊。

這一項與 PLAN-01 不同，不是「設定了卻沒有讀取端」，而是資料結構表達的事情與介面用字不同。而且系統沒有計費機制（見 PLAN-10），因此永久提高額度不會造成重複收費，結果是平台往後每個月都無償提供同樣的加購量。

寫入方式另有兩個問題。

**累加沒有交易保護。** `approveRequest()` 的流程是 `findUnique` 讀出 `limitOverrides`、在記憶體算出新值、再 `update` 覆寫整個 JSON 物件。三步之間沒有交易。同一個租戶的兩筆加購申請若同時核准，兩邊都讀到同一個起始值，後寫入的會覆蓋先寫入的，其中一筆加購量消失。覆寫的是整份 JSON，因此將來若有其他路徑寫別的 key，那些值也會一起被蓋掉。同一個模組的 `platform-user.service.ts` 停用最後一個帳號時用了 `Serializable` 交易，兩處的嚴謹程度不一致。

**有效上限的解析邏輯有第二份副本。** `plan-change.service.ts` 的 `approveRequest()` 在 `token_topup` 分支自己重寫了一次「覆寫優先」的判斷，用 `overrides.monthlyTokens !== undefined`；`plan-limits.service.ts` 的 `resolveEffectiveLimit()` 用 `hasOwnProperty`。JSON 欄位存不出 `undefined`，所以兩者目前行為相同，但這是兩份會分歧的邏輯。`approveRequest()` 手上已經有 `limitOverrides` 與 `plan.limits`，可以直接呼叫 `resolveEffectiveLimit()`。

<a id="plan-03"></a>
### PLAN-03：換方案不會回收既有的超額狀態

租戶換方案有三個入口：平台改租戶方案（`updateTenant()`）、核准升級申請（`approveRequest()`）、試用轉正式（`convertToPaid()`）。三者都只寫 `planId`，以下三件事不會跟著改變。

**一、既有資源不會被回收。** 方案的數量上限只在建立時檢查：

| 上限 | 檢查點 |
| --- | --- |
| `maxAgents` | `agent.service.ts` 建立成員前 `count` 比對，超過回 403 `PLAN_LIMIT_EXCEEDED` |
| `maxChannels` | `channel.service.ts` 建立渠道前比對 |
| `allowedChannelTypes` | 只擋新建的渠道類型 |

因此降級到人數較少的方案之後，超出新上限的成員照常登入與使用，渠道也照常收發訊息，只有下一次新增才會被擋。系統不會提示租戶目前超額，也沒有任何地方列得出「哪些租戶超出自己方案的上限」。

**二、`limitOverrides` 不會被清除。** 這個欄位的值優先於方案的 `limits`，而且判斷的是 key 存不存在，連 `null`（無上限）都會延續，見 `../features/platform/PLANS.md` 的有效上限一節。

寫入端只有一個：核准 `token_topup`。沒有任何路由或頁面可以檢視、修改或清除它。因此一個曾經加購過 AI 額度的租戶，降級之後仍然維持加購後的額度，而且**沒有任何介面能改回來**，只能直接改資料庫。加購本身的語意問題見 PLAN-02。

**三、其他行程的租戶方案快取不會失效。** `invalidateTenantPlan()` 清的是行程內的 `Map`，只對處理這個請求的行程有效。`invalidatePlanPermissions()` 走 Redis，所有行程一起生效。兩者搭配的結果是：其他行程在 60 秒內仍以舊的 `planId` 查天花板，降級後的權限收回會延後，升級後的新功能也會延後開通。

生產環境目前只跑一個 `api` 容器（`docker-compose.prod.yml` 沒有 replicas 設定），因此第三點尚未顯現。水平擴充時會出現。

<a id="plan-04"></a>
### PLAN-04：功能天花板只在掛了權限檢查的路由生效

**部分修正。** `efbd5f0`（#207，2026-10-02）為 `case`、`conversation`、`tag`、`shortlink` 的每一條路由掛上 `requirePermission()`；`contact` 已在 `481452a` 掛上。因此把 `inbox` 從方案拿掉之後，API 會擋下收件匣一帶的路由。其他 feature 的覆蓋情況沒有改變。

方案用三種手段限制租戶，效力不同：

| 手段 | 強制點 | 是否生效 |
| --- | --- | --- |
| `limits.maxAgents` | `agent.service.ts` 建立成員前 count | 是 |
| `limits.maxChannels` | `channel.service.ts` 建立渠道前 count | 是 |
| `limits.monthlyTokens` | `token-quota.service.ts` 的 Redis 計數器 | 是 |
| `limits.maxTags` | **沒有強制點** | 否 |
| `allowedChannelTypes` | `channel.service.ts` 建立渠道時 | 是 |
| `features`（功能天花板） | 只有 `requirePermission()` | 視路由而定 |

功能天花板的公式是「角色權限 ∩ 方案天花板」，而這個交集只在 `requirePermission()` 執行時才被計算。沒有呼叫它的路由，方案開不開都一樣。

以 feature 分組統計各模組的路由數與權限檢查數。除了 `inbox` 那一列於 2026-10-02 更新，其餘是 2026-09-24 的核對結果：

| feature | 路由層的覆蓋情況 | 關掉這個 feature |
| --- | --- | --- |
| `automation` | `canvas` 11 條全有、`automation` 7 條中 5 條（沒有檢查的是試跑與執行紀錄，見 AUTO-09） | 大致擋得住 |
| `analytics` | 9 條路由、10 處檢查 | 擋得住 |
| `channels` | `channel` 19 條中 17 條 | 大致擋得住 |
| `marketing` | 36 條中 21 條 | 大部分擋得住，仍有未檢查的路由 |
| `knowledge` | 21 條中 12 條 | 同上 |
| `portal` | 後台 `portal.routes.ts` 自 `723f6e14` 起以 plugin hook 對每條路由要求 `portal.view`，14 條全部經過 `requirePermission()`；另 6 條是粉絲端，不適用。原本記為「17 條中 8 條」，2026-10-30 功能健檢讀程式更正（[PORTAL 健檢](../features/health/PORTAL.md)） | 應擋得住，沒有以改方案實測 |
| `inbox` | `case`、`conversation`、`contact`、`tag`、`shortlink` 的每一條路由都有檢查 | 擋得住 |
| `core` | 恆開，方案不會關 | 不適用 |

剩下的缺口：

- **行銷、知識庫仍有路由沒有權限檢查。** 方案不含這些 feature 時，這些路由照常可用。知識庫的部分見 RBAC-01。粉絲活動的後台路由已全部檢查（見上表）。
- **側欄不依方案過濾收件匣一帶的選單。** `apps/web` 的 `Sidebar.tsx` 會依權限過濾選單，但「收件匣」「工單」「聯絡人」「通知」四個節點沒有 `perm` 欄位，一律顯示。方案不含 `inbox` 時，成員看得到「收件匣」「工單」「聯絡人」，點進去卻收到 403。「通知」的路由只檢查登入，不受影響。

`maxTags` 是另一種形狀的失效：它在 `apps/api/src` 只出現在 `plan-limits.service.ts` 的 `LimitKey` 型別宣告，沒有任何地方拿它比對，與 PLAN-01 的 `Plan.isActive` 相同。

成因見 RBAC-01。

**規格依據。** 各缺口的依據強度不同：

| 缺口 | 依據 |
| --- | --- |
| 側欄不依權限隱藏收件匣一帶的選單 | **違反主規格。** `openspec/specs/dashboard-tree-navigation/spec.md` 的「Permission-aware tree rendering」要求使用者沒有權限的目的地 SHALL 不顯示 |
| 行銷的路由沒有全部套用天花板 | **違反主規格。** `openspec/specs/tenant-plan/spec.md` 的「功能天花板交集」有情境「trial 方案未含 marketing」：呼叫 marketing API MUST 被 `requirePermission` 擋下 |
| 知識庫、粉絲活動的路由沒有全部套用天花板 | 間接。同一條需求只寫到「移除 `knowledge` 後有效權限不再含知識庫權限碼」，沒有寫 API 要擋 |
| `maxTags` 沒有強制點 | 沒有主規格。`openspec/changes/archive/2026-09-15-platform-control-plane/tasks.md` 的任務 2.8「createTag 前檢查 maxTags」沒有勾選；平台後台的方案頁卻可以設定「分眾標籤數」 |

前兩項違反主規格，依「違反主規格的項目至少是 P2」，這一項至少是 P2。依影響判定也是 P2：只影響方案不含該功能的租戶，而且 API 仍會以 403 擋下收件匣一帶的操作。

**修正方向**：為行銷、知識庫、粉絲活動沒有檢查的路由掛上 `requirePermission()`；側欄的四個節點加上對應的 `perm`；`maxTags` 在建立標籤前比對。

<a id="plan-05"></a>
### PLAN-05：加購過的租戶升級方案，額度反而變低

`resolveEffectiveLimit()` 判斷 `limitOverrides` 有沒有這個 key，有就直接回傳覆寫值，不與方案的 `limits` 比大小。加購把覆寫值寫成「加購當時的方案額度 + 加購量」（見 PLAN-02），因此覆寫值綁的是**加購當時**的那個方案。

以 `packages/database/prisma/seed.ts` 的方案額度為例：

| 步驟 | `Plan.limits.monthlyTokens` | `limitOverrides.monthlyTokens` | 有效上限 |
| --- | --- | --- | --- |
| 綁 `light` | 1,500,000 | 未設定 | 1,500,000 |
| 核准加購 50,000 | 1,500,000 | 1,550,000 | 1,550,000 |
| 升級到 `standard` | 3,000,000 | 1,550,000 | **1,550,000** |

租戶付費升級之後，AI 月額度停在升級前的數字。換方案的三個入口（`updateTenant()`、`approveRequest()` 的 `upgrade`、`convertToPaid()`）都只寫 `planId`，沒有一個會清除或重算覆寫值。

沒有任何路由或頁面讀得到 `limitOverrides`，因此平台方也看不出這個租戶的額度為什麼沒跟著升級，只能直接改資料庫。

PLAN-03 記錄的是相反方向：降級之後仍然維持加購後的較高額度，結果對租戶有利。這一項是同一個機制在升級方向上的結果，對租戶不利。

<a id="plan-07"></a>
### PLAN-07：渠道的兩個分級欄位都沒有方案填過值

`resolveEffectiveLimit()` 在方案的 `limits` 沒有某個 key 時回傳 `null`，而 `null` 代表無上限。缺少設定的結果是完全不限制。

`packages/database/prisma/seed.ts` 的 `seedPlans()` 為每個方案寫的 `limits` 只有 `maxAgents`、`maxTags`、`monthlyTokens`，沒有 `maxChannels`。因此凡是綁定 seed 方案的租戶，渠道數都是無上限。

這一項與 PLAN-04 的 `maxTags` 剛好相反，兩者各缺一半：

| 上限 | 方案有定義嗎 | 有檢查點嗎 | 結果 |
| --- | --- | --- | --- |
| `maxAgents` | 有 | `agent.service.ts` 的 `createAgent()` | 生效 |
| `monthlyTokens` | 有 | `token-quota.service.ts` 的 `isMonthlyTokenExceeded()` | 生效 |
| `maxChannels` | **沒有** | `channel.service.ts` 的 `createChannel()` | 檢查點永遠跳過 |
| `maxTags` | 有 | **沒有** | 設定值沒有讀取端 |

`/admin/plans` 的欄位清單（`apps/web/src/app/admin/plans/page.tsx` 的 `LIMIT_KEYS`）列出全部四項，`maxChannels` 顯示為空白。平台後台看不出「空白」在這裡代表方案從未定義這個 key，也就是無上限。

`updatePlanSchema` 的 `limits` 是 `z.record(...)`，沒有 key 白名單，也沒有必填項。送 `{}` 會通過驗證，該方案所有租戶的四項上限同時變成無上限。平台後台的頁面每次送出都帶完整的 `limits` 物件，因此從介面操作不會漏 key；直接呼叫 API 則會。

另一半是 `allowedChannelTypes`。`seedPlans()` 的 `upsert` 沒有傳這個欄位，因此五個方案都落在 schema 的預設值 `[]`，而 `[]` 的語意是不限制。`channel.service.ts` 的 `createChannel()` 裡，白名單檢查只在陣列非空時才比對，所以也永遠跳過。

兩者相加的結果是渠道這個維度完全沒有分級：

| | `light` | `enterprise` |
| --- | --- | --- |
| 渠道數上限 | 無上限 | 無上限 |
| 可建立的渠道類型 | 全部 | 全部 |

兩個機制的檢查程式碼都完整，缺的是方案資料。`/admin/plans` 兩個欄位都編輯得到，補上值就會生效。

補上值之後還有一個缺口：`createChannel()` 只在建立時檢查數量，`updateChannel()` 把停用的渠道改回啟用時不檢查。停用一個渠道、建立一個新的、再把舊的啟用，就能超過上限。

<a id="plan-08"></a>
### PLAN-08：角色權限的顯示與儲存都不套方案天花板

租戶側「角色與權限」頁的勾選狀態來自資料庫的授予紀錄，與方案天花板無關。三個端點都不套天花板：

| 端點 | 回傳或寫入 | 是否套天花板 |
| --- | --- | --- |
| `GET /roles/matrix` | `getPermissionMatrix()`，整份權限註冊表 | 否 |
| `GET /roles/:id/permissions` | `role_permissions` 的原始列 | 否 |
| `PUT /roles/:id/permissions` | `setRolePermissions()` 的四道驗證 | 否 |

`setRolePermissions()` 驗依賴前置、越權、admin 核心鎖定與防自鎖。其中的越權防護讀 `getEffectivePermissions()`（角色原始權限），不是 `getEffectiveTenantPermissions()`（套過天花板的那一個）。因此租戶可以勾選方案不含的權限，儲存會成功，資料庫也會留下該筆授予。

這不是邊界情境。`seedRolesForTenant()` 給每個新租戶的 admin 角色種入 `DEFAULT_ROLE_PERMISSIONS.admin`，其值是 `PERMISSIONS.map((p) => p.code)`，也就是註冊表的全部權限碼，過程完全不看方案。以 seed 的 `light` 方案為例，它的 `features` 只有 `inbox` 與 `core`，`FEATURES` 的其餘六項都不在天花板內。

於是同一個權限在三個地方呈現三種狀態：

| 位置 | 讀的是什麼 | 顯示結果 |
| --- | --- | --- |
| 角色與權限頁 | `role_permissions` | 已勾選 |
| 側邊欄 | `/auth/me/permissions`（套過天花板） | 該選單不出現 |
| 直接開該路由 | `requirePermission()`（套過天花板） | 403 |

三處都沒有說明原因。管理員看到角色頁上已經打勾，會判斷成系統故障。

`requirePermission()` 回 403 時，`error.message` 是「權限不足，無法執行此操作。如需使用請聯繫管理員。」，`error.details` 附 `requiredPermission`。回應無法區分「角色沒有授予」與「方案不包含」：guard 拿來比對的 `eff` 是 `getEffectiveTenantPermissions()` 算出的「角色權限 ∩ 方案天花板」，兩種情況走同一個判斷。`details.requiredPermission` 只告訴維運缺哪一個權限碼，不告訴缺在哪一層。

訊息也指向了錯的人。「如需使用請聯繫管理員」把使用者導向租戶的管理員，而管理員打開角色頁，看到的是這個權限已經勾選。能處理的是平台方，要升級方案才會生效，訊息沒有提到這一點。

要區分兩種情況，guard 需要多比對一次角色的原始權限：角色有、交集沒有，就是方案不含。

PLAN-04 記的是天花板沒有咬合點、設定了也不生效。這一項相反：天花板確實生效，但沒有任何介面反映它的存在。

<a id="plan-09"></a>
### PLAN-09：改方案立即影響全體租戶，介面不顯示影響範圍

`updatePlan()` 寫入後，`features` 或 `permissionOverrides` 有變動就呼叫 `invalidatePlanPermissions()` 清掉該方案所有租戶的天花板交集快取。下一個請求就會用新的天花板重算，沒有灰度，也沒有延遲。`/admin/plans` 的提示文字有寫「該方案所有租戶即時生效」。

缺的是操作者判斷影響範圍所需的資訊：

- **看不到租戶數。** `listPlans()` 只做 `plan.findMany()`，沒有帶 `_count`，頁面也沒有顯示這個方案目前有幾個租戶。
- **沒有預覽與二次確認。** 取消勾選一個 feature 之後直接儲存即生效。
- **稽核不記舊值。** `plan.update` 的 payload 是送出的請求主體，只有新值。事後查不出改動前是什麼，也無法據以還原。

因此把 `professional` 的 `analytics` 取消勾選，所有 professional 租戶下一次請求就失去報表相關權限，而操作者在按下儲存之前不知道這影響幾個租戶，事後也沒有紀錄可以還原。

租戶端的感受見 PLAN-08：權限消失時，角色頁上那些權限仍然顯示為已勾選。

<a id="plan-10"></a>
### PLAN-10：加購沒有金額紀錄，事後無法對帳

這個系統不接金流。`Plan.priceMonthly` 的 schema 註解寫明「顯示用，不接金流」，資料庫也沒有帳單、發票或付款的資料表，沒有任何程式把用量或方案換算成應收金額。收費在系統外進行，這是設計決策，不是落差。

落差在於：加購這個動作在系統裡留下的紀錄，不足以還原當初賣了什麼。

**一、申請不記金額。** `PlanChangeRequest` 的欄位是 `type`、`targetPlanSlug`、`topupTokens`、`note` 與審核欄位，沒有金額欄位。租戶申請加購 30 萬 token，系統記得數量，記不得價格。

**二、覆寫值拆不開。** `limitOverrides.monthlyTokens` 存的是「加購當時的方案額度 + 加購量」的合併值（見 PLAN-02），無法從現況反推加購了多少。

**三、方案額度沒有變更歷史。** 要還原加購量，只能回頭加總該租戶所有已核准的 `topupTokens`，而這個算法必須假設 `Plan.limits.monthlyTokens` 從未被編輯過。`updatePlan()` 可以隨時改 `limits`，而且稽核只記新值（見 PLAN-09），因此這個假設無法驗證。

**四、沒有任何介面看得到。** `limitOverrides` 沒有讀取端（見 PLAN-03），平台後台列不出哪些租戶加購過、加購了多少、什麼時候加的。

四者相加的結果是：加購在系統裡留下的唯一痕跡，是一個拆不開、看不到、也對不回金額的數字。

租戶端同樣查不到。`/dashboard/plan` 只有申請表與自己的申請列表，看不到目前方案的內容、價格或已用額度。`priceMonthly` 只在平台後台的 `/admin/plans` 顯示，以及 `listPlans()` 拿來排序，從不回傳給租戶端。

`model_pricings` 不是租戶售價。它是各個 LLM 模型每 1M token 的單價，`platform-usage.service.ts` 用它算出平台自己的成本，顯示在 `/admin/usage`。

<a id="plan-11"></a>
### PLAN-11：平台查不到已處理的方案異動申請

`listPendingRequests()` 的查詢條件寫死 `status: 'pending'`，而平台側只有 `GET /api/v1/platform/plan-change-requests` 這一個列表端點。已核准與已駁回的申請一旦離開待審狀態，平台後台就再也看不到。

資料本身沒有遺失，只是平台讀不到。租戶側的 `listTenantPlanChangeRequests()` 查 `where: { tenantId }`，不分狀態，回傳最近 50 筆。同一批資料，租戶看得到自己的全部歷史，平台看不到任何一筆。

租戶詳情頁也沒有。`getTenantDetail()` 的 `select` 涵蓋方案、成員與各項計數，沒有 `planChangeRequests`，也沒有 `limitOverrides`。

從稽核紀錄反查不實用。平台稽核只有一個查詢端點 `GET /platform-users/:id/audit-logs`，條件是 `platformUserId` 或 `targetType = 'platform_user'`，上限 200 筆。它不能依租戶或 `action` 查詢，所以要找某個租戶的升級紀錄，必須先知道當初是哪一位平台人員核准的，再希望那筆還在他最近 200 筆之內。

`reviewedBy` 存的是 `platformUserId`，但不是外鍵，因此即使查到紀錄，要顯示審核者姓名仍須自己查 `platform_users`。

連帶影響 PLAN-10。那一項提到加購量可以回頭加總 `plan_change_requests.topupTokens` 來還原，但平台後台沒有任何介面做得到這件事，只能直接查資料庫。

<a id="plan-12"></a>
### PLAN-12：AI 不在功能天花板的維度內

`packages/core/src/rbac/features.ts` 的 `FEATURES` 有八個 slug：`inbox`、`channels`、`automation`、`marketing`、`analytics`、`knowledge`、`portal`、`core`。**沒有 `ai`。** 因此方案的 `features` 陣列無法表達「這個方案不含 AI」，平台後台方案頁的功能勾選區也關不掉 AI。

權限碼這一層同樣擋不住。AI 的入口有三類，只有一類掛得上權限：

| 入口 | 觸發者 | 授權判斷 |
| --- | --- | --- |
| `ai.routes.ts` 的 `/suggest-reply`、`/summarize`、`/analyze-sentiment`、`/classify`、`/rewrite` | 客服操作 | 只有 `fastify.authenticate`，沒有權限碼 |
| `ai.routes.ts` 的 `/agent/run`、`/agent/runs/:id` | 客服操作 | `requirePermission('inbox.reply')`、`('inbox.view')` |
| `kb-autoreply`（`automation.worker.ts`）、自動化動作（workers 的 `lib/automation-actions.ts`） | 客人傳訊息、規則命中 | 不經過路由，沒有請求可以掛 guard |

後兩個入口沒有使用者按下任何按鈕，因此不存在可以檢查權限的時機。

結果是控制 AI 只剩 `limits.monthlyTokens` 一個數值欄位，而它的語意在「不給用」這個方向上與其他欄位相反：

| `monthlyTokens` | `resolveEffectiveLimit()` 回傳 | 實際效果 |
| --- | --- | --- |
| 方案沒有這個 key | `null` | 無上限 |
| `null` | `null` | 無上限 |
| `0` | `0` | `used >= 0` 恆成立，一律擋下。這是唯一能表達「不給 AI」的寫法 |
| 正整數 | 該數值 | 依數值擋 |

其他欄位「留空」代表不限制，符合直覺；AI 要停用卻必須主動填 `0`。

兩點澄清，避免把這一項讀成比實際更嚴重：

- **現況沒有踩到。** `seedPlans()` 的五個方案都定義了 `monthlyTokens`，其中 `enterprise` 是 `null`（刻意無上限）。
- **介面有標示。** `/admin/plans` 的欄位標題是「數值上限（留空 = 無上限）」，placeholder 是「無上限」，輸入非數字時 `setLimit()` 會維持原值而不是解除上限。這一點比 PLAN-07 的 `maxChannels` 好：那個欄位是方案從未定義過，畫面同樣顯示空白，但「從未設定」與「刻意設成無上限」在介面上分辨不出來。

這一項記的是方案模型缺少 AI 這個維度，不是某個值設錯。

<a id="plan-13"></a>
### PLAN-13：換方案或調高方案的額度之後，當月的額度告警不會再發

用量告警以 Redis 的告警旗標 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}` 做冪等：`checkQuotaThresholdCrossing()` 用 `SET NX` 寫入旗標，寫入成功才發送，旗標到月底才過期。月額度提高之後，本月已經寫入的旗標還在。用量跨越新上限的門檻時，系統不會再通知。

核准加購會清除這兩個旗標（`clearQuotaAlertFlags()`，2026-10-08 修正）。其他會提高月額度的操作都不清除：

- `platform-tenant.service.ts` 的 `updateTenant()` 帶 `planSlug`：平台在租戶編輯頁換方案。
- `plan-change.service.ts` 的 `approveRequest()` 核准 `upgrade`。
- `trial-admin.service.ts` 的 `convertToPaid()`：試用租戶轉為付費方案。
- `plan.service.ts` 的 `updatePlan()` 調高方案的 `limits.monthlyTokens`：影響這個方案的所有租戶。

以 `packages/database/prisma/seed.ts` 的方案額度為例，租戶沒有覆寫值：

| 事件 | 有效上限 | 累計用量 | 跨越的門檻 | 是否通知 |
| --- | --- | --- | --- | --- |
| 用量累積 | 1,500,000 | 1,500,000 | warning 與 critical | 是，旗標寫入。之後被硬擋 |
| 升級到 `standard` | 3,000,000 | 1,500,000 | 無 | 無 |
| 用量累積 | 3,000,000 | 2,400,000 | warning（80%） | **否**，旗標已存在 |
| 用量累積 | 3,000,000 | 3,000,000 | critical（100%） | **否**，旗標已存在。再次被硬擋 |

租戶付費升級之後，當月第二次用完額度時沒有任何預警。主規格 `usage-quota-alerts` 的「每個門檻每月最多告警一次」只規定核准加購時清除旗標。因此這一項不違反主規格，但造成的結果與核准加購修正前相同。

租戶有 `monthlyTokens` 的覆寫值時，換方案不會改變有效上限（見 PLAN-05），這時保留旗標是正確的。修正時要比較換方案前後的有效上限，上限提高才清除旗標。

<a id="plan-14"></a>
### PLAN-14：試用與輕量版方案的租戶看不到也建不了渠道

`packages/database/prisma/seed.ts` 的 `trial`（免費試用）與 `light`（輕量版）方案，`features` 只有 `inbox` 與 `core`。`channel.view`、`channel.create` 屬於 `channels` feature，因此這兩個方案的租戶連管理員都看不到、也建不了任何渠道，接不了 LINE、FB、IG、WebChat。

渠道頁把 403 顯示成「沒有渠道／新增您的第一個渠道」，按「新增渠道」才 403（RBAC-11）。租戶實際上有啟用中的渠道時，畫面也顯示沒有渠道。

UAT 已確認相同：2026-10-30 以平台 API 唯讀查詢，`trial` 是 `["inbox","knowledge","core"]`、`light` 是 `["inbox","core"]`，都不含 `channels`。試用開通的租戶從第一天起就無法接渠道。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-PLANS-01（[PLATFORM-PLANS 健檢](../features/health/PLATFORM-PLANS.md)）。證據：`packages/database/prisma/seed.ts:31,38`、`packages/shared/src/rbac/permissions.ts:76-83`；自建方案設成 `["inbox","core"]`，租戶管理員 `GET /channels` 回 403 `requiredPermission: channel.view`（健檢實測）。

<a id="plan-15"></a>
### PLAN-15：同時編輯兩張方案卡片，第二張存入舊值

`/admin/plans` 的數值輸入框是非受控的（`defaultValue`）。先儲存一張卡片會重新載入全部方案的狀態，另一張卡片的輸入框仍顯示使用者改過的新值；再儲存那一張時送出的是重新載入的舊值，畫面卻顯示「已更新…該方案所有租戶即時生效」。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-PLANS-02（[PLATFORM-PLANS 健檢](../features/health/PLATFORM-PLANS.md)）。證據：`apps/web/src/app/admin/plans/page.tsx:44-47,131-132,239`；A 卡改成 7 不存、按 B 卡儲存、再按 A 卡儲存，畫面顯示已更新，資料庫 `maxAgents` 仍是 1（健檢實測，Playwright）。

<a id="plan-16"></a>
### PLAN-16：方案異動申請的審核與送出有競態

兩個競態都來自「先查再寫」，沒有條件更新或唯一約束：

| 情況 | 現況 |
| --- | --- |
| 同一筆申請同時核准與駁回 | `approveRequest()`、`rejectRequest()` 先讀狀態、再改租戶、最後無條件寫狀態。兩個請求都回 200，平台稽核同時記下 `plan_change.approve` 與 `plan_change.reject`，額度照加。同時送 3 個核准，3 個都 200、記 3 筆稽核，額度只加一次（同 PLAN-02 的覆寫遺失） |
| 同一租戶同時送出多筆申請 | 「同一租戶同時只能一筆 pending」只靠 `findFirst` 後 `create`，`plan_change_requests` 只有一般索引。同時送出會建立多筆 pending。租戶頁的按鈕送出中會停用，API 與 CLI 呼叫端會觸發 |

平台審核頁的按鈕在請求期間也沒有停用。

**規格依據。** 主規格 `plan-change-request` 規定同一租戶同時只能有一筆待審申請；第二種情況違反這條需求。

**修正方向**：核准與駁回以 `updateMany({ where: { id, status: 'pending' } })` 搶狀態，搶到才改租戶，整段放進交易；建立 `(tenantId) WHERE status = 'pending'` 的部分唯一索引，`create` 撞到時回 409。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-PLAN-CHANGES-01（[PLATFORM-PLAN-CHANGES 健檢](../features/health/PLATFORM-PLAN-CHANGES.md)）、HC-PLATFORM-PLAN-CHANGES-02（[PLATFORM-PLAN-CHANGES 健檢](../features/health/PLATFORM-PLAN-CHANGES.md)）。證據：`apps/api/src/modules/platform/plan-change.service.ts:21-25,36-44,88-155`、`packages/database/prisma/schema.prisma:2219-2240`；同時送 approve 與 reject 重複 5 次，每次都兩個 200；同時送 5 筆申請，資料庫 5 筆 pending（健檢實測）。

<a id="plan-17"></a>
### PLAN-17：方案異動的審核結果傳不回租戶

- 平台審核頁沒有審核備註欄位。API 接受 `note`，但介面不送。
- 租戶頁的型別與畫面都不含 `reviewNote`，租戶只看到「已駁回」，不知道原因。
- 核准與駁回不發站內通知，也不寄 email，租戶要自己回來看。功能文件已寫「核准之後租戶不會收到通知」。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-PLAN-CHANGES-04（[PLATFORM-PLAN-CHANGES 健檢](../features/health/PLATFORM-PLAN-CHANGES.md)）。證據：`apps/web/src/app/admin/plan-changes/page.tsx:32`、`apps/web/src/app/dashboard/plan/page.tsx:7-15,126-136`、`apps/api/src/modules/platform/plan-change.service.ts:82-156`；以介面駁回後 `reviewNote` 為 null，`notifications` 表沒有任何一筆（健檢實測）。

<a id="plan-18"></a>
### PLAN-18：「升級」申請不檢查方向

租戶頁的目標方案下拉寫死「標準版／專業版／企業版」，不看目前方案。企業版租戶也能選標準版送出 `upgrade`；後端也接受與目前相同的方案。平台審核頁不提示這是降級，核准後租戶立刻失去方案外的權限，超額資源也不會回收（PLAN-03）。功能文件已寫「沒有任何比較貴的檢查」。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-PLAN-CHANGES-05（[PLATFORM-PLAN-CHANGES 健檢](../features/health/PLATFORM-PLAN-CHANGES.md)）。證據：`apps/web/src/app/dashboard/plan/page.tsx:17-21,90-92`、`apps/api/src/modules/platform/plan-change.service.ts:27-31,93-102`；專業版租戶送 `light` 經平台核准後方案變成 light，`GET /marketing/campaigns` 立刻 403（健檢實測）。

<a id="plan-19"></a>
### PLAN-19：待審的方案異動申請不能撤回，也沒有逾期

租戶端只有 `GET`、`POST /plan-change`，沒有撤回的路由，待審申請也沒有逾期機制。租戶送錯只能等平台處理；平台不處理，這筆申請就永遠擋住同一租戶的新申請。

UAT Demo 租戶有一筆 2026-09-16 起待審的加購申請（`21676e0e-…`）。這筆是 BD 在測試使用的，**不是殘留資料，不要處理**。它說明了這個限制的效果：在它處理之前，Demo 租戶無法再送申請，E2E `cross-plan-request` 遇到待審申請也會中止。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-PLAN-CHANGES-06（[PLATFORM-PLAN-CHANGES 健檢](../features/health/PLATFORM-PLAN-CHANGES.md)）。證據：`apps/api/src/modules/platform/plan-change.routes.ts:26-35`（讀程式）；UAT 唯讀查詢 `GET /plan-change`，`/dashboard/plan` 顯示「您有一筆處理中的申請」（健檢實測）。

## AI 用量與成本

功能說明見[用量統計](../features/platform/USAGE.md)。

<a id="ai-01"></a>
### AI-01：BYOK 金鑰解密失敗會靜默退回平台金鑰

BYOK 指租戶自備 Gemini API key，說明見[用量統計](../features/platform/USAGE.md#哪些呼叫不算)。

`ai-key.service.ts` 的 `resolveGeminiKey()` 在解密租戶金鑰失敗時，`catch` 區塊是空的，直接往下走 fallback，回傳平台的 `GEMINI_API_KEY` 與 `source: 'platform'`。原始碼註解寫「解密失敗（如換過加密 key）→ 退回平台 key」，因此退回本身是刻意的。

問題是 `keySource` 一路決定三件事，退回之後全部反轉：

| | 退回前（`byok`） | 退回後（`platform`） |
| --- | --- | --- |
| 呼叫用誰的金鑰 | 租戶自備的 | 平台的 `GEMINI_API_KEY` |
| Google 的帳單開給誰 | 租戶 | **平台** |
| `AiUsage.costUsd` | 記 0 | 依 `ModelPricing` 實算（`llm.service.ts` 的 `recordAiUsage()` 以 `!isByok` 判斷） |
| 是否計入租戶月額度 | 否 | **是**（`incrMonthlyTokens()` 只累加 `platform`） |
| 額度用完是否被擋 | 否 | **是**（`llm.service.ts` 的 `generateReply()`） |

租戶不會因此多付錢，系統沒有計費機制（見 PLAN-10）。他付出的是額度：原本不計數的呼叫開始消耗 `monthlyTokens`，用完還會被擋下。平台則開始承擔本來由租戶負擔的 LLM 費用。

觸發條件是解密失敗，最可能的成因是 `CREDENTIAL_ENCRYPTION_KEY` 輪替。`ai-key.service.ts` 的加解密直接複用 `channel.service.ts` 的函式，與渠道憑證共用同一把金鑰，因此一次輪替會讓所有租戶的 BYOK 同時退回平台金鑰。

兩端的訊號都很弱：

- **平台端沒有訊號。** 唯一的間接跡象是 `/admin/usage` 的成本上升，但那一頁不分 `keySource`（見 USAGE-01），看不出是哪些租戶，也看不出原因。
- **租戶端要主動去看才知道。** `getTenantGeminiKeyStatus()` 解密失敗時回 `configured: true`，遮罩字串是「（無法解密）」。設定頁看得到這行字，但 AI 呼叫本身不會失敗，也沒有任何通知，租戶沒有理由去開那一頁。

<a id="usage-01"></a>
### USAGE-01：用量頁沒有標示統計的母體與筆數上限

`/admin/usage` 有標對的部分：頁首寫「僅計成功呼叫」，「AI 呼叫數」卡片的副標是「成功呼叫」，「總成本」卡片的副標是「平台承擔（不含 BYOK）」。這三句都與 `platform-usage.service.ts` 的實作相符。

缺的是另外兩件事。

**一、相鄰兩張卡的母體不同，只有其中一張標了。** 三個查詢都沒有 `keySource` 條件，也不看 `usageMissing`，因此 BYOK 與查無價目的呼叫都計入 token 總量，只是成本以 0 併入：

| 卡片 | 母體 | 卡片上的說明 |
| --- | --- | --- |
| 總 AI Token | 含 BYOK、含查無價目 | 只寫活躍租戶數 |
| 總成本 | 不含 BYOK（那些是 0） | 「平台承擔（不含 BYOK）」 |

兩張卡並排，讀者會拿成本除以 token 推算平均單價，但分母的母體大於分子。

**二、租戶排行沒有標筆數上限。** `platform-usage.service.ts` 的 `getTenantUsageRanking()` 是 `take: 50`，介面標題只寫「各租戶用量排行」。租戶多於 50 個時，排行的 token 加總會小於總覽的數字，畫面上沒有任何說明。

另有一處說明與實作不符，位置在原始碼裡。`platform-usage.service.ts` 開頭的註解寫「失敗成本為 0，計入次數但不計 token/cost」，但三個查詢的 `where` 都有 `success: true`，失敗的呼叫連次數都不算。介面與實作是一致的，只有這行註解是錯的，會誤導下一個改這支服務的人。

<a id="usage-02"></a>
### USAGE-02：價目表沒有維護介面，缺價期間的成本永久記 0

`ModelPricing` 以 `(model, effectiveFrom)` 版本化，結構本身支援調價。缺的是寫入途徑。

**唯一的寫入端是 seed。** 全 repo 只有 `packages/database/prisma/seed.ts` 的 `seedModelPricing()` 會寫 `modelPricing`，平台後台沒有任何路由。`apps/api/docker-entrypoint.sh` 在 API 容器每次啟動時都跑 seed，所以改 seed 的價目、合併到 `main`，部署後就會寫入。但 seed 的價目是寫死的固定 `effectiveFrom`，調價要改程式碼再部署，平台方無法自己調。

2026-10-29 以前，seed 每次啟動也會建立 Demo Tenant、固定密碼的 Demo 成員與開發用的平台帳號，並把它們的密碼與啟用狀態設回原始碼裡的值。現在 `NODE_ENV=production` 時預設不建這些帳號，帳號已經存在時也不覆寫密碼與啟用狀態（issue #394）。

**價目只涵蓋 3 個模型（2026-10-30 功能健檢）。** 租戶的 AI 設定可以選 10 個 Gemini 模型，`model_pricings` 只有 `gemini-2.5-flash`、`gemini-2.5-flash-lite`、`gemini-2.5-pro`。選其餘 7 個模型（`gemini-2.0-flash`、`gemini-2.0-flash-lite`、`gemini-flash-latest`、`gemini-flash-lite-latest`、`gemini-pro-latest`、兩個 `gemini-3-*-preview`）並使用平台金鑰時，每次呼叫的成本永久記 0、`usageMissing` 為 true。UAT 也只有這 3 筆價目。UAT Demo 租戶用 `gemini-flash-latest`，但走 BYOK，目前記 0 是對的；BYOK 一旦退回平台金鑰（AI-01），成本就會記 0 而不是實算。主規格只要求 seed 至少涵蓋三個 2.5 模型，不違反規格。

改 seed 的價目時要用新的 `effectiveFrom`：同一個 `(model, effectiveFrom)` 的 upsert 是 `update: {}`，不會覆寫既有的價目。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-SETTINGS-03（[PLATFORM-SETTINGS 健檢](../features/health/PLATFORM-SETTINGS.md)）、HC-PLATFORM-USAGE-01（[PLATFORM-USAGE 健檢](../features/health/PLATFORM-USAGE.md)）。證據：`apps/api/src/modules/ai/providers/gemini.provider.ts:21-35`、`packages/database/prisma/seed.ts:90-114`；UAT 唯讀交易查詢 `model_pricings` 只有 3 筆、Demo 租戶 `ai_usages` 有 412 筆 `gemini-flash-latest`、`keySource=byok`（健檢實測）；本機 `model_pricings` 3 列。

**缺價期間的成本無法事後修正。** 成本在寫入 `AiUsage` 的當下就算好，之後不重算。`getPricing()` 查不到價目時 `calcCostUsd()` 回 `null`，呼叫端記 `costUsd = 0` 並標 `usageMissing`。所以從新模型開始被使用、到有人手動補上價目之間的每一筆呼叫，成本永久是 0，而 repo 裡沒有任何重算路徑。

**快取讓這段期間更長。** `pricingCache` 是行程內的 `Map`，TTL 10 分鐘，而且**連查無價目的 `null` 一起快取**。補上價目之後最久還要再等 10 分鐘才會套用，多個 API 行程各自計時。`clearPricingCache()` 的註解寫「測試/改價後手動清快取用」，但全 repo 沒有任何呼叫端，也沒有對外端點。

**平台看不出帳面被低估。** `/admin/usage` 不看 `usageMissing`（見 USAGE-01），畫面上的成本只會偏低，沒有任何提示。唯一的線索是 `recordAiUsage()` 留的一則 warn log。

**修正方向（2026-09-30 提出，尚未實作）**

補一組 `ModelPricing` 的平台路由即可，不需要改 schema，版本化欄位已經齊備：

- **寫入介面**：列出各 model 的現行價目、新增一個 `effectiveFrom` 版本。寫入時一併呼叫 `writePlatformAudit()`，調價是會改變帳面的操作，應該留紀錄。
- **快取失效**：把 `clearPricingCache()` 接到寫入路由。但它清的是行程內的 `Map`，多行程時只對自己有效，應比照 `invalidatePlanPermissions()` 改走 Redis。
- **不要快取查無價目**：查不到時縮短 TTL 或直接不寫入快取，避免補完價目還要等滿 10 分鐘。
- **既有的零成本列**：要修正需要一條重算路徑（依 `model` 與 `createdAt` 回查當時應適用的價目版本）。若不打算做重算，至少讓 `/admin/usage` 顯示 `usageMissing` 的筆數，讓平台知道帳面被低估——這一點與 USAGE-01 一起修。


<a id="usage-03"></a>
### USAGE-03：AI 額度計數器少算用量之後，當月不會再校正

`token-quota.service.ts` 的月額度檢查讀 Redis 計數器 `aiquota:{tenantId}:{YYYY-MM}`。只有計數器**不存在**時，`getMonthlyTokens()` 與 `incrMonthlyTokens()` 才會從 `AiUsage` 的加總補建。計數器存在、但少算了用量時（計數器的數字小於 `AiUsage` 的實際加總），沒有任何程式會再拿 `AiUsage` 校正，少算的用量一直留到月底 key 過期。

有三種情況會讓計數器少算用量：

- **累加失敗。** `recordAiUsage()` 寫入 `AiUsage` 之後，以 fire-and-forget 呼叫 `incrMonthlyTokens()`。`incrby` 失敗時只記一則 warn log，這次的 token 不會再加進計數器。
- **Redis 重啟後還原舊的快照。** `docker-compose.yml` 與 `docker-compose.dev.yml` 的 Redis 掛載資料 volume，沒有指定設定檔，使用 image 預設的 RDB 快照，沒有開啟 AOF。重啟時還原最後一次快照，快照之後的累加都會遺失，而計數器仍然存在，所以不會補建。
- **核准加購刪除計數器時，有一筆累加正在進行。** `incrMonthlyTokens()` 先用 `exists()` 確認計數器存在，再呼叫 `incrby()`，這兩步不是原子操作。`approveRequest()` 在兩步之間刪除計數器時，`incrby()` 會建立一個新的計數器，值只有這次呼叫的 token 數。計數器存在，所以不會從 `AiUsage` 補建。這個新的 key 也沒有過期時間，月底之後仍留在 Redis。

計數器少算用量時，月額度檢查放行已經用完額度的租戶，平台多付這段期間的 LLM 費用。用量告警也以累加後的計數判斷，同樣會晚發或不發。

**規格依據**：主規格 `token-quota` 的「本月 AI 用量的計數」規定，只有成功、`keySource` 是 `platform` 的呼叫會累加，而且累加量是這次呼叫的 totalTokens。累加失敗之後，計數器與這條需求的計數不一致。

另有一個方向相反、影響較小的情況：計數器剛建立時，同時有多個請求在累加。`incrMonthlyTokens()` 用 `SET NX` 補建計數器，沒搶到的一方一律再 `incrby` 這次的 token。搶到的一方補建時，`AiUsage` 的加總可能已經包含這次的 token，這時這次的 token 會被算兩次。偏差最多是同時進行的呼叫的 token 數。

核准加購時，`approveRequest()` 會呼叫 `clearTokenQuotaCache()` 刪除計數器，下一次讀取時從 `AiUsage` 補建。這一步順便校正了少算用量的計數器，但只發生在核准加購時。刪除計數器本身也可能造成少算，見上面的第三種情況。

**修正方向**：

- 讓 `incrMonthlyTokens()` 的「確認計數器存在」與「累加」變成一個原子操作，例如用 Lua script：計數器存在時才 `incrby`，不存在時由呼叫端從 `AiUsage` 補建。這樣刪除計數器之後，進行中的累加不會建立只有一次用量的計數器。
- 原子操作只解決第三種情況。累加失敗與 Redis 還原舊快照造成的少算，仍要另外拿 `AiUsage` 的加總校正計數器。
<a id="usage-04"></a>
### USAGE-04：租戶看不到本月的 AI 用量與上限

整個系統沒有任何 API 回傳「本月已用／有效上限」：

- 告警信的按鈕寫「查看用量與方案」，站內通知也連到 `/dashboard/plan`，但那一頁只有申請表與申請紀錄。操作手冊 ch14 也寫「這頁不會顯示目前的方案和用量」。
- 平台的 `/admin/usage` 只有用量，沒有對照上限；租戶詳細頁沒有額度欄位。

要知道一個租戶還剩多少額度，只能查 Redis 的 `aiquota:*` 或直接查資料庫。PLAN-10 提到租戶端看不到已用額度，但沒有列成項目，也沒有提到告警連結。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-USAGE-02（[PLATFORM-USAGE 健檢](../features/health/PLATFORM-USAGE.md)）。證據：`apps/web/src/app/dashboard/plan/page.tsx`、`apps/api/src/modules/notification/notification.worker.ts:296-310`、`apps/api/src/modules/trial/usage-alert-emails.ts`；自建租戶用量達 100% 後開 `/dashboard/plan`，只有申請表與「尚無申請記錄」（健檢實測）。

## SLA

功能說明見[服務水準協議](../features/SLA.md)。

<a id="sla-02"></a>
### SLA-02：掃描每輪上限 100 張工單

`apps/workers/src/handlers/sla.handler.ts` 的 `getActiveCases()` 用 `take: 100` 取工單，沒有 `orderBy`，也沒有租戶條件。這個上限是全系統共用，不是每個租戶各 100 張。

全系統符合條件的工單超過 100 張時，超出的部分在該輪不會被檢查。沒有 `orderBy`，因此每輪取到哪 100 張由資料庫決定，不保證輪替。掃描間隔是 300 秒。

<a id="sla-04"></a>
### SLA-04：工單以政策名稱連結政策

`SlaPolicy` 與 `Case` 之間沒有 relation。`Case.slaPolicy` 是 `String?`，存的是政策名稱。`case.service.ts` 建立工單時寫入 `slaPolicy: slaPolicy?.name`，`sla.handler.ts` 的 `getPolicy()` 再以 `findFirst({ where: { tenantId, name } })` 回查。

由此產生三個問題：

- 修改政策名稱之後，既有工單的 `slaPolicy` 仍是舊名稱。`getPolicy()` 回傳 null，`sla.handler.ts` 直接 `continue`，該工單從此不再受監控，而且沒有任何紀錄。
- `sla_policies` 只有 `@@index([tenantId])`，沒有 `(tenantId, name)` 的唯一約束。同一租戶建立兩條同名政策時，`findFirst` 回傳哪一條不確定。
- `DELETE /api/v1/sla-policies/:id` 是硬刪除，沒有引用檢查。`SlaPolicy` 沒有 `isActive` 欄位，因此無法套用 `AGENTS.md` 的 soft-delete 慣例。刪除後，引用該名稱的工單留下一個查不到政策的字串。

**部分修正（change `fix-admin-settings-safeguards`，2026-10-15）。** 新增 `sla.service.ts`，三個問題的應用層補強如下，資料模型沒有改：

| 問題 | 現況 |
| --- | --- |
| 改名 | 已修正：改名在同一個交易內把本租戶工單的 `slaPolicy` 從舊名稱改成新名稱 |
| 同名政策 | 部分修正：建立或改名撞名回 409 `DUPLICATE`。資料庫仍沒有 `(tenantId, name)` 的唯一約束，修正前已存在的同名政策不受影響，改名時兩條同名政策的工單會一起改 |
| 刪除 | 部分修正：仍有未結案工單（狀態不是 `RESOLVED`、`CLOSED`）時回 409 `SLA_POLICY_IN_USE`。只有已結案工單時仍是硬刪除 |

徹底的修法仍是 `Case` 改以外鍵連結 `SlaPolicy`，需要 migration 與回填。

<a id="sla-05"></a>
### SLA-05：沒有關聯對話的工單沒有首次回應時間

`c99c40d` 之後，客服在工單關聯的對話送出訊息時，`conversation.service.ts` 的 `sendMessage()` 呼叫 `case.service.ts` 的 `markCaseFirstResponse()` 寫入 `Case.firstResponseAt`。對話掛到既有工單時，`syncFirstResponseFromConversation()` 也會補上工單建立後最早的那則客服訊息。

兩個寫入點都以「工單關聯的對話」為前提。`POST /api/v1/cases` 的 `createCase()` 只帶 `contactId` 與 `channelId`，不建立對話關聯。客服之後在這位聯絡人的對話裡回覆，只要那個對話沒有掛到這張工單，就不算這張工單的首次回應。

這種工單套用 SLA 政策時：

- `sla.handler.ts` 在 `createdAt + firstResponseMinutes` 到期時判定 `first_response_breached`，通知負責人與主管、寫入 `CaseEvent`、觸發自動化規則。同一個期限只記一次（`fix-sla-outcome-repeat`，2026-10-15 起；原本每 24 小時再發一次。2026-10-30 功能健檢在本機與 UAT 確認，[SLA 健檢](../features/health/SLA.md)）。
- 分析報表的平均首次回應時間不計入這種工單。

`apps/api/src/scripts/backfill-case-first-response.ts` 為既有工單補值時，也只看關聯對話裡的客服訊息，同樣補不到這種工單。另一種補不到的情況是：客服只在工單建立之前回覆過，之後沒有再回覆。

**修正方向**：手動建立工單時，若這位聯絡人在該渠道有進行中的對話，就把對話掛到工單上；或者讓首次回應改以「工單建立後，客服對這位聯絡人在該渠道送出的第一則訊息」判斷，不要求對話關聯。

<a id="sla-06"></a>
### SLA-06：SLA 不扣營業時間、假日與待處理時間

工單的解決期限在建立時寫入 `slaDueAt = createdAt + 政策分鐘數`，首次回應期限每輪以建立時間現算，兩者都是日曆時間。營業時間只被非營業時間自動回覆讀取（`inbound-side-effects.ts:172`），SLA 不讀。因此：

- 下班後、週末、假日建立的工單照樣逾時，系統在非營業時間發逾時通知、自動升級優先級。
- 工單狀態為 `PENDING`（等客人回覆）時不暫停計時。

手冊 ch17 已寫明（`<!-- KNOWN-ISSUE -->`），功能文件沒有記錄。這是產品決定還是缺陷，健檢總表列為待決定事項；決定之前依影響列 P2。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-SLA-01（[SLA 健檢](../features/health/SLA.md)）。證據：`apps/api/src/modules/case/case.service.ts:289`、`apps/workers/src/handlers/sla.handler.ts:400`；營業時間設為週一到五 09:00–10:00、當天列為假日，建 HIGH 工單後 `slaDueAt` 等於建立時間加 240 分，掃描在假日、非營業時間寫入逾時事件並升級為 URGENT（健檢實測）。

<a id="sla-07"></a>
### SLA-07：工單優先級改變後不重新套用 SLA 政策

手動改優先級、升級工單、SLA 逾時自動升級（`applyPriorityBump()`）、自動化的 `set_case_priority` 都只改 `priority`。`slaPolicy` 與 `slaDueAt` 維持建單時的值：

- 升成緊急的工單仍以低、中優先的時限計時。
- 逾時自動升級後沒有新的期限，之後不會再有預警或逾時事件。

UAT Demo 租戶 10 張工單中有 7 張 `priority = URGENT`、`slaPolicy = "中優先"`，`slaDueAt` 是建單後 1440 分。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-SLA-02（[SLA 健檢](../features/health/SLA.md)）。證據：`apps/api/src/modules/case/case.service.ts:861-866`、`apps/workers/src/handlers/sla.handler.ts:457`；MEDIUM 工單改成 HIGH 後 `slaPolicy`、`slaDueAt` 不變（本機健檢實測）；UAT Demo 只讀查詢。

<a id="hours-01"></a>
### HOURS-01：營業時間設定為空物件時，營業時間頁崩潰

`TenantSettings` 由營業時間以外的路徑建立時（追蹤設定、跨渠道綁定、AI 設定，或第一次收文字訊息時情緒分析呼叫 `getChatSettings()`），`officeHours` 是 schema 預設的 `{}`。

- `office-hours.service.ts` 的 `getOfficeHours()` 只在沒有這一列時給預設值；`{}` 是 truthy，直接回傳。
- 前端 `data.officeHours || DEFAULT_CONFIG` 也不會替換。

結果是在營業時間頁按「啟用」開關時整頁崩潰（`Cannot read properties of undefined (reading 'mon')`）；不按開關直接儲存則回 400。收過訊息的租戶多半是這種狀態，因此這類租戶無法從畫面啟用營業時間。UAT Demo 租戶已有完整設定，不受影響；其他租戶沒有查。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-SETTINGS-01（[SETTINGS 健檢](../features/health/SETTINGS.md)）。證據：`apps/api/src/modules/settings/office-hours.service.ts:69`、`apps/web/src/components/settings/OfficeHoursSettings.tsx:64, 192-194`；本機 Demo 租戶 `officeHours` 為 `{}`，點開關後出現「Application error: a client-side exception」（健檢實測）。

<a id="hours-02"></a>
### HOURS-02：營業時間不驗證時段與時區

`PUT /settings/office-hours` 不驗證內容：

| 輸入 | 結果 |
| --- | --- |
| 結束早於開始（跨午夜，例如 13:00–02:00） | 可以儲存，實際整天都判定為非營業，營業時間內也送出非營業時間自動回覆。手冊已提醒不支援跨午夜，但畫面與後端都不擋 |
| `99:99`、`24:61`、假日 `abc`、`2026-13-45` | 都接受 |
| 不合法的 `timezone`（例如 `Mars/Base`） | 每則進站訊息在 `Intl.DateTimeFormat` 拋 `RangeError`，`sendOutsideHoursAutoReply()` 只寫 error log，自動回覆整個失效，後台沒有任何提示 |

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-SETTINGS-03（[SETTINGS 健檢](../features/health/SETTINGS.md)）、HC-SETTINGS-04（[SETTINGS 健檢](../features/health/SETTINGS.md)）。證據：`apps/api/src/modules/settings/settings.routes.ts:57-82`、`office-hours.service.ts:118, 146-151`、`apps/api/src/modules/webhook/inbound-side-effects.ts:216-217`；週五 13:32 設 `fri: 13:00–02:00` 後 WebChat 收到自動回覆；`timezone: "Mars/Base"` 後沒有自動回覆、log 有 `Invalid time zone specified`（健檢實測）。

## 對話、工單與自動化

功能說明見[收件匣與對話](../features/tenant/INBOX.md)、[工單](../features/tenant/CASES.md)與[自動化](../features/tenant/AUTOMATION.md)。

<a id="conv-01"></a>
### CONV-01：對話的閒置自動關閉時限沒有維護介面

`conversation/inactivity-close.worker.ts` 的 `setupInactivityCloseWorker()` 定期關閉閒置過久的對話。時限讀 `TenantSettings.inactivityCloseHours`，schema 預設 72 小時，值小於等於 0 代表停用。

這個欄位沒有寫入端。`settings.routes.ts` 沒有對應的路由，前端、CLI 與 seed 都不設定它。租戶無法調整時限，也無法停用自動關閉；要改只能直接更新資料庫。

掃描以 `tenant_settings` 的列為單位，因此還有一個邊界情況：沒有這一列的租戶不會被掃描，對話永遠不會自動關閉。開通租戶時不會建立這一列。第一次呼叫 AI，或打開 Chat、Embedding、營業時間、追蹤設定等設定頁時，才會建立。收過文字訊息的租戶通常已有這一列，因為情緒分析會經由 `llm.service.ts` 呼叫 `getChatSettings()`。

**修正方向**：在 `settings` 模組加一組讀寫閒置時限的路由，驗證範圍（0 代表停用），寫入時記錄租戶稽核。前端放在設定頁，例如與營業時間同一頁。開通租戶時一併建立 `TenantSettings`，讓掃描涵蓋所有租戶。

<a id="conv-02"></a>
### CONV-02：收件匣的下拉選單繞過關閉與指派的副作用，指派對話不會通知

收件匣右上角的負責人與狀態兩個下拉選單，都呼叫 `PATCH /conversations/:id`，由 `conversation.service.ts` 的 `updateConversation()` 直接改欄位並推送 socket。

| 動作 | 專用路徑的行為 | 下拉選單的行為 |
| --- | --- | --- |
| 關閉 | `POST /:id/close` 經 `closeConversation()`：記錄關閉原因、來源、時間與操作者，發布 `conversation.closed` | 只改 `status`，不記原因，不發布事件 |
| 指派 | 沒有專用路徑 | 只改 `assignedToId`，不發布任何事件 |

**`conversation.assigned` 沒有發布端。** `notification.worker.ts` 訂閱了這個事件，要通知被指派的客服；但 API 行程裡沒有任何程式發布它（唯一的 `emit` 原本在沒有呼叫端的 `action-executor.ts`，而且是 socket 事件；這個檔案已在 `8e25e1b` 刪除）。因此指派對話從來不會通知被指派的人，訂閱這個事件的對外 Webhook 也收不到。

狀態選單的標籤也容易誤解：「已處理」送出的值是 `AGENT_HANDLED`，意思是「由客服處理中」。

**修正方向**：`updateConversation()` 收到 `CLOSED` 時改走 `closeConversation()`；指派時發布 `conversation.assigned`，讓通知與對外 Webhook 接得到。

**部分修正。** #294（`a3044f93`）讓狀態選單的「已關閉」改開結案視窗，走 `POST /:id/close`。2026-10-16，`updateConversation()` 收到 `CLOSED`（且對話尚未關閉）時改呼叫 `closeConversation()`，記錄來源 `manual`、時間與操作者並發布 `conversation.closed`；同時帶負責人時先改負責人再關閉。直接呼叫 API 的路徑因此也有結案紀錄。指派仍不發布 `conversation.assigned`。

<a id="conv-03"></a>
### CONV-03：對話轉接真人時，主管與管理員收不到通知

兩條路徑會把對話從 `BOT_HANDLED` 改成 `AGENT_HANDLED`，並發布 `conversation.handoff`：

| 路徑 | 位置 |
| --- | --- |
| 客人點「轉接客服」按鈕（postback `handoff_request`） | `webhook/inbound-postback-interceptors.ts` |
| 自動轉真人（機器人回覆次數到上限、客人說出轉接關鍵字、客人傳圖片、檔案或影片） | `automation/automation.worker.ts` 的 `checkAutoHandoff()` |

API 行程內沒有任何程式訂閱 `conversation.handoff`。`notification.worker.ts` 沒有訂閱這個事件，所以主管與管理員收不到「對話已轉接真人」的通知。只有訂閱了這個事件的對外 Webhook 收得到。

change `handoff-prompt-configurable`（2026-06-02 歸檔）的 `design.md` 寫「既有 `conversation.handoff` event 已有 notification.worker 訂閱者通知 supervisor」。這個前提不成立，當時沒有實作訂閱者。

**規格依據。** 主規格 `bot-handoff-config` 的「Webhook intercepts handoff_request postback」規定：系統 SHALL 發布 `conversation.handoff`，讓 SUPERVISOR 與 ADMIN 收到通知。事件有發布，但通知沒有發生，現況違反這條需求，因此列為 P2。自動轉真人的路徑不在這條需求內，但發布同一個事件。

<a id="conv-04"></a>
### CONV-04：收件匣只載入前 50 段對話

`useConversations.ts` 只送 `page=1&limit=50`，對話列表沒有分頁，也沒有「載入更多」。「未讀」「我的」與搜尋都在前端對這 50 段過濾，第 51 段以後在收件匣找不到，API 的 `meta.total` 與 `totalPages` 沒有被使用。

手冊已寫明限制，建議改到聯絡人頁找；但只有 WebChat 身分的聯絡人不在聯絡人清單，這個繞道對他們無效。進行中對話常態超過 50 段的租戶，收件匣等於主要功能失效。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-INBOX-01（[INBOX 健檢](../features/health/INBOX.md)）。證據：`apps/web/src/hooks/useConversations.ts:130`、`apps/web/src/components/inbox/ConversationList.tsx:78-103`；本機插入 55 段已關閉對話，「已關閉」分頁只顯示 50 段；UAT Demo 近 30 天已關閉 93 段，畫面顯示 50 段（健檢實測，UAT 只讀）。子代理原列 P2，2026-10-30 使用者決定升為 P1。

<a id="conv-05"></a>
### CONV-05：重新開啟對話造成兩段未關閉的對話

`conversation.service.ts` 的 `updateConversation()` 把對話改回 `ACTIVE` 時，不檢查同一位聯絡人在同一個渠道是否已有未關閉的對話。結果同時有兩段未關閉的對話，之後的新訊息依 `inbound-conversation-resolver.ts` 進到 `lastMessageAt` 最新的那一段，另一段擱在列表上。重新開啟也不清除 `closeReason`、`closeSource`。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-INBOX-02（[INBOX 健檢](../features/health/INBOX.md)）。證據：`apps/api/src/modules/conversation/conversation.service.ts:873-950`、`apps/api/src/modules/webhook/inbound-conversation-resolver.ts:20-28`；C1 結案、訪客再傳訊產生 C2，C1 重新開啟後兩段都未關閉（健檢實測）。

<a id="conv-06"></a>
### CONV-06：指派負責人不驗證對象是否啟用、看得到渠道

對話與工單的手動指派都不檢查負責人：

| 路徑 | 現況 |
| --- | --- |
| 對話：`PATCH /conversations/:id` 的 `assignedToId`、`/handoff` 的 `assignToId` | 停用的成員、看不到該渠道的成員都能被指派。指派給停用成員時，負責人下拉顯示「未指派」；指派給看不到渠道的成員時，他的「我的」分頁是空的，收到新訊息通知但點開 404 |
| 工單：`/assign`、`PATCH assigneeId`、建立時帶 `assigneeId`、升級時改派 | 不檢查負責人看不看得到工單的渠道。被指派的人收到通知，點進去 404，工單也不在他的列表。自動指派有這個檢查，手動沒有；負責人下拉列出租戶全部成員 |
| 停用成員 | `deactivateAgent()` 不解除指派。客人在指派給停用成員的對話傳訊時，`notification.worker.ts` 只通知那位停用的成員，ADMIN、SUPERVISOR 都收不到。`case.assigned` 與 SLA 通知同樣不檢查 `isActive` |

指派他租戶的成員見 CASE-07。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-INBOX-03（[INBOX 健檢](../features/health/INBOX.md)）、HC-CASES-04（[CASES 健檢](../features/health/CASES.md)）、HC-NOTIFICATIONS-02（[NOTIFICATIONS 健檢](../features/health/NOTIFICATIONS.md)）。證據：`apps/api/src/modules/conversation/conversation.service.ts:668-673, 898-903`、`apps/api/src/modules/case/case.service.ts:374-400`、`apps/api/src/modules/notification/notification.worker.ts:226-228`、`apps/api/src/modules/agent/agent.service.ts:376-396`；以上三種情況都在本機實測；`case.assigned` 與 `apps/workers/src/handlers/sla.handler.ts:205` 的 SLA 通知為讀程式。

<a id="case-02"></a>
### CASE-02：非 LINE 渠道的滿意度調查無法回覆

`csat.service.ts` 的 `sendCsatSurvey()` 依渠道送出調查：

| 渠道 | 實際送出的內容 | 客人能不能回覆 |
| --- | --- | --- |
| LINE | 設計上是 Flex Message，五個 postback 按鈕，資料是 `csat:<分數>:<工單 ID>` | 設計上能；實際上 Flex 送不出去，見 CASE-03 |
| 其他渠道 | `deliverToChannel()` 送出文字「回覆 csat:分數 即可，例如 csat:5」 | 不能 |

`inbound-postback-interceptors.ts` 的 `handleCsatResponse()` 只認得 `csat:<分數>:<工單 ID>`。客人照提示回覆的 `csat:5` 沒有工單 ID，不符合這個格式，會被當成一般訊息交給 AI 回覆與自動化。

另外兩個零件也沒有接上：

- `buildCsatChannelMessage()` 為非 LINE 渠道組了五個快速回覆選項，但 `sendCsatSurvey()` 只在 LINE 分支使用它的回傳值。
- 進站的 `postbackData` 只從 LINE 的 `rawPayload.postback.data` 取值，Facebook 的 postback 欄位沒有解析，因此即使改送快速回覆或按鈕，Facebook 送回的 payload 也到不了攔截器。

結果是非 LINE 渠道的工單永遠不會有 CSAT 分數。原本記為「報表的滿意度只反映 LINE 的客人」；2026-10-30 功能健檢發現 LINE 的問卷也送不出去（CASE-03），所以目前沒有任何渠道的客人能自己回覆滿意度，只剩客服手動記分（[LINE 健檢](../features/health/LINE.md)）。

<a id="case-03"></a>
### CASE-03：LINE 的滿意度調查送不出去

`csat.service.ts` 的 `sendCsatSurvey()` 以 `contentType: 'flex'` 呼叫 LINE 外掛，但 `packages/channel-plugins/src/line/index.ts` 的 `buildLineMessage()` 沒有 `'flex'` 分支，落到 `default` 變成 `{"type":"text","text":""}`。LINE 拒收空白文字。

失敗沒有任何地方看得到：外掛的 `sendMessage()` 回 `{success: false}` 不拋錯，`sendCsatSurvey()` 不檢查回傳值，`csatSentAt` 已經寫入，之後也不會再寄。`'flex'` 分支在 `3a19c457`（2026-05-20，新增素材系統）被刪除，之後沒有測試涵蓋 LINE 這條路徑。

加上 CASE-02 的非 LINE 渠道，目前沒有任何渠道的客人能自己回覆滿意度，只剩客服手動記分（手動記分的問題見 CASE-05）。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-LINE-01（[LINE 健檢](../features/health/LINE.md)）。證據：`packages/channel-plugins/src/line/index.ts:134, 246`、`apps/api/src/modules/csat/csat.service.ts:25, 166`；以 tsx 呼叫 `buildLineMessage('flex', …)` 得到 `{"type":"text","text":""}`（函式層健檢實測）。LINE 端拒收依 API 規格判斷，待真機驗證。

<a id="case-04"></a>
### CASE-04：工單狀態轉換不維護 `resolvedAt` 與 `csatSentAt`

`case.service.ts` 只在狀態轉成 `RESOLVED` 時寫 `resolvedAt`，其他轉換不動 `resolvedAt` 與 `csatSentAt`。造成兩組後果：

**報表失真。** 報表以 `resolvedAt` 判斷「已解決」：

- 直接關閉（`OPEN`／`IN_PROGRESS` → `CLOSED`）不寫 `resolvedAt`，這類工單不算已解決，不進 SLA 達成率與平均解決時間。
- 解決後重開（`RESOLVED` → `IN_PROGRESS`）保留舊的 `resolvedAt`，仍在處理中的工單被算成已解決，逾時的還會拉低 SLA 達成率。

影響總覽的已解決數、SLA 達成率、平均解決時間，案件趨勢的「已解決」，客服績效與我的績效。UAT Demo 的 3 張 `CLOSED` 工單有 2 張 `resolvedAt` 為空。

**重開後被自動結案。** 工單重開再解決時，若第一次的問卷寄出已超過 72 小時，問卷逾時結案排程（`csat.scheduler.ts`，只看 `csatSentAt`）在 1 分鐘內就把工單改成 `CLOSED`，並關閉工單底下所有對話，包括正在進行的。也不會寄第二份問卷。

workers 的 `update_case_status` 動作也不寫 `resolvedAt`，見 AUTO-10。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-ANALYTICS-02（[ANALYTICS 健檢](../features/health/ANALYTICS.md)）、HC-CASES-02（[CASES 健檢](../features/health/CASES.md)）。證據：`apps/api/src/modules/case/case.service.ts:487-492`、`apps/api/src/modules/analytics/analytics.service.ts:68-88, 211-214, 350-357`、`apps/api/src/modules/csat/csat.scheduler.ts:65-90`；本機以 API 直接關閉後 `resolvedAt: null`，重開後 `resolvedAt` 不變，固定資料下總覽 `resolvedCases` 為 2（期望 1）；`csatSentAt` 設為 80 小時前、重開再解決，約 1 分鐘後工單已是 `CLOSED`（健檢實測）。HC-ANALYTICS-02 子代理原列 P2，2026-10-30 使用者決定升為 P1。

<a id="case-05"></a>
### CASE-05：客服記錄滿意度直接把工單改成已關閉

`POST /cases/:id/csat`（收件匣 CSAT 卡片的星星）呼叫 `csat.service.ts`，不檢查工單狀態，直接把工單改成 `CLOSED`：不經狀態機、不寫時間軸、不關閉對話。同時把「感謝評分」的追蹤訊息送給顧客；2 分以下送「我們會立即安排主管為您跟進處理」，但顧客根本沒有評分。

**規格依據。** 主規格 `case-management` 的「Case Status Transition Validation」規定狀態轉換 SHALL 經過狀態機驗證。現況違反這條需求。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CASES-01（[CASES 健檢](../features/health/CASES.md)）。證據：`apps/api/src/modules/csat/csat.service.ts:211, 315-322`、`apps/api/src/modules/case/case.routes.ts:342`、`apps/web/src/components/inbox/CsatMessage.tsx:29`；`IN_PROGRESS` 工單 `POST /cases/:id/csat {score:2}` 回 200，工單變 `CLOSED`、對話多一則致歉訊息（健檢實測）。

<a id="case-06"></a>
### CASE-06：連結對話到工單不檢查聯絡人與渠道

`POST /cases/:id/conversations/:conversationId/link` 只檢查工單的渠道，不檢查對話：

- 不檢查對話的聯絡人是不是工單的聯絡人，別的顧客的對話也能掛上。
- 不檢查對話所屬渠道的可見範圍。只看得到 LINE-A 的成員可以把 WebChat 的對話掛到 LINE-A 的工單，之後在工單詳情讀到那則對話。

掛錯之後，CSAT 問卷寄到 `conversations[0]`（沒有排序），問卷逾時結案會關閉所有掛上的對話。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CASES-03（[CASES 健檢](../features/health/CASES.md)）。證據：`apps/api/src/modules/case/case.service.ts:698-720`、`case.routes.ts:326-339`、`csat.service.ts:85-88`、`csat.scheduler.ts:33-37`；不同顧客的對話與看不到的渠道的對話都連結成功（200），問卷實際寄到另一個渠道的對話（健檢實測）。

<a id="case-07"></a>
### CASE-07：工單的負責人與團隊不驗證屬於本租戶

`POST /cases`、從對話建立工單，以及 `PATCH /cases/:id`（以 `connect` 寫入）都不驗證 `assigneeId`、`teamId` 屬於本租戶或啟用中，直接以外鍵寫入。只有 `/assign` 與升級有檢查。PostgreSQL 的外鍵檢查不受 RLS 限制，所以 RLS 擋不住；回應的 `assignee.name` 會帶出他租戶成員的姓名。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CASES-05（[CASES 健檢](../features/health/CASES.md)）。證據：`apps/api/src/modules/case/case.service.ts:302-303, 867-870`；本機 `POST /cases {assigneeId:<他租戶成員>}` 回 201、`PATCH` 回 200；以 `SET ROLE app_tenant` 在交易內插入同樣的工單成功後 rollback（健檢實測）。PATCH 在正式環境的 RLS 下是否被擋沒有驗。

<a id="case-08"></a>
### CASE-08：工單的團隊下拉永遠是空的

工單詳情與建立視窗讀 `agent.team`、`agent.teamId`，但 `GET /agents` 回的是 `teams[].team`，所以「團隊」下拉永遠只有「未指定／不指定」。自動指派只在「有團隊、沒有負責人」時觸發，因此畫面上無法觸發輪流指派。建立視窗選了負責人也不會帶入團隊。以 API 帶 `teamId` 建立時，自動指派正常輪流。團隊本身無法建立見 TEAM-01。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CASES-06（[CASES 健檢](../features/health/CASES.md)）。證據：`apps/web/src/components/case/CaseDetail.tsx:102-106`、`CaseCreateModal.tsx:154-161`、`apps/api/src/modules/agent/agent.service.ts:438`；本機建團隊加入 3 位成員後兩個下拉仍只有一個選項，UAT 也只有「未指定」（健檢實測）。

<a id="case-09"></a>
### CASE-09：建立與升級工單時指定的負責人收不到通知

兩條路徑會指定負責人，卻不發 `case.assigned`：

| 路徑 | 現況 |
| --- | --- |
| 建立工單時帶 `assigneeId` | `case.flow.ts` 的 `afterCaseCreated()` 只在沒有負責人時處理（自動指派才發 `case.assigned`）。負責人收不到通知，狀態維持 `OPEN`；之後用 `/assign` 指派才會變 `IN_PROGRESS`。建立視窗把「指派給」放在表單裡，這是常見的指派方式 |
| 升級時在對話框改派 | `escalateCaseFlow()` 只發 `case.escalated`，收件人是主管與升級前的負責人，新負責人沒有收到任何通知 |

功能文件已寫第一種情況。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CASES-07（[CASES 健檢](../features/health/CASES.md)）、HC-NOTIFICATIONS-03（[NOTIFICATIONS 健檢](../features/health/NOTIFICATIONS.md)）、HC-NOTIFICATIONS-04（[NOTIFICATIONS 健檢](../features/health/NOTIFICATIONS.md)）。證據：`apps/api/src/modules/case/case.flow.ts:73-98, 145-155`、`apps/api/src/modules/notification/notification.service.ts:122-150`；`POST /cases {assigneeId}` 回 201、`status: OPEN`、負責人沒有通知；升級改派給 agent 後 agent 沒有任何通知（健檢實測）。

<a id="case-10"></a>
### CASE-10：工單詳情頁的首次回應判斷與後端不同

`CaseDetail.tsx` 以時間軸上第一個客服事件判斷「首次回應：已達／未達」，指派與改狀態都算。後端以 `markCaseFirstResponse()` 在客服於關聯對話送出訊息時寫 `firstResponseAt`，前端沒有使用。客服還沒回覆顧客，只要先指派，畫面就顯示「已達」，與 SLA 掃描的判斷不同。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CASES-11（[CASES 健檢](../features/health/CASES.md)）。證據：`apps/web/src/components/case/CaseDetail.tsx:118-129`（讀程式）。

<a id="auto-02"></a>
### AUTO-02：規則的執行紀錄與執行次數停止更新

寫入 `AutomationLog`、更新 `AutomationRule.runCount` 與 `lastRunAt` 的程式，原本只存在 API 端 `action-executor.ts` 的 `executeActions()`。這個函式自 `9255245` 起沒有呼叫端，檔案已在 `8e25e1b`（#209）刪除。workers 的執行路徑不寫這些欄位，因此目前沒有任何程式寫入。

- 自動化頁的規則清單原本顯示執行次數與最後執行時間，停在搬遷前的值，搬遷後建立的規則永遠顯示 0。2026-10-05 起規則清單不再顯示這兩個值（change `improve-automation-page-readability`）；欄位本身仍然沒有更新。
- `GET /automation/logs` 查不到搬遷後的任何執行。前端沒有呼叫這個端點。

`AutomationExecution` 表則是從來沒有任何程式讀寫。

<a id="auto-03"></a>
### AUTO-03：自動化的貼標動作以名稱找標籤，不分 scope，找不到就重建

workers 的 `automation-actions.ts` 執行 `add_tag` 時，以 `tag.findFirst({ where: { name, tenantId } })` 找標籤，沒有限定 `scope`。

- 同名的 `CASE`、`CONVERSATION` 或 `MATERIAL` 標籤可能被找到並貼到聯絡人上。`tagging.service.ts` 的 `assertTagScope()` 會拒絕這種組合，這條路徑繞過了它。
- 找不到時，直接以這個名稱建立一個 `scope` 為預設 `CONTACT` 的新標籤。標籤被管理員刪除或改名後，規則下一次觸發就默默把舊名稱的標籤建回來。

**規格依據。** 主規格 `tag-management` 的「Scoped tag assignment」規定：貼標 SHALL 檢查標籤的 scope 與對象類型相符。workers 的 `add_tag` 不論以 ID 或名稱找標籤，都不檢查 scope，現況違反這條需求，因此由 P3 調為 P2。`automation-engine` 的「Add Tag Worker Action」沒有規定 scope，與這個結論不衝突。

<a id="auto-05"></a>
### AUTO-05：規則編輯器提供的部分觸發事件永遠不會觸發

規則編輯器（`automation/[ruleId]/page.tsx`）以 `packages/automation` 的 `AUTOMATION_EVENT_DEFINITIONS` 列出全部觸發事件。實際送進 `automation` queue 的只有：

- 自動化訂閱者（`automation.worker.ts`）轉送的 `message.received`、`conversation.created`、`case.created`、`case.escalated`、`contact.created`、`contact.tagged`、`link.clicked`、`portal.activity.submitted`。
- workers 處理 `message.received` 時一併比對的 `keyword.matched`。
- workers 的 `sla.handler.ts` 自己查規則的五種 SLA 事件。

其餘事件的規則可以儲存，但永遠不會執行：

| 事件 | 原因 |
| --- | --- |
| `case.closed`、`case.assigned` | eventBus 上有發布，但沒有轉送進 queue |
| `message.postback`、`case.updated`、`case.status_changed`、`contact.updated` | 沒有任何程式發布 |

反過來，`portal.activity.submitted` 有轉送進 queue，但不在契約裡，規則編輯器選不到。

**目前的緩解。** 2026-10-05 起，契約以 `dispatched: false` 標出上表 6 種事件（change `improve-automation-page-readability`）：規則編輯器的選單顯示「（目前不會觸發）」，選了之後警告規則不會執行，試跑也說明條件符合仍不會執行。API 與 CLI、MCP 仍然可以建立這些事件的規則，事件本身也仍然沒有送出。

<a id="auto-06"></a>
### AUTO-06：規則編輯器把純數字的條件值存成數字

`apps/web/src/lib/automation/qb-to-engine.ts` 的 `parseValue()` 把看起來像數字的條件值轉成數字存檔。`packages/automation/src/rules/operators.ts` 的 `contains` 遇到非字串的比較值回 `false`，因此「訊息內容」「聯絡人名稱」「聯絡人標籤」這類字串欄位的條件永遠不成立。

訂單編號、選單數字（「1」「2」）、電話是最常見的關鍵字，都受影響。編輯器重新整理後仍顯示 8888，「試試看」也顯示不會觸發，管理員只會以為規則壞了。以 API 存入字串 `"7777"` 的規則正常。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-AUTOMATION-01（[AUTOMATION 健檢](../features/health/AUTOMATION.md)）。證據：`apps/web/src/lib/automation/qb-to-engine.ts:9-16,82`、`packages/automation/src/rules/operators.ts`；在 `/dashboard/automation/new` 建「訊息內容 包含 8888」，送出的 body 是 `"value":8888`，模擬訊息「我的單號 8888」沒有觸發，`POST /rules/:id/test` 回 `matched:false`（健檢實測）。

<a id="auto-07"></a>
### AUTO-07：SLA 規則的執行路徑與一般規則不一致

workers 的 `sla.handler.ts` 自己查規則並執行動作，沒有經過一般路徑的契約驗證，也不把 `contactId` 傳給動作：

- 契約允許的「新增標籤」「移除標籤」在 SLA 規則永遠被略過（log「no contact in context」），facts 裡也沒有 `contact.id`。
- 含已停用動作的 SLA 規則不會被略過。

手冊第 6 節已提醒不要在 SLA 規則用貼標。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-AUTOMATION-02（[AUTOMATION 健檢](../features/health/AUTOMATION.md)）。證據：`apps/workers/src/handlers/sla.handler.ts:226-260`、`apps/workers/src/lib/automation-actions.ts:321`；SLA 健檢以 `sla.resolution.breached` 規則加 `add_tag` 實測，workers log 出現 `skipped: no contact in context`、標籤沒有貼上（健檢實測，見 SLA 報告）。

<a id="auto-08"></a>
### AUTO-08：「聯絡人加標籤」的規則會重複執行

兩個原因讓 `contact.tagged` 規則執行的次數比預期多：

- `automation.worker.ts` 轉送 `contact.tagged` 時只傳 `contactId`，丟掉 `tagId`、`tagName`，契約也沒有「剛貼上的標籤」這個事實。規則只能用「聯絡人標籤 包含 X」，這個條件看的是聯絡人身上全部標籤，所以聯絡人之後每被貼上任何標籤，規則都再執行一次。
- 重複貼同一個標籤時，`addTagToTarget()` 以 upsert 回 201，並再寫一筆 `contact.tagged` 到 outbox。前端選單不列已貼的標籤，所以主要來自 API、自動化與短連結。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-AUTOMATION-03（[AUTOMATION 健檢](../features/health/AUTOMATION.md)）、HC-CONTACTS-09（[CONTACTS 健檢](../features/health/CONTACTS.md)）。證據：`apps/api/src/modules/automation/automation.worker.ts:479`、`packages/automation/src/contracts/facts.ts`、`apps/api/src/modules/tag/tag.flow.ts:36-43`、`tagging.service.ts:146`；貼 tagM 觸發通知後再貼無關的 tagN，又收到一次通知；同一個標籤 `POST` 兩次，outbox 多兩筆 `contact.tagged`（健檢實測）。

<a id="auto-09"></a>
### AUTO-09：自動化的試跑與執行紀錄只驗登入

`automation.routes.ts` 的 `POST /automation/rules/:id/test` 與 `GET /automation/logs` 只掛 `fastify.authenticate`。沒有 `automation.view` 的成員（例如 seed 的 agent）可以用規則 ID 呼叫試跑，拿到規則的名稱、條件與動作全文（含通知文字、素材 ID、客服 ID）。權限註冊表寫 `automation.view` 涵蓋「logs、test」。方案不含 `automation` 時，這兩條路由同樣不受天花板限制（PLAN-04 的「7 條中 5 條」）。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-AUTOMATION-04（[AUTOMATION 健檢](../features/health/AUTOMATION.md)）。證據：`apps/api/src/modules/automation/automation.routes.ts:196,210`、`packages/shared/src/rbac/permissions.ts:70`；agent 的 `GET /automation/rules` 回 403，但 `/rules/<id>/test` 回 200 並含 `rule.conditions`、`rule.actions`（健檢實測）。

<a id="auto-10"></a>
### AUTO-10：workers 的工單類動作繞過工單模組

`apps/workers/src/lib/automation-actions.ts` 的工單類動作直接更新 `case`：

- `update_case_status` 不檢查狀態轉換、不寫 `resolvedAt`、`closedAt`、不寫工單事件；規則轉成「已解決」的工單不會發滿意度調查。
- `assign_agent` 不通知被指派的人。
- 這幾個 `case.update` 只用 `where: { id }`，沒有自帶 `tenantId`。workers 用 BYPASSRLS 連線，租戶隔離只剩呼叫端傳入的 ID 是否正確（RLS-08）。

功能文件 `AUTOMATION.md` 的「工單類動作繞過工單模組」已寫行為。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-AUTOMATION-05（[AUTOMATION 健檢](../features/health/AUTOMATION.md)）。證據：`apps/workers/src/lib/automation-actions.ts:295-305,385-428`；`case.created` 規則設定 URGENT、指派、改成 RESOLVED 之後 `resolvedAt` 為 null、`case_events` 只有 `created`、被指派的人沒有通知（健檢實測）。

<a id="auto-11"></a>
### AUTO-11：Canvas 無法串接節點，權限與網址檢查過寬

- 節點的 `nextNodeId` 必須是 UUID，但節點 ID 由資料庫產生，`PATCH /canvas/:id` 也不收 `nodes`（回 200 但節點不變），所以用 API 建不出兩個以上互相串接的節點。
- 草稿（`DRAFT`）流程也能觸發；`contactId` 不存在也回 202。
- `agent` 系統角色預設有 `canvas.use`。
- `API_FETCH` 節點直接 `fetch()` 任意網址，沒有 `isBlockedUrl()` 檢查。目前因為無法串接而走不到；串接修好之後，成員就能讓伺服器請求內網網址（同 SEC-08）。

RLS-01 與 APP-07 記錄的是 Canvas 引擎的連線與喚醒，與這一項不同。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-AUTOMATION-06（[AUTOMATION 健檢](../features/health/AUTOMATION.md)）。證據：`apps/api/src/modules/canvas/canvas.routes.ts:37,51-58,137`、`canvas.service.ts:69-79,230-250`、`packages/core/src/canvas/api-fetch-node.ts:51`、`packages/shared/src/rbac/default-roles.ts:65`；agent 建立 TRIGGER→API_FETCH→ACTION 的草稿流程並觸發，回 202，執行紀錄 `FAILED`、`Node … not found in flow`（健檢實測）；SSRF 為讀程式。

<a id="auto-12"></a>
### AUTO-12：自動化動作的參數不檢查值

`packages/automation/src/contracts/validation.ts` 只檢查動作參數「有填」：`update_case_status` 可以存 `status: "FOO"`，`assign_agent`、`notify` 的 `agentId` 可以存非 UUID、不存在或其他租戶的成員。規則編輯器用下拉選單，不會送出這些值；API、CLI、MCP 可以。執行時才在 workers 失敗，而且只寫 log。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-AUTOMATION-07（[AUTOMATION 健檢](../features/health/AUTOMATION.md)）。證據：`packages/automation/src/contracts/validation.ts:147-160`、`apps/api/src/modules/automation/automation.service.ts:205-209`；`POST /automation/rules` 帶上述值都回 201（健檢實測，規則建成停用、未執行）。

<a id="auto-13"></a>
### AUTO-13：「短連結被點擊」沒有連結的條件欄位

事件說明寫「可以依是哪一條連結決定要做什麼」，但契約沒有連結相關的條件欄位。workers 的事實其實帶了 slug，規則用到時存檔驗證拒絕。手冊已註明。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-AUTOMATION-08（[AUTOMATION 健檢](../features/health/AUTOMATION.md)）。證據：`packages/automation/src/contracts/events.ts:144-149`、`facts.ts:55-88`、`validation.ts:91-94`（讀程式）。

## 聯絡人、行銷與報表

功能說明見[租戶後台](../features/tenant/README.md)底下的聯絡人與標籤、行銷、短連結、報表四份文件。

<a id="ident-01"></a>
### IDENT-01：合併建議沒有產生端

`packages/core/src/identity/identity-stitcher.ts` 的 `detectPhoneDuplicates()` 是唯一會建立 `MergeSuggestion` 的函式，它沒有任何呼叫端；同一個檔案的 `stitchByPhone()` 與 `stitchByLiffCookie()` 也沒有。`/api/v1/identity` 的審核端點因此永遠沒有資料可審。

**規格依據。** 主規格 `identity-stitching-engine` 的「AI 合併建議」規定：系統發現不同渠道的聯絡人有相同手機號碼時，必須產生一筆合併建議，交給管理員核准。現況沒有任何程式產生建議，違反這條需求，因此由 P4 調為 P2。

<a id="ident-03"></a>
### IDENT-03：一位聯絡人在同一個渠道可以有兩個身分，收發訊息會對錯人

`Conversation` 只記錄 `contactId` 與 `channelId`，沒有記錄這段對話屬於哪一個渠道身分。收發訊息時，系統以「聯絡人 + 渠道」查詢：

| 動作 | 程式 | 查詢方式 |
| --- | --- | --- |
| 客服回覆 | `conversation.service.ts` 的 `sendMessage()` | 取聯絡人在這個渠道的渠道身分，只取 1 筆，沒有排序 |
| 機器人回覆 | `conversation.service.ts` 的 `deliverToChannel()` | 取聯絡人在這個渠道的第一個渠道身分 |
| 進站訊息找對話 | `inbound-conversation-resolver.ts` | 取聯絡人在這個渠道最近一段未關閉的對話 |

這個做法只在「一位聯絡人在一個渠道只有一個身分」時正確。一位聯絡人在同一個 LINE 官方帳號有兩個身分（甲、乙）時，在甲的對話回覆可能送到乙，乙傳來的訊息可能放進甲的對話。

**已修正的部分**（`89014327`，change `enforce-merge-same-channel-guard`）：`contact-merge.service.ts` 的 `mergeContacts()` 鎖定雙方之後檢查同渠道，衝突時回 409 `SAME_CHANNEL_CONFLICT`。客服手動合併、核准合併建議、email 登記、綁定代碼 4 個入口都經過這個檢查，兩個合併同時併入同一位聯絡人時也擋得住。產品決定客服不可以合併同一個渠道的兩位聯絡人（#252）。

**未修正的部分**：

- 2026-10-12 查 UAT（唯讀，只讀 ID、渠道與時間）：119 位聯絡人、130 個渠道身分中，有 8 位聯絡人在同一個渠道有 2 個身分，都在預設租戶的 WebChat 渠道「tatung」，2026-09-03～09-04 建立。每位都恰好有 1 位已封存、`mergedIntoId` 指向它的聯絡人：這是修正前 UAT E2E 測試 `apps/web/tests/e2e-uat/tenant-contacts.spec.ts`「合併執行」把兩個自種的 chatbox 訪客（同一個 WebChat 渠道）合併的結果。`ContactMergeLog` 在 2026-09-30（`481452a4`）才建立，所以沒有合併紀錄。LINE、FB、Instagram 沒有這種聯絡人。8 位的 id 記在 `AUDIT-REVIEWS.md` 2026-10-12 的查詢紀錄。
- `channel_identities` 的唯一限制只有 `(channelId, uid)`，資料庫不擋一位聯絡人在同一個渠道有兩個身分。
- 入站時以 `IdentityMap` 把新的 uid 接到既有聯絡人（`inbound-contact-resolver.ts`），直接建立渠道身分，不鎖聯絡人的列，也不檢查同渠道。這筆身分與一個合併同時寫入同一位聯絡人時，合併的檢查看不到它。條件少見：同一個 provider 的另一個官方帳號第一次收到這個 uid 的訊息，同時有合併併入同一位聯絡人。
- 合併建議的兩位聯絡人在同一個渠道都有身分時，核准一律回 409，建議一直停在 `PENDING`。目前沒有程式產生建議（IDENT-01）。
- 409 的訊息與 `details.channels` 列出衝突渠道的名稱，不依成員可見的渠道過濾，與 RBAC-04「聯絡人合併沒有套用渠道可見範圍」同一個缺口。

**修正方向**：刪除上述 8 位 WebChat 測試聯絡人與各自被併入的封存聯絡人（寫入 UAT，要先匯出關聯資料並取得同意，刪除後重跑查詢確認為 0）之後，加上 `(contactId, channelId)` 唯一限制當第二道防線，合併違反限制時把資料庫錯誤轉成 `AppError`。不建議讓 `Conversation` 記錄渠道身分，產品沒有「一位客人在同一個官方帳號使用兩個帳號」的需求。

UAT E2E 的「合併執行」測試合併兩個同渠道的訪客，修正後會被拒絕（409 `SAME_CHANNEL_CONFLICT`），要改成兩個不同渠道的聯絡人，或改為驗證拒絕訊息。

<a id="ident-07"></a>
### IDENT-07：合併預覽與實際合併結果不一致

`contact.service.ts` 的 `getMergePreview()` 有兩處與實際合併不一致：

- 以 `channelType` 判斷「新增」的渠道身分。對方的身分在另一個同類型渠道（第二個 LINE 官方帳號、第二個粉專）時，預覽顯示「（無新增）」，實際合併會把它搬過來。
- 不檢查「兩位聯絡人在同一個渠道都有身分」。客服走完三步、勾選確認之後，執行時才收到 409 `SAME_CHANNEL_CONFLICT`（IDENT-03 的合併檢查）。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CONTACTS-02（[CONTACTS 健檢](../features/health/CONTACTS.md)）、HC-CONTACTS-03（[CONTACTS 健檢](../features/health/CONTACTS.md)）。證據：`apps/api/src/modules/contact/contact.service.ts:570, 602`；A 只有 LINE-A、B 只有 LINE-B，預覽 `newChannelIdentities` 為 `[]`，合併後 A 有兩個身分；兩個同 WebChat 渠道的聯絡人預覽 200、確認時 409（本機與 UAT 健檢實測）。

<a id="contact-02"></a>
### CONTACT-02：已封存的聯絡人仍可操作

被併入的聯絡人（`isArchived`）在詳情頁沒有標示，只有「合併紀錄」卡寫「已被併入 另一位聯絡人」。它仍然：

- 有「合併聯絡人」按鈕；以它當主要聯絡人時預覽成功，執行才 400「目標聯絡人已被封存或合併」（預覽只檢查次要聯絡人）。
- 可以 `PATCH` 改資料。
- 可以貼標，並寫出 `contactId` 為封存聯絡人的 `contact.tagged`。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CONTACTS-04（[CONTACTS 健檢](../features/health/CONTACTS.md)）。證據：`apps/web/src/app/dashboard/contacts/[contactId]/page.tsx:89-106`、`apps/api/src/modules/contact/contact.service.ts:599`、`tagging.service.ts:137`；B 併入 A 後，`PATCH /contacts/B` 200、`POST /contacts/B/tags` 201（健檢實測）。

<a id="contact-03"></a>
### CONTACT-03：合併完成後合併紀錄卡不更新

`ContactMergeHistory.tsx` 只在 `contactId` 改變時讀取，詳情頁的 `onMergeComplete` 沒有通知它。合併完成後，渠道身分卡已出現新身分，合併紀錄卡仍只有舊紀錄，要重新整理頁面才看得到新紀錄與「解除合併」。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CONTACTS-05（[CONTACTS 健檢](../features/health/CONTACTS.md)）。證據：`apps/web/src/components/contact/ContactMergeHistory.tsx:54-56`；詳情頁合併精靈併入 FB 聯絡人後合併紀錄卡沒有更新（健檢實測）。

<a id="contact-04"></a>
### CONTACT-04：聯絡人時間軸沒有筆數上限

`GET /contacts/:id/timeline` 的三個 `findMany` 都沒有 `take`，一次取出該聯絡人全部的對話、工單、工單事件與標籤，前端全部渲染。`/contacts/:id/conversations` 有分頁。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CONTACTS-08（[CONTACTS 健檢](../features/health/CONTACTS.md)）。證據：`apps/api/src/modules/contact/contact.service.ts:459-500`；替一位聯絡人插入 20,000 筆對話後，API 回 3.78 MB，詳情頁 60 秒以上才出現、DOM 約 16 萬個節點（健檢實測）。

<a id="mkt-01"></a>
### MKT-01：群發失敗後重試，逐人送出的群發會重送給已送達的人

`POST /marketing/broadcasts/:id/send` 在 HTTP 請求內 `await` `marketing.service.ts` 的 `executeBroadcast()`，整筆群發送完才回應。

**部分修正（`f0d88b0e`，#283，2026-10-15）。** 同一筆群發不會再同時執行兩次：

- `executeBroadcast()` 以條件更新（`status in (draft, scheduled, failed)`）搶占執行權，改成 `sending`。兩個請求同時送出，或請求與排程器同時執行時，只有一個搶得到。
- 狀態是 `sending` 的群發再送出時回 409 `BROADCAST_ALREADY_SENDING`。
- 「立即發送」的按鈕在請求期間停用。

立即發送的路由、排程器與 MCP 工具都呼叫 `executeBroadcast()`，所以三條路徑都受這個保護。

**仍未修正：**

| 情況 | 現況 |
| --- | --- |
| 群發中途發生例外，狀態變成 `failed`，管理員重試 | 重試會重新解析發送對象。逐人送出的群發（Facebook，或素材含變數）對全部對象再送一次，不看既有的 `BroadcastRecipient` 紀錄。LINE 的 multicast 依批次編號（`BroadcastDeliveryAttempt.batchIndex`）跳過已被 LINE 接受的批次；兩次執行之間受眾改變時，同一個批次編號的對象會不同 |
| 行程在送出途中結束 | 狀態停在 `sending`。再送出一律回 409，這筆群發只能取消，不能重送 |

2026-10-30 功能健檢確認第二種情況：一般群發停在 `sending` 時，行銷頁那一列沒有任何按鈕（只有附券群發有逾時重送）。後端 `POST /marketing/broadcasts/:id/cancel` 可以取消停在 `sending` 的群發，但只能直接呼叫 API。**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-08（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`apps/web/src/app/dashboard/marketing/page.tsx:497-560`、`apps/api/src/modules/marketing/marketing.service.ts:353`；把一則一般群發設成 `sending` 後該列 0 個按鈕，`POST /cancel` 回 200（健檢實測）。

**後台可以直接重試（`8baf76a0`，#296，2026-10-16）。** 行銷頁的失敗群發多了「重新發送」按鈕，按鈕呼叫的仍是 `POST /marketing/broadcasts/:id/send`。上表第一種情況因此可以從後台觸發，不必透過 API。群發變成 `failed` 的原因有兩種，重送的結果不同：

- 全部對象都送出失敗：沒有人收到過，重送不會重複。
- 送出途中發生例外：逐人送出的群發，例外之前已經送達的人，重送時會再收到一次。

**修正方向**：送出改成背景工作；重試時跳過已有成功收件紀錄的聯絡人；為停在 `sending` 的群發提供逾時或復原的途徑。

<a id="mkt-02"></a>
### MKT-02：排程群發不檢查發送權限

建立群發（`POST /marketing/broadcasts`）只要求 `marketing.manage`，「立即發送」才要求 `marketing.broadcast`。建立時帶 `scheduledAt`，`broadcast.scheduler.ts` 到期直接執行，不檢查建立者有沒有發送權限。只有 `marketing.manage` 的成員因此可以對顧客群發。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-01（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`apps/api/src/modules/marketing/marketing.routes.ts:278`、`apps/api/src/modules/marketing/broadcast.scheduler.ts:24-45`；只有 `marketing.view`、`marketing.manage` 的成員建立 75 秒後的附券群發，「立即發送」回 403，約 80 秒後排程器送出：送達 3、發券 3（健檢實測）。

<a id="mkt-03"></a>
### MKT-03：附券群發繞過發券權限

`marketing.service.ts` 的 `assertBroadcastCoupon()` 只檢查券的狀態，不檢查操作者有沒有 `coupon.issue`。沒有任何優惠券權限的成員可以建立並送出附券群發。前端附券選單因 `GET /coupons` 403 顯示載入失敗，但 API 照收。`audience-preview` 也把券的剩餘名額回給沒有 `coupon.view` 的成員。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-02（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`apps/api/src/modules/marketing/marketing.service.ts:227-228`、`marketing.routes.ts:290-294`；沒有 `coupon.view`、`coupon.issue` 的成員帶 `couponId` 建立群發 201、送出 202，結果發券 3 張（健檢實測）。

<a id="mkt-04"></a>
### MKT-04：群發不套用渠道可見範圍

行銷模組沒有任何 `assertChannelVisible()` 呼叫（批次發券有）。成員可以對看不到的渠道預估人數、建立群發，排程後由排程器送出；群發列表也列出所有渠道的群發。其他沒有套用可見範圍的路徑見 RBAC-04、RBAC-07。

**規格依據。** 主規格 `channel-visibility-defaults` 的「Unbound Channel Is Not Visible」規定沒有綁定的渠道不可見。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-03（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`apps/api/src/modules/marketing/marketing.service.ts:205-341`、`marketing.routes.ts:263-294`；只綁 WebChat 的成員對「健檢 FB」呼叫 `audience-preview` 回 200（matched 1）、建立群發 201（健檢實測）。

<a id="mkt-05"></a>
### MKT-05：分群的建立日期條件以 UTC 切日

`segment.service.ts` 把「建立日期」條件的日期解析成 UTC 午夜。台灣時間 00:00–07:59 建立的聯絡人被算到前一天，「之後」少算、「之前」多算。報表的同類問題見 ANA-01。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-09（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`apps/api/src/modules/marketing/segment.service.ts:176-185`；聯絡人 `createdAt` 設為台灣 10/29 03:00，「建立日期（之後）2026-10-29」回 2 人（應 3 人）、「（之前）」回 1 人（應 0 人）（健檢實測）。

<a id="mkt-06"></a>
### MKT-06：群發的素材與分群選單取不到全部資料

群發表單以 `limit=200` 取素材，`material.routes.ts` 的上限是 100；`useSegments()` 沒有分頁，只拿第一頁 50 筆分群。素材超過 100 筆、分群超過 50 筆的租戶，選單裡找不到其餘的項目，畫面沒有提示。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-10（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`apps/web/src/app/dashboard/marketing/page.tsx:290-294`、`apps/web/src/hooks/useMarketing.ts:41`、`apps/api/src/modules/marketing/material.routes.ts:258`；`GET /marketing/materials?limit=200` 回 `meta.limit=100`，`GET /marketing/segments` 回 `meta.limit=50`（健檢實測）。

<a id="mkt-07"></a>
### MKT-07：刪除分群不檢查排程群發的引用

`segment.service.ts` 刪除分群時不檢查是否被排程群發引用，也沒有警告。外鍵把 `broadcasts.segmentId` 設成 null；群發到期時 fail-closed（不會發給全部人），但失敗原因寫「選擇『受眾分群』時必須指定一個分群」，看不出是分群被刪。`assertSegmentUsable()` 的「所選分群已不存在」訊息因此永遠走不到。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-11（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`apps/api/src/modules/marketing/segment.service.ts:131-138`、`marketing.service.ts:42-44,53-56`；建分群、建排程群發、刪分群（200）後群發到期變 `failed`（健檢實測）。

<a id="mkt-08"></a>
### MKT-08：LINE 素材在憑證解不開時回 500

`material.service.ts` 建立或修改 LINE 素材時，用租戶最新的啟用中 LINE 渠道憑證呼叫 LINE 驗證。憑證解不開時回 500 `INTERNAL_ERROR`。群發已把同一種錯誤包成 `CHANNEL_CREDENTIAL_DECRYPT_FAILED`，素材沒有。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-12（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`apps/api/src/modules/marketing/material.service.ts:178-194`；本機 LINE 憑證無法解密時 `POST /marketing/materials`（`line_text`）回 500，FB 素材正常（健檢實測）；UAT 憑證正常時建立正常。

<a id="mkt-09"></a>
### MKT-09：會員綁定沒有前端入口

主規格 `member-binding` 有 5 條需求，後端 `member-binding` 模組有對應路由；`apps/web/src` 沒有任何地方呼叫 `/member-binding` 或 `/fan/member-binding`，圖文選單與關鍵字也沒有入口。

**規格依據。** 主規格 `openspec/specs/member-binding/spec.md` 第 78-95 行的需求要求顧客端可以完成綁定，現況沒有入口。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-13（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`apps/api/src/modules/member-binding/*.routes.ts`；`grep -rn "member-binding" apps/web/src` 沒有結果（讀程式）。

<a id="mkt-10"></a>
### MKT-10：素材的連結動作沒有檢查協定

`material.routes.ts` 定義了 `actionSchema`，但沒有套到 body。`javascript:` 等網址只有在租戶有可用的 LINE 渠道時才會被 LINE 的驗證擋下；FB 素材與沒有 LINE 渠道的租戶都存得進去。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-26（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`apps/api/src/modules/marketing/material.routes.ts:103,123-139`（讀程式，未實測）。

<a id="mkt-11"></a>
### MKT-11：優惠券從不變成已過期

沒有任何程式把券的狀態寫成 `EXPIRED`（`packages/core/src/coupon/issue.ts:42` 的註解）。序號明細的「已過期」篩選永遠 0 筆，過期的券顯示「已領取」，成效的過期數永遠是 0。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-27（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`apps/api/src/modules/coupon/coupon-stats.service.ts:45-52, 131-133`（讀程式）。

<a id="mkt-12"></a>
### MKT-12：序號包券用完後暫停就無法恢復

已發布的序號包券沒有追加序號的介面。序號用完後一旦暫停，恢復時會重跑發布檢查，被「須先匯入可用序號」擋下，再也恢復不了。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-28（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`apps/web/src/components/coupon/CouponForm.tsx:852-855`、`apps/api/src/modules/coupon/coupon-lifecycle.service.ts:81-88,122-124`（讀程式）。

<a id="short-01"></a>
### SHORT-01：記錄點擊的公開端點採信呼叫端提供的身分

`shortlink-redirect.routes.ts` 的 `POST /s/track` 不需要登入，也沒有速率限制。它把 body 的 `cid`（聯絡人 ID）與 `lineUid` 交給 `shortlink.service.ts` 的 `recordClick()`（2026-10-28 之前是 `trackClick()`），兩者都不驗證：`lineUid` 對到渠道身分時以它的聯絡人為準，否則直接使用 `cid`。

- 知道同租戶某個聯絡人的 ID 或 LINE uid，就能替他記一筆點擊，觸發 `tagOnClick` 貼標，以及訂閱 `contact.tagged`、`link.clicked` 的自動化規則，例如自動傳訊息給他。
- 沒有 `lineUid` 的點擊，每次都算一次不重複點擊。點擊數與不重複點擊數都能被任意灌高。

`addTagToTarget()` 會檢查聯絡人屬於短連結的租戶，所以貼標不會跨租戶。

**部分修正（2026-10-06，RLS-07 的修正一併處理）。** `trackClick()` 現在只採用格式正確、且屬於短連結租戶的 `cid`，其他租戶的聯絡人 ID 不再寫進 `ClickLog.contactId` 與 `link.clicked` 事件；不是 UUID 的 `cid` 視為匿名點擊（原本 `clickLog.create` 會拋錯，點擊默默沒有被記錄）。仍未處理：同租戶的聯絡人 ID 與 `lineUid` 仍可冒用，也仍然沒有速率限制。

<a id="short-02"></a>
### SHORT-02：改短連結的目標網址後社群預覽不更新

編輯對話框把現有的 OG 值（含自動抓到的）一起送回，`shortlink.flow.ts` 判定「手動填了 OG」就不重抓。因此改了目標網址之後，社群平台抓到的預覽仍是舊網站。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-SHORTLINKS-01（[SHORTLINKS 健檢](../features/health/SHORTLINKS.md)）。證據：`apps/web/src/components/shortlink/LinkFormDialog.tsx:65-67,105-107`、`apps/api/src/modules/shortlink/shortlink.flow.ts:70`、`shortlink.service.ts:32-34`；目標從 GitHub 改成 python.org，6 秒後 `ogTitle` 仍是 GitHub，`curl -A facebookexternalhit` 回 GitHub 的預覽（健檢實測）。

<a id="short-03"></a>
### SHORT-03：短連結的點擊貼標不驗證標籤

標籤選單列出全部標籤，包含工單範圍的標籤；後端只檢查 `tagOnClick` 長度不超過 100，不存在或範圍不對的標籤照樣存入。點擊時貼標必定失敗，只寫 API log，後台看不到。`tagOnClick` 沒有外鍵，標籤被刪除後已設定的連結也默默失效。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-SHORTLINKS-02（[SHORTLINKS 健檢](../features/health/SHORTLINKS.md)）。證據：`apps/web/src/app/dashboard/shortlinks/page.tsx:27-31`、`apps/api/src/modules/shortlink/shortlink.routes.ts:65`、`shortlink.service.ts:411-421`；以工單標籤與不存在的 UUID 各建一條連結（200），帶 `cid` 點擊後聯絡人沒有被貼標，log 為 `Tag scope CASE cannot be assigned to CONTACT`（健檢實測）。

<a id="short-04"></a>
### SHORT-04：建立短連結回傳原始錯誤訊息

`shortlink.routes.ts` 以 `try/catch` 把所有例外包成 400，並回傳原始訊息。Prisma 錯誤原文（含伺服器檔案路徑與程式片段）因此顯示在建立視窗，違反 `AGENTS.md` 的「Do not return raw errors」。

自訂代碼全域唯一，但 `createShortLink()` 在租戶連線下查重，RLS 讓它看不到其他租戶的代碼，所以跨租戶重複時檢查通過、寫入時撞到唯一約束，也走這條路徑。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-SHORTLINKS-03（[SHORTLINKS 健檢](../features/health/SHORTLINKS.md)）。證據：`apps/api/src/modules/shortlink/shortlink.routes.ts:118-124`、`shortlink.service.ts:123-128`；`POST /shortlinks {"tagOnClick":"not-a-uuid", …}` 回 400，訊息是 `Invalid prisma.shortLink.create() invocation in /Users/…`（健檢實測）；跨租戶重複為讀程式加部分實測。

<a id="ana-01"></a>
### ANA-01：報表以 UTC 切分日期

`analytics.service.ts` 以 `date_trunc('day' | 'week' | 'month', "createdAt")` 分組。時間欄位是不帶時區的 `TIMESTAMP(3)`，存的是 UTC，資料庫連線也以 UTC 計算。台灣時間凌晨 0 點到 8 點的訊息、工單與聯絡人，會被算進前一天；週與月的邊界也差 8 小時。

2026-10-30 功能健檢補上兩點：

- 報表頁的區間以瀏覽器的本地時區送出，KPI 總數是台灣時間的一天；趨勢圖卻以 UTC 的 `date_trunc` 分組，同一天的資料被拆成兩個點，兩者對不起來。
- 「我的績效」的「本月」與每日彙總（`analytics.aggregator.ts`）以 **API 伺服器的時區** 切月、切日（`new Date(y, m, 1)`）。UAT 的容器沒有設定 `TZ`，是 UTC，每月 1 日台灣 0–8 點的工單算到上個月。`TenantSettings.timezone`（預設 `Asia/Taipei`）存在，但報表沒有使用。

分群的建立日期條件有同樣的問題，見 MKT-05。**健檢來源**（2026-10-30，程式版本 `5c81102e`）：ANA-01 補充（[ANALYTICS 健檢](../features/health/ANALYTICS.md)）。證據：`apps/api/src/modules/analytics/analytics.service.ts:13-22, 212, 492, 560-562`、`analytics.aggregator.ts:19-20`；本機固定資料 5 則訊息都在台灣 10/21，KPI 為 5，`message-trend` 回 UTC 10-20、10-21 兩筆（健檢實測）。

同一份報表的「平均首次回應時間」讀 `Case.firstResponseAt`。沒有關聯對話的工單不會有這個值，不計入平均，見 SLA-05。

<a id="ana-02"></a>
### ANA-02：工單報表的匯出與 CSAT 報表讀出期間內的所有工單

analytics 的其他統計以 SQL 的 `count` 或 `$queryRaw` 彙總，或以 `take` 限制筆數，回傳的筆數不隨資料量增加。下面兩處不同：

| 端點 | 現況 |
| --- | --- |
| `POST /api/v1/analytics/export`，`reportType: 'cases'` | `exportCsv()` 以 `case.findMany` 讀出期間內的所有工單與指派客服、聯絡人，沒有 `take`，在 API 行程內組成整份 CSV |
| `GET /api/v1/analytics/csat` | 以 `case.findMany` 讀出期間內所有送過問卷的工單，在 JavaScript 計算回覆率、平均分數與滿意率。低分工單清單取前 20 筆，但查詢沒有排序，所以列出哪 20 張不固定 |

兩處都在一個請求內完成。工單多的租戶選了長的期間時，回應時間與 API 的記憶體用量隨工單數增加。#337 搬遷之後，這兩處的查詢在租戶交易內執行，交易的逾時是 5 秒。

**量測（2026-10-30，UAT，main `105b76bf`）**：Demo Tenant 的工單共 10 張。伺服器端 p50：工單報表的匯出約 6.5 ms，CSAT 報表約 4.7 ms。所以目前的資料量量不出這個問題，本項是依查詢的寫法判斷。量測方法與其他端點的結果記在 #337 的規劃。

**修正方向**：

- CSAT 報表：數量、平均分數與滿意率改用 SQL 彙總，低分工單另外查詢，加上排序與 `take: 20`。指定排序會讓回傳的清單變成固定的，要寫進主規格 `analytics-reports`。
- 工單報表的匯出：二選一，兩者都要開 change：
  - 限制匯出筆數，超過時告知使用者。
  - 改成背景工作產生檔案，做法比照 `tenant/data-export`。

<a id="ana-03"></a>
### ANA-03：報表匯出的 CSV 沒有跳脫

`analytics.service.ts` 匯出 CSV 時，工單報表只替標題加引號，聯絡人名稱、客服姓名、分類原樣輸出；客服報表的姓名也一樣。聯絡人名稱來自 LINE、FB 暱稱或 WebChat 訪客自填：

- 名稱含逗號時，後面的欄位錯位。
- 名稱以 `=`、`+`、`-`、`@` 開頭時，Excel 把它當成公式（CSV injection）。顧客可以自己設定這個值。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-ANALYTICS-04（[ANALYTICS 健檢](../features/health/ANALYTICS.md)）。證據：`apps/api/src/modules/analytics/analytics.service.ts:652-666, 672-685, 701-703`；聯絡人名稱改成 `=HYPERLINK("http://evil.example","hc-analytics, 點我")`，匯出的工單 CSV 標題列 10 欄、資料列 11 欄（健檢實測）。子代理原列 P2，2026-10-30 使用者決定升為 P1。

<a id="portal-01"></a>
### PORTAL-01：粉絲門戶的活動結果端點回傳測驗答案與未發布活動的結果，詳情端點不看開放時間

`portal-public.routes.ts` 的 `GET /api/v1/fan/activities/:id/result` 呼叫 `portal.service.ts` 的 `getActivityResult()`：

- 回傳每個選項的 `isCorrect`。活動列表與詳情的查詢刻意不選這個欄位，結果端點卻沒有。粉絲可以在作答前讀到測驗的正確答案，再送出滿分換取積分。
- 只以活動 ID 與租戶查詢，不看活動的狀態與作答者。草稿、未發布或已下架活動的投票與作答統計，持有該租戶 fanToken 的人都讀得到。

活動詳情端點 `GET /api/v1/fan/activities/:id` 呼叫 `portal.service.ts` 的 `getActivityForFan()`，只檢查活動已發布，不看開始與結束時間。活動列表（`listOpenActivitiesForFan()`）只列出已開始、還沒結束的活動，詳情端點卻沒有同樣的條件。知道活動 id 的人，可以讀到還沒開始的活動的選項與參加人數，也可以讀到已經結束的活動。送出時另外檢查開始與結束時間，所以不會提早或延後參加。已經結束的活動要不要讓粉絲看（例如查看自己的作答），是產品的決定。

原本以「`signFanToken()` 沒有呼叫端，粉絲門戶的端點實際上無法進入」標為 P3。2026-10-30 功能健檢確認這個前提已不成立：優惠券系統（`5234b9b6`，2026-10-22）起，票券夾開啟成功就簽發 24 小時的 fanToken（`coupon-wallet.service.ts` 的 `grantWalletSession`），存在顧客瀏覽器的 sessionStorage，可以呼叫 `/api/v1/fan/activities*`、`/fan/me/*`、`/fan/member-binding*`。目前沒有粉絲活動的前端，一般顧客不會碰到，但拿到 token 的人可以直接呼叫，因此調為 P2。**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PORTAL-02（[PORTAL 健檢](../features/health/PORTAL.md)）。證據：`apps/api/src/modules/coupon/coupon-wallet.service.ts:104-122`（讀程式）；結果端點回傳 `isCorrect`、草稿活動的結果也讀得到（健檢實測）。

**修正方向**：結果端點只對已發布的活動開放，測驗的 `isCorrect` 只在該粉絲作答後（或活動結束後）回傳。

<a id="portal-02"></a>
### PORTAL-02：粉絲門戶送出活動一律回 400

`POST /api/v1/fan/activities/:id/submit` 以 `try/catch` 包住 `submitActivityFlow()`，所有錯誤都回 400 `BAD_REQUEST`，`message` 是原始錯誤訊息。

- `submitActivity()` 拋出的 `AppError` 本來帶有 404 `ACTIVITY_NOT_AVAILABLE`、409 `ACTIVITY_NOT_STARTED`、`ACTIVITY_ENDED`、`ALREADY_SUBMITTED` 等狀態碼與代碼，全部被改成 400，用戶端分不出「已經作答過」與「輸入錯誤」。
- 非 `AppError` 的例外（例如 Prisma 錯誤）也把原始訊息回給公開用戶端，違反 `AGENTS.md` 的「Do not return raw errors」。

原本以「端點目前無法進入」標為 P3。這個前提已不成立（見 PORTAL-01），調為 P2。2026-10-30 功能健檢實測：「您已參加過這個活動」（409）、草稿與已結束（404）都變成 400 `BAD_REQUEST`，Prisma 錯誤原文（含伺服器檔案路徑與程式碼片段）直接回給公開端。main 已把輸入解析移到 `try` 之外，業務錯誤仍轉成 400（[PORTAL 健檢](../features/health/PORTAL.md)）。修正方式是移除這段 `try/catch`，交給全域的錯誤處理。

<a id="portal-03"></a>
### PORTAL-03：編輯草稿活動會清掉選項

活動頁把清單項當成編輯資料，而 `portal.service.ts` 的 `listActivities()` 不 include `options`、`fields`。編輯對話框因此沒有帶出原本的選項與欄位；只改標題就按「儲存」，前端送出 `options: []`，`updateActivity()` 收到空陣列就 `deleteMany`，所有選項（含競猜的正確答案）或表單欄位被刪光。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PORTAL-01（[PORTAL 健檢](../features/health/PORTAL.md)）。證據：`apps/web/src/app/dashboard/portal/page.tsx:182`、`apps/api/src/modules/portal/portal.service.ts:44-54, 131-156`、`apps/web/src/components/portal/ActivityFormDialog.tsx:62-71, 99-104`；本機介面改標題儲存後 `options` 為 `[]`；UAT 以前端相同的 body PATCH 草稿，回應 `options: []`（健檢實測）。

<a id="portal-04"></a>
### PORTAL-04：粉絲送出活動的答案不驗證

`portal.service.ts` 的送出流程不驗證答案：

- 不屬於該活動、甚至不是 UUID 的 `optionIds` 照收並給點。
- 表單的必填欄位空白也收。
- 投票不限選幾個；競猜全選即滿分（功能文件已寫）。

fanToken 已有簽發端（見 PORTAL-01），持有 token 的人可以直接呼叫。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PORTAL-06（[PORTAL 健檢](../features/health/PORTAL.md)）。證據：`apps/api/src/modules/portal/portal.service.ts:263-333`；本機對投票送 `optionIds: ["0000…", "zzz"]` 回 200 並加 10 點，必填表單送 `fields: {}` 回 200（健檢實測，版本 `5c81102e`）；目前 main 仍存在為讀程式。

## 渠道、稽核與資料權利

功能說明見[租戶後台](../features/tenant/README.md)底下的渠道管理與稽核、資料權利與對外整合兩份文件。

<a id="chan-01"></a>
### CHAN-01：渠道刪除是硬刪除，有對話的渠道刪不掉

`AGENTS.md` 規定渠道以 `isActive: false` 軟刪除，但 `channel.service.ts` 的 `deleteChannel()` 呼叫 `prisma.channel.delete()`。

`Conversation`、`ChannelUsage` 與 `RichMenu` 指向渠道的外鍵沒有設定 `onDelete`，也就是 `RESTRICT`。

- 有對話的渠道刪除時，資料庫拒絕。repo 沒有處理 Prisma 的外鍵錯誤（`P2003`），前端收到一般的伺服器錯誤，看不出原因。
- 沒有對話的渠道刪除時，`ChannelIdentity`、`ChannelTeamAccess`、`AgentChannelAccess` 與 `ChatboxSession` 因 `onDelete: Cascade` 一併刪除。

**部分修正（change `fix-admin-settings-safeguards`，2026-10-15）。** `deleteChannel()` 把 `P2003` 轉成 409 `CHANNEL_IN_USE`，訊息建議改用停用；渠道管理頁每張卡片新增「停用」與「啟用」按鈕（`PATCH /channels/:id` 的 `isActive`）。沒有對話的渠道刪除時仍是硬刪除，上面第二點沒有改。

<a id="chan-02"></a>
### CHAN-02：workers 沒有網站聊天室外掛，關鍵字回覆在網站聊天室送不出去

API 行程以 `registerChannelPlugin()` 註冊 LINE、FB、WEBCHAT、THREADS 四個外掛。workers 行程不用這個註冊表，而是用 `apps/workers/src/lib/plugin-registry.ts` 的 `createWorkerPluginRegistry()`。自動化的 `send_message`、`send_material` 在 workers 執行，由 `channel-delivery.ts` 的 `deliverToChannelFromWorker()` 以這份清單找外掛；找不到時寫入一則失敗訊息「系統未載入 … 渠道外掛，無法送出」。

**已修正**（`95d68fc8`，change `fix-keyword-yield-ig-delivery`）：

- workers 的清單加入 `threadsPlugin`，規則可以回覆 Instagram 私訊。
- `hasMatchingKeywordRule()` 只把能在這個渠道回覆的規則算進去（`send_message`，或素材渠道與對話相同的 `send_material`），而且渠道要在 `channel-plugins` 的 `AUTOMATION_DELIVERY_CHANNEL_TYPES` 裡。只加標籤、素材是別的渠道的規則，或網站聊天室的對話，不再讓知識庫與 AI 讓步。
- `send_material` 因素材渠道與對話不同而略過時，在對話寫入「沒有送出」的紀錄。

2026-10-14 在 UAT 確認原本的問題：創造智能接上 Instagram 後，第一則私訊含「你好」，命中只送 LINE 素材的規則，AI 讓步、素材被略過，客人沒有收到任何回覆，失敗只在 workers 的 log。

**未修正**：workers 的清單仍沒有 `webchatPlugin`，關鍵字與自動化規則的回覆送不到網站聊天室（收件匣有失敗紀錄）。AI 不會因此讓步，訪客仍收到 AI 回覆。即使補上外掛也不夠：`webchatPlugin.sendMessage()` 只寫 log，訪客看到訊息靠的是 API 的 `conversation.service.ts` 推送到 `visitor:<channelId>:<uid>` 房間，workers 的送出路徑沒有這一步。

**群發與批次發券也送不到網站聊天室（2026-10-30 功能健檢）。** API 行程的群發與批次發券同樣呼叫 `webchatPlugin.sendMessage()`，它只寫 log 並回成功；附券流程也沒有推送 socket 或寫入訊息。WebChat 渠道的群發與發券顯示「成功」、發券數照算，顧客實際收不到任何訊息，對話裡也沒有外送訊息。群發頁的渠道選單列出 WebChat；批次發券的介面不列 WebChat（`COUPON_PUSH_CHANNEL_TYPES`），但 API 照收並同樣回成功。UAT Demo 租戶也有 WebChat 渠道可以選。顧客收不到券，系統紀錄卻顯示已送達，因此這一項由 P2 調為 P1。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-04（[MARKETING 健檢](../features/health/MARKETING.md)）。證據：`packages/channel-plugins/src/webchat/index.ts:48-56`、`apps/web/src/app/dashboard/marketing/page.tsx:285`、`apps/web/src/lib/marketing/coupon-broadcast.ts:89`；WebChat 渠道的附券群發 `completed`、成功 3、發券 3，`messages` 表沒有任何外送訊息（健檢實測）。

**修正方向**：網站聊天室的訪客推送移進外掛或共用的送出函式，再加入 workers 的清單；群發與發券改用同一個送出函式，送不到時不能回成功；關鍵字回覆頁建立的規則加上渠道條件，或在頁面上註明會套用到所有渠道。

<a id="chan-06"></a>
### CHAN-06：LINE 的測試連線不檢查 Channel Secret

`channel.service.ts` 的 LINE 測試連線只用 Channel Access Token 呼叫 `/v2/bot/info`，不檢查 Channel Secret。Secret 填錯時測試連線顯示成功，之後每則 LINE webhook 都因簽章不符回 403（`webhook.routes.ts:55-58`），渠道卡片沒有任何警示。FB、IG 有 `webhookRouting` 警示，LINE 沒有對應的機制。手冊 ch15 第 2 節已提醒。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CHANNELS-05（[CHANNELS 健檢](../features/health/CHANNELS.md)）。證據：`apps/api/src/modules/channel/channel.service.ts:564-590`、`apps/api/src/modules/webhook/webhook.routes.ts:55-58`（讀程式；無法在本機以真實 LINE 帳號重現）。

<a id="chan-07"></a>
### CHAN-07：LINE 重送事件被重複處理

進站去重只看 `message.id`（`inbound-message-writer.ts:26`）。LINE 重送事件（`deliveryContext.isRedelivery`）時，沒有訊息 id 的事件被重複處理：

- postback 存兩則，再跑一次攔截（貼標、轉真人、CSAT）與 AI、自動化。
- follow 存兩則，`followCount` 加兩次。

LINE 文件建議以 `webhookEventId` 去重，程式只有下游轉發的迴圈防護用到它。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-LINE-02（[LINE 健檢](../features/health/LINE.md)）。證據：`apps/api/src/modules/webhook/inbound-message-writer.ts:26`、`packages/channel-plugins/src/line/index.ts:376`；同一個 `webhookEventId` 的 postback 先後以 `isRedelivery:false`、`true` 送入，收件匣出現兩則；follow 讓 `followCount` 從 0 變 2（健檢實測）。

<a id="chan-08"></a>
### CHAN-08：客人收回的 LINE 訊息仍然顯示

進站管線沒有處理 `unsend` 事件。客人收回訊息時，原訊息照常顯示，另外多一則「[不支援的訊息類型]」並增加未讀數。LINE 開發準則要求尊重收回，收回的訊息之後不能被看到或使用。

**規格依據。** 主規格 `line-webhook-events` 規定收到 `unsend` 時 SHALL 把原訊息標成 `recalled`。現況違反這條需求。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-LINE-03（[LINE 健檢](../features/health/LINE.md)）。證據：`packages/channel-plugins/src/line/index.ts:402`；先送 text `hcmsg0001`、再送 `unsend` 指向它，收件匣兩則都在、原文未變（健檢實測）。

<a id="chan-09"></a>
### CHAN-09：下游轉發被擋下時訊息消失

渠道的下游轉發設為 `immediate` 時，CRM 不處理訊息，交給目標網址。目標網址被 SSRF 防護擋下（內網、DNS 失敗）時不轉發，CRM 也不處理，訊息完全消失，只寫一行 warn log。存設定時只檢查 https，不檢查網址會不會被擋；錯誤訊息是英文「url must use https」。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-LINE-05（[LINE 健檢](../features/health/LINE.md)）。證據：`apps/api/src/modules/webhook/webhook.service.ts:207-213`、`apps/api/src/modules/channel/channel.routes.ts:43`、`apps/api/src/modules/webhook/downstream-forwarder.ts`；設定 `https://localhost/hc-line-hook` 後送一則訊息，`messages` 查無該訊息，log 只有 `Blocked SSRF target`（健檢實測）。

<a id="chan-10"></a>
### CHAN-10：圖文選單綁定受眾失敗沒有紀錄

綁定受眾只回「已送出綁定給 N 位」。背景工作（`rich-menu-bind`）失敗時（權杖失效、LINE 限流、使用者已封鎖）不重試，也不通知；畫面與渠道都沒有紀錄，只有平台的佇列監控看得到。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-LINE-06（[LINE 健檢](../features/health/LINE.md)）。證據：`apps/api/src/modules/line/rich-menu.service.ts:643`、`apps/workers/src/handlers/rich-menu-bind.handler.ts`；假 `lineRichMenuId` 綁定 1 位聯絡人，API 回 `{queued:1}`，job 的 `failedReason` 是 LINE 401、`attempts:0`（健檢實測）。

<a id="chan-11"></a>
### CHAN-11：圖文選單的日期時間選擇存不了

`AreaActionEditor.tsx` 把區域動作切成「日期時間選擇」時，模式下拉顯示「日期 + 時間」，但沒有寫入 `mode`。按「儲存草稿」回 400「日期選擇器必須指定模式」，要把下拉改成別的值再改回來才存得了。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-LINE-07（[LINE 健檢](../features/health/LINE.md)）。證據：`apps/web/src/components/line/rich-menu/AreaActionEditor.tsx:36, 113`；介面建立選單、區域 1 選日期時間選擇後儲存失敗，切換模式後儲存成功（健檢實測）。

<a id="aud-01"></a>
### AUD-01：租戶稽核只涵蓋部分操作

租戶稽核涵蓋成員、角色的建立改名刪除與權限、渠道的建立刪除與團隊授權、設定、合併聯絡人、刪除工單、資料匯出與刪除申請。`role`、`agent`（change `migrate-role-agent-tenant-ctx`）與 `case`、`contact`、`webtalk`（#337 階段 3）以 `recordTenantAudit()` 在交易內寫稽核，其他模組仍呼叫 `writeTenantAudit()`。下列操作沒有寫稽核：

| 範圍 | 沒有稽核的操作 |
| --- | --- |
| 認證 | 登入成功與失敗、Passkey 的註冊與刪除 |
| 長效憑證 | API 金鑰的建立與撤銷、CLI token 的建立（`/settings/cli-sessions`、`/auth/cli/login`）與撤銷 |
| 渠道 | 修改渠道，包括更換憑證（`PATCH /channels/:id`） |
| 業務 | 送出群發、自動化規則的增刪改、刪除知識庫文章、刪除標籤 |
| 行銷與優惠券（2026-10-30 健檢） | 優惠券的建立、發布、暫停、恢復、複製、刪除；群發與分群的建立。`coupon`、`marketing` 模組都沒有呼叫稽核函式 |
| 匯出與對外 Webhook（2026-10-30 健檢） | 下載匯出檔（只把 `downloadCount` 加一，同租戶任何持 `data.export` 的成員都能下載別人發起的匯出）；對外 Webhook 訂閱的建立、修改、刪除與測試送出。訂閱 `message.received` 就能把客人訊息持續送到外部網址（HOOK-01），刪除又是硬刪除，連 `WebhookDelivery` 一起刪掉，事後查不到曾送到哪個網址 |
| 其他敏感操作（2026-10-30 健檢） | 修改聯絡人的 email、電話；門市帳號的建立、重設密碼、強制登出、刪除（`store.manage`）；會員綁定設定與手動綁定、解除；SLA 政策的增刪改 |

長效憑證與渠道憑證的變更影響最大：事後無法查出是誰、在什麼時候建立了一把能長期存取租戶資料的金鑰。渠道憑證可以被看不到該渠道的成員更換，見 RBAC-07。稽核紀錄失去操作者的問題見 AUD-03、AUD-04。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-MARKETING-14（[MARKETING 健檢](../features/health/MARKETING.md)）、HC-GOVERNANCE-03（[GOVERNANCE 健檢](../features/health/GOVERNANCE.md)）、HC-GOVERNANCE-04（[GOVERNANCE 健檢](../features/health/GOVERNANCE.md)）、HC-GOVERNANCE-09（[GOVERNANCE 健檢](../features/health/GOVERNANCE.md)）。證據：優惠券與行銷操作、下載匯出檔、Webhook 訂閱的建立修改刪除、修改聯絡人 email 與電話之後 `tenant_audit_logs` 沒有新紀錄（健檢實測）；門市帳號、會員綁定、SLA 政策為讀程式，例如 `apps/api/src/modules/webhook-subscriptions/webhook-subscription.routes.ts:48, 58, 68, 86`、`apps/api/src/modules/data-export/data-export.flow.ts:62-69`、`apps/api/src/modules/store/store.routes.ts:56-100`。

<a id="aud-03"></a>
### AUD-03：永久刪除成員後，稽核紀錄失去操作者

`TenantAuditLog.actor` 的外鍵是 `onDelete: SetNull`，`agent.purge` 的稽核又只記 `targetId`，不記被刪成員是誰。成員被永久刪除之後：

- 他在稽核紀錄裡的所有操作變成 `actor: null`，與系統排程寫的紀錄無法區分。
- 資料匯出請求的 `requestedBy` 也變成 null。「誰匯出了全租戶資料」在這位成員被刪除後完全查不到。

永久刪除是釋放 email 的標準做法，UAT 已有 52 筆 `agent.purge`。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-GOVERNANCE-01（[GOVERNANCE 健檢](../features/health/GOVERNANCE.md)）。證據：`packages/database/prisma/schema.prisma:2132, 2156, 2178`、`apps/api/src/modules/agent/agent.flow.ts:150-160`；成員 X 發起資料匯出後被停用並刪除，同一筆 `data.export.request` 稽核的 `actorId` 變成 NULL（健檢實測）。

<a id="aud-04"></a>
### AUD-04：建立成員的稽核不記實際角色

`agent.flow.ts` 寫 `agent.create` 稽核時，`payload` 只有舊的角色列舉 `role`（例如 `"AGENT"`），不記實際指派的 `roleId` 與初始可見渠道。以高權限的自訂角色建立成員時，稽核看起來像建立了一般客服。雙欄位的問題見 RBAC-03。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-GOVERNANCE-10（[GOVERNANCE 健檢](../features/health/GOVERNANCE.md)）。證據：`apps/api/src/modules/agent/agent.flow.ts:60-67`；以含 `data.export`、`data.erase` 的自訂角色建立成員，稽核 `payload` 只有 `{"role": "AGENT"}`（健檢實測）。

<a id="erase-01"></a>
### ERASE-01：資料刪除沒有涵蓋所有個人資料

**涉及 GDPR。** 資料刪除對應個資法與 GDPR 的被遺忘權。下列資料在刪除後仍留在系統，客人要求刪除時無法完整履行。2026-10-16 決定暫時維持 P3。

`apps/workers/src/handlers/data-erasure.handler.ts` 有兩種模式：

- `anonymize`（預設）：清空聯絡人的個人欄位，刪除屬性、渠道身分、`IdentityMap` 與長期記憶，把進站訊息的內容換成 `{ redacted: true }`。
- `hard_delete`：刪除聯絡人與他的對話、訊息、工單、積分、活動提交與媒體檔。

沒有涵蓋的資料：

| 資料 | `anonymize` | `hard_delete` |
| --- | --- | --- |
| 客服回覆的訊息內容 | 保留 | 刪除 |
| 物件儲存裡的訊息媒體檔（頭像檔兩種模式都刪除） | 保留 | 刪除 |
| 活動提交（含表單答案）、積分 | 保留 | 刪除 |
| 工單標題、描述、備註、CSAT 留言 | 保留 | 刪除 |
| `ClickLog`（含 IP、User-Agent、LINE uid） | 保留 | 保留 |
| `BroadcastRecipient`、`KbArticleFeedback`、`FlowExecution` | 保留 | 保留 |
| 被合併到這位聯絡人的封存聯絡人（姓名、電話、email、頭像網址與頭像檔） | 保留 | 保留 |
| `Outbox.payload`（已送出的列不清除，例如 `case.created` 帶工單標題）、`WebhookDelivery.payload`（事件原文，含訊息內容）（2026-10-30 健檢） | 保留 | 保留 |
| 刪除前產生、7 天內仍可下載的匯出檔（2026-10-30 健檢） | 保留 | 保留 |

`ClickLog`、`BroadcastRecipient`、`KbArticleFeedback`、`FlowExecution` 只存 `contactId` 字串，沒有外鍵，兩種模式都不處理。預設模式保留了客人上傳的圖片與表單答案，這兩類最可能含個人資料。

最後一列來自聯絡人合併。`contact-merge.service.ts` 合併兩位聯絡人時，被併入的聯絡人只設定 `isArchived` 與 `mergedIntoId`，個人欄位不變。刪除的 handler 只處理請求指定的 `contactId`，不沿 `mergedIntoId` 找被併入的聯絡人。同一位客人在多個渠道各有一位聯絡人、後來合併時，刪除保留下來的那一位，其他渠道留下的姓名、電話與 email 仍在資料庫。封存的聯絡人可以另外以自己的 ID 發起刪除，但後台不列出封存的聯絡人，操作者不容易知道它們存在。

**刪除後仍可解除合併，被刪除的人重新出現（2026-10-30 功能健檢）。** `contact-merge.service.ts` 的解除合併只檢查紀錄與被併入方存在，刪除的 handler 也不處理 `ContactMergeLog`。匿名化主要聯絡人之後，合併紀錄的「解除合併」照樣成功，被併入的封存聯絡人恢復成一般聯絡人，姓名與 email 都在，回到聯絡人清單。硬刪除主要聯絡人之後，解除合併也回 200，被併入的那位同樣恢復。

`Outbox`、`WebhookDelivery` 與匯出檔三者都沒有保留期限或清除排程（匯出檔除外，7 天）。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-GOVERNANCE-06（[GOVERNANCE 健檢](../features/health/GOVERNANCE.md)）、HC-GOVERNANCE-08（[GOVERNANCE 健檢](../features/health/GOVERNANCE.md)）。證據：`apps/api/src/modules/contact/contact-merge.service.ts:466-475`、`apps/workers/src/handlers/data-erasure.handler.ts`、`apps/api/src/modules/webhook-subscriptions/webhook-dispatcher.ts:90-96, 195-197`；匿名化 D 之後 `POST /contacts/merge-logs/<log>/revert` 回 200、E 恢復且名稱與 email 原樣；匿名化 A 之後 outbox 仍有帶工單標題的 `case.created`（健檢實測）；WebhookDelivery 為讀程式。

**修正方向**：發起刪除時，一併處理 `mergedIntoId` 指向目標聯絡人的封存聯絡人（逐層往下找），並讓刪除後的合併紀錄不能再解除；清除或遮蔽 outbox 與 Webhook 送出紀錄裡的個人資料。

<a id="erase-02"></a>
### ERASE-02：資料刪除沒有防誤刪機制

`POST /tenant/data-erasure` 的 `hard_delete` 一次呼叫就排進佇列執行，約 1 秒內完成，對話、訊息、工單一併刪除：

- 沒有影響筆數的預覽、確認步驟、冷靜期或取消。
- 沒有列出請求的端點，只能以 id 查單筆。
- 同一位聯絡人可以重複發起。

目前沒有前端，誤用的風險來自直接呼叫 API 的整合或腳本。刪除涵蓋範圍的問題見 ERASE-01。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-GOVERNANCE-07（[GOVERNANCE 健檢](../features/health/GOVERNANCE.md)）。證據：`apps/api/src/modules/data-erasure/data-erasure.routes.ts:36-51`；`POST /tenant/data-erasure {mode:"hard_delete"}` 約 1 秒內完成（健檢實測）。

<a id="export-01"></a>
### EXPORT-01：資料匯出的通知、範圍參數、記憶體用量與重複執行

`POST /api/v1/tenant/data-export` 與 `apps/workers/src/handlers/data-export.handler.ts` 有四個問題：

| 問題 | 現況 |
| --- | --- |
| 完成通知的連結 | 成功與失敗的通知都連到 `/dashboard/settings/data-export/<請求 ID>`。前端沒有這個頁面，也沒有任何匯出、稽核或資料刪除的畫面 |
| 範圍參數 | API 接受 `scope`（資料類型陣列）並存進請求，但 worker 不讀它，一律匯出聯絡人、對話、訊息與工單 |
| 記憶體用量 | `fetchAllPaged()` 分頁查詢，卻把每一頁累加到同一個陣列，最後連同 JSON 字串與 zip 一起留在記憶體。函式註解寫「避免一次全載入記憶體」，實際上整個租戶的資料都載入 |
| 同時執行兩次 | 見下方「同一個請求同時執行兩次」 |

前兩項讓使用者看到不存在的頁面，或以為只匯出了部分資料。第三項在資料量大的租戶可能讓 workers 的記憶體用盡，同一個行程的其他佇列也會中斷。

**同一個請求同時執行兩次**（2026-10-29，#337 階段 3 搬遷 `data-export` 時分析）。handler 以請求狀態認領（主規格 `tenant-data-export`「worker 不重新處理已結束的匯出請求」）：

- 開始時，把 `pending` 或 `processing` 改成 `processing`。
- 完成時，只把 `processing` 改成 `completed`。
- 失敗時，只把 `processing` 改成 `failed`。

兩次執行同時進行時，A 還在打包，B 先失敗，B 就把請求改成 `failed` 並通知發起的成員。A 之後上傳了檔案，但完成的條件不成立，請求維持 `failed`。上傳的檔案沒有請求指向它，清理排程只處理 `completed` 的請求，所以這個檔案一直留在物件儲存。

同一個匯出工作被執行兩次的來源：

| 來源 | 兩次會不會同時執行 |
| --- | --- |
| outbox 重送：快速送出成功，但標記已送出失敗，relay 2 分鐘後再送一次 | 不會。job id 是 outbox id，佇列裡已有同一個 id 時，BullMQ 不建立新的工作。完成的工作保留 24 小時，超過之後才補送時，第一次早已結束，第二次認領失敗後直接結束 |
| BullMQ 判定工作卡住後重新派送：handler 以同步的 `JSON.stringify` 與 `zip.build()` 打包整個租戶的資料，event loop 被占住超過 lock 期限（預設 30 秒）時，lock 沒有續期 | 目前不會。workers 只有一個容器（compose 指定 `container_name`），data-export worker 的 `concurrency` 是預設的 1，重新派送的工作要等第一次結束才會被取出。workers 有兩個以上的行程時，會同時執行 |
| 行程中途結束（部署、記憶體用盡） | 不會。第一次已經停止，第二次把 `processing` 的請求重新處理，這是規格要求的行為 |

所以這個問題要同時滿足兩個條件才會發生：workers 有兩個以上的行程，而且某次打包占住 event loop 超過 lock 期限。根本原因與第三項相同。`data-erasure.handler.ts` 用同樣的方式認領，但刪除是資料庫交易，沒有長時間的同步運算，所以不列入本項。

**修正方向**：

- 通知連結改到實際存在的頁面，或在前端做出匯出頁面之前拿掉連結。
- `scope` 要嘛在 worker 生效，要嘛從 API 移除。
- 匯出改成逐表寫入 zip，不保留全部列。這也解決重複執行的根本原因：打包期間 event loop 不再被長時間占住，lock 能正常續期。
- workers 擴充成多個行程之前，再評估是否讓「成功的那次執行為準」：完成的條件放寬為 `processing` 或 `failed`。檔案已經產生時，請求最後是 `completed`，不會留下沒有請求指向的檔案；代價是發起的成員會先收到失敗通知，再收到完成通知。這會改變既有的 Requirement，要開 change。

<a id="hook-01"></a>
### HOOK-01：對外 Webhook 轉送所有內部事件，`message.received` 送出 `replyToken`

對外 Webhook 訂閱者只轉送 `packages/core/src/outbox/events.ts` 的 `EXTERNAL_EVENT_NAMES`（`717d32bf`）。事件的名稱只要在清單內、也在訂閱的 `events` 裡，就把事件的 `payload` 原樣放進 `data` 送出。訂閱 API 的 `events` 是 `z.array(z.string())`，不檢查名稱。

清單的機制已經有了，但第一版清單等於所有事件名稱，行為與加上清單之前相同。所以每一個業務事件仍是對外介面，包括只給內部使用的事件：

| 事件 | 原本的用途 |
| --- | --- |
| `keyword.matched` | 自動化的中間結果：哪一條關鍵字規則命中 |
| `sentiment.negative` | 情緒分析的中間結果 |
| `usage.quota.threshold` | AI 用量告警 |

`APP_EVENT_NAMES` 之後新增的名稱，`EXTERNAL_EVENT_NAMES` 也會跟著包含，所以新增的內部事件會自動成為對外介面。清單要縮減哪些事件，待產品決定。`docs/09_API_DESIGN.md` 的原始設計只舉業務事件為例（`case.created`、`case.closed`、`contact.tagged`），沒有說所有事件都對外。

**`replyToken` 送到外部網址。** `inbound-side-effects.ts` 的 `publishMessageReceived()` 在 `message.received` 的 `payload` 放入 LINE 的 `replyToken`。訂閱這個事件的網址會收到 `replyToken`，可以在 LINE 的回覆期限內，以這個官方帳號的身分回覆客人一次。建立訂閱只需要 `webhook.manage`，不需要渠道設定的權限。

**優先順序。** 不違反主規格：`webhook-subscription-egress` 只規定訂閱網址的檢查。`replyToken` 外流要有人訂閱 `message.received` 才會發生，所以列為 P2。

## 部署與應用程式

<a id="dep-01"></a>
### DEP-01：殘留的 Video Worker 設定

`apps/video-worker` 沒有原始碼與 `package.json`，但開發 Compose 仍保留 `nm_videoworker` volume 與掛載點。

<a id="dep-02"></a>
### DEP-02：`.env.prod.example` 的變數送不到讀取它們的行程

`docker-compose.prod.yml` 只把 `.env.prod` 掛給 `nginx` 與 `certbot` 兩個服務的 `env_file`。api、workers、web 各自讀 `.env.api`、`.env.workers`、`.env.web`。

`.env.prod.example` 除了 `DOMAIN` 與 `CERTBOT_EMAIL`，還放了下表這些變數。它們只有 api 或 workers 讀：

| 變數 | 讀取端 | 缺少時的行為 |
| --- | --- | --- |
| `DATABASE_URL_ADMIN` | `apps/api/src/plugins/prisma.plugin.ts` 的 `prismaPlugin()`、`apps/workers/src/index.ts` 的 `main()` | api fallback 到租戶連線，workers 拋錯不啟動。見 RLS-04 |
| `CHATBOX_SESSION_TTL_MINUTES` | `apps/api/src/modules/chatbox/chatbox.service.ts` 的 `getChatboxSessionTtlMs()` | 取程式預設值，與範例檔給的值相同 |
| `WEBCHAT_LEGACY_ROUTES_ENABLED` | `apps/api/src/modules/webchat/webchat.routes.ts` 的舊版訪客 token 路由 | 取程式預設值 `false`，與範例檔給的值相同 |

nginx 的 entrypoint 只用 `DOMAIN`，certbot 的 entrypoint 只用 `DOMAIN` 與 `CERTBOT_EMAIL`。拿到 `.env.prod` 的這兩個容器都不讀上表的變數。

實際影響集中在 `DATABASE_URL_ADMIN`。api 缺少這個變數時不會報錯，`prismaAdmin` 直接指向租戶連線，因此失去 BYPASSRLS。走白名單的服務查詢受 RLS 的租戶表時，會得到空結果，而不是錯誤。這些服務包含平台後台、auth、排程、OAuth callback 與公開 webhook。唯一的訊號是啟動 log 少印 `+ admin`。另外兩個變數的程式預設值與範例檔的值相同，缺少它們沒有差別。

上表的變數在 `.env.api.example` 都已經有一份，`DATABASE_URL_ADMIN` 在 `.env.workers.example` 也有。部署時逐一複製 `.env.*.example` 就不會缺這些值。`.env.prod.example` 裡的這幾行是第二份副本，改一邊不會同步到另一邊。

`docker-compose.prod.yml` 開頭的步驟說明只要求建立 `.env.prod`，沒有提到 `.env.api`、`.env.web`、`.env.workers`。Compose 發現 `env_file` 指向的檔案不存在時，在解析階段就報錯，不會啟動任何服務。照那份步驟說明操作，`docker compose -f docker-compose.prod.yml up -d` 會直接失敗。`AGENTS.md` 的「Environment Gotchas」有寫要複製這三個檔案，prod compose 檔本身沒寫。

CI 的部署不走這條路徑。`.github/workflows/deploy.yml` 用的是 `docker-compose.yml`，而且有一步檢查 `.env.web`、`.env.api`、`.env.workers` 是否存在，缺一個就讓部署失敗。因此這個落差只影響照 `docker-compose.prod.yml` 手動部署的人。

<a id="app-02"></a>
### APP-02：WhatsApp 與 Telegram 沒有註冊外掛

渠道套件只匯出 `TelegramPlugin` 類別，沒有 `telegramPlugin` 實例。API 因此無法將 Telegram 傳給 `registerChannelPlugin()`。執行時檢查顯示 LINE、Facebook、WebChat、Threads 已註冊，Telegram 未註冊。

WhatsApp 也沒有註冊外掛，也沒有 webhook 路由，但 `channel.routes.ts` 的 `createChannelSchema` 接受 `WHATSAPP`。租戶可以建立 WhatsApp 渠道，卻收不到訊息也送不出去。

Telegram 未註冊沒有實際影響：`createChannelSchema` 不接受 `TELEGRAM`，租戶無法建立 Telegram 渠道。

**優先順序。** 主規格 `telegram-channel` 原本要求應用程式啟動時註冊 Telegram 外掛，這一項因此列為 P2。issue #217 確認 Telegram 沒有客戶需求，移除了這份主規格，這一項回到 P3。剩下的落差是 WhatsApp 渠道可以建立卻無法使用，屬於設定與實際行為不符。WhatsApp 沒有主規格。

<a id="app-03"></a>
### APP-03：啟動 log 過時

API 啟動 log 寫死為 `LINE, FB, WEBCHAT`，但實際註冊表也包含 Threads。

<a id="app-04"></a>
### APP-04：Worker 檔名與內容不符

API 的 `automation.worker.ts` 與 `notification.worker.ts` 回傳訂閱者的處理函式，由 API 行程的訂閱者 Worker（`apps/api/src/events/subscriber-workers.ts`）呼叫。處理函式再送出 `automation`、`notification` 的 job，這兩個佇列的 consumer 位於 `apps/workers`。檔名的 worker 兩種意思都不完全對。

<a id="app-05"></a>
### APP-05：API 行程的 SLA 通知訂閱永遠收不到事件

`notification.worker.ts` 的 `setupNotificationWorker()` 訂閱 `sla.warning` 與 `sla.breached`。SLA 掃描在 `apps/workers` 的 `sla.handler.ts`，它直接送出通知，不經過 API 行程的 eventBus。API 行程裡也沒有其他程式發布這兩個事件。

因此這兩個訂閱者永遠不會執行。讀程式時容易誤以為 SLA 通知經過這裡。

<a id="app-06"></a>
### APP-06：訊息模擬器在所有環境都可用

`apps/api/src/index.ts` 無條件註冊 `/api/v1/simulator`。`channels/simulator/simulator.routes.ts` 只掛 `fastify.authenticate`，沒有權限碼，也不檢查執行環境。前端的 `SimulatorPanel.tsx` 在 `NODE_ENV` 不是 `development` 時不顯示，但這只隱藏入口，API 在正式環境一樣可用。

`simulator.service.ts` 的 `simulateInboundMessage()` 會建立聯絡人與對話、寫入訊息，並發布 `message.received`。任何已登入的成員都能用自己租戶的任一渠道，偽造一則來自任意 uid 的進站訊息。這則訊息會觸發機器人回覆、情緒分析、自動化規則、新訊息通知與對外 Webhook，AI 用量也計入租戶額度。

影響範圍限於呼叫者自己的租戶。

<a id="app-07"></a>
### APP-07：Canvas 等待節點的 BullMQ 路徑永遠失敗

`packages/core/src/canvas/scheduler.ts` 的 `scheduleWaitNode()` 先嘗試建立名為 `flow:resume` 的 BullMQ 佇列送出延遲工作，失敗時退回資料庫輪詢。實際上前者從未成功：

- `pnpm-lock.yaml` 鎖定的 BullMQ 是 5.71.0，它的 `QueueBase` 建構子在名稱含 `:` 時拋出 `Queue name cannot contain :`。錯誤被 `catch` 接住，每個等待節點都寫一筆「BullMQ scheduling failed」的 warning。
- 即使建立成功，`apps/workers` 與 API 都沒有消費 `flow:resume` 的 worker，工作會永遠留在 Redis。

所以 Canvas 的喚醒完全靠 API 行程的 `canvas.scheduler.ts` 每 60 秒輪詢，精度是 60 秒。`CANVAS-FLOW-ENGINE.md` 原本寫「優先用 BullMQ 的延遲工作」，已改正。

**修正方向**：移除 BullMQ 路徑，或改用不含冒號的名稱並在 workers 加上消費者。只改名而不加消費者時，工作會一直留在 Redis 的 delayed set。輪詢也受 [RLS-01](#rls-01) 影響，修正 RLS-01 時一併處理。

<a id="app-08"></a>
### APP-08：Redis 沒有記憶體上限（佇列的保留期限已補上）

BullMQ 預設保留所有完成與失敗的工作。

**已修正的部分。** 所有佇列都已設定保留期限：

| 佇列 | 保留期限 | 修正 |
| --- | --- | --- |
| `notification`、`automation` | 完成 24 小時、失敗 7 天 | `5f392e60`、`3710b293`、`0585cd33` |
| `event-notification`、`event-automation`、`event-webhook`、`webhook-delivery`、`usage-alert-email` | 完成 24 小時、失敗 7 天 | change `outbox-event-delivery` 新增時就設定 |
| `rich-menu-bind`、`data-export` | 完成 24 小時、失敗 7 天 | change `queue-monitoring`（`aabe714f`） |
| `sla`、`data-export-cleanup`、`tag-expiry-cleanup`、`agent-retention-cleanup` | 完成 24 小時、失敗 7 天。workers 啟動時刪除既有的重複工作再重新註冊，部署前已排定的工作也套用 | change `queue-monitoring`（`aabe714f`）。`tag-expiry-cleanup` 先前漏列在本表 |
| `ops-alert` | 完成 24 小時、失敗 7 天 | change `queue-monitoring` 新增時就設定 |
| `data-erasure` | 完成 24 小時、失敗 7 天 | change `migrate-data-erasure-tenant-ctx` 改經 outbox 送出時，從 100 筆、50 筆改成以時間計算 |
| `api-scheduler` | 完成 100 筆、失敗 50 筆 | 原本就設定 |

**未修正的部分。** Redis（`docker-compose.yml`、`docker-compose.prod.yml`）沒有設定 `maxmemory` 或淘汰策略。每筆工作以 hash 存在 Redis，含完整的 `data`；保留期限限制了工作的數量，但 Redis 的用量仍沒有上限。

**修正方向**：Redis 設定 `maxmemory`，淘汰策略要用 `noeviction`，避免佇列的鍵被淘汰。

<a id="app-09"></a>
### APP-09：API 行程假設只有一份

生產環境只跑一個 `api` 容器，所以下列問題目前不會出現。但只要水平擴充，就會同時出現：

| 機制 | 多個 API 行程時 |
| --- | --- |
| API 行程內的排程（群發、CSAT、Canvas、閒置關閉、試用、報表彙總、權杖檢查） | **重複觸發已修正，重複處理只剩 Canvas。** 改由 BullMQ Job Scheduler 觸發（`apps/api/src/lib/job-scheduler.ts`），不論有幾個行程，每一期只產生一筆 job。這筆 job 仍可能執行不只一次：執行中的行程被強制結束時，BullMQ 會重新執行。同一個排程的兩期也可能重疊（一期跑超過週期時），Canvas 與試用以 `withoutOverlapping` 防止。寄送滿意度問卷、問卷逾時結案（#333）、閒置關閉（#302）與群發都以條件更新認領資料，重跑或和使用者操作同時發生時不會重複處理。Canvas 等待節點喚醒仍只以 id 更新，鎖過期後兩期同時執行時可能重複恢復同一個流程（#334） |
| `crm:events`（Canvas） | 每個行程的 `canvas.worker.ts` 都收到同一則 `canvas.send_message`，客人收到多次 |
| 行程記憶體的狀態 | 非營業時間回覆的去重、工單輪流指派的位置、價目表快取（USAGE-02）、租戶方案快取，各行程各自一份 |
| Socket.IO | 沒有 Redis adapter。`@socket.io/redis-adapter` 列在 `apps/api/package.json`，但程式沒有使用。API 直接推送的事件只送到同一個行程的客戶端 |

這些問題分散在各模組，單獨看都像是小事，但合起來代表 API 目前無法水平擴充。

**修正方向**：Redis 廣播改成 BullMQ 佇列，或在接收端以事件 ID 去重；行程記憶體的狀態改存 Redis；Socket.IO 接上 Redis adapter。

要同時執行多個 api 容器，還要先拿掉 `docker-compose.yml` 中 api 的 `container_name`。

<a id="app-10"></a>
### APP-10：沒有獨立的正式環境

`.github/workflows/deploy.yml` 的名稱是「Deploy to UAT」。它在每次 push 到 `main` 時，於標籤為 `uat` 的 self-hosted runner 上，把程式同步到 `/srv/open333crm`，再以 `docker-compose.yml` 重建並重啟服務。repo 裡沒有其他部署 workflow，`docker-compose.prod.yml` 也沒有任何 workflow 使用。

issue #197 回報（2026-10-02）：這台 UAT 主機（`uat.open333crm.create360.ai`）同時是客戶「創造智能」實際在用的環境，沒有另一套正式環境。repo 只能確認部署路徑，無法確認主機的用途，因此驗證狀態是「間接確認」。

這代表：

- **合併到 `main` 就直接部署到客戶在用的環境。** 每次合併都會重啟 API 與 Caddy。2026-10-02 一天合併 6 個 PR，觸發 6 次部署；其中 #200 改變來源 IP 與登入規則，#202 讓所有既有的 access token 失效，兩者都是上線之後才在同一個環境驗證。
- **測試資料與客戶資料在同一個資料庫。** Demo Tenant 的測試規則、E2E 測試租戶、Meta 審查用的帳號，與客戶的對話放在一起。回填腳本與修資料的 SQL 只能直接對客戶資料執行。
- **主機與其他服務共用。** issue #197 回報，同一台主機還執行另一個客戶的正式容器，磁碟也曾因 build cache 塞滿而導致部署失敗。
- **文件的部署步驟沒有地方能照做。** 本文件的「部署前要先做」、各 OpenSpec change 的 Migration Plan，都假設先在別的環境驗證、再上正式環境。

**修正方向**（issue #197 提出的最小做法）：

- 另開一台正式環境的主機，或至少獨立一套 compose 與資料庫。
- 正式環境改成手動發布，例如以 tag 或 release 觸發，不跟著 `main` 自動部署。
- UAT 維持 `main` 自動部署，作為上線前的驗證站。

這一項需要決定主機資源與成本，不是程式修正。

<a id="app-11"></a>
### APP-11：後台操作失敗時畫面沒有訊息

下列頁面的操作沒有 `catch`，或只寫 console。失敗時畫面不變、沒有訊息，操作者以為按了沒反應，或以為已經處理：

| 頁面 | 沒有提示的操作 | 健檢編號 |
| --- | --- | --- |
| 工單詳情 | 改負責人（`handleAssign`）、新增備註 | HC-CASES-09 |
| 渠道管理 | 網站聊天室背景圖上傳與外觀儲存；後端錯誤也不是標準格式或是英文 | HC-CHANNELS-03 |
| 行銷素材 | 複製、刪除；刪除確認寫「可在後台復原」，但沒有復原介面 | HC-MARKETING-07 |
| 平台：租戶列表 | 停用、啟用、初始載入 | HC-PLATFORM-TENANTS-03 |
| 平台：試用管理 | 延長、轉正式、復原、重寄、作廢、初始載入（例如以為已延長，客戶隔天仍被停用）。「政策設定」的 `saveSetting` 見 TRIAL-02 | HC-PLATFORM-TRIALS-03 |
| 平台：方案異動審核 | 核准、駁回、初始載入（例如 400 `TOPUP_UNLIMITED`） | HC-PLATFORM-PLAN-CHANGES-03 |
| 平台：用量 | 總覽、排行、租戶鑽取；失敗時顯示「此區間尚無用量資料」，平台方會以為真的沒有用量 | HC-PLATFORM-USAGE-03 |

使用者看不到的失敗會被當成「沒有反應」。修正時每個操作都要顯示錯誤訊息，讀取失敗與「沒有資料」要分開顯示。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-CASES-09（[CASES 健檢](../features/health/CASES.md)）、HC-CHANNELS-03（[CHANNELS 健檢](../features/health/CHANNELS.md)）、HC-MARKETING-07（[MARKETING 健檢](../features/health/MARKETING.md)）、HC-PLATFORM-TENANTS-03（[PLATFORM-TENANTS 健檢](../features/health/PLATFORM-TENANTS.md)）、HC-PLATFORM-TRIALS-03（[PLATFORM-TRIALS 健檢](../features/health/PLATFORM-TRIALS.md)）、HC-PLATFORM-PLAN-CHANGES-03（[PLATFORM-PLAN-CHANGES 健檢](../features/health/PLATFORM-PLAN-CHANGES.md)）、HC-PLATFORM-USAGE-03（[PLATFORM-USAGE 健檢](../features/health/PLATFORM-USAGE.md)）。證據：多數以 Playwright 攔截 API 回 500 或以權限不足的角色操作，畫面沒有訊息、console 有 `Request failed with status code …`（健檢實測）；位置見各報告，例如 `apps/web/src/app/admin/tenants/page.tsx:37-40`、`apps/web/src/app/admin/trial/page.tsx:88-123`、`apps/web/src/app/admin/usage/page.tsx:46-58`。

<a id="app-12"></a>
### APP-12：週期工作吞掉錯誤，佇列監控看不到

下列週期工作的 processor 在頂層 `catch` 錯誤後只寫 log，job 照常 completed。失敗不會進 failed set，佇列監控看不到原因，也不發告警：

- workers：`sla`（整輪 SLA 掃描失敗時，SLA 預警與逾時全部停擺，監控仍全綠）、`data-export-cleanup`、`tag-expiry-cleanup`、`agent-retention-cleanup`。
- API 的 `api-scheduler`：`csat-send`、`csat-auto-close`、`broadcast-scheduled`、`inactivity-close`。`analytics-daily`、`trial-lifecycle` 逐租戶吞錯；逐筆吞錯合理，但沒有任何彙總的失敗紀錄。

同一個 `api-scheduler` 佇列裡，processor 丟出的錯誤會進 failed set 並告警，可見告警機制本身正常。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-QUEUE-MONITORING-01（[PLATFORM-QUEUE-MONITORING 健檢](../features/health/PLATFORM-QUEUE-MONITORING.md)）。證據：`apps/workers/src/index.ts:79-83, 137-141, 150-154, 163-167`、`apps/api/src/modules/csat/csat.scheduler.ts:53, 136`、`apps/api/src/modules/marketing/broadcast.scheduler.ts:48`、`apps/api/src/modules/conversation/inactivity-close.worker.ts:59`（讀程式）；對照組實測：沒有註冊的排程丟錯時進 FAILED 並告警，`sla` 佇列 256 筆全部 completed。

<a id="app-13"></a>
### APP-13：outbox 積壓沒有告警，送不出去的列會擋住後面的列

`outbox-relay` 每分鐘補送未送出的 outbox 列：

- 永遠送不出去的列每分鐘重送一次、每次寫一行 error log，永遠不標記，也不會被清理（清理只刪已送出的列）。`outbox-relay` 的 job 本身照常 completed，不進 failed set，不發告警，bull-board 也看不到。
- relay 依 `createdAt` 由舊到新取 500 筆。累積 500 筆以上送不出去的列時，之後較新的未送出列永遠輪不到補送。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-QUEUE-MONITORING-02（[PLATFORM-QUEUE-MONITORING 健檢](../features/health/PLATFORM-QUEUE-MONITORING.md)）。證據：`apps/api/src/modules/outbox/outbox.scheduler.ts:21-31`、`packages/core/src/outbox/outbox.ts:115-117`；插入一筆 BullMQ 會拒絕的 outbox 列，API log 每分鐘出現補送與送出失敗，沒有 ops-alert（健檢實測，測試列已刪除）；500 筆的阻塞為讀程式。

<a id="app-14"></a>
### APP-14：workers 停止時沒有告警

佇列告警只監聽 failed 事件（`failed-alerts.ts`）。workers 停掉時 job 停在 waiting，不會失敗，所以不告警；只有打開 bull-board 才看得到「No workers」。`docker-compose.yml` 的 workers 服務沒有 healthcheck，API 的 `/health` 不檢查 Redis 與 worker。API 停機時同理，API 停機期間移到 failed set 的 job 也不告警（功能文件已註明）。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-QUEUE-MONITORING-03（[PLATFORM-QUEUE-MONITORING 健檢](../features/health/PLATFORM-QUEUE-MONITORING.md)）。證據：`apps/api/src/modules/queue-monitoring/failed-alerts.ts:57-68`、`docker-compose.yml` 的 `workers` 服務、`apps/api/src/index.ts:184-188`（讀程式）；`/api/queues/sla/workers` 有回傳 worker 連線的部分為實測。

## 共用套件

<a id="pkg-01"></a>
### PKG-01：重複的渠道型別

`packages/types` 與 `packages/shared` 都定義 `ChannelType`、`MessageContentType`。兩份定義目前相同，但沒有同步機制。

<a id="pkg-02"></a>
### PKG-02：錯誤的 Facebook 子路徑

`channel-plugins` 的 `./fb` export 指向 `dist/fb/index.js`，實際輸出位於 `dist/facebook/index.js`。容器內執行 `import('@open333crm/channel-plugins/fb')` 會回傳 `ERR_MODULE_NOT_FOUND`。

<a id="pkg-03"></a>
<a id="pkg-04"></a>
### PKG-03、PKG-04：未接線套件仍持續建置

`brain` 沒有 app 使用者；`ui` 只有空匯出。兩者仍由開發環境的 `packages` 服務建置並啟動 watch process。

<a id="pkg-05"></a>
### PKG-05：`core` 匯出沒有呼叫端的服務

`packages/core` 有一套以 Redis `crm:events` 頻道傳遞的 `EventBus`，與 API 行程的 eventBus 不相通。實際使用它的只有 Canvas：`FlowRunner` 發布、API 的 `canvas.worker.ts` 訂閱。同一個套件裡另有：

| 程式 | 內容 | 呼叫端 |
| --- | --- | --- |
| `inbox/inbox-service.ts` 的 `InboxService` | 對話與訊息，並發布到 `crm:events` | `apps/*` 沒有 |
| `contacts/contact-service.ts` 的 `ContactService` | 聯絡人 | `apps/*` 沒有 |

這些與 API 的 `conversation`、`contact` 模組功能重疊。讀程式時容易以為對話或聯絡人走這裡。

**已刪除的部分**：`cases/case-service.ts` 的 `CaseService` 與訂閱 `crm:events` 的 `automation/engine.ts` 的 `AutomationEngine`（#327）。`CaseService` 在模組載入時建立 `sla-monitoring` 的 Queue 與 Worker，`AutomationEngine` 是它唯一的使用者，沒有從 `index.ts` 匯出，也沒有呼叫 `start()` 的程式。

<a id="pkg-06"></a>
### PKG-06：`channel-plugins` 有沒有呼叫端的程式

| 程式 | 內容 | 呼叫端 |
| --- | --- | --- |
| `ChannelPlugin.setWebhook()` | LINE 與 Telegram 外掛有實作 | 沒有。LINE 的自動設定由 API 的 `line-webhook-setup.service.ts` 直接呼叫 LINE API |
| `extensions.audience` | LINE 外掛有實作分眾名單 | 沒有 |
| `line/worker-media-download.ts`、`worker-narrowcast-progress.ts`、`worker-insight-sync.ts` | 各自定義 BullMQ 佇列與 worker | 沒有任何檔案 import。LINE 媒體下載實際走 `resolveInboundMedia()` |
| `getAllChannelPlugins()`、`hasChannelPlugin()`、`getPlugin()`、`registerPlugin` | 註冊表的輔助函式與舊名稱 | 沒有 |
| `telegram.ts` | `TelegramPlugin` 類別，由套件入口與 `./telegram` 子路徑匯出 | 沒有註冊，見 APP-02 |

與此同時，圖文選單的建立與發布寫在 API 的 `rich-menu.service.ts`，直接呼叫 LINE API，而外掛的 `extensions.ui` 只用在 workers 的綁定。同一種渠道能力一半在外掛、一半在模組內，新增渠道時不容易判斷該實作哪些方法。

**主規格已移除。** 主規格 `line-analytics` 與 `line-audience` 描述的 LINE Insight 同步與分眾名單從來沒有上線。issue #217 確認兩者都沒有排程，群發改為以分眾或標籤找出 UID 後用 Multicast 送出，移除了這兩份主規格。上表的 `worker-insight-sync.ts`、`worker-narrowcast-progress.ts` 與 `extensions.audience` 沒有主規格，也沒有呼叫端。這一項維持 P4。

## Storage、LLM 與資料庫

<a id="sto-01"></a>
### STO-01：Workers 無法連線 MinIO

Workers 的 `MinioStorageProvider` 讀取 `MINIO_*`，但 `.env.workers` 提供 `S3_*`。`STORAGE_PROVIDER` 也沒有程式讀取。Provider 最後採用 `localhost:9000`，在 Workers 容器內會連回自己。

執行時呼叫 `listBuckets()` 已重現 `ECONNREFUSED`。

<a id="llm-01"></a>
### LLM-01：AI 設定預設使用 Ollama

`tenant_settings` 的預設值指向 Ollama：

- `chatProvider` 預設為 `ollama`，`chatBaseUrl` 預設為 `http://localhost:11434`。
- `embeddingBaseUrl` 預設為 `http://localhost:11434`，`embeddingModel` 預設為 `bge-m3`。

`chat-settings.service.ts` 的 `DEFAULT_CHAT_SETTINGS` 也使用同樣的值。組織不部署 Ollama，因此新租戶的 Chat 從建立起就連不上模型。

即使部署了 Ollama 容器，這個預設位址仍然錯誤：在 API 容器內，`localhost` 指向 API 自己。執行時連線曾重現 `Connection refused`。

Chat 可以繞過：租戶的 ADMIN 在 Chat 設定把供應商改成 Gemini。Embedding 沒有供應商可選，無法繞過，見 LLM-04。

<a id="llm-02"></a>
### LLM-02：Compose 仍部署 Ollama

`docker-compose.yml` 與 `docker-compose.prod.yml` 都有 `ollama` 服務與 `ollama_data` volume。服務啟動時會下載 `OLLAMA_CHAT_MODEL` 與 `OLLAMA_EMBED_MODEL` 指定的模型，預設是 `qwen2.5:0.5b` 與 `bge-m3`。

依照部署決定，這個服務不應該再啟動。只要依這兩個 Compose 檔部署，Ollama 仍會啟動並佔用主機資源。

<a id="llm-03"></a>
### LLM-03：`OLLAMA_*` 環境變數已無作用

`apps/api/src/config/env.ts` 定義三個變數：`OLLAMA_BASE_URL`、`OLLAMA_EMBED_MODEL` 與 `OLLAMA_CHAT_MODEL`。`.env.api.example` 提供 `OLLAMA_BASE_URL=http://ollama:11434`。

- `OLLAMA_BASE_URL` 只有一個讀取端：commit `ee251c8` 在 `ollama.provider.ts` 的 `generate()` 與 `generateToolTurn()` 加上的補救。當租戶的 `chatBaseUrl` 等於預設值時，補救改連這個變數的位址。Ollama 不部署之後，這個位址也連不上。
- `OLLAMA_EMBED_MODEL` 與 `OLLAMA_CHAT_MODEL` 沒有任何程式讀取。

<a id="llm-04"></a>
### LLM-04：Embedding 只能呼叫 Ollama

`tenant_settings` 的 Chat 設定有 `chatProvider`，可以選 Ollama 或 Gemini。Embedding 設定沒有對應的供應商欄位。`embedding.service.ts` 的 `embedOnce()` 一律以 Ollama 的 embed API 格式呼叫 `embeddingBaseUrl`；`embedding-settings.service.ts` 的健康檢查與模型清單也只查 Ollama。

組織決定不部署 Ollama。拿掉 Ollama 之後，所有產生向量的路徑都會失敗：

| 功能 | 失敗時的行為 |
| --- | --- |
| 知識庫自動回覆（`kb-autoreply.service.ts` 的 `attemptKbAutoReply()`） | 只記 error log，然後不回覆客人，也不轉真人 |
| AI 建議回覆（`ai.service.ts` 的 `suggestReply()`） | 回傳空的建議清單 |
| 知識庫語意搜尋（`knowledge.service.ts` 的 `semanticSearch()`） | 拋出錯誤 |
| 建立或修改文章時產生向量（`embedArticle()`） | 在背景失敗，只記 log。文章仍可發布，但不會被檢索到 |

自動回覆的失敗最不容易察覺：客人收不到回覆，對話也沒有轉給客服。

**UAT 目前仍正常產生向量（2026-10-30 功能健檢）。** UAT Demo 租戶的 `GET /knowledge/embedding-status` 回 `{ok: true, model: "bge-m3:latest"}`，1180 篇已發布文章抽查前 200 篇都有向量。UAT 靠 Compose 內仍在執行的 Ollama 服務（LLM-02）運作。「Embedding 只能呼叫 Ollama」仍然成立；上表是拿掉 Ollama 之後的結果，不是 UAT 目前的現況。原本這裡寫成「所有產生向量的路徑都會失敗」，依健檢改成條件式（[KNOWLEDGE 健檢](../features/health/KNOWLEDGE.md)）。

改用其他 embedding 服務時，資料庫欄位的維度要配合新的模型，與 DB-01 一起處理。

<a id="llm-05"></a>
### LLM-05：AI 摘要失敗時回傳固定範本

`ai.service.ts` 的摘要在 LLM 呼叫失敗時（含月額度用完的 403）回傳一段固定範本當成摘要：「客戶主要詢問了產品相關問題，Bot 提供了初步回覆但客戶可能需要更詳細的人工協助…」，內容與對話無關，回應是 200。自動轉接真人時（`automation.worker.ts`），這段文字以「Bot 對話摘要」寫進對話的系統訊息，永久留存，客服會以為是 AI 讀過對話的結論。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-USAGE-04（[PLATFORM-USAGE 健檢](../features/health/PLATFORM-USAGE.md)）。證據：`apps/api/src/modules/ai/ai.service.ts:113-128`、`apps/api/src/modules/automation/automation.worker.ts:136-147`；本機 LLM 不通時 `POST /ai/summarize` 回 200 與上述範本（健檢實測）；額度用完與寫入系統訊息為讀程式。

<a id="kb-01"></a>
### KB-01：追問次數用完時回覆已轉接，實際沒有轉接

`kb-autoreply.service.ts` 在追問次數用完時送出「…已為您轉接客服人員，請稍候」，但只寫訊息，不改對話狀態：對話仍是 `BOT_HANDLED`，沒有 `handoffReason`、沒有系統訊息，客服不會收到。客人再傳訊息，又收到同一句。

實際的轉接要等 `botRepliesCount` 達到渠道的 `maxBotReplies`（預設 5），才由 `automation.worker.ts` 的 `checkAutoHandoff()` 觸發；把 `maxBotReplies` 調高的渠道，客人會一直收到假的轉接訊息。LLM 失敗（含月額度用完的 `PLAN_LIMIT_EXCEEDED`）時，追問路徑也送同一句。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-KNOWLEDGE-01（[KNOWLEDGE 健檢](../features/health/KNOWLEDGE.md)）。證據：`apps/api/src/modules/ai/kb-autoreply.service.ts:252-255, 270-273`；健檢腳本搭配假 LLM 對新對話連送 4 則，後兩則都是 `clarify_handoff`，對話狀態一直是 `BOT_HANDLED`（健檢實測，未經 workers 與真實渠道）。

<a id="kb-02"></a>
### KB-02：型號守門把一般英文詞當成型號

`model-matcher.ts` 的正規式 `\b([A-Z]{1,4})-([0-9A-Z]+…)\b` 不分大小寫，`Wi-Fi`、`e-mail`、`T-shirt`、訂單編號 `AB-12345` 都被當成型號。KB 相似度低於 0.85 時，機器人回「這個型號我這邊查不到資料」，請客人確認型號。

- 守門對**所有租戶**生效。沒有任何型號文章的租戶白名單是空的，只要訊息有這類詞，就一定走守門。
- 守門路徑不累加追問次數，客人一直提到這類詞就一直不會轉真人。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-KNOWLEDGE-02（[KNOWLEDGE 健檢](../features/health/KNOWLEDGE.md)）。證據：`apps/api/src/modules/ai/model-matcher.ts:22`、`kb-autoreply.service.ts:185-237`；健檢腳本送「我家 Wi-Fi 連不上怎麼辦」得到 `replyKind=model_not_found`、`unknownModel=WI-FI`；`detectModels()` 對 `T-shirt`、`AB-12345` 也命中（健檢實測）。

<a id="kb-03"></a>
### KB-03：知識庫匯入沒有 BOM 的 CSV 變成亂碼

`file-parser.service.ts` 以 `XLSX.read(buffer, {type:'buffer'})` 讀 CSV，沒有指定編碼，把 UTF-8 當單位元組讀。沒有 BOM 的 UTF-8 CSV 匯入後中文全部變亂碼：

- 表頭是「問題,答案」時認不出表頭，整份變成一篇亂碼草稿。
- 表頭是英文 `question,answer` 時會拆成問答，但標題與答案是亂碼，而且直接發布（`knowledge.routes.ts:167`），AI 馬上會用。

Google 試算表、Numbers 與程式匯出的 CSV 都沒有 BOM；台灣版 Excel 的「CSV（逗號分隔）」是 Big5，同樣會亂碼。手冊用的範例檔 `apps/web/tests/fixtures/manual-kb-sample.csv` 就是沒有 BOM 的 UTF-8。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-KNOWLEDGE-03（[KNOWLEDGE 健檢](../features/health/KNOWLEDGE.md)）。證據：`apps/api/src/modules/knowledge/file-parser.service.ts:57, 139`；上傳英文表頭、沒有 BOM 的 CSV 得到 1 篇已發布、標題亂碼的文章；加上 `EF BB BF` 後正常（健檢實測）。

<a id="kb-04"></a>
### KB-04：LLM 失敗時把文章全文送給客人

`kb-autoreply.service.ts` 在 LLM 呼叫失敗時，把相似度最高的文章原文（`topResult.content`，不限長度）直接當成回覆送出。月額度用完（`PLAN_LIMIT_EXCEEDED`）也走這條：規格要求的「不呼叫 LLM」做到了，但客人收到的是未整理的文章全文；文章裡若有內部備註也會一起送出。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-KNOWLEDGE-04（[KNOWLEDGE 健檢](../features/health/KNOWLEDGE.md)）。證據：`apps/api/src/modules/ai/kb-autoreply.service.ts:292-296`；健檢腳本讓假 LLM 回 500，客人問「濾網怎麼拆」，回覆就是文章 content，`replyKind=kb_high_confidence`（健檢實測）。

<a id="kb-05"></a>
### KB-05：型號守門的對話標記不會清除

`kb-autoreply.service.ts` 以 `{...existingMeta, ...metadataExtras}` 寫對話的 metadata。守門命中後寫入的 `modelGuard` 之後永遠不會清掉，後續的一般回答與追問都沿用舊值，客服或除錯時會誤以為最近一則是守門回覆。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-KNOWLEDGE-06（[KNOWLEDGE 健檢](../features/health/KNOWLEDGE.md)）。證據：`apps/api/src/modules/ai/kb-autoreply.service.ts:436`；守門之後的 `clarify`、`kb_high_confidence` 回覆，對話 metadata 仍是 `{"modelGuard":{"unknownModel":"E-MAIL",…}}`（健檢實測）。

<a id="db-01"></a>
### DB-01：向量維度不一致

Prisma schema 與程式常數使用 1024 維。執行中的 `km_articles.embedding` 與 `long_term_memories.embedding` 欄位都是 `vector(1536)`。預設的 `bge-m3` 產生 1024 維向量，直接寫入會被資料庫拒絕。

組織不部署 Ollama 之後，`bge-m3` 不再是可用的模型。正確的維度要等 LLM-04 選定新的 embedding 模型才能決定。

<a id="db-02"></a>
### DB-02：`ContactTag.expiresAt` 沒有設定端，也沒有讀取端

schema 為聯絡人標籤留了到期時間。貼標的程式都不設定這個欄位，也沒有任何查詢或排程依它過濾或清除標籤。它唯一出現的地方，是 `contact-merge.service.ts` 合併聯絡人時以 `updateMany` 搬移標籤，保留原值。

<a id="db-03"></a>
### DB-03：`DailyStat` 每天寫入，沒有讀取端

`analytics.scheduler.ts` 的 `setupAnalyticsScheduler()` 每天對每個啟用中的租戶呼叫 `analytics.aggregator.ts` 的 `runDailyAggregation()`，把總覽、工單、客服、渠道與聯絡人的彙總寫入 `DailyStat`。

`analytics.service.ts` 的報表函式都在查詢當下從原始資料表計算，沒有任何程式讀 `DailyStat`。排程每天為每個租戶做一次完整計算，結果沒有用途。

change `add-tenant-aware-login` 的歸檔規格有「每日統計對每個啟用中的租戶各跑一次」這條需求。change `restore-tenant-aware-login-specs` 刻意沒有補回這條需求，等這一項決定報表改讀 `DailyStat`，或刪除排程。

2026-10-30 在 #318 請 Daniel 決定 `DailyStat` 要不要有讀取端。#228 第 8 項（平台用量讀 `DailyStat`）也移到 #318 一起回答。

<a id="db-04"></a>
### DB-04：schema 有、程式沒有讀寫的欄位與資料表

| 欄位或資料表 | 現況 |
| --- | --- |
| `Case.mergedIntoId`、`Case.parentCaseId`、`CaseRelation` | `apps/api`、`apps/workers`、`apps/web` 都沒有讀寫。工單的合併、子工單與關聯沒有實作 |
| `Contact.isBlocked` | `PATCH /contacts/:id` 可以寫入，前端沒有入口，也沒有任何程式讀取。設成 `true` 不會擋下訊息、機器人或群發 |

`Conversation.teamId` 原本也列在這裡。它違反主規格 `channel-team-access`，2026-10-02 移到 TEAM-01。

## 架構規則

`AGENTS.md` 的模組結構規則只約束新寫與修改的程式。本節記錄既有程式中違反規則、而且修正成本低的部分。修正成本高的規則（一個 route 檔一種資源、渠道差異走外掛）不在這裡列出清單，原因見 `AGENTS.md`。

<a id="arch-01"></a>
### ARCH-01：route 檔直接查詢資料庫

規則 1 要求 route 只驗證輸入、檢查權限、呼叫 service，查詢放在 service。2026-10-01 以下列指令核對：

```bash
grep -cE '(prisma|tenantPrisma|prismaAdmin|\btx)\.[a-zA-Z]+\.(find|create|update|delete|upsert|count|aggregate|groupBy)' apps/api/src/modules/*/*.routes.ts | grep -v ':0$'
```

當天的結果：

| route 檔 | 查詢呼叫數 | 備註 |
| --- | --- | --- |
| `auth/auth.routes.ts` | 9 | |
| `sla/sla.routes.ts` | 8 | 模組沒有 service 檔 |
| `channel/channel.routes.ts` | 7 | |
| `settings/settings.routes.ts` | 5 | 2026-10-30 功能健檢讀程式剩 2 處：`cli-sessions` 的 `findMany`、`identity-binding` 的 `upsert`（[SETTINGS 健檢](../features/health/SETTINGS.md)） |
| `portal/portal-public.routes.ts` | 4 | |
| `tag/tag.routes.ts` | 3 | |
| `line-login/line-login.routes.ts` | 3 | 2026-10-30 功能健檢確認這個檔案已不存在（`apps/api/src/modules/` 沒有 `line-login`），下次核對時移除這一列（[LINE 健檢](../features/health/LINE.md)） |
| `fb-login/fb-login.routes.ts` | 3 | |
| `webhook/webhook.routes.ts` | 2 | |
| `webchat/webchat.routes.ts`、`shortlink/shortlink-redirect.routes.ts`、`platform/platform.routes.ts`、`knowledge/knowledge.routes.ts`、`conversation/conversation.routes.ts`、`analytics/analytics.routes.ts`、`ai/ai.routes.ts`、`agent/agent.routes.ts` | 各 1 | |

多數是單筆查詢，搬進 service 即可。這些 route 大多沒有測試，搬移前先補上 route 的測試，確認行為不變。

## CI 與測試

盤點時，`.github/workflows/ci.yml` 只執行 RLS 隔離測試，lint 步驟只輸出略過訊息。之後有 commit 刪除了 `ci.yml`，刪除經過見 `AGENTS.md` 的「CI gates」一節。目前唯一的 workflow 是 `deploy.yml`，它只負責部署到 UAT，不執行測試或 lint。

<a id="ci-01"></a>
### CI-01：沒有 CI 執行 API 測試

沒有任何 CI workflow 執行測試。測試只能在本機執行：根目錄的 `pnpm test` 執行各套件的 unit 測試，`pnpm test:feature` 執行需要 PostgreSQL 與 Redis 的 feature 測試。

<a id="ci-02"></a>
### CI-02：沒有 CI 執行 lint

`eslint.config.js` 與 `pnpm lint` 已存在，但沒有任何 CI workflow 執行 lint。

<a id="ci-04"></a>
### CI-04：試用申請與開通沒有自動測試

主規格 `trial-application` 的 9 個 scenario（總開關、關閉後仍可開通、防枚舉、gmail 別名、過期 token、重寄後舊連結失效、開通成功、中途失敗可重試、email 已被建走）都找不到測試。`trial.service.ts`、`email-normalizer.ts`、`trial.routes.ts` 沒有任何測試引用。TRIAL-05 與 TRIAL-06 都發生在這段沒有測試的程式。

**健檢來源**（2026-10-30，程式版本 `5c81102e`）：HC-PLATFORM-TRIALS-04（[PLATFORM-TRIALS 健檢](../features/health/PLATFORM-TRIALS.md)）。證據：`git ls-files apps/*/tests` 搜尋 `requestTrial`、`verifyAndProvision`、`normalizeEmail`、`trial/signups` 都沒有結果（讀程式）。

## 已查證後排除的項目

以下項目在盤點時看起來像落差，查證後確認是刻意的設計，記錄於此避免重複回報。

### `broadcast` 佇列不是遺留物

`apps/workers/src/index.ts` 建立了一個 `broadcast` 佇列，但沒有對應的 consumer。這段程式的用途是清除 Redis 中殘留的 repeatable job：取得所有 repeatable job、逐一移除、然後關閉佇列。清理失敗時只記錄 warning，不影響啟動。原始碼的註解已說明這個意圖。

## 已核對的資料庫基線

2026-09-02 在開發環境核對以下資料：

| 項目 | 結果 |
| --- | --- |
| Prisma model | 78 |
| enum | 24 |
| migration | 45 |
| 外鍵 | 114 |
| 啟用及強制 RLS 的資料表 | 71 |
| 未啟用 RLS 的平台表 | 7 |
| `app_tenant.rolbypassrls` | `false` |
| `app_admin.rolbypassrls` | `true` |

未啟用 RLS 的平台表是 `model_pricings`、`plans`、`platform_audit_logs`、`platform_settings`、`platform_users`、`tenants`、`trial_signups`。

