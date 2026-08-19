#!/usr/bin/env bash
#
# sync-uat-db.sh — 把 UAT 的資料庫同步回本機（單向、唯讀 UAT）
#
# 用途：在本機用 UAT 的真實測試資料開發 / 驗證，不用每次都部署到 UAT。
#
# 安全保證：
#   1. 對 UAT「只讀」（只跑 pg_dump），絕不寫回 UAT。
#   2. 灌入目標寫死為「本機 5433」，不可能打到遠端。
#   3. 灌入前先自動備份本機現有 DB（存到 backups/）。
#   4. 灌完後自動補跑本機獨有的 Prisma migration（本機 schema 可能比 UAT 新）。
#
# 用法：
#   ./scripts/sync-uat-db.sh            # 完整同步（dump → 備份本機 → 還原 → migrate）
#   ./scripts/sync-uat-db.sh --no-migrate   # 同步後不自動跑 migrate
#
set -euo pipefail

# ─── 設定 ─────────────────────────────────────────────────────────────────────
# 各項可用環境變數覆寫（本機 container 名可能不同，如 dev compose 的 open333crm-dev-postgres-1）
UAT_SSH="${UAT_SSH:-ec2-user@uat.open333crm.create360.ai}"
UAT_CONTAINER="${UAT_CONTAINER:-open333crm-postgres}"
UAT_DB="${UAT_DB:-open333crm}"
UAT_USER="${UAT_USER:-crm}"

LOCAL_CONTAINER="${LOCAL_CONTAINER:-open333crm-postgres}"
LOCAL_DB="${LOCAL_DB:-open333crm}"
LOCAL_USER="${LOCAL_USER:-crm}"
LOCAL_PORT="${LOCAL_PORT:-5433}"   # 本機對外 port（容器內仍是 5432）

# Docker 完整路徑（本機 Docker Desktop）
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

RUN_MIGRATE=true
[[ "${1:-}" == "--no-migrate" ]] && RUN_MIGRATE=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/backups"
mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="$BACKUP_DIR/uat_dump_${TS}.sql"
LOCAL_BACKUP="$BACKUP_DIR/local_before_sync_${TS}.sql"

cyan() { printf "\033[36m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
red() { printf "\033[31m%s\033[0m\n" "$1"; }

# ─── 0. 前置檢查 ──────────────────────────────────────────────────────────────
cyan "[0/5] 檢查本機 Docker / Postgres 容器…"
if ! docker ps --format '{{.Names}}' | grep -q "^${LOCAL_CONTAINER}$"; then
  red "本機容器 ${LOCAL_CONTAINER} 沒在跑，請先啟動本機 DB（docker compose up -d）。"
  exit 1
fi

# ─── 1. 從 UAT dump（唯讀）──────────────────────────────────────────────────────
cyan "[1/5] 從 UAT pg_dump（唯讀，不影響 UAT）…"
ssh -o ConnectTimeout=15 "$UAT_SSH" \
  "docker exec ${UAT_CONTAINER} pg_dump -U ${UAT_USER} -d ${UAT_DB} --clean --if-exists --no-owner --no-acl" \
  > "$DUMP_FILE"
DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
green "  → 已下載 UAT dump：$DUMP_FILE ($DUMP_SIZE)"

# pgvector 等 extension：dump 內含 CREATE EXTENSION，灌入端需有同名 extension 可用。
# 本機 image 為 pgvector/pgvector，已內建，無需額外處理。

# ─── 2. 備份本機現有 DB（保險）────────────────────────────────────────────────
cyan "[2/5] 備份本機現有 DB（萬一要還原）…"
docker exec "$LOCAL_CONTAINER" pg_dump -U "$LOCAL_USER" -d "$LOCAL_DB" --clean --if-exists --no-owner --no-acl \
  > "$LOCAL_BACKUP"
green "  → 本機備份：$LOCAL_BACKUP"

# ─── 3. 把 UAT dump 灌進本機 ──────────────────────────────────────────────────
cyan "[3/5] 還原 UAT 資料到本機（target 寫死本機容器，不會碰 UAT）…"
docker exec -i "$LOCAL_CONTAINER" psql -U "$LOCAL_USER" -d "$LOCAL_DB" < "$DUMP_FILE" \
  > /tmp/sync_restore.log 2>&1 || {
    red "還原過程有錯誤，請看 /tmp/sync_restore.log（部分 NOTICE/錯誤通常可忽略，但請確認）。"
  }
green "  → UAT 資料已灌入本機 $LOCAL_DB"

# ─── 4. 補跑本機獨有的 migration（本機 schema 可能比 UAT 新）──────────────────
if $RUN_MIGRATE; then
  cyan "[4/5] 補跑本機 Prisma migration（讓本機獨有欄位補回，如 modelGuideSystemPrompt）…"
  export DATABASE_URL="postgresql://${LOCAL_USER}:crmpassword@localhost:${LOCAL_PORT}/${LOCAL_DB}"
  (cd "$ROOT_DIR" && pnpm --filter @open333crm/database exec prisma migrate deploy 2>&1 | grep -v "^warn\|deprecated\|prisma-config\|^For more") || \
    red "  migrate deploy 有警告，請確認（若提示 already applied 可忽略）。"
  green "  → migration 補齊"
else
  cyan "[4/5] 略過 migrate（--no-migrate）"
fi

# ─── 5. 完成 ──────────────────────────────────────────────────────────────────
cyan "[5/5] 完成！"
green "本機 DB 已同步 UAT 資料。"
echo "  - UAT dump：     $DUMP_FILE"
echo "  - 本機同步前備份：$LOCAL_BACKUP"
echo ""
echo "若要還原同步前的本機資料："
echo "  docker exec -i $LOCAL_CONTAINER psql -U $LOCAL_USER -d $LOCAL_DB < $LOCAL_BACKUP"
