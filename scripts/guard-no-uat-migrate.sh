#!/usr/bin/env bash
#
# guard-no-uat-migrate.sh — 護欄：阻止對 UAT（或任何遠端 tunnel）跑 migration
#
# 在跑 prisma migrate / db push 前先執行本腳本。若偵測到 DATABASE_URL 指向
# UAT tunnel（port 5434）或非本機 5433，直接擋下並退出非零。
#
# 用法（手動或包在 migrate 前）：
#   ./scripts/guard-no-uat-migrate.sh && pnpm --filter @open333crm/database db:migrate
#
set -euo pipefail

URL="${DATABASE_URL:-}"

# 允許的本機 DB port（本機開發庫）
LOCAL_OK_PORT=5433
# 明確標記為 UAT 的 tunnel port
UAT_TUNNEL_PORT=5434

if [[ -z "$URL" ]]; then
  echo "⚠️  DATABASE_URL 未設定，無法判斷目標，為安全起見擋下。"; exit 1
fi

if [[ "${OPEN333_DB_TARGET:-}" == "UAT" ]] || [[ "$URL" == *":${UAT_TUNNEL_PORT}/"* ]]; then
  echo "🛑 偵測到 DATABASE_URL 指向 UAT（tunnel :${UAT_TUNNEL_PORT}）。"
  echo "   禁止對 UAT 跑 migration / db push（會改 UAT 表結構、可能弄崩 UAT 服務）。"
  echo "   如需改 UAT schema，請走正式部署流程（見 reference_deploy_sop）。"
  exit 1
fi

if [[ "$URL" != *"localhost:${LOCAL_OK_PORT}/"* && "$URL" != *"127.0.0.1:${LOCAL_OK_PORT}/"* ]]; then
  echo "🛑 DATABASE_URL 不是本機開發庫（localhost:${LOCAL_OK_PORT}）：$URL"
  echo "   為避免誤改遠端資料庫，migration 只允許在本機 :${LOCAL_OK_PORT} 執行。"
  exit 1
fi

echo "✅ 目標是本機開發庫（localhost:${LOCAL_OK_PORT}），可安全執行 migration。"
