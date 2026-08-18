## ADDED Requirements

### Requirement: AI Key 加密儲存
系統 SHALL 將所有租戶的 AI provider API key 以 AES-256-GCM 加密後儲存於 TenantSettings.aiKeysEncrypted 欄位，該欄位為一份可容納多個 provider（各自一把 key）的加密 JSON；資料庫 MUST 絕不儲存任何 key 明文。加密所需的 CREDENTIAL_ENCRYPTION_KEY MUST 於正式環境明確設定，不得使用 fallback 預設值。

#### Scenario: 寫入租戶自填 key 時加密儲存
- **GIVEN** 一個租戶 admin 在聊天設定頁填入 gemini 的 API key
- **WHEN** 系統將該 key 寫入 TenantSettings
- **THEN** aiKeysEncrypted 以 AES-256-GCM 加密後儲存，內容為 JSON `{ gemini: "<ciphertext>" }`
- **AND** 資料庫該欄位不含任何明文 key

#### Scenario: 多 provider 各自一把 key 共存於同一加密 JSON
- **GIVEN** 租戶已設定 gemini 的 key
- **WHEN** 租戶再設定 openai 的 key
- **THEN** aiKeysEncrypted 解密後為 JSON `{ gemini: "...", openai: "..." }`
- **AND** 兩把 key 各自獨立、互不覆蓋

#### Scenario: 正式環境缺 CREDENTIAL_ENCRYPTION_KEY 時拒絕啟動
- **GIVEN** 正式環境未設定 CREDENTIAL_ENCRYPTION_KEY
- **WHEN** API 啟動並以 zod schema 驗證 env
- **THEN** 系統 MUST 啟動失敗並回報缺少加密金鑰，不得以預設值繼續

### Requirement: 三層 fallback key 解析
AI 呼叫時，系統 SHALL 依固定優先序解析 provider 的 API key：(1) 租戶自填 / 平台代設（同一加密欄位）→ (2) 平台預設 env key（如 GEMINI_API_KEY）→ 皆無則 MUST throw 該 provider 未設定 key 的錯誤。fallback 邏輯 MUST 收斂於 provider 一處（`opts.apiKey ?? env`）。Ollama 因無 key MUST 不走此解析鏈。

#### Scenario: 租戶已設 key 時優先使用租戶 key
- **GIVEN** 租戶的 aiKeysEncrypted 含 gemini key
- **WHEN** 系統為該租戶發起 gemini 生成呼叫
- **THEN** provider 收到 opts.apiKey 為解密後的租戶 key
- **AND** 不使用 env.GEMINI_API_KEY

#### Scenario: 租戶未設 key 時退回平台 env 預設
- **GIVEN** 租戶的 aiKeysEncrypted 為 null 且 env.GEMINI_API_KEY 已設定
- **WHEN** 系統為該租戶發起 gemini 生成呼叫
- **THEN** provider 使用 env.GEMINI_API_KEY 作為 fallback

#### Scenario: 租戶與 env 皆無 key 時拋錯
- **GIVEN** 租戶未設 gemini key 且 env.GEMINI_API_KEY 未設定
- **WHEN** 系統為該租戶發起 gemini 生成呼叫
- **THEN** 系統 MUST throw「該 provider 未設定 key」的錯誤，不得以空 key 呼叫

#### Scenario: Ollama 不走 key fallback 鏈
- **GIVEN** 租戶 chatProvider 為 ollama
- **WHEN** 系統發起生成呼叫
- **THEN** 系統 MUST 不解析任何 API key，僅使用 per-tenant baseUrl

### Requirement: Provider 接收 opts.apiKey
ChatGenerateOptions SHALL 新增選用欄位 apiKey；llm.service 產生回覆時 MUST 從 getChatSettings 取得解密後、依 chatProvider 對應的 key 並透過 provider.generate({ ..., apiKey }) 傳入。設定頁的 checkChatHealth（測試連線）MUST 一併透傳租戶自己的 key，使連線測試使用租戶實際生效的 key。解密後的明文 MUST 僅即用即丟傳給 provider，不得寫入 log 或錯誤訊息。

#### Scenario: generateReply 傳入對應 provider 的解密 key
- **GIVEN** 租戶 chatProvider 為 gemini 且已設 gemini key
- **WHEN** llm.service.generateReply 執行
- **THEN** provider.generate 收到 opts.apiKey 為 gemini 對應的解密 key

#### Scenario: 測試連線使用租戶自己的 key
- **GIVEN** 租戶在設定頁按下「測試連線」且已填自己的 gemini key
- **WHEN** checkChatHealth 執行
- **THEN** 連線測試使用該租戶的解密 key，而非平台 env key

#### Scenario: 明文 key 不進 log 與錯誤訊息
- **GIVEN** provider 呼叫因 key 無效而失敗
- **WHEN** 系統記錄錯誤
- **THEN** log 與錯誤訊息 MUST 不含任何 key 明文

### Requirement: API 回應一律遮罩
任何回傳 AI key 狀態的 API 回應 SHALL 一律遮罩，MUST 絕不回傳明文；每個 provider 僅回 `{ hasKey: boolean, masked?: string }` 形式（比照 Partner API key 的前後綴遮罩）。未設定 key 的 provider MUST 回 hasKey=false 且不含 masked。

#### Scenario: 已設 key 的 provider 回遮罩字串
- **GIVEN** 租戶已設 gemini key `AIza...4b2c`
- **WHEN** 前端查詢 AI 金鑰設定
- **THEN** 回應為 `{ gemini: { hasKey: true, masked: "AIza…4b2c" } }`
- **AND** 回應不含完整明文 key

#### Scenario: 未設 key 的 provider 回 hasKey false
- **GIVEN** 租戶未設 openai key
- **WHEN** 前端查詢 AI 金鑰設定
- **THEN** 回應為 `{ openai: { hasKey: false } }`
- **AND** 不含 masked 欄位

#### Scenario: 內部 getChatSettings 可取明文但不外洩
- **GIVEN** 內部 llm.service 呼叫 getChatSettings 取解密 key
- **WHEN** 該 key 用於 provider 呼叫
- **THEN** 明文僅存在於後端記憶體即用即丟
- **AND** 任何對外 API 回應仍維持遮罩

### Requirement: 租戶與平台雙入口設定與來源標記
系統 SHALL 提供兩個 key 設定入口：租戶站內（租戶 admin，需 settings.manage）與平台後台（superuser）。兩入口寫入同一 aiKeysEncrypted 欄位，並 MUST 以 aiKeySource 標記來源（tenant / platform）；aiKeySource 僅供 UI 顯示與稽核，MUST 不影響 key 解析優先序。平台後台 MUST 能顯示各租戶 key 來源（租戶自填 / 平台代管 / 用平台預設 env）。

#### Scenario: 租戶自填標記為 tenant
- **GIVEN** 租戶 admin（具 settings.manage）在站內填入 key
- **WHEN** 系統寫入 aiKeysEncrypted
- **THEN** aiKeySource 設為 `tenant`

#### Scenario: 平台代設標記為 platform
- **GIVEN** superuser 在平台後台租戶詳情頁代填 key
- **WHEN** 系統寫入 aiKeysEncrypted
- **THEN** aiKeySource 設為 `platform`

#### Scenario: 來源標記不改變解析優先序
- **GIVEN** 某租戶 aiKeySource 為 platform 且該 provider 已有 key
- **WHEN** 系統解析該 provider 的 key
- **THEN** 直接使用該加密欄位內的 key，與 aiKeySource 值無關

#### Scenario: 平台後台顯示用平台預設的租戶
- **GIVEN** 某租戶 aiKeysEncrypted 為 null
- **WHEN** superuser 於平台後台檢視該租戶 key 來源
- **THEN** 顯示為「用平台預設（env）」

### Requirement: 平台代管寫稽核
當 superuser 於平台後台代租戶設定或清除 key 時，系統 MUST 寫入 PlatformAuditLog（action `tenant.aikey.set`）；稽核 payload MUST 不含任何 key 明文，僅記錄 provider 名稱與遮罩後字串。此稽核 SHALL 屬高敏感操作紀錄，供事後追溯誰對哪個租戶做了代管。

#### Scenario: 平台代設 key 寫稽核且不含明文
- **GIVEN** superuser 為某租戶代填 gemini key
- **WHEN** 系統完成寫入
- **THEN** 產生一筆 PlatformAuditLog action=`tenant.aikey.set`
- **AND** payload 僅含 provider=gemini 與遮罩字串，不含明文 key

#### Scenario: 平台清除 key 亦寫稽核
- **GIVEN** superuser 清除某租戶的 openai key
- **WHEN** 系統完成清除
- **THEN** 產生一筆 PlatformAuditLog 記錄該清除操作與操作者
- **AND** payload 不含任何明文 key

#### Scenario: 租戶站內自填不強制寫平台稽核
- **GIVEN** 租戶 admin 在站內自行設定 key（aiKeySource=tenant）
- **WHEN** 系統寫入
- **THEN** 不產生 platform 代管稽核（`tenant.aikey.set`）

### Requirement: BYOK 成本歸屬與用量標記
AiUsage 逐次紀錄 SHALL 新增 keySource 欄位（tenant / platform），記錄該次呼叫使用的 key 來源。租戶自帶 key（BYOK，keySource=tenant）的呼叫，平台 MUST 不計費、僅記用量；平台代設或平台預設 key（keySource=platform）的呼叫，成本 SHALL 歸平台並據以向租戶換算金額。AiModelPricing 金額換算 MUST 僅套用於 keySource=platform 的呼叫。

#### Scenario: BYOK 呼叫記用量不計費
- **GIVEN** 租戶使用自己的 gemini key（生效來源為租戶）發起呼叫
- **WHEN** 系統寫入 AiUsage
- **THEN** keySource 記為 `tenant`
- **AND** 該筆用量 MUST 不被換算金額計費

#### Scenario: 平台代設 key 呼叫計費
- **GIVEN** 租戶生效 key 來自平台代設或平台 env 預設
- **WHEN** 系統寫入 AiUsage
- **THEN** keySource 記為 `platform`
- **AND** 該筆用量依 AiModelPricing 換算金額並歸平台成本

#### Scenario: 平台儀表板依 keySource 區分成本歸屬
- **GIVEN** 一段期間內同時有 tenant 與 platform 兩種 keySource 的用量
- **WHEN** 平台 usage 儀表板彙整
- **THEN** MUST 能區分「平台承擔成本的 token」與「租戶自付的 token」
- **AND** 僅對平台承擔部分呈現換算金額
