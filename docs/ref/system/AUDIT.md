# 實作落差與驗證紀錄

本文件集中記錄系統盤點時發現的實作落差，只描述各項的現況。其他系統文件只描述主要結構，不重複問題細節；每一項怎麼查證、在哪一次盤點發現，記在[實作落差複查紀錄](./AUDIT-REVIEWS.md)。

摘要表依章節排列，順序與內文相同。點 ID 可跳到該項的內文。

- **驗證環境**：`docker compose -f docker-compose.dev.yml`
- **執行時驗證日期**：2026-09-02
- **最近複查日期**：2026-10-02
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

排序只反映「先修哪一個」，與修復成本無關。兩項同為 P1 時，先做哪一項由當時的人力與相依關係決定。

最近一次標示日期為 2026-10-01。項目的內容改變時要一併重看它的優先順序。

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
| [RLS-01](#rls-01) | 租戶隔離與權限 | P1 | 未處理 | Canvas 引擎不走租戶連線 | 靜態確認 |
| [RLS-03](#rls-03) | 租戶隔離與權限 | P3 | 未處理 | 隔離檢查腳本掃不到 `packages/*` | 靜態確認 |
| [RLS-04](#rls-04) | 租戶隔離與權限 | P3 | 未處理 | `.env.api.example` 沒有 `DATABASE_URL_TENANT` | 靜態確認 |
| [RLS-05](#rls-05) | 租戶隔離與權限 | P1 | 已提建議 | 重抓 LINE 個人資料的端點不檢查租戶，可讀寫其他租戶的聯絡人資料 | 靜態確認 |
| [RLS-07](#rls-07) | 租戶隔離與權限 | P3 | 未處理 | 短連結轉址使用 `prismaAdmin`，但不在白名單，`check-prisma-admin-usage.mjs --strict` 因此失敗 | 靜態確認 |
| [RBAC-01](#rbac-01) | 租戶隔離與權限 | P1 | 部分修正 | 權限碼有一部分沒有強制點，工單、對話、標籤、短連結的路由不檢查權限碼 | 靜態確認 |
| [RBAC-02](#rbac-02) | 租戶隔離與權限 | P2 | 未處理 | CLI token 只看 scope，繞過角色權限與方案天花板；任何成員都能以 CLI 讀全租戶報表 | 靜態確認 |
| [RBAC-03](#rbac-03) | 租戶隔離與權限 | P3 | 未處理 | 工單自動指派與通知收件人看舊的角色列舉，不看細粒度角色 | 靜態確認 |
| [RBAC-04](#rbac-04) | 租戶隔離與權限 | P2 | 未處理 | 渠道可見範圍在 socket 租戶房間、聯絡人、AI 輔助等處沒有套用 | 靜態確認 |
| [RBAC-05](#rbac-05) | 租戶隔離與權限 | P2 | 已提建議 | reconcile 腳本會覆蓋租戶對系統角色的修改，收回的權限被重新授予 | 靜態確認 |
| [RBAC-06](#rbac-06) | 租戶隔離與權限 | P3 | 已定方向 | 預設角色的權限有兩份，內容已經不同；demo 資料的 `supervisor` 多了 `channel.view_all`，`admin` 少了稽核與資料權利的權限碼 | 靜態確認 |
| [TEAM-01](#team-01) | 租戶隔離與權限 | P3 | 未處理 | 團隊沒有建立與管理成員的途徑，依團隊授權與指派都無法使用 | 靜態確認 |
| [A2A-01](#a2a-01) | 租戶隔離與權限 | P2 | 未處理 | A2A 橋接以最早建立的租戶執行所有外部任務，使用該租戶的金鑰與額度 | 靜態確認 |
| [AUTH-01](#auth-01) | 帳號與登入 | P2 | 已定方向 | 租戶端沒有忘記密碼流程，唯一的 ADMIN 忘記密碼就沒有復原途徑 | 靜態確認 |
| [AUTH-02](#auth-02) | 帳號與登入 | P2 | 未處理 | 停用租戶不會中斷既有的 Socket 連線，CLI token 與 Partner API 金鑰也不受影響 | 靜態確認 |
| [AUTH-03](#auth-03) | 帳號與登入 | P2 | 未處理 | 平台帳號改密碼或重設密碼後，已發出的 token 仍然有效 | 靜態確認 |
| [AUTH-04](#auth-04) | 帳號與登入 | P2 | 未處理 | 平台帳號沒有權限分級也沒有第二因子，改 email 不通知原主而可被接管 | 靜態確認 |
| [AUTH-05](#auth-05) | 帳號與登入 | P2 | 部分修正 | 租戶端 JWT 不分用途，refresh token 能當客服 access token；粉絲 token 的簽發路徑接回後，粉絲 token 也能 | 靜態確認 |
| [AUTH-06](#auth-06) | 帳號與登入 | P3 | 已提建議 | 兩個「JWT 或其他憑證」裝飾器的 JWT 分支不填 `roleId`，網頁登入的成員呼叫 `partner-ingest` 一律 403 | 靜態確認 |
| [AUTH-07](#auth-07) | 帳號與登入 | P4 | 未處理 | `JWT_EXPIRES_IN` 沒有讀取端，技術文件卻列為 token 有效期 | 靜態確認 |
| [SEC-02](#sec-02) | 帳號與登入 | P3 | 未處理 | 平台帳號的登入與密碼重設沒有寫入稽核紀錄 | 靜態確認 |
| [SEC-03](#sec-03) | 帳號與登入 | P3 | 未處理 | rate-limit 在各路由模組內各自註冊，搬移路由時設定會被靜默忽略 | 靜態確認 |
| [SEC-06](#sec-06) | 帳號與登入 | P2 | 已提建議 | 租戶的帳號鎖定只依 email 計數，知道 email 的人可以讓該成員一直無法以密碼登入 | 靜態確認 |
| [SEC-01](#sec-01) | 金鑰與 License | P2 | 部分修正 | 渠道加密金鑰的硬編碼備援值：API 已修正（`f507fe1`），Workers 仍保留 | 靜態確認 |
| [LIC-01](#lic-01) | 金鑰與 License | P4 | 未處理 | API 使用寫死的授權資料 | 間接確認 |
| [LIC-02](#lic-02) | 金鑰與 License | P4 | 未處理 | 可連線的 Core LicenseService 沒有使用者 | 靜態確認 |
| [TRIAL-02](#trial-02) | 試用 | P3 | 已定方向 | 試用政策存在無型別的 KV，錯誤的值會靜默失效或靜默生效 | 靜態確認 |
| [TRIAL-03](#trial-03) | 試用 | P2 | 未處理 | 「資料保留天數」到期只做標記，租戶的業務資料永遠不會被刪除 | 靜態確認 |
| [PLAN-01](#plan-01) | 方案與額度 | P3 | 未處理 | `Plan.isActive` 沒有讀取端，停售的方案仍可指派 | 靜態確認 |
| [PLAN-02](#plan-02) | 方案與額度 | P3 | 未處理 | 加購 token 是永久提高每月額度，不是一次性配額 | 靜態確認 |
| [PLAN-03](#plan-03) | 方案與額度 | P3 | 未處理 | 換方案不會回收既有的超額資源，也不會清除 `limitOverrides` | 靜態確認 |
| [PLAN-04](#plan-04) | 方案與額度 | P2 | 未處理 | 方案的功能天花板在收件匣一帶沒有咬合點，關掉 `inbox` 不影響使用 | 靜態確認 |
| [PLAN-05](#plan-05) | 方案與額度 | P2 | 未處理 | 加購過的租戶升級方案，AI 月額度反而停在升級前的數字 | 靜態確認 |
| [PLAN-06](#plan-06) | 方案與額度 | P2 | 未處理 | 核准加購清掉的是用量計數器而非告警旗標，當月後續額度告警全部靜默 | 靜態確認 |
| [PLAN-07](#plan-07) | 方案與額度 | P3 | 未處理 | 渠道的兩個分級欄位都沒有任何方案填過值，渠道維度完全不分級 | 靜態確認 |
| [PLAN-08](#plan-08) | 方案與額度 | P1 | 未處理 | 角色權限的顯示與儲存都不套方案天花板，介面顯示的授予狀態與實際生效的權限不一致 | 靜態確認 |
| [PLAN-09](#plan-09) | 方案與額度 | P3 | 未處理 | 改方案立即對該方案所有租戶生效，介面不顯示影響範圍，稽核不記舊值 | 靜態確認 |
| [PLAN-10](#plan-10) | 方案與額度 | P3 | 未處理 | 加購沒有金額紀錄，覆寫值也拆不開，事後無法對帳 | 靜態確認 |
| [PLAN-11](#plan-11) | 方案與額度 | P3 | 未處理 | 平台只查得到待審的方案異動申請，已核准與已駁回的沒有讀取途徑 | 靜態確認 |
| [PLAN-12](#plan-12) | 方案與額度 | P3 | 未處理 | AI 不在功能天花板的維度內，停用 AI 只能把 `monthlyTokens` 設成 `0` | 靜態確認 |
| [AI-01](#ai-01) | AI 用量與成本 | P2 | 未處理 | BYOK 金鑰解密失敗會靜默退回平台金鑰，成本轉由平台承擔且開始計入租戶額度 | 靜態確認 |
| [USAGE-01](#usage-01) | AI 用量與成本 | P3 | 未處理 | 用量頁沒有標示統計的母體與筆數上限，相鄰兩張卡的母體不同 | 靜態確認 |
| [USAGE-02](#usage-02) | AI 用量與成本 | P2 | 已提建議 | 價目表只能改 seed 或資料庫，缺價期間的成本永久記 0 | 靜態確認 |
| [SLA-02](#sla-02) | SLA | P2 | 未處理 | SLA 掃描每輪上限 100 張工單，且不分租戶 | 靜態確認 |
| [SLA-03](#sla-03) | SLA | P3 | 未處理 | `isDefault` 沒有讀取端，預設政策記帳不影響挑選結果 | 靜態確認 |
| [SLA-04](#sla-04) | SLA | P2 | 未處理 | 工單以政策名稱連結，改名或刪除即脫鉤 | 靜態確認 |
| [SLA-05](#sla-05) | SLA | P2 | 未處理 | 沒有關聯對話的工單永遠沒有首次回應時間，套用 SLA 時必定判定逾時 | 靜態確認 |
| [CONV-01](#conv-01) | 對話、工單與自動化 | P3 | 已提建議 | 對話的閒置自動關閉時限沒有維護介面，租戶無法調整或停用 | 靜態確認 |
| [CONV-02](#conv-02) | 對話、工單與自動化 | P2 | 已提建議 | 收件匣的下拉選單繞過關閉與指派的副作用；指派對話不會通知 | 靜態確認 |
| [CONV-03](#conv-03) | 對話、工單與自動化 | P2 | 已提建議 | 客服回覆送出失敗時，介面沒有任何標示 | 靜態確認 |
| [CASE-01](#case-01) | 對話、工單與自動化 | P2 | 已提建議 | 工單的狀態下拉選單不寫時間軸、不發布事件，選「已升級」不通知主管 | 靜態確認 |
| [CASE-02](#case-02) | 對話、工單與自動化 | P2 | 未處理 | 非 LINE 渠道的客人無法回覆滿意度調查，評分永遠不會被記錄 | 靜態確認 |
| [AUTO-01](#auto-01) | 對話、工單與自動化 | P1 | 已提建議 | 部分自動化動作可以儲存、也會命中，workers 執行時卻略過 | 靜態確認 |
| [AUTO-02](#auto-02) | 對話、工單與自動化 | P3 | 未處理 | 規則的執行紀錄、執行次數與最後執行時間自 `9255245` 起停止更新 | 靜態確認 |
| [AUTO-03](#auto-03) | 對話、工單與自動化 | P3 | 未處理 | 自動化貼標以名稱找標籤，不分 scope，找不到就重建 | 靜態確認 |
| [AUTO-04](#auto-04) | 對話、工單與自動化 | P2 | 未處理 | 關鍵字回覆頁承諾的「只在機器人對話觸發」與「每小時上限」都沒有生效 | 靜態確認 |
| [AUTO-05](#auto-05) | 對話、工單與自動化 | P2 | 未處理 | 規則編輯器提供的部分觸發事件永遠不會觸發 | 靜態確認 |
| [CONTACT-01](#contact-01) | 聯絡人、行銷與報表 | P2 | 未處理 | 兩套聯絡人合併實作行為不一致：手動合併遺失積分，自動合併硬刪除並可能失敗 | 靜態確認 |
| [IDENT-01](#ident-01) | 聯絡人、行銷與報表 | P4 | 未處理 | 合併建議沒有產生端，審核端點永遠沒有資料 | 靜態確認 |
| [IDENT-02](#ident-02) | 聯絡人、行銷與報表 | P2 | 已提建議 | LINE、Facebook 登入補 email 時不確認登入者就是該聯絡人，授權網址可由任何人以任意渠道身分產生 | 靜態確認 |
| [MKT-01](#mkt-01) | 聯絡人、行銷與報表 | P2 | 已提建議 | 群發可以重複執行，重送時不排除已送達的人 | 靜態確認 |
| [SHORT-01](#short-01) | 聯絡人、行銷與報表 | P3 | 未處理 | 記錄點擊的公開端點採信呼叫端提供的聯絡人與 LINE uid，也沒有速率限制 | 靜態確認 |
| [ANA-01](#ana-01) | 聯絡人、行銷與報表 | P3 | 未處理 | 報表以 UTC 切分日期，台灣凌晨的資料算到前一天 | 靜態確認 |
| [CHAN-01](#chan-01) | 渠道、稽核與資料權利 | P3 | 未處理 | 渠道刪除是硬刪除，有對話的渠道刪不掉並回一般錯誤 | 靜態確認 |
| [CHAN-02](#chan-02) | 渠道、稽核與資料權利 | P2 | 已提建議 | workers 只註冊 LINE 與 FB 外掛；關鍵字回覆不限渠道，在 Instagram 私訊與網站聊天室命中時客人收不到任何回覆 | 靜態確認 |
| [CHAN-03](#chan-03) | 渠道、稽核與資料權利 | P4 | 已提建議 | 進站路由不比對渠道本身的類型；FB 與 Instagram 以一般字串比對簽章 | 靜態確認 |
| [AUD-01](#aud-01) | 渠道、稽核與資料權利 | P3 | 未處理 | 租戶稽核不涵蓋登入、長效憑證、渠道憑證變更等操作 | 靜態確認 |
| [ERASE-01](#erase-01) | 渠道、稽核與資料權利 | P3 | 未處理 | 資料刪除沒有涵蓋所有個人資料，預設模式保留媒體檔與表單答案 | 靜態確認 |
| [DEP-01](#dep-01) | 部署與應用程式 | P4 | 未處理 | `video-worker` 只剩殘留 volume 設定 | 靜態確認 |
| [DEP-02](#dep-02) | 部署與應用程式 | P3 | 未處理 | `.env.prod.example` 的變數只送到 nginx 與 certbot，讀取它們的 api、workers 收不到 | 靜態確認 |
| [APP-01](#app-01) | 部署與應用程式 | P3 | 未處理 | `core` 載入時啟動另一套 SLA consumer | 執行時確認 |
| [APP-02](#app-02) | 部署與應用程式 | P3 | 未處理 | Telegram 外掛未註冊 | 執行時確認 |
| [APP-03](#app-03) | 部署與應用程式 | P4 | 未處理 | 啟動 log 少列 Threads | 執行時確認 |
| [APP-04](#app-04) | 部署與應用程式 | P4 | 未處理 | API 的 `*.worker.ts` 實際是 Queue producer | 靜態確認 |
| [APP-05](#app-05) | 部署與應用程式 | P4 | 未處理 | API 行程訂閱的 `sla.warning`、`sla.breached` 沒有發布端 | 靜態確認 |
| [APP-06](#app-06) | 部署與應用程式 | P3 | 未處理 | 訊息模擬器的 API 在正式環境可用，成員可偽造進站訊息 | 靜態確認 |
| [APP-07](#app-07) | 部署與應用程式 | P4 | 已提建議 | Canvas 等待節點的 BullMQ 路徑永遠失敗，佇列也沒有消費者 | 靜態確認 |
| [APP-08](#app-08) | 部署與應用程式 | P3 | 已提建議 | 多數 BullMQ 佇列永遠保留已完成的工作，Redis 沒有記憶體上限 | 靜態確認 |
| [APP-09](#app-09) | 部署與應用程式 | P3 | 已提建議 | API 行程假設只有一份：排程沒有鎖、Redis 廣播會重複處理，無法水平擴充 | 靜態確認 |
| [PKG-01](#pkg-01) | 共用套件 | P4 | 未處理 | `types` 與 `shared` 重複定義渠道型別 | 靜態確認 |
| [PKG-02](#pkg-02) | 共用套件 | P3 | 未處理 | `channel-plugins/fb` 子路徑指向錯誤 | 執行時重現 |
| [PKG-03](#pkg-03) | 共用套件 | P4 | 未處理 | `brain` 尚未接線，仍持續建置與監看 | 執行時確認 |
| [PKG-04](#pkg-04) | 共用套件 | P4 | 未處理 | `ui` 是空殼，仍持續建置與監看 | 執行時確認 |
| [PKG-05](#pkg-05) | 共用套件 | P4 | 未處理 | `core` 匯出沒有呼叫端的服務與事件訂閱者 | 靜態確認 |
| [PKG-06](#pkg-06) | 共用套件 | P4 | 未處理 | `channel-plugins` 有沒有呼叫端的方法、擴充與檔案 | 靜態確認 |
| [ARCH-01](#arch-01) | 架構規則 | P4 | 未處理 | route 檔直接查詢資料庫 | 靜態確認 |
| [ARCH-02](#arch-02) | 架構規則 | P4 | 未處理 | `ai` 模組 import `automation` 的 worker 檔 | 靜態確認 |
| [STO-01](#sto-01) | Storage、LLM 與資料庫 | P2 | 未處理 | Workers 的 MinIO 設定名稱不一致 | 執行時重現 |
| [LLM-01](#llm-01) | Storage、LLM 與資料庫 | P2 | 未處理 | 租戶的 Chat 與 Embedding 設定預設使用 Ollama，但組織不部署 Ollama | 靜態確認 |
| [LLM-02](#llm-02) | Storage、LLM 與資料庫 | P4 | 未處理 | 兩個 Compose 檔仍有 `ollama` 服務 | 靜態確認 |
| [LLM-03](#llm-03) | Storage、LLM 與資料庫 | P4 | 未處理 | `OLLAMA_*` 環境變數與 Chat 的位址補救已無作用 | 靜態確認 |
| [LLM-04](#llm-04) | Storage、LLM 與資料庫 | P2 | 未處理 | Embedding 只能呼叫 Ollama，知識庫自動回覆、AI 建議回覆與語意搜尋都無法運作 | 靜態確認 |
| [DB-01](#db-01) | Storage、LLM 與資料庫 | P2 | 未處理 | Prisma 與資料庫的向量維度不一致 | 執行時重現 |
| [DB-02](#db-02) | Storage、LLM 與資料庫 | P4 | 未處理 | `ContactTag.expiresAt` 沒有設定端，也沒有讀取端 | 靜態確認 |
| [DB-03](#db-03) | Storage、LLM 與資料庫 | P4 | 未處理 | `DailyStat` 每天寫入，報表不讀 | 靜態確認 |
| [DB-04](#db-04) | Storage、LLM 與資料庫 | P4 | 未處理 | schema 有、程式沒有讀寫的欄位：`Conversation.teamId`、工單合併與關聯、`Contact.isBlocked` | 靜態確認 |
| [CI-01](#ci-01) | CI 與測試 | P2 | 未處理 | 沒有 CI workflow 執行 API 測試 | 靜態確認 |
| [CI-02](#ci-02) | CI 與測試 | P3 | 未處理 | 沒有 CI workflow 執行 lint | 靜態確認 |

## 租戶隔離與權限

<a id="rls-01"></a>
### RLS-01：Canvas 引擎不走租戶連線

`packages/core/src/canvas/flow-runner.ts` 在檔案開頭匯入 `@open333crm/database` 的 module-level `prisma` singleton。`packages/core/src/canvas/scheduler.ts` 的 `processResumeQueue()` 與 `apps/api/src/modules/canvas/canvas.webhook.ts` 也用同一個 singleton。

這個 client 由 `packages/database/src/client.ts` 以 `new PrismaClient()` 建立，沒有指定 datasource，因此連線字串是 `DATABASE_URL`。這個 singleton 與 `apps/api/src/plugins/prisma.plugin.ts` 建立的租戶連線不是同一條連線，連線上也不會有 `app.current_tenant`。`AGENTS.md` 明文禁止 `packages/*` 使用這個 singleton。

`FlowRunner` 的每一個查詢都以主鍵 `executionId` 定位，`where` 沒有 `tenantId`。`canvas.service.ts` 的 `triggerFlow()` 建立 execution 時用的是受約束的 `TenantDb`，但建立後把 `execution.id` 交給 `FlowRunner.run()`，之後的讀寫就離開租戶連線。

後果依 `DATABASE_URL` 指向哪個 role 而不同：

- 指向 superuser 或帶 BYPASSRLS 的 role（`.env.api.example` 的 `crm` 屬於這類）：Canvas 的所有讀寫跳過 RLS。
- 指向 `app_tenant`：singleton 的連線沒有 `app.current_tenant`，policy fail-closed，`FlowRunner.run()` 在第一個 `findUniqueOrThrow` 就查不到列，Canvas 會靜默停止運作。

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

<a id="rls-05"></a>
### RLS-05：重抓 LINE 個人資料的端點不檢查租戶

`apps/api/src/modules/line/line-profile.routes.ts` 註冊 `PATCH /api/v1/channels/:channelId/contacts/:lineUid/sync-profile`。這條路由只掛 `fastify.authenticate`，沒有權限碼。它把路徑參數直接交給 `line-profile.service.ts` 的 `syncLineContactProfile(fastify.prismaAdmin, channelId, lineUid)`，沒有傳入 `request.agent.tenantId`。

`syncLineContactProfile()` 以 `prismaAdmin`（BYPASSRLS）查 `channelIdentity` 與 `channel`，`where` 都沒有 `tenantId`。接著它用該渠道的憑證呼叫 LINE，再改寫 `channelIdentity`。

兩層租戶隔離在這條路徑上都不生效。任何租戶的已登入成員，只要取得其他租戶的 `channelId` 與一個 LINE uid，就能：

- 讓系統以對方渠道的憑證呼叫 LINE Profile API。
- 改寫對方租戶的 `ChannelIdentity.profileName` 與 `profilePic`。
- 從回應取得該 LINE 使用者的顯示名稱與頭像網址。

`scripts/check-prisma-admin-usage.mjs` 把這個檔案列在白名單，註解寫「LINE profile（認證相關）」。這條路由是登入後的客服操作，不屬於白名單涵蓋的平台後台、auth、排程、OAuth callback 與公開 webhook。

前端、CLI 與 MCP 都沒有呼叫這個端點。

**修正方向**：路由改用 `request.tenantPrisma`，服務查 `channelIdentity` 與 `channel` 的條件都加上 `tenantId`，並把這個檔案移出白名單。確認沒有外部呼叫端的話，也可以直接移除這條路由。

<a id="rls-07"></a>
### RLS-07：短連結轉址使用 `prismaAdmin`，但不在白名單

`207da85`（2026-09-22）修復短連結被 RLS 擋下時，讓 `shortlink/shortlink-redirect.routes.ts` 改用 `prismaAdmin` 查渠道的 LIFF ID 與租戶的追蹤碼設定，但沒有把這個檔案加進 `scripts/check-prisma-admin-usage.mjs` 的白名單。從那時起，這支檢查以 `--strict` 執行就會失敗。CI 沒有執行這支檢查，所以一直沒有人發現。2026-10-01 實際執行確認。

用途看起來合理：這是不需要登入的公開路由，請求進來時還不知道是哪個租戶；路由先依短網址解析出連結，再只查該連結所屬租戶的資料。修正方式是把這個檔案加進白名單，並註明理由。

<a id="rbac-01"></a>
### RBAC-01：部分權限碼沒有強制點

**部分修正。** `481452a`（2026-09-30）讓 `contact.routes.ts` 的每一條路由都掛上 `requirePermission()`：讀取用 `contact.view`，修改與貼標用 `contact.update`，合併與解除合併用 `contact.merge`；聯絡人的對話另外要求 `inbox.view`，聯絡人的工單另外要求 `case.view`。工單、對話、標籤與短連結模組的路由仍然沒有授權判斷。

`packages/core/src/rbac/permissions.ts` 宣告 56 個權限碼（2026-10-01 核對）。其中 12 個在 `apps/api/src` 完全沒有出現：

| feature | 沒有出現的權限碼 |
| --- | --- |
| `inbox` | `inbox.manage`、`case.create`、`case.update`、`case.assign`、`case.escalate`、`tag.view`、`tag.manage`、`shortlink.view`、`shortlink.manage` |
| `core` | `agent.delete`、`billing.view` |
| `knowledge` | `knowledge.view` |

其中 `billing.view` 的描述是「租戶站內方案/用量頁」，而那個頁面不存在：租戶端的 `/dashboard/plan` 只有升級與加購的申請表，以及自己的申請列表，看不到方案內容、價格或已用額度（見 PLAN-10）。

另有兩個碼有出現，但沒有守在對應的路由上：

- `case.delete` 只以稽核紀錄的 `action` 字串出現（`case.routes.ts` 的 `action: 'case.delete'`），不是檢查。
- `case.view` 只守在聯絡人模組的 `GET /contacts/:id/cases`，`case.routes.ts` 本身不檢查。

`inbox.view` 與 `inbox.reply` 有被 `requirePermission()` 使用，但掛在 `ai` 模組的兩條 agent 路由與聯絡人模組上，不在收件匣本身。

結果是 `case`、`conversation`、`tag`、`shortlink` 這幾個模組的路由都不檢查權限碼：

- `case.routes.ts` 與 `conversation.routes.ts` 檢查渠道可見範圍（`resolveChannelVisibility()`、`assertConversationChannelVisible()`），成員只能操作自己看得到的渠道。渠道可見範圍決定「能操作哪些資料」，不決定「能做哪些動作」。
- `tag.routes.ts` 與 `shortlink.routes.ts` 只有 `fastify.authenticate`，沒有任何授權判斷。

租戶的角色設定在這個區塊不生效：管理員在角色矩陣取消勾選「刪除案件」，該角色的成員仍然刪得掉。

一個例外要分辨：`channel.view_all` 也沒有出現在 `requirePermission()` 裡，但它透過 `getEffectiveTenantPermissions()` 在 `services/channel-visibility.ts` 與 socket 房間授權中判斷，屬於有強制點的情況。

**這是未完成的遷移，不是設計決策。** `openspec/changes/archive/2026-09-15-rbac-granular-permissions/tasks.md` 的第 9.2 項「分批灰度切換路由 guard（新舊並存），監控 403 異常」沒有打勾，該 change 就已歸檔。同一節的 9.1、9.3、9.4、9.5 也都沒有打勾。

舊的角色守門也已經不在：`requireRole()`、`requireAdmin()`、`requireSupervisor()` 仍由 `guards/rbac.guard.ts` 匯出，但 `apps/api/src` 沒有任何呼叫端。`case.routes.ts` 的 git 歷史也查不到曾經使用過。因此這些路由不是「從舊守門切到新守門時漏掉」，而是從頭就沒有授權判斷。

啟動時的檢查只驗單向：`validateRouteCodes()` 確認路由用到的碼都存在於 registry，不檢查 registry 的碼有沒有人用。因此宣告了卻沒有強制點的碼不會產生任何警告。

對方案天花板的連帶影響見 PLAN-04。

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

指派自訂角色時，`agent.service.ts` 的 `resolveRoleAssignment()` 讓 `role` 沿用成員原本的值。因此兩個同屬一個自訂角色的成員，行為可能正好相反：原本是 `ADMIN` 的人會收到所有主管通知，也永遠不會被自動指派工單；原本是 `AGENT` 的人則相反。「人員管理」頁只顯示細粒度角色，管理員看不到這個差異。

<a id="rbac-04"></a>
### RBAC-04：渠道可見範圍有多處沒有套用

渠道可見範圍讓同一個租戶內的成員只看到被授權的渠道，規則在 `services/channel-visibility.ts`。收件匣與工單的 REST 路由、單一對話的 socket 房間有套用；下列路徑沒有：

| 路徑 | 沒有套用的結果 |
| --- | --- |
| `plugins/socket.plugin.ts` 在連線時讓每條 socket 自動加入 `tenant:<租戶 ID>` | `conversation.service.ts` 的 `sendMessage()` 與 `webhook/inbound-socket-presenter.ts` 的 `emitToConversationAndTenant()` 都把含訊息內容的 `message.new` 發到租戶房間。受限的客服即時收到所有渠道的訊息 |
| `contact.routes.ts` 的所有路由 | 聯絡人清單、`/:id/conversations`（含每個對話的最後一則訊息內容）、`/:id/cases`、`/:id/timeline` 與合併，都不過濾渠道 |
| `ai.routes.ts` 的 `/suggest-reply`、`/summarize` | 以 `conversationId` 讀整段對話，不檢查對話的渠道 |
| `case.routes.ts` 的 `POST /` | 建立工單時不檢查 `channelId` 是否可見 |
| `case.routes.ts` 的 `GET /stats` | 統計全租戶的工單 |

第一項影響最大：只要受限客服的畫面連著 socket，渠道可見範圍在即時事件上等於不存在。

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

**修正方向**：reconcile 只補上「預設有、但租戶從未設定過」的新權限碼，不刪除也不重加既有的碼；這需要記錄每個角色已經同步到哪一版註冊表。腳本結束前清除 `perms:*` 快取，並納入部署流程。

<a id="rbac-06"></a>
### RBAC-06：預設角色的權限有兩份，內容已經不同

系統角色的預設權限寫在兩個地方：

| 位置 | 用途 |
| --- | --- |
| `packages/core/src/rbac/default-roles.ts` 的 `DEFAULT_ROLE_PERMISSIONS` | 平台開通租戶、reconcile 腳本 |
| `packages/database/prisma/seed-data/rbac-roles.ts` | `pnpm db:seed` 建立的 demo 租戶 |

第二份存在的原因寫在檔頭：`database` 套件不能 import `core`，否則形成循環相依。兩份以人工同步，逐項比對的結果如下：

| 角色 | 只在 core 的版本 | 只在 demo seed 的版本 |
| --- | --- | --- |
| `supervisor` | 無 | `channel.view_all` |
| `agent` | 無 | 無 |
| `admin` | `audit.view`、`data.export`、`data.erase`（core 的 `admin` 是註冊表的全部權限碼） | 無 |

**分歧的來源。** 兩份檔案與平台的開通流程都在 2026-08-25 加入（`723f6e1`、`acb7568`），當時內容一致。之後兩次新增權限碼，各只更新了其中一份：

| 日期 | commit | 新增的權限碼 | core 的版本 | demo seed 的版本 |
| --- | --- | --- | --- | --- |
| 2026-08-26 | `ad686d2` | `audit.view`、`data.export`、`data.erase` | `admin` 以全部權限碼計算，自動取得 | `ADMIN_ONLY` 沒有更新 |
| 2026-09-11 | `4382dc3` | `channel.view_all`、`channel.assign_team`、`agent.deactivate`、`agent.purge` | `SUPERVISOR_CODES` 沒有更新 | `supervisor` 加上 `channel.view_all` |

影響：

- **開發環境的 `supervisor` 看得到所有渠道，平台開通的租戶則受渠道綁定限制。** 在開發環境測試分店情境時，得到的結果與正式租戶不同。
- **demo 租戶的 `admin` 呼叫不了稽核日誌、資料匯出與資料刪除的端點**，直到執行 reconcile。
- CHANGELOG 的 CM-173 寫 `channel.view_all`「給 admin/supervisor」，與下方定案的方向不符。openspec 的設計文件只寫「授予給總店主管類角色」，沒有指定角色。

**已定方向（2026-09-30）**：`supervisor` 預設**不**擁有 `channel.view_all`，以 core 的版本為準。總店主管由租戶管理員另外授權，例如建立含 `channel.view_all` 的自訂角色。要做的事：

1. demo seed 的 `supervisor` 移除 `channel.view_all`；`admin` 改為註冊表的全部權限碼，與 core 相同。
2. 兩份改為共用同一個來源，避免再次分歧。例如把預設權限移到 `core` 與 `database` 都能相依、而且不相依兩者的位置，或讓 demo seed 改由 API 的開通流程建立租戶。

<a id="team-01"></a>
### TEAM-01：團隊沒有建立與管理成員的途徑

`Team` 與 `AgentTeamMember` 沒有任何寫入端。API、workers、種子資料與前端都沒有建立團隊、加入成員或移除成員的功能。

依賴團隊的功能因此都只能直接改資料庫才用得起來：

- 渠道授權給團隊。渠道管理頁的團隊授權只能從 `GET /channels/teams` 列出的既有團隊中選擇。
- 工單依團隊自動指派。`autoAssignCase()` 只在工單有 `teamId` 時觸發，候選人是該團隊的成員。
- 對話的團隊限制。見 DB-04。

<a id="a2a-01"></a>
### A2A-01：A2A 橋接以最早建立的租戶執行外部任務

`A2A_BRIDGE_ENABLED` 為 `true` 時，`settings/a2a-bridge.worker.ts` 的 `startA2ABridgeWorker()` 在 API 行程常駐輪詢 A2A Hub。收到外部 agent 的任務後，它用 `prismaAdmin` 查出 `isActive` 為 `true`、`createdAt` 最早的租戶，再以該租戶的身分執行 `runAgentReply()`。

橋接的身分（`A2A_AGENT_ID`、`A2A_AGENT_TOKEN`）是整個部署共用的環境變數，任務本身不帶租戶。後果如下：

- 多租戶部署中，所有外部任務都以同一個租戶執行。AI 呼叫使用該租戶的金鑰設定，包含租戶自備的 Gemini 金鑰，用量也記在該租戶名下。
- 那個租戶被停用後，任務改由次早建立的租戶執行，沒有任何通知。
- 每個租戶的「設定 → 整合 → A2A」都顯示同一個橋接的狀態，看起來像是自己租戶的設定。

只有一個租戶的部署不受影響。

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

<a id="auth-05"></a>
### AUTH-05：租戶端的 JWT 不分用途，refresh token 能通過客服認證

**部分修正。** `481452a`（2026-09-30）刪除了 `POST /api/v1/fan/auth`。這條路由只要 body 帶 `contactId` 與 `tenantId`、而且該聯絡人存在，就簽發粉絲 token，不驗證任何登入憑證。刪除之後，`signFanToken()` 沒有呼叫端，系統目前不簽發粉絲 token。驗證端沒有改：`authenticate` 仍然不區分 token 的種類。

`JWT_SECRET` 同時簽發下列 token，`@fastify/jwt` 也以它驗證客服的 access token：

| token | 簽發位置 | 內容 | 有效期 |
| --- | --- | --- | --- |
| 客服 access token | `auth.routes.ts` 的 `signAccessToken()` | `agentId`、`tenantId`、`role`、`roleId` | 預設 15 分鐘 |
| 客服 refresh token | `auth.routes.ts` 的 `signRefreshToken()` | 同上，另加 `rememberMe` | 預設 30 天 |
| 粉絲 token | `portal-auth.service.ts` 的 `signFanToken()`，目前沒有呼叫端 | `sub: 'fan'`、`contactId`、`tenantId` | 24 小時 |
| MCP 確認 token | `mcp/line-mcp-confirmation.ts` 的 `createLineMcpConfirmation()` | `op`、`tenantId`、`agentId` 等 | 5 分鐘 |

`auth.plugin.ts` 的 `authenticate` 只呼叫 `jwtVerify()`，不檢查 token 的種類，也不要求 payload 帶 `agentId`。`plugins/socket.plugin.ts` 的連線驗證同樣只驗簽章。因此這四種 token 都能當客服的 access token 使用。

**refresh token 能當 access token 使用 30 天。** refresh token 放在 httpOnly cookie，前端程式讀不到，被第三方盜用的機會較低。但 refresh token 一旦外洩，就能當 access token 使用到過期，而且 `authenticate` 不檢查成員或租戶是否已停用。成員本人也能從瀏覽器取出自己的 refresh token：成員被停用之後，`POST /auth/refresh` 會擋下換發，但直接拿 refresh token 呼叫 API 不會被擋。AUTH-02 所說「REST 這一面是有界的」前提，在 refresh token 直接當 access token 時不成立。

**粉絲 token 的簽發路徑接回之後，粉絲 token 也能通過客服認證。** `openspec/changes/add-cross-channel-one-id/tasks.md` 的 9.3.3 預計接回簽發路徑，由優惠券分支的 Account Link 或之後的會員登入頁簽發。接回之後，持有粉絲 token 的人呼叫客服 API 時，`request.agent` 為 `{ id: undefined, tenantId, role: undefined, roleId: null }`：

- `requirePermission()` 以 `roleId` 計算權限，得到空集合，掛權限碼的路由回 403。
- 不檢查權限碼的路由全部放行：對話、訊息、工單、標籤、通知、AI 輔助、短連結、檔案、訊息模擬器，也包括送出訊息給客人。對話與工單另有渠道可見範圍的檢查，但下一點說明粉絲 token 也能通過。見 RBAC-01。
- 渠道可見範圍的 `resolveRoleId()` 以 `agent.findFirst({ where: { id: undefined, tenantId } })` 查角色。Prisma 忽略值為 `undefined` 的條件，查到的是該租戶的任一成員，於是沿用那個人的角色。即使沒有 `channel.view_all`，沒有綁定成員或團隊的渠道本來就所有人可見。
- 以粉絲 token 連 socket，會自動加入租戶房間，即時收到全租戶的新訊息內容。見 RBAC-04。

**優先順序。** 刪除 `/fan/auth` 之後，利用這一項需要先取得外洩的 refresh token，或曾經是該租戶的成員，因此從 P1 調為 P2。這一項必須在 9.3.3 接回簽發路徑之前修正。

**修正方向**：

- 各種 token 以不同的密鑰簽發，或加上用途欄位（例如 `typ`），由 `authenticate` 與 socket 驗證時檢查。
- `authenticate` 要求 payload 帶 `agentId`。
- 接回粉絲 token 的簽發路徑時，由驗證過的憑證（例如 LINE LIFF 的 ID token）推導出聯絡人，不接受呼叫端指定。

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

這是 `login-attempts.ts` 的註解記下的已知取捨，`add-login-brute-force-protection` 的規格沒有提到。帳號被鎖時，`login()` 會寫一筆 warn log（`[Auth] 登入因失敗次數過多被擋`，帶 email 雜湊），可以從 log 發現有人反覆鎖同一個帳號。

**修正方向**：`login-attempts.ts` 的註解建議改以 email 加來源 IP 計數。改用這個鍵之後，攻擊者的失敗嘗試只鎖住攻擊者自己的 IP，成員從其他 IP 仍可登入。代價是：從多個 IP 分散猜同一個帳號時，每個 IP 各自計數，只剩每個 IP 的速率限制能擋。另一個做法是保留 email 計數，但鎖定期間改為要求額外驗證，而不是直接拒絕。

## 金鑰與 License

<a id="sec-01"></a>
### SEC-01：渠道加密金鑰備援值

盤點時，API 的 `channel.service.ts` 與 Workers 的 `apps/workers/src/lib/credentials.ts` 都有同一個備援字串。缺少 `CREDENTIAL_ENCRYPTION_KEY` 時，兩個檔案都改用這個公開在原始碼中的字串。

Commit `f507fe1` 修正了 API 端：

- `channel.service.ts` 在金鑰缺少或長度不足時拋出錯誤。
- API 啟動時的環境變數驗證要求這個變數，設定缺失會讓 API 啟動失敗。

Workers 端尚未修正。`credentials.ts` 仍保留備援字串，設定缺失不會讓 Workers 啟動失敗。Workers 只用這把金鑰解密，因此不會用備援值加密新資料。Workers 缺少金鑰時，這項設定錯誤要到 Workers 解密渠道憑證時才會出現。

<a id="lic-01"></a>
<a id="lic-02"></a>
### LIC-01、LIC-02：兩份 LicenseService

`license.guard.ts` 使用 `apps/api/src/services/license.ts`。該實作直接建立寫死的授權資料，不會連線到授權伺服器。

`packages/core/src/license/license-service.ts` 會呼叫 `LICENSE_FETCH_URL`，但沒有實際使用者。

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

**介面擋不住。** `/admin/trial` 的「設定」分頁在欄位 `onBlur` 時直接呼叫 `PUT`，沒有確認步驟，數字欄位也沒有 `min`。清空數字欄位再離開時，`parseInt('')` 得到 `NaN`，JSON 序列化成 `null`；`PlatformSetting.value` 是必填的 `Json`，這筆寫入會失敗，而 `saveSetting()` 沒有 `catch`，頁面既不顯示成功也不顯示失敗。`trial.planSlug` 不在這個分頁上，只能直接呼叫 API，而 API 不檢查方案是否存在。

**管理面也有缺口：**

- 沒有刪除端點。寫錯的鍵刪不掉，也沒有「恢復預設」，只能手動寫回預設值，而預設值只存在於原始碼的 `DEFAULTS`。
- 稽核只記鍵名，不記新舊值（見[平台設定](../features/platform/SETTINGS.md)）。
- 每個參數各自一次 `PUT`。彼此相關的參數（例如試用天數與提醒檔位）無法一起改，中間狀態會被排程讀到。

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

## 方案與額度

功能說明見[方案與上限](../features/platform/PLANS.md)與[方案異動審核](../features/platform/PLAN-CHANGES.md)。

<a id="plan-01"></a>
### PLAN-01：`Plan.isActive` 沒有讀取端

`Plan.isActive` 的 schema 註解寫「停售軟下架」，`/admin/plans` 也能切換它。但整個 repo 沒有任何查詢以它為條件。

`grep -rn "isActive" apps/api/src apps/web/src` 的命中全部屬於 `Tenant`、`Agent` 或 `PlatformUser`，沒有一處是 `Plan`。三條指派方案的路徑都只以 `slug` 查方案，查到就用：

| 路徑 | 位置 |
| --- | --- |
| 平台改租戶方案 | `platform-tenant.service.ts` 的 `updateTenant()` |
| 核准升級申請 | `plan-change.service.ts` 的 `approveRequest()` |
| 試用開通綁定方案 | `trial.service.ts`，方案來自 `trial.planSlug` |

因此把一個方案設為停售，只會改變 `/admin/plans` 上的顯示。它仍然可以被指派給新的或既有的租戶，既有租戶也完全不受影響。

這與 SLA-03 是同一種形狀：欄位有寫入端與介面，沒有讀取端，操作者以為的效果不會發生。

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
### PLAN-04：功能天花板在收件匣一帶沒有咬合點

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

以 feature 分組統計各模組的路由數與權限檢查數（2026-09-24 核對）：

| feature | 路由層的覆蓋情況 | 關掉這個 feature |
| --- | --- | --- |
| `automation` | `canvas` 11 條全有、`automation` 7 條中 5 條 | 擋得住 |
| `analytics` | 9 條路由、10 處檢查 | 擋得住 |
| `channels` | `channel` 19 條中 17 條 | 大致擋得住 |
| `marketing` | 36 條中 21 條 | 大部分擋得住，仍有未檢查的路由 |
| `knowledge` | 21 條中 12 條 | 同上 |
| `portal` | 17 條中 8 條 | 同上 |
| `inbox` | `case` 19 條、`conversation` 14 條、`contact` 10 條、`tag` 4 條、`shortlink` 8 條，**全部 0 處檢查** | **沒有效果** |
| `core` | 恆開，方案不會關 | 不適用 |

也就是說，把 `inbox` 從方案的 `features` 拿掉之後，該租戶的收件匣、對話、案件、聯絡人、標籤與短連結全部照常使用。前端也擋不住：`apps/web` 的 `Sidebar.tsx` 會依權限過濾選單，但「收件匣」「工單」「聯繫人」「通知」四個節點沒有 `perm` 欄位，一律顯示。

`maxTags` 是另一種形狀的失效：它在 `apps/api/src` 只出現在 `plan-limits.service.ts` 的 `LimitKey` 型別宣告，沒有任何地方拿它比對，與 PLAN-01 的 `Plan.isActive` 相同。

成因見 RBAC-01。

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

<a id="plan-06"></a>
### PLAN-06：核准加購之後，當月的額度告警全部靜默

`approveRequest()` 核准加購後呼叫 `clearTokenQuotaCache(req.tenantId)`，程式註解寫「讓硬擋重讀新額度」。這一行清掉的是用量計數器 `aiquota:{tenantId}:{YYYY-MM}`，不是告警旗標。

清計數器沒有必要，也沒有效果：

- 上限不在 Redis。`isMonthlyTokenExceeded()` 每次都呼叫 `getEffectiveLimit()` 查資料庫，本來就讀得到新額度。
- 計數器存的是已用量。清掉之後，下一次呼叫會從 `aiUsage` 重新加總回填，得到的值與清掉之前相同，只是多跑一次聚合查詢。

真正需要清的是告警旗標 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`。`checkQuotaThresholdCrossing()` 用 `SET NX` 搶旗標做冪等，搶不到就不回報該門檻，而旗標的過期時間是月底。於是同一個月內第二次接近上限時，兩個門檻都不會再發通知：

| 事件 | 有效上限 | 累計用量 | 跨越的門檻 | 是否通知 |
| --- | --- | --- | --- | --- | --- |
| 用量累積 | 200,000 | 160,000 | warning（80%） | 是，旗標寫入 |
| 用量累積 | 200,000 | 200,000 | critical（100%） | 是，旗標寫入。之後被硬擋 |
| 核准加購 300,000 | 500,000 | 200,000 | 無 | 無 |
| 用量累積 | 500,000 | 400,000 | warning（80%） | **否**，旗標已存在 |
| 用量累積 | 500,000 | 500,000 | critical（100%） | **否**，旗標已存在。再次被硬擋 |

告警會送給該租戶的所有 ADMIN，站內通知與 email 各一份（`notification.worker.ts` 訂閱的 `usage.quota.threshold` 事件）。因此加購過的租戶當月第二次用完額度時，是毫無預警被擋下的。

租戶也無法自己查。`getEffectiveLimit()` 的呼叫端都在伺服器端做判斷，沒有任何路由把上限或已用量回傳給租戶端；租戶側的 `/api/v1/plan-change` 只能列出自己的申請與發起新申請。這兩個門檻的告警是租戶唯一的資訊來源。

修正所需的函式已經存在：`token-quota.service.ts` 的 `clearQuotaAlertFlags(tenantId)` 由 2026-08-26 的 `ce55353` 加入，專門清除告警旗標，但目前沒有任何呼叫端。核准 `token_topup` 時一併呼叫它即可。

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
| `kb-autoreply`（`automation.worker.ts`）、自動化動作（`engine/action-executor.ts`） | 客人傳訊息、規則命中 | 不經過路由，沒有請求可以掛 guard |

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

**唯一的寫入端是 seed，而 seed 不能在正式環境執行。** 全 repo 只有 `packages/database/prisma/seed.ts` 的 `seedModelPricing()` 會寫 `modelPricing`，平台後台沒有任何路由。但 `seed.ts` 的 `main()` 會建立 Demo Tenant 與一批固定密碼的 demo 成員，`seedPlatformUser()` 種的也是開發用密碼。因此「調價要改 seed」在正式環境等於不可行，實務上只剩直接改資料庫一條路。

**缺價期間的成本無法事後修正。** 成本在寫入 `AiUsage` 的當下就算好，之後不重算。`getPricing()` 查不到價目時 `calcCostUsd()` 回 `null`，呼叫端記 `costUsd = 0` 並標 `usageMissing`。所以從新模型開始被使用、到有人手動補上價目之間的每一筆呼叫，成本永久是 0，而 repo 裡沒有任何重算路徑。

**快取讓這段期間更長。** `pricingCache` 是行程內的 `Map`，TTL 10 分鐘，而且**連查無價目的 `null` 一起快取**。補上價目之後最久還要再等 10 分鐘才會套用，多個 API 行程各自計時。`clearPricingCache()` 的註解寫「測試/改價後手動清快取用」，但全 repo 沒有任何呼叫端，也沒有對外端點。

**平台看不出帳面被低估。** `/admin/usage` 不看 `usageMissing`（見 USAGE-01），畫面上的成本只會偏低，沒有任何提示。唯一的線索是 `recordAiUsage()` 留的一則 warn log。

**修正方向（2026-09-30 提出，尚未實作）**

補一組 `ModelPricing` 的平台路由即可，不需要改 schema，版本化欄位已經齊備：

- **寫入介面**：列出各 model 的現行價目、新增一個 `effectiveFrom` 版本。寫入時一併呼叫 `writePlatformAudit()`，調價是會改變帳面的操作，應該留紀錄。
- **快取失效**：把 `clearPricingCache()` 接到寫入路由。但它清的是行程內的 `Map`，多行程時只對自己有效，應比照 `invalidatePlanPermissions()` 改走 Redis。
- **不要快取查無價目**：查不到時縮短 TTL 或直接不寫入快取，避免補完價目還要等滿 10 分鐘。
- **既有的零成本列**：要修正需要一條重算路徑（依 `model` 與 `createdAt` 回查當時應適用的價目版本）。若不打算做重算，至少讓 `/admin/usage` 顯示 `usageMissing` 的筆數，讓平台知道帳面被低估——這一點與 USAGE-01 一起修。

## SLA

功能說明見[服務水準協議](../features/SLA.md)。

<a id="sla-02"></a>
### SLA-02：掃描每輪上限 100 張工單

`apps/workers/src/handlers/sla.handler.ts` 的 `getActiveCases()` 用 `take: 100` 取工單，沒有 `orderBy`，也沒有租戶條件。這個上限是全系統共用，不是每個租戶各 100 張。

全系統符合條件的工單超過 100 張時，超出的部分在該輪不會被檢查。沒有 `orderBy`，因此每輪取到哪 100 張由資料庫決定，不保證輪替。掃描間隔是 300 秒。

<a id="sla-03"></a>
### SLA-03：`isDefault` 沒有讀取端

`apps/api/src/modules/sla/sla.routes.ts` 的建立與修改路由各有一段邏輯，維持「同一優先級只有一條政策的 `isDefault` 是 `true`」。`apps/web/src/components/settings/SlaManagement.tsx` 也顯示這個標記。

但 `apps/api/src/modules/case/case.service.ts` 的 `createCaseRecord()` 在呼叫端沒有指定 `slaPolicyId` 時，是這樣挑政策的：

```ts
await prisma.slaPolicy.findFirst({ where: { tenantId, priority } })
```

沒有 `isDefault: true`，也沒有 `orderBy`。同一優先級有多條政策時，挑中哪一條由資料庫決定，與 `isDefault` 無關。

<a id="sla-04"></a>
### SLA-04：工單以政策名稱連結政策

`SlaPolicy` 與 `Case` 之間沒有 relation。`Case.slaPolicy` 是 `String?`，存的是政策名稱。`case.service.ts` 建立工單時寫入 `slaPolicy: slaPolicy?.name`，`sla.handler.ts` 的 `getPolicy()` 再以 `findFirst({ where: { tenantId, name } })` 回查。

由此產生三個問題：

- 修改政策名稱之後，既有工單的 `slaPolicy` 仍是舊名稱。`getPolicy()` 回傳 null，`sla.handler.ts` 直接 `continue`，該工單從此不再受監控，而且沒有任何紀錄。
- `sla_policies` 只有 `@@index([tenantId])`，沒有 `(tenantId, name)` 的唯一約束。同一租戶建立兩條同名政策時，`findFirst` 回傳哪一條不確定。
- `DELETE /api/v1/sla-policies/:id` 是硬刪除，沒有引用檢查。`SlaPolicy` 沒有 `isActive` 欄位，因此無法套用 `AGENTS.md` 的 soft-delete 慣例。刪除後，引用該名稱的工單留下一個查不到政策的字串。

<a id="sla-05"></a>
### SLA-05：沒有關聯對話的工單沒有首次回應時間

`c99c40d` 之後，客服在工單關聯的對話送出訊息時，`conversation.service.ts` 的 `sendMessage()` 呼叫 `case.service.ts` 的 `markCaseFirstResponse()` 寫入 `Case.firstResponseAt`。對話掛到既有工單時，`syncFirstResponseFromConversation()` 也會補上工單建立後最早的那則客服訊息。

兩個寫入點都以「工單關聯的對話」為前提。`POST /api/v1/cases` 的 `createCase()` 只帶 `contactId` 與 `channelId`，不建立對話關聯。客服之後在這位聯絡人的對話裡回覆，只要那個對話沒有掛到這張工單，就不算這張工單的首次回應。

這種工單套用 SLA 政策時：

- `sla.handler.ts` 在 `createdAt + firstResponseMinutes` 到期時判定 `first_response_breached`，通知負責人與主管、寫入 `CaseEvent`、觸發自動化規則。去重的區間是 24 小時，工單沒有結案前每 24 小時再發一次。
- 分析報表的平均首次回應時間不計入這種工單。

`apps/api/src/scripts/backfill-case-first-response.ts` 為既有工單補值時，也只看關聯對話裡的客服訊息，同樣補不到這種工單。另一種補不到的情況是：客服只在工單建立之前回覆過，之後沒有再回覆。

**修正方向**：手動建立工單時，若這位聯絡人在該渠道有進行中的對話，就把對話掛到工單上；或者讓首次回應改以「工單建立後，客服對這位聯絡人在該渠道送出的第一則訊息」判斷，不要求對話關聯。

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

**`conversation.assigned` 沒有發布端。** `notification.worker.ts` 訂閱了這個事件，要通知被指派的客服；但 API 行程裡沒有任何程式發布它（唯一的 `emit` 在沒有呼叫端的 `action-executor.ts`，而且是 socket 事件）。因此指派對話從來不會通知被指派的人，訂閱這個事件的對外 Webhook 也收不到。

狀態選單的標籤也容易誤解：「已處理」送出的值是 `AGENT_HANDLED`，意思是「由客服處理中」。

**修正方向**：`updateConversation()` 收到 `CLOSED` 時改走 `closeConversation()`；指派時發布 `conversation.assigned`，讓通知與對外 Webhook 接得到。

<a id="conv-03"></a>
### CONV-03：客服回覆送出失敗時，介面沒有任何標示

`conversation.service.ts` 的 `sendMessage()` 先寫入一則 `OUTBOUND` 訊息、推送到收件匣，再呼叫渠道外掛送出。送出失敗時：

- LINE 只把 `metadata.lineDeliveryStatus` 寫成 `failed`。
- 其他渠道什麼都不寫。
- 例外被捕捉後只寫 log。

前端的 `MessageBubble.tsx` 與對話清單只認 `metadata.deliveryFailed`，這個欄位只有 workers 的 `channel-delivery.ts`（自動化發送）會寫。`POST /conversations/:id/messages` 也把 `sendMessage()` 回傳的 `delivery` 丟掉，只回傳訊息本身。

因此客服手動回覆的訊息送不出去時，例如 token 失效或 LINE 訊息額度用完，畫面上和成功送出的訊息一模一樣。客服會以為客人已經收到。

**修正方向**：送出失敗時一律寫入 `metadata.deliveryFailed` 與錯誤說明，並推送更新；文字回覆的路由把 `delivery` 回傳給前端。

<a id="case-01"></a>
### CASE-01：工單的狀態下拉選單繞過狀態轉換的副作用

工單改狀態有兩類路徑：

| 路徑 | 呼叫端 | 服務函式 |
| --- | --- | --- |
| `POST /cases/:id/resolve`、`/close`、`/reopen` | 工單詳情頁的按鈕 | `case.service.ts` 的 `transitionCase()` |
| `POST /cases/:id/escalate` | 升級對話框 `EscalationModal.tsx` | `case.service.ts` 的 `escalateCase()` |
| `PATCH /cases/:id` 帶 `status` | 工單詳情頁的狀態下拉選單，`CaseDetail.tsx` 的 `handleStatusChange()` | `case.service.ts` 的 `updateCase()` |

兩類路徑都經過 `validateTransition()`，允許的轉換相同。差別在副作用：

| 副作用 | 專用端點 | `PATCH /cases/:id` |
| --- | --- | --- |
| 寫入 `CaseEvent`（工單時間軸） | 有 | 沒有 |
| 發布 `case.resolved`、`case.closed` | 有 | 沒有 |
| 發布 `case.escalated`（通知主管、觸發自動化） | 有 | 沒有 |
| 記錄升級原因 | 有 | 沒有 |
| 設定 `resolvedAt`、`closedAt` | 有 | 有 |

下拉選單的選項包含「已升級」。客服從下拉選單把工單改成 `ESCALATED` 時，主管不會收到通知，訂閱 `case.escalated` 的自動化規則也不會觸發。從下拉選單解決或關閉的工單，時間軸上沒有這筆紀錄，訂閱 `case.resolved`、`case.closed` 的對外 Webhook 也收不到事件。

`resolvedAt` 仍然會寫入，因此 CSAT 排程照常發送調查。

**修正方向**：`updateCase()` 收到 `status` 時改走 `transitionCase()`，收到 `ESCALATED` 時拒絕並要求改用 `/escalate`。另一個做法是讓前端的下拉選單改呼叫專用端點。

<a id="case-02"></a>
### CASE-02：非 LINE 渠道的滿意度調查無法回覆

`csat.service.ts` 的 `sendCsatSurvey()` 依渠道送出調查：

| 渠道 | 實際送出的內容 | 客人能不能回覆 |
| --- | --- | --- |
| LINE | Flex Message，五個 postback 按鈕，資料是 `csat:<分數>:<工單 ID>` | 能 |
| 其他渠道 | `deliverToChannel()` 送出文字「回覆 csat:分數 即可，例如 csat:5」 | 不能 |

`inbound-postback-interceptors.ts` 的 `handleCsatResponse()` 只認得 `csat:<分數>:<工單 ID>`。客人照提示回覆的 `csat:5` 沒有工單 ID，不符合這個格式，會被當成一般訊息交給 AI 回覆與自動化。

另外兩個零件也沒有接上：

- `buildCsatChannelMessage()` 為非 LINE 渠道組了五個快速回覆選項，但 `sendCsatSurvey()` 只在 LINE 分支使用它的回傳值。
- 進站的 `postbackData` 只從 LINE 的 `rawPayload.postback.data` 取值，Facebook 的 postback 欄位沒有解析，因此即使改送快速回覆或按鈕，Facebook 送回的 payload 也到不了攔截器。

結果是非 LINE 渠道的工單永遠不會有 CSAT 分數，報表的滿意度只反映 LINE 的客人。

<a id="auto-01"></a>
### AUTO-01：部分自動化動作可以儲存、也會命中，執行時卻被略過

2026-05-12 的 `9255245` 把自動化規則的評估與執行，從 API 行程搬到 `apps/workers`。從那之後，`automation` queue 由 `apps/workers/src/handlers/automation.handler.ts` 消費，動作由 `lib/automation-actions.ts` 的 `executeWorkerAutomationActions()` 執行。

搬遷時只實作了一部分動作。規則契約 `packages/automation/src/contracts/actions.ts` 的 `AUTOMATION_ACTION_DEFINITIONS` 與前端規則編輯器都提供下列動作，`executeWorkerAutomationActions()` 卻沒有對應的分支：

| 動作 | 前端標籤 |
| --- | --- |
| `create_case` | 建立工單 |
| `remove_tag` | 移除標籤 |
| `assign_bot` | 指派機器人 |
| `kb_auto_reply` | KB 知識庫回覆 |
| `llm_reply` | LLM 智能回覆 |

遇到上表的動作時，函式只記一行 info 等級的 log（`Unsupported worker action "…" skipped`），然後繼續執行下一個動作。規則能通過 `automation.handler.ts` 呼叫的 `validateAutomationRuleContract()`，因為契約只依事件提供的資料判斷動作是否允許，不管 workers 有沒有實作。

結果：租戶可以建立「收到訊息 → 建立工單」這類規則。規則儲存成功、條件命中，前端也收到 `automation.executed` socket 事件，但工單從未建立。

API 行程的 `modules/automation/engine/action-executor.ts` 的 `executeActions()` 實作了上表的動作，但自 `9255245` 起沒有任何檔案 import 它。

**修正方向**：兩個方向擇一：

- 把缺少的動作補進 `executeWorkerAutomationActions()`。
- 在契約標出 workers 支援哪些動作，讓前端與 `validateAutomationRuleContract()` 拒絕其他動作。

不論選哪一個，都應刪除 API 端沒有呼叫端的 `action-executor.ts`，避免讀程式的人以為它在運作。

<a id="auto-02"></a>
### AUTO-02：規則的執行紀錄與執行次數停止更新

寫入 `AutomationLog`、更新 `AutomationRule.runCount` 與 `lastRunAt` 的程式，只存在 API 端 `action-executor.ts` 的 `executeActions()`。這個函式自 `9255245` 起沒有呼叫端（見 AUTO-01），workers 的執行路徑也不寫這些欄位。

- 自動化頁的規則清單顯示的執行次數與最後執行時間，停在搬遷前的值。搬遷後建立的規則永遠顯示 0。
- `GET /automation/logs` 查不到搬遷後的任何執行。前端沒有呼叫這個端點。

`AutomationExecution` 表則是從來沒有任何程式讀寫。

<a id="auto-03"></a>
### AUTO-03：自動化的貼標動作以名稱找標籤，不分 scope，找不到就重建

workers 的 `automation-actions.ts` 執行 `add_tag` 時，以 `tag.findFirst({ where: { name, tenantId } })` 找標籤，沒有限定 `scope`。

- 同名的 `CASE`、`CONVERSATION` 或 `MATERIAL` 標籤可能被找到並貼到聯絡人上。`tagging.service.ts` 的 `assertTagScope()` 會拒絕這種組合，這條路徑繞過了它。
- 找不到時，直接以這個名稱建立一個 `scope` 為預設 `CONTACT` 的新標籤。標籤被管理員刪除或改名後，規則下一次觸發就默默把舊名稱的標籤建回來。

<a id="auto-04"></a>
### AUTO-04：關鍵字回覆頁承諾的兩項保護都沒有生效

`line/keyword-replies/page.tsx` 在頁面上寫著兩條規則：

1. 規則只在機器人負責（`BOT_HANDLED`）的對話觸發，客服接手的對話不會自動回覆。
2. 同一個聯絡人對同一條規則，每小時最多觸發三次。

兩條都沒有實作在實際執行的路徑上：

- `automation.worker.ts` 的 `checkKeywordTriggers()` 對所有對話都比對關鍵字並發布 `keyword.matched`；workers 的 `send_material` 也不檢查對話狀態。
- 每小時上限 `RATE_LIMIT_MAX` 只寫在沒有呼叫端的 `action-executor.ts`。這段是 2026-05-28 的 `fff80d8` 加入的，當時 `action-executor.ts` 已經因 `9255245` 而沒有呼叫端。

結果：客服接手對話後，客人訊息含關鍵字時仍會收到自動回覆；客人重複傳同一個關鍵字，每次都會收到回覆。另外，一則訊息命中多條關鍵字規則時，每條各回一次。

<a id="auto-05"></a>
### AUTO-05：規則編輯器提供的部分觸發事件永遠不會觸發

規則編輯器（`automation/[ruleId]/page.tsx`）以 `packages/automation` 的 `AUTOMATION_EVENT_DEFINITIONS` 列出全部觸發事件。實際送進 `automation` queue 的只有：

- `automation.worker.ts` 訂閱並轉送的 `message.received`、`keyword.matched`、`conversation.created`、`case.created`、`case.escalated`、`contact.created`、`contact.tagged`、`link.clicked`、`portal.activity.submitted`。
- workers 的 `sla.handler.ts` 自己查規則的五種 SLA 事件。

其餘事件的規則可以儲存，但永遠不會執行：

| 事件 | 原因 |
| --- | --- |
| `case.closed`、`case.assigned` | eventBus 上有發布，但沒有轉送進 queue |
| `message.postback`、`case.updated`、`case.status_changed`、`contact.updated` | 沒有任何程式發布 |

反過來，`portal.activity.submitted` 有轉送進 queue，但不在契約裡，規則編輯器選不到。

## 聯絡人、行銷與報表

功能說明見[租戶後台](../features/tenant/README.md)底下的聯絡人與標籤、行銷、短連結、報表四份文件。

<a id="contact-01"></a>
### CONTACT-01：兩套聯絡人合併實作的行為不一致

| | 手動合併 | 登入時自動合併 |
| --- | --- | --- |
| 程式 | `contact.service.ts` 的 `mergeContacts()` | `line-login.service.ts` 與 `fb-login.service.ts` 各一份 `mergeContactIntoTarget()`，內容相同 |
| 觸發 | 客服在後台操作 | 客人以 LINE 或 Facebook 登入並授權 email，`updateContactEmail()` 在同租戶找到另一個同 email 的聯絡人 |
| 人工確認 | 有 | 沒有 |
| 被合併的聯絡人 | 封存，`mergedIntoId` 指向主要聯絡人 | 硬刪除 |
| 渠道身分 | 全部搬移 | 只搬登入用的那一個；其他的因 `onDelete: Cascade` 隨聯絡人刪除 |
| 積分、活動提交 | 不搬，留在被封存的聯絡人 | 外鍵為 `ON DELETE RESTRICT`，來源有這兩種資料時整個交易失敗，email 綁定也跟著失敗 |
| 長期記憶、`IdentityMap` | 不搬 | 搬移 |
| 聯絡人關係 | 搬移 | 不處理 |

手動合併後，客人在粉絲活動累積的積分，留在已封存的聯絡人身上，主要聯絡人看不到。自動合併則會默默刪掉被合併者在其他渠道的身分；那些渠道的客人下次傳訊息時，會被建成一個新的聯絡人。

<a id="ident-01"></a>
### IDENT-01：合併建議沒有產生端

`packages/core/src/identity/identity-stitcher.ts` 的 `detectPhoneDuplicates()` 是唯一會建立 `MergeSuggestion` 的函式，它沒有任何呼叫端；同一個檔案的 `stitchByPhone()` 與 `stitchByLiffCookie()` 也沒有。`/api/v1/identity` 的審核端點因此永遠沒有資料可審。

<a id="ident-02"></a>
### IDENT-02：LINE、Facebook 登入補 email 時，不確認登入者就是該聯絡人

客服在對話中按「索取 email」時，`line-login.routes.ts` 的 `POST /auth/line/request-email` 產生一個 LINE Login 授權網址，以訊息傳給客人。客人登入並同意提供 email 之後，callback 把 email 寫到聯絡人上。Facebook 的 `fb-login` 模組是同一套流程，以 `psid` 取代 `lineUid`。

這個流程有三個缺口：

1. **授權網址可以由任何人產生。** `GET /auth/line/authorize` 與 `GET /auth/fb/authorize` 是公開端點，接受呼叫端指定的 `lineUid`（或 `psid`）與 `channelId`，直接產生帶 state 的授權網址。前端沒有任何地方呼叫這兩個端點。
2. **callback 不比對登入者。** `/callback` 取出 state 記錄的 `lineUid`，把登入者的 email 寫到這個渠道身分所屬的聯絡人。`verifyIdToken()` 回傳的 `userId` 沒有被使用，因此系統不知道登入的人是不是這位聯絡人。LINE Login 的 channel 由 `LINE_LOGIN_CHANNEL_ID` 設定，全部署共用一個；它與租戶的 Messaging API channel 通常不屬於同一個 provider，同一個人在兩邊的 user ID 也不同，所以無法直接比對。
3. **授權網址本身就是憑證。** 客人把收到的連結轉給別人，由別人完成登入，寫入的就是別人的 email。

寫入的 email 會觸發自動合併：`updateContactEmail()` 在同租戶找到另一個同 email 的聯絡人時，把原聯絡人併進去並硬刪除，見 CONTACT-01。所以知道一組 `lineUid` 與 `channelId` 的人，可以用自己的 LINE 帳號完成登入，把該聯絡人併進自己的聯絡人。合併之後，客服看到的歷史對話與資料都歸在同一個聯絡人底下。

觸發的前提是知道目標的 `lineUid` 與 `channelId`。這兩個值不會出現在公開頁面，但租戶成員在聯絡人詳情頁看得到渠道身分的 ID，因此離職成員是最可能的來源。

另外，state 存在 API 行程的記憶體（`line-login.service.ts` 與 `fb-login.service.ts` 各自的 `stateStore`）。API 重啟之後，還沒完成的授權全部失效；部署多個 API 行程時，callback 若落在另一個行程也會失敗。

**修正方向**：

- 移除公開的 `/authorize`，授權網址只由 `request-email` 產生。
- state 與產生它的對話綁定，存在 Redis，並設定一次性使用。
- email 寫入之後不自動合併，改為產生合併建議，由客服確認。

<a id="mkt-01"></a>
### MKT-01：群發可以重複執行，重送時不排除已送達的人

`POST /marketing/broadcasts/:id/send` 在 HTTP 請求內 `await` `marketing.service.ts` 的 `executeBroadcast()`，整筆群發送完才回應。

`executeBroadcast()` 允許狀態為 `draft`、`scheduled`、`sending`、`failed` 的群發執行。它先讀狀態、再把狀態改成 `sending`，兩步不是原子操作。重新執行時會重新解析發送對象，對所有人再送一次，不看既有的 `BroadcastRecipient` 紀錄。

下列情況都會讓客人收到重複的群發：

- 管理員連按兩次送出。
- 逐人送出的群發（Facebook，或素材含變數）人數多，請求逾時；狀態停在 `sending`，管理員再按一次。
- 群發中途發生例外，狀態變成 `failed`，管理員重試。

**修正方向**：送出改成背景工作；以條件更新（`status in (draft, scheduled)`）原子地搶到執行權；重試時跳過已有成功收件紀錄的聯絡人。

<a id="short-01"></a>
### SHORT-01：記錄點擊的公開端點採信呼叫端提供的身分

`shortlink-redirect.routes.ts` 的 `POST /s/track` 不需要登入，也沒有速率限制。它把 body 的 `cid`（聯絡人 ID）與 `lineUid` 交給 `shortlink.service.ts` 的 `trackClick()`，兩者都不驗證：`lineUid` 對到渠道身分時以它的聯絡人為準，否則直接使用 `cid`。

- 知道同租戶某個聯絡人的 ID 或 LINE uid，就能替他記一筆點擊，觸發 `tagOnClick` 貼標，以及訂閱 `contact.tagged`、`link.clicked` 的自動化規則，例如自動傳訊息給他。
- 沒有 `lineUid` 的點擊，每次都算一次不重複點擊。點擊數與不重複點擊數都能被任意灌高。

`addTagToTarget()` 會檢查聯絡人屬於短連結的租戶，所以貼標不會跨租戶。`ClickLog.contactId` 則不驗證，可以寫入任意值。

<a id="ana-01"></a>
### ANA-01：報表以 UTC 切分日期

`analytics.service.ts` 以 `date_trunc('day' | 'week' | 'month', "createdAt")` 分組。時間欄位是不帶時區的 `TIMESTAMP(3)`，存的是 UTC，資料庫連線也以 UTC 計算。台灣時間凌晨 0 點到 8 點的訊息、工單與聯絡人，會被算進前一天；週與月的邊界也差 8 小時。

同一份報表的「平均首次回應時間」讀 `Case.firstResponseAt`。沒有關聯對話的工單不會有這個值，不計入平均，見 SLA-05。

## 渠道、稽核與資料權利

功能說明見[租戶後台](../features/tenant/README.md)底下的渠道管理與稽核、資料權利與對外整合兩份文件。

<a id="chan-01"></a>
### CHAN-01：渠道刪除是硬刪除，有對話的渠道刪不掉

`AGENTS.md` 規定渠道以 `isActive: false` 軟刪除，但 `channel.service.ts` 的 `deleteChannel()` 呼叫 `prisma.channel.delete()`。

`Conversation`、`ChannelUsage` 與 `RichMenu` 指向渠道的外鍵沒有設定 `onDelete`，也就是 `RESTRICT`。

- 有對話的渠道刪除時，資料庫拒絕。repo 沒有處理 Prisma 的外鍵錯誤（`P2003`），前端收到一般的伺服器錯誤，看不出原因。
- 沒有對話的渠道刪除時，`ChannelIdentity`、`ChannelTeamAccess`、`AgentChannelAccess` 與 `ChatboxSession` 因 `onDelete: Cascade` 一併刪除。

<a id="chan-02"></a>
### CHAN-02：workers 只註冊 LINE 與 FB 外掛，關鍵字回覆在其他渠道送不出去

API 行程以 `registerChannelPlugin()` 註冊 LINE、FB、WEBCHAT、THREADS 四個外掛。workers 行程不用這個註冊表，`apps/workers/src/index.ts` 另建一個 `pluginRegistry`，只放 `linePlugin` 與 `fbPlugin`。自動化的 `send_message`、`send_material` 在 workers 執行，由 `channel-delivery.ts` 的 `deliverToChannelFromWorker()` 以這個 `Map` 找外掛；找不到時寫入一則失敗訊息「系統未載入 … 渠道外掛，無法送出」。

這個缺口在關鍵字回覆上最明顯：

1. 「LINE 關鍵字回覆」頁建立規則時，`useKeywordReplies.ts` 送出的 `conditions` 是 `{ all: [] }`，沒有限定渠道。所以 Instagram 私訊（`THREADS`）與網站聊天室的訊息也會命中。
2. 命中時，`kb-autoreply.service.ts` 以 `automation.worker.ts` 的 `hasMatchingKeywordRule()` 判斷後讓知識庫與 AI 的機器人回覆讓步，避免客人同時收到兩種回覆。
3. workers 收到 `keyword.matched` 後執行 `send_material`，因為沒有外掛而失敗。

結果是客人**沒有收到任何回覆**。一般的自動化規則若含 `send_message` 動作，在這兩種渠道也同樣送不出去。

網站聊天室即使補上外掛也不夠：`webchatPlugin.sendMessage()` 只寫 log，訪客看到訊息靠的是 API 的 `conversation.service.ts` 推送到 `visitor:<channelId>:<uid>` 房間，workers 的送出路徑沒有這一步。

**修正方向**：workers 改用與 API 相同的註冊函式，註冊全部外掛；網站聊天室的訪客推送移進外掛或共用的送出函式；關鍵字回覆頁建立的規則加上渠道條件，或在頁面上註明會套用到所有渠道。

<a id="chan-03"></a>
### CHAN-03：webhook 驗簽的兩處細節

**進站路由不比對渠道本身的類型。** `webhook.routes.ts` 的 LINE、FB、Threads 路由各自把固定的 `channelType` 傳給 `processWebhookEvent()`，後者以這個值取得外掛與決定驗簽用的秘密，但不與 `channel.channelType` 比對。把 LINE 渠道的 ID 送到 Facebook 的路由，會以 Facebook 外掛、LINE 渠道的憑證處理。目前因為兩種渠道的憑證欄位不同（LINE 沒有 `appSecret`），驗簽會失敗；這個保護依賴於憑證欄位碰巧不同。

**FB 與 Instagram 以一般字串比對簽章。** `facebook/index.ts` 與 `threads.ts` 的 `verifySignature()` 以 `===` 比對 HMAC，不是固定時間的比較。LINE 外掛使用 `crypto.timingSafeEqual()`，但沒有先比對長度，簽章長度不同時會拋出錯誤而不是回傳 `false`；錯誤被外層接住，只寫一筆 error log。

**修正方向**：`processWebhookEvent()` 在取得渠道後比對類型，不符時丟棄；三個外掛統一以長度檢查加上 `timingSafeEqual()` 比對。

<a id="aud-01"></a>
### AUD-01：租戶稽核只涵蓋部分操作

`writeTenantAudit()` 的呼叫點涵蓋成員、角色權限、渠道的建立刪除與團隊授權、設定、合併聯絡人、刪除工單、資料匯出與刪除申請。下列操作沒有寫稽核：

| 範圍 | 沒有稽核的操作 |
| --- | --- |
| 認證 | 登入成功與失敗、Passkey 的註冊與刪除 |
| 長效憑證 | API 金鑰的建立與撤銷、CLI token 的建立（`/settings/cli-sessions`、`/auth/cli/login`）與撤銷 |
| 渠道 | 修改渠道，包括更換憑證（`PATCH /channels/:id`） |
| 角色 | 建立、改名、刪除 |
| 業務 | 送出群發、自動化規則的增刪改、刪除知識庫文章、刪除標籤 |

長效憑證與渠道憑證的變更影響最大：事後無法查出是誰、在什麼時候建立了一把能長期存取租戶資料的金鑰。

<a id="erase-01"></a>
### ERASE-01：資料刪除沒有涵蓋所有個人資料

`apps/workers/src/handlers/data-erasure.handler.ts` 有兩種模式：

- `anonymize`（預設）：清空聯絡人的個人欄位，刪除屬性、渠道身分、`IdentityMap` 與長期記憶，把進站訊息的內容換成 `{ redacted: true }`。
- `hard_delete`：刪除聯絡人與他的對話、訊息、工單、積分、活動提交與媒體檔。

沒有涵蓋的資料：

| 資料 | `anonymize` | `hard_delete` |
| --- | --- | --- |
| 客服回覆的訊息內容 | 保留 | 刪除 |
| 物件儲存裡的媒體檔 | 保留 | 刪除 |
| 活動提交（含表單答案）、積分 | 保留 | 刪除 |
| 工單標題、描述、備註、CSAT 留言 | 保留 | 刪除 |
| `ClickLog`（含 IP、User-Agent、LINE uid） | 保留 | 保留 |
| `BroadcastRecipient`、`KbArticleFeedback`、`FlowExecution` | 保留 | 保留 |

最後兩列的資料表只存 `contactId` 字串，沒有外鍵，兩種模式都不處理。預設模式保留了客人上傳的圖片與表單答案，這兩類最可能含個人資料。

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

<a id="app-01"></a>
### APP-01：兩套 SLA 機制

`packages/core/src/cases/case-service.ts` 在模組載入時建立 `sla-monitoring` consumer。任何匯入 `@open333crm/core` 的程序都會產生副作用。`apps/workers` 另有正式的 `sla` consumer，因此 Redis 同時出現 `sla` 與 `sla-monitoring`。

執行時匯入 `@open333crm/core` 會立即建立 Redis 連線，證實模組載入具有副作用。

<a id="app-02"></a>
### APP-02：Telegram 未註冊

渠道套件只匯出 `TelegramPlugin` 類別，沒有 `telegramPlugin` 實例。API 因此無法將 Telegram 傳給 `registerChannelPlugin()`。執行時檢查顯示 LINE、Facebook、WebChat、Threads 已註冊，Telegram 未註冊。

WhatsApp 也沒有註冊外掛，也沒有 webhook 路由，但 `channel.routes.ts` 的 `createChannelSchema` 接受 `WHATSAPP`。租戶可以建立 WhatsApp 渠道，卻收不到訊息也送不出去。

<a id="app-03"></a>
### APP-03：啟動 log 過時

API 啟動 log 寫死為 `LINE, FB, WEBCHAT`，但實際註冊表也包含 Threads。

<a id="app-04"></a>
### APP-04：Worker 檔名與內容不符

API 的 `automation.worker.ts` 與 `notification.worker.ts` 只建立 Queue producer。真正的 consumer 位於 `apps/workers`。

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

**修正方向**：移除 BullMQ 路徑，或改用不含冒號的名稱並在 workers 加上消費者。

<a id="app-08"></a>
### APP-08：多數 BullMQ 佇列永遠保留已完成的工作

BullMQ 預設保留所有完成與失敗的工作。只有 `automation` 與 `data-erasure` 的佇列設定了 `removeOnComplete` 與 `removeOnFail`，其他佇列與 `apps/workers` 的所有 `Worker` 都沒有設定：

| 佇列 | 產生頻率 |
| --- | --- |
| `notification` | 每則進站訊息至少一筆；對話沒有負責人時，每位管理員與主管各一筆 |
| `sla` | 重複工作，每 5 分鐘一筆 |
| `data-export-cleanup`、`agent-retention-cleanup` | 重複工作，每小時各一筆 |
| `rich-menu-bind`、`data-export` | 依操作 |

每筆工作以 hash 存在 Redis，含完整的 `data`。`docker-compose.prod.yml` 的 Redis 沒有設定 `maxmemory` 或淘汰策略，因此用量會隨訊息量持續成長，直到主機記憶體不足。

**修正方向**：所有佇列設定 `removeOnComplete` 與 `removeOnFail`（以筆數或時間為上限）；Redis 設定 `maxmemory`，但淘汰策略要用 `noeviction`，避免佇列的鍵被淘汰。

<a id="app-09"></a>
### APP-09：API 行程假設只有一份

生產環境只跑一個 `api` 容器，所以下列問題目前不會出現。但只要水平擴充，就會同時出現：

| 機制 | 多個 API 行程時 |
| --- | --- |
| API 行程內的排程（群發、CSAT、Canvas、閒置關閉、試用、報表彙總） | 每個行程各自執行，沒有分散式鎖。群發在兩個行程都查到同一筆 `scheduled` 時，因 `executeBroadcast()` 接受 `sending` 狀態而兩邊都執行，見 MKT-01 |
| `crm:events`（Canvas） | 每個行程的 `canvas.worker.ts` 都收到同一則 `canvas.send_message`，客人收到多次 |
| `domain:event` | 每個行程都轉成自己的 eventBus 事件，同一次貼標觸發多次自動化 |
| 行程記憶體的狀態 | OAuth 的 state（IDENT-02）、非營業時間回覆的去重、工單輪流指派的位置、價目表快取（USAGE-02）、租戶方案快取，各行程各自一份 |
| Socket.IO | 沒有 Redis adapter。`@socket.io/redis-adapter` 列在 `apps/api/package.json`，但程式沒有使用。API 直接推送的事件只送到同一個行程的客戶端 |

這些問題分散在各模組，單獨看都像是小事，但合起來代表 API 目前無法水平擴充。

**修正方向**：定期工作移到 workers 以 BullMQ 重複工作執行；Redis 廣播改成 BullMQ 佇列，或在接收端以事件 ID 去重；行程記憶體的狀態改存 Redis；Socket.IO 接上 Redis adapter。

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
### PKG-05：`core` 匯出沒有呼叫端的服務與事件訂閱者

`packages/core` 有一套以 Redis `crm:events` 頻道傳遞的 `EventBus`，與 API 行程的 eventBus 不相通。實際使用它的只有 Canvas：`FlowRunner` 發布、API 的 `canvas.worker.ts` 訂閱。同一個套件裡另有：

| 程式 | 內容 | 呼叫端 |
| --- | --- | --- |
| `cases/case-service.ts` 的 `CaseService` | 工單的建立與狀態變更，並發布到 `crm:events` | `apps/*` 沒有。模組載入時建立 `sla-monitoring` 佇列，見 APP-01 |
| `inbox/inbox-service.ts` 的 `InboxService` | 對話與訊息，並發布到 `crm:events` | `apps/*` 沒有 |
| `contacts/contact-service.ts` 的 `ContactService` | 聯絡人 | `apps/*` 沒有 |
| `automation/engine.ts` 的 `AutomationEngine` | 訂閱 `crm:events` 執行自動化規則 | 沒有從 `index.ts` 匯出，也沒有呼叫 `start()` 的程式 |

這些與 API 的 `case`、`conversation`、`contact`、`automation` 模組功能重疊。讀程式時容易以為工單或自動化走這裡。

<a id="pkg-06"></a>
### PKG-06：`channel-plugins` 有沒有呼叫端的程式

| 程式 | 內容 | 呼叫端 |
| --- | --- | --- |
| `ChannelPlugin.setWebhook()` | LINE 與 Telegram 外掛有實作 | 沒有。LINE 的自動設定由 API 的 `line-webhook-setup.service.ts` 直接呼叫 LINE API |
| `extensions.audience` | LINE 外掛有實作分眾名單 | 沒有 |
| `line/worker-media-download.ts`、`worker-narrowcast-progress.ts`、`worker-insight-sync.ts` | 各自定義 BullMQ 佇列與 worker | 沒有任何檔案 import。LINE 媒體下載實際走 `resolveInboundMedia()` |
| `getAllChannelPlugins()`、`hasChannelPlugin()`、`getPlugin()`、`registerPlugin` | 註冊表的輔助函式與舊名稱 | 沒有 |
| `telegram.ts` 與 `telegram/index.ts` | 兩份 `TelegramPlugin` 類別；前者由 `./telegram` 子路徑匯出，後者由套件入口匯出 | 都沒有註冊，見 APP-02 |

與此同時，圖文選單的建立與發布寫在 API 的 `rich-menu.service.ts`，直接呼叫 LINE API，而外掛的 `extensions.ui` 只用在 workers 的綁定。同一種渠道能力一半在外掛、一半在模組內，新增渠道時不容易判斷該實作哪些方法。

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

組織不部署 Ollama，因此所有產生向量的路徑都會失敗：

| 功能 | 失敗時的行為 |
| --- | --- |
| 知識庫自動回覆（`kb-autoreply.service.ts` 的 `attemptKbAutoReply()`） | 只記 error log，然後不回覆客人，也不轉真人 |
| AI 建議回覆（`ai.service.ts` 的 `suggestReply()`） | 回傳空的建議清單 |
| 知識庫語意搜尋（`knowledge.service.ts` 的 `semanticSearch()`） | 拋出錯誤 |
| 建立或修改文章時產生向量（`embedArticle()`） | 在背景失敗，只記 log。文章仍可發布，但不會被檢索到 |

自動回覆的失敗最不容易察覺：客人收不到回覆，對話也沒有轉給客服。

改用其他 embedding 服務時，資料庫欄位的維度要配合新的模型，與 DB-01 一起處理。

<a id="db-01"></a>
### DB-01：向量維度不一致

Prisma schema 與程式常數使用 1024 維。執行中的 `km_articles.embedding` 與 `long_term_memories.embedding` 欄位都是 `vector(1536)`。預設的 `bge-m3` 產生 1024 維向量，直接寫入會被資料庫拒絕。

組織不部署 Ollama 之後，`bge-m3` 不再是可用的模型。正確的維度要等 LLM-04 選定新的 embedding 模型才能決定。

<a id="db-02"></a>
### DB-02：`ContactTag.expiresAt` 沒有設定端，也沒有讀取端

schema 為聯絡人標籤留了到期時間。貼標的程式都不設定這個欄位，也沒有任何查詢或排程依它過濾或清除標籤。它唯一出現的地方，是 `line-login.service.ts` 與 `fb-login.service.ts` 合併聯絡人時，把舊值原樣抄到新的一筆。

<a id="db-03"></a>
### DB-03：`DailyStat` 每天寫入，沒有讀取端

`analytics.scheduler.ts` 的 `setupAnalyticsScheduler()` 每天對每個啟用中的租戶呼叫 `analytics.aggregator.ts` 的 `runDailyAggregation()`，把總覽、工單、客服、渠道與聯絡人的彙總寫入 `DailyStat`。

`analytics.service.ts` 的報表函式都在查詢當下從原始資料表計算，沒有任何程式讀 `DailyStat`。排程每天為每個租戶做一次完整計算，結果沒有用途。

<a id="db-04"></a>
### DB-04：schema 有、程式沒有讀寫的欄位與資料表

| 欄位或資料表 | 現況 |
| --- | --- |
| `Conversation.teamId` | 沒有寫入端。`channel-visibility.ts` 的 `assertConversationChannelVisible()` 有一段「對話綁了團隊時只有該團隊成員能操作」的檢查，因此永遠不會觸發 |
| `Case.mergedIntoId`、`Case.parentCaseId`、`CaseRelation` | `apps/api`、`apps/workers`、`apps/web` 都沒有讀寫。工單的合併、子工單與關聯沒有實作 |
| `Contact.isBlocked` | `PATCH /contacts/:id` 可以寫入，前端沒有入口，也沒有任何程式讀取。設成 `true` 不會擋下訊息、機器人或群發 |

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
| `settings/settings.routes.ts` | 5 | |
| `portal/portal-public.routes.ts` | 4 | |
| `tag/tag.routes.ts` | 3 | |
| `line-login/line-login.routes.ts` | 3 | |
| `fb-login/fb-login.routes.ts` | 3 | |
| `webhook/webhook.routes.ts` | 2 | |
| `webchat/webchat.routes.ts`、`shortlink/shortlink-redirect.routes.ts`、`platform/platform.routes.ts`、`knowledge/knowledge.routes.ts`、`conversation/conversation.routes.ts`、`analytics/analytics.routes.ts`、`ai/ai.routes.ts`、`agent/agent.routes.ts` | 各 1 | |

多數是單筆查詢，搬進 service 即可。這些 route 大多沒有測試，搬移前先補上 route 的測試，確認行為不變。

<a id="arch-02"></a>
### ARCH-02：`ai` 模組 import `automation` 的 worker 檔

規則 4 禁止 import 別的模組的 `.routes.ts`、`.worker.ts`、`.scheduler.ts`；引用別的模組的 helper 檔不算違規。2026-10-01 以下列指令核對，只有一處違規：

```bash
grep -rnE "from '\.\./[a-z-]+/[a-zA-Z.-]+\.(routes|worker|scheduler)\.js'" apps/api/src/modules
```

`ai/kb-autoreply.service.ts` 從 `automation/automation.worker.ts` 匯入 `hasMatchingKeywordRule()`、`DEFAULT_BOT_CONFIG`、`DEFAULT_HANDOFF_PROMPT_TEXT` 與 `BotConfig`。修正方式是把這些搬到 `automation` 的 service 或 helper 檔。

## CI 與測試

盤點時，`.github/workflows/ci.yml` 只執行 RLS 隔離測試，lint 步驟只輸出略過訊息。之後有 commit 刪除了 `ci.yml`，刪除經過見 `AGENTS.md` 的「CI gates」一節。目前唯一的 workflow 是 `deploy.yml`，它只負責部署到 UAT，不執行測試或 lint。

<a id="ci-01"></a>
### CI-01：沒有 CI 執行 API 測試

沒有任何 CI workflow 執行測試。測試只能在本機執行：根目錄的 `pnpm test` 執行各套件的 unit 測試，`pnpm test:feature` 執行需要 PostgreSQL 與 Redis 的 feature 測試。

<a id="ci-02"></a>
### CI-02：沒有 CI 執行 lint

`eslint.config.js` 與 `pnpm lint` 已存在，但沒有任何 CI workflow 執行 lint。

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

