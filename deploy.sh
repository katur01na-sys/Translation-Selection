#!/usr/bin/env bash
# deploy.sh — 一键构建 + 部署到桌面 .app
# 用法：bash deploy.sh [--no-restart]
set -e

APP="/Users/wangyijun/Desktop/polish-chiny.app"
SRC="/Users/wangyijun/Desktop/波兰语助手"
FRONTEND="$SRC/polskiej-frontend"
ELECTRON="$SRC/polskiej-chinese-src"

echo "🔨 [1/4] 构建前端..."
cd "$FRONTEND" && npm run build

echo "📦 [2/4] 复制 dist 资源..."
cp -r "$ELECTRON/dist/"* "$APP/Contents/Resources/app/dist/"

echo "⚙️  [3/4] 复制 Electron 主进程文件..."
cp "$ELECTRON/dist-electron/main.js"    "$APP/Contents/Resources/app/dist-electron/main.js"
cp "$ELECTRON/dist-electron/preload.js" "$APP/Contents/Resources/app/dist-electron/preload.js"
cp "$ELECTRON/dist-electron/bg_review.js" "$APP/Contents/Resources/app/dist-electron/bg_review.js"
echo "🎨 [3.5/4] 刷新应用图标..."
cp "$ELECTRON/build/icon.icns" "$APP/Contents/Resources/icon.icns"
sips -s format png "$ELECTRON/build/icon.icns" --out /tmp/app_icon_1024.png --resampleWidth 1024 >/dev/null 2>&1
osascript -e "use framework \"AppKit\"" \
  -e "set theImage to current application's NSImage's alloc()'s initWithContentsOfFile:\"/tmp/app_icon_1024.png\"" \
  -e "current application's NSWorkspace's sharedWorkspace()'s setIcon:theImage forFile:\"$APP\" options:0" 2>/dev/null

echo "✅ 部署完成"

if [[ "$1" != "--no-restart" ]]; then
  echo "🔄 [4/4] 重启应用..."
  pkill -x "polish-chiny" 2>/dev/null || true
  sleep 1
  open "$APP"
  echo "✅ 已启动"
fi
