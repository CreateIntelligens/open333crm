#!/usr/bin/env bash
#
# dev-uat.sh — 在本機啟動 API，但資料庫連到 UAT（透過 SSH tunnel）
#
# 用途：本機跑最新程式碼，但用 UAT 的真實測試資料。
#
# ⚠️⚠️ 重要：連 UAT 期間，本機 API 的任何寫入都會改到 UAT 資料庫。
#         UAT 是可重啟的測試站，但請「絕對不要」在此狀態下跑 prisma migrate
#         （會改到 UAT 的表結構，可能讓 UAT 上跑著的服務崩潰）。
#         本腳本只啟動 API，不會自動 migrate。
#
# 用法：
#   ./scripts/dev-uat.sh          # 開 tunnel + 啟動 API（連 UAT DB）
#   Ctrl+C 結束 API 後，記得 ./scripts/uat-tunnel.sh down 關 tunnel
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_LOCAL_PORT=5434

cat <<'BANNER'

  ╔══════════════════════════════════════════════════════════╗
  ║  ⚠️  你正要讓本機 API 連到 UAT 資料庫                      ║
  ║                                                          ║
  ║  · 本機 API 的寫入會直接改到 UAT（測試站）               ║
  ║  · 絕對不要跑 prisma migrate / db push（會改 UAT 結構）  ║
  ║  · 結束後執行 ./scripts/uat-tunnel.sh down 關 tunnel     ║
  ╚══════════════════════════════════════════════════════════╝

BANNER
read -r -p "確認要連 UAT DB 啟動 API 嗎？(輸入 yes 繼續) " ans
[[ "$ans" == "yes" ]] || { echo "已取消。"; exit 0; }

# 1. 開 tunnel
"$SCRIPT_DIR/uat-tunnel.sh" up

# 2. 用環境變數覆蓋 DATABASE_URL 指向 tunnel（不改任何 .env 檔）
#    密碼沿用 UAT 的（與本機相同：crmpassword）。若 UAT 密碼不同，改這行。
export DATABASE_URL="postgresql://crm:crmpassword@localhost:${DB_LOCAL_PORT}/open333crm"
# Redis 仍用本機（UAT redis 未走 tunnel；BullMQ 佇列用本機即可，不影響讀寫 UAT DB）
export REDIS_URL="${REDIS_URL:-redis://localhost:6380}"
# 標記目前連的是 UAT，方便在 log / prompt 辨識
export OPEN333_DB_TARGET="UAT"

echo
echo "→ DATABASE_URL 已覆蓋為 UAT（透過 tunnel :${DB_LOCAL_PORT}）"
echo "→ 啟動 API（只跑 api，不跑 migrate）..."
echo

cd "$ROOT_DIR"
# 只起 api；dotenv 會載入 .env，但上面 export 的 DATABASE_URL 已在 process.env，
# dotenv 預設不覆蓋既有變數，故連的是 UAT。
exec pnpm --filter @open333crm/api dev
