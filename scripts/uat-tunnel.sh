#!/usr/bin/env bash
#
# uat-tunnel.sh — 開/關 到 UAT 資料庫與 Redis 的 SSH tunnel
#
# 讓本機可以透過 localhost 連到 UAT 的 DB / Redis（走 SSH，不需 EC2 對外開 port）。
#   本機 5434  →  UAT postgres(5433)
#   本機 6381  →  UAT redis(6380)   ← 若 UAT redis 未對外映射則略過
#
# ⚠️ 連到 UAT 後，任何寫入/migration 都會改到 UAT。UAT 是可重啟的測試站，
#    但仍請避免在連 UAT 狀態下跑 prisma migrate（見 dev-uat.sh 的護欄）。
#
# 用法：
#   ./scripts/uat-tunnel.sh up      # 開 tunnel
#   ./scripts/uat-tunnel.sh down    # 關 tunnel
#   ./scripts/uat-tunnel.sh status  # 看狀態
#
set -euo pipefail

UAT_SSH="ec2-user@uat.open333crm.create360.ai"
DB_LOCAL_PORT=5434
DB_REMOTE_PORT=5433          # UAT 主機上 postgres 對外映射的 port
TUNNEL_TAG="uat-db-tunnel"   # 用來辨識 / 關閉本 tunnel

cmd="${1:-status}"

is_up() { pgrep -f "${DB_LOCAL_PORT}:localhost:${DB_REMOTE_PORT}.*${UAT_SSH}" >/dev/null 2>&1; }

case "$cmd" in
  up)
    if is_up; then echo "✅ tunnel 已在運行（本機 :${DB_LOCAL_PORT} → UAT DB）"; exit 0; fi
    if nc -z -w1 localhost "$DB_LOCAL_PORT" 2>/dev/null; then
      echo "❌ 本機 :${DB_LOCAL_PORT} 已被其他程式佔用，請先釋放"; exit 1
    fi
    echo "→ 建立 SSH tunnel（本機 :${DB_LOCAL_PORT} → UAT DB :${DB_REMOTE_PORT}）..."
    ssh -o ConnectTimeout=10 -o ExitOnForwardFailure=yes \
        -f -N -L "${DB_LOCAL_PORT}:localhost:${DB_REMOTE_PORT}" "$UAT_SSH"
    sleep 1
    if is_up; then echo "✅ tunnel 已建立。本機用 postgresql://crm:***@localhost:${DB_LOCAL_PORT}/open333crm 即連到 UAT"; \
    else echo "❌ tunnel 建立失敗"; exit 1; fi
    ;;
  down)
    if is_up; then
      pkill -f "${DB_LOCAL_PORT}:localhost:${DB_REMOTE_PORT}.*${UAT_SSH}" 2>/dev/null || true
      sleep 1
      echo "✅ tunnel 已關閉"
    else
      echo "（tunnel 未在運行）"
    fi
    ;;
  status)
    if is_up; then echo "✅ tunnel 運行中（本機 :${DB_LOCAL_PORT} → UAT DB）";
    else echo "○ tunnel 未運行"; fi
    ;;
  *)
    echo "用法: $0 {up|down|status}"; exit 1 ;;
esac
