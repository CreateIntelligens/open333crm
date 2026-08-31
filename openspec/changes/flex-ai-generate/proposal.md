## Why

Flex 範本填空（階段 1）解決了「不會寫程式也能建 Flex」，但起手仍受限於現有範本。加上 AI 生成 = 差異化再進一步：**行銷人用一句話描述想要的卡片，AI 產出一個 Flex 草稿，再進填空編輯器微調**。這對應競品研究的差異化機會（Omni AI Message Flow 等已用自然語言生內容），且 open333CRM 已有完整 LLM 基建（`ai/llm.service.ts` + Ollama/Gemini provider）可複用。另含填空編輯器內的「AI 潤稿」（階段 1 留的 stub）。

## What Changes

- **AI 描述生成 Flex 草稿**：在建 Flex 素材時，提供「用一句話描述」入口 → AI 產出合法的 Flex JSON 草稿 → 載入階段 1 的填空編輯器微調。
- **AI 潤稿（接階段 1 stub）**：填空編輯器內的文字欄位，可對內容做 AI 潤稿/改語氣/縮短（複用既有 LLM）。
- **產出保證合法**：AI 產的 Flex 經既有 `POST /materials/line-flex/validate`（實打 LINE API）驗證；不合法則要求 AI 修正或退回範本。

不在本階段範圍：AI 生圖（另議）、進階視覺編輯（階段 3）、多輪對話式修改（先一次生成 + 手動微調）。

## Capabilities

### New Capabilities
（無全新 capability；延伸 Flex 素材編輯 + 既有 AI 能力）

### Modified Capabilities
- `material-system`: Flex 素材新增「AI 描述生成草稿」起手方式與填空內「AI 潤稿」，產出經 LINE validate 保證合法。

## Impact

- **後端 (`apps/api/src/modules/ai/` + marketing/material)**：
  - 新增 service：`generateFlexFromPrompt(tenantId, prompt)` → 呼叫 llm.service（帶「產 LINE Flex bubble JSON」的系統提示 + few-shot 範例）→ 解析 JSON → 經 line-flex validate → 回合法 Flex body。
  - 新增/擴充端點：`POST /materials/line-flex/ai-generate`（body: prompt）。
  - AI 潤稿：既有或新增 text 潤稿端點（`POST /ai/rewrite`）供填空編輯器呼叫。
  - 走既有 AI key / token 額度機制（platform 控制平面）。
- **前端**：
  - Flex 起手加「✦ 用 AI 描述生成」入口 → 呼叫 ai-generate → 載入填空編輯器。
  - 填空編輯器 text 欄位的「AI 潤稿」stub（階段 1 留）接上實作。
- **相容性**：AI 產出走與範本相同的 body 結構（{ contents, altText }），無 sampleId（或標記 ai-generated），進同一填空編輯器。
- **成本/額度**：AI 生成消耗 token，走既有租戶 token 額度硬擋機制。
- **RLS**：無新表；AI 呼叫走租戶 AI key。
