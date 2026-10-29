#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22 或更新版本：https://nodejs.org/'
  read -r -p '按回车退出。' response
  exit 1
fi
node scripts/run-local.mjs
