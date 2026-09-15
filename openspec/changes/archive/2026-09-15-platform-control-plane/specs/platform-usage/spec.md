## ADDED Requirements

### Requirement: AI 呼叫逐次記錄（AiUsage）
系統 SHALL 在每次 AI 呼叫（reply / summarize / classify / sentiment / kb_autoreply / embedding）完成後，寫入一列 AiUsage 記錄，內容 MUST 包含 tenantId、callType、provider、model、promptTokens、completionTokens、totalTokens、latencyMs、success 與 keySource；此表 MUST 作為 token 用量、呼叫次數、成功率與延遲的單一事實來源。

#### Scenario: 成功的 reply 呼叫寫入完整 usage
- **GIVEN** 某租戶觸發一次 callType=reply 的 AI 呼叫且 provider 回傳 usage
- **WHEN** llm.service 完成 generateReply 並落地記錄
- **THEN** 系統 MUST 新增一列 AiUsage，其 tenantId、callType=reply、provider、model 均正確填入
- **AND** promptTokens、completionTokens、totalTokens、latencyMs 均為非負整數且 success=true

#### Scenario: 失敗的 AI 呼叫仍記錄並標示錯誤
- **GIVEN** 某次 AI 呼叫在 provider 端拋出錯誤
- **WHEN** 呼叫點捕捉例外並落地 AiUsage
- **THEN** 系統 MUST 寫入一列 success=false 的 AiUsage 並填入 errorCode
- **AND** latencyMs MUST 反映呼叫前後 Date.now() 量測的實際耗時

#### Scenario: embedding 呼叫以獨立 callType 記錄
- **GIVEN** embedding.service 執行一次向量化呼叫
- **WHEN** 呼叫完成並讀取 embed 回應的 token
- **THEN** 系統 MUST 寫入一列 callType=embedding 的 AiUsage
- **AND** promptTokens MUST 來自回應解析結果而非 0 或估算值

#### Scenario: 記錄標示金鑰來源 keySource
- **GIVEN** 某租戶使用自帶金鑰（BYOK）進行 AI 呼叫
- **WHEN** 系統落地該次 AiUsage
- **THEN** keySource MUST 標示為 byok（相對於平台金鑰的 platform）

### Requirement: Provider 介面回傳 usage
ChatProvider.generate() 的回傳型別 MUST 從 Promise<string> 改為包含 text、usage（promptTokens / completionTokens / totalTokens）與 model 的結構；每個 provider 實作 MUST 於成功路徑解析原生 usage 欄位並回傳，不得丟棄。

#### Scenario: Ollama 解析原生 token 欄位
- **GIVEN** Ollama provider 收到含 prompt_eval_count 與 eval_count 的回應
- **WHEN** generate() 回傳結果
- **THEN** usage.promptTokens MUST 等於 prompt_eval_count，usage.completionTokens MUST 等於 eval_count
- **AND** usage.totalTokens MUST 等於兩者之和

#### Scenario: Gemini 成功路徑讀取 usageMetadata
- **GIVEN** Gemini provider 成功回應且回應含 usageMetadata
- **WHEN** generate() 於成功路徑組裝回傳結構
- **THEN** 系統 MUST 從 usageMetadata 讀取 token 數並填入 usage，而非僅在報錯路徑讀取
- **AND** 回傳的 model 欄位 MUST 為實際使用的模型名

#### Scenario: 回傳結構供呼叫點落地
- **GIVEN** 任一 provider 完成 generate()
- **WHEN** 呼叫點取得回傳值
- **THEN** 回傳值 MUST 同時提供 text 與 usage，使呼叫點能直接寫入 AiUsage 而不需再次呼叫 provider

### Requirement: AI 金額換算與 BYOK 排除
系統 SHALL 依 AiModelPricing 平台全域單價表，將 AiUsage 的 token 量換算為金額，計算 MUST 使用該筆記錄 createdAt 時點生效（effectiveFrom）的單價版本；凡 keySource=byok 的呼叫 MUST 不計入平台金額。

#### Scenario: 以生效單價換算金額
- **GIVEN** 一列 AiUsage 具 promptTokens=2000、completionTokens=1000，且對應 provider+model 於該時點的 promptPricePer1k 與 completionPricePer1k 已設定
- **WHEN** 系統換算金額
- **THEN** 金額 MUST 等於 2 × promptPricePer1k + 1 × completionPricePer1k，並帶正確 currency

#### Scenario: 改價不影響歷史換算
- **GIVEN** 某 model 的單價於 2026-08-01 起新增一筆較高 effectiveFrom 版本
- **WHEN** 換算 2026-07 期間產生的 AiUsage 金額
- **THEN** 系統 MUST 採用 2026-07 當時生效的舊單價版本，不得套用新版單價

#### Scenario: BYOK 呼叫不計平台金額
- **GIVEN** 某租戶當月同時有 platform 與 byok 兩種 keySource 的 AiUsage
- **WHEN** 系統彙總該租戶平台金額
- **THEN** 平台金額 MUST 僅加總 keySource=platform 的記錄，byok 記錄金額 MUST 視為 0
- **AND** byok 的 token 用量 MAY 仍呈現於用量統計但不計入計費金額

### Requirement: 每日彙總複用 DailyStat
系統 SHALL 由 analytics.aggregator 每日將 AiUsage 與渠道費用彙總寫入 DailyStat，新增 statType=ai_usage 與 statType=channel_cost；彙總 MUST 透過 aggregateAllTenants 掃描全部租戶，平台儀表板讀取 DailyStat 即可而不需即時掃原始表。

#### Scenario: 每日產生 ai_usage 彙總列
- **GIVEN** 某租戶在某日產生多列 AiUsage
- **WHEN** aggregator 執行當日彙總
- **THEN** 系統 MUST 寫入一列 DailyStat（tenantId、date、statType=ai_usage），其 Json MUST 含 token 總量、各 model 分布、呼叫次數、換算金額、成功率與平均延遲

#### Scenario: 全租戶皆被掃描
- **GIVEN** 平台有多個啟用中的租戶
- **WHEN** aggregateAllTenants 執行
- **THEN** 每個有 AiUsage 或渠道費用的租戶 MUST 各自產生對應 statType 的 DailyStat 列，不得遺漏任一租戶

#### Scenario: 渠道費用彙總為 channel_cost
- **GIVEN** 某租戶當日有渠道訊息費用資料
- **WHEN** aggregator 執行
- **THEN** 系統 MUST 寫入一列 statType=channel_cost 的 DailyStat，記錄各渠道訊息數與費用

### Requirement: 三類指標彙總（用量／計費／健康度）
平台用量統計 SHALL 涵蓋三類指標：用量類（AI 呼叫次數、訊息量、對話／案件／聯絡人／自動化執行）、計費類（LLM token、AI 換算金額、渠道訊息費、broadcast 則數）、健康度類（AI 成功率與平均延遲、SLA、CSAT、webhook 投遞成功率）；每類指標 MUST 可依租戶與時間區間查詢。

#### Scenario: 用量類含 AI 呼叫次數依 callType
- **GIVEN** 某租戶指定時間區間
- **WHEN** 查詢用量類指標
- **THEN** 回應 MUST 含依 callType 拆分的 AI 呼叫次數，以及 inbound/outbound/BOT 訊息數與對話／案件／聯絡人數

#### Scenario: 計費類含 token 與換算金額
- **GIVEN** 某租戶指定時間區間
- **WHEN** 查詢計費類指標
- **THEN** 回應 MUST 含 prompt/completion/total token 量、AI 換算金額（帶幣別）、渠道訊息費與 broadcast 則數

#### Scenario: 健康度類含 AI 成功率與延遲
- **GIVEN** 某租戶指定時間區間
- **WHEN** 查詢健康度類指標
- **THEN** 回應 MUST 含 AI 成功率與平均 latencyMs、SLA 達成率、CSAT 分數與 webhook 投遞成功率

### Requirement: 平台用量 API（跨租戶總覽與單租戶鑽取）
平台用量 API SHALL 提供跨租戶總覽與單一租戶鑽取端點，且全數 MUST 掛 requirePlatformSuperuser() 授權守門；跨租戶查詢屬授權例外，MUST 記錄稽核。總覽 MUST 回傳本月各租戶排行與平台總成本，鑽取 MUST 回傳單租戶各類指標並讀自 DailyStat。

#### Scenario: 非 superuser 被拒
- **GIVEN** 一個非平台 superuser 的請求
- **WHEN** 呼叫 GET /admin/usage/overview
- **THEN** 系統 MUST 回傳授權失敗（403），不得洩漏任何跨租戶資料

#### Scenario: 總覽回傳排行與平台總成本
- **GIVEN** 平台有多個租戶且本月已有用量彙總
- **WHEN** superuser 呼叫 GET /admin/usage/overview
- **THEN** 回應 MUST 含各租戶本月 token 用量／換算金額排行、訊息量排行與 AI 成功率異常租戶警示
- **AND** 平台總成本 MUST 等於各租戶 AI 金額與渠道費之總和

#### Scenario: 單租戶鑽取讀 DailyStat
- **GIVEN** 指定 tenantId 與時間區間（日／週／月）
- **WHEN** superuser 呼叫 GET /admin/tenants/:id/usage
- **THEN** 回應 MUST 讀自 DailyStat 並含 AI、訊息、業務量、健康度與額度對照各類指標
- **AND** 該跨租戶查詢 MUST 產生稽核記錄

#### Scenario: AI 明細鑽取
- **GIVEN** 指定 tenantId 與時間區間
- **WHEN** superuser 呼叫 GET /admin/tenants/:id/usage/ai
- **THEN** 回應 MUST 含 token 趨勢、各 model 分布、換算金額、呼叫次數、成功率與延遲明細
