#!/bin/sh
# docker-compose.dev.yml 的 deps 服務使用：編譯 @tensorflow/tfjs-node 的 binding，做法與
# apps/api/Dockerfile 相同。
#
# deps 以 --ignore-scripts 安裝，所以 tfjs-node 自己的安裝腳本不會執行。那支腳本在 Linux arm64
# 找不到預期的 libtensorflow 版本，每次都重新下載，再以 npm 的 tar 解壓；pnpm.overrides 固定的
# tar 7 拒絕壓縮檔裡的連續 symlink（TAR_SYMLINK_ERROR）。所以改用 Dockerfile.dev 以系統 tar
# 解壓好的 /opt/libtensorflow，再直接以 node-pre-gyp 從原始碼編譯。
set -eu

TFJS_NODE_DIR="$(realpath /app/apps/api/node_modules/@tensorflow/tfjs-node)"
BINDING="$TFJS_NODE_DIR/lib/napi-v8/tfjs_binding.node"

# node_modules 是 named volume，重新啟動時 binding 還在，不用再編譯一次。
# 先實際載入一次：volume 裡的 binding 損壞或不相容時，載入失敗，改為重新編譯。
if [ -f "$BINDING" ] && node -e 'require(process.argv[1])' "$BINDING" >/dev/null 2>&1; then
  echo "tfjs-node binding already built: $BINDING"
  exit 0
fi

rm -rf "$TFJS_NODE_DIR/deps"
mkdir -p "$TFJS_NODE_DIR/deps"
cp -a /opt/libtensorflow/. "$TFJS_NODE_DIR/deps/"
cd "$TFJS_NODE_DIR"
# node-pre-gyp 是 tfjs-node 宣告的相依套件，用套件自己的 .bin，不依賴 pnpm 的 hoist
./node_modules/.bin/node-pre-gyp install --build-from-source
test -f "$BINDING"
