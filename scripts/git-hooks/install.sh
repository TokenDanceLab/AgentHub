#!/usr/bin/env bash
# 安装项目 git hooks：git config core.hooksPath scripts/git-hooks
# 每个 clone 后跑一次即可；hook 文件随仓库版本管理，改完自动生效
set -e
cd "$(dirname "$0")/../.."
git config core.hooksPath scripts/git-hooks
echo "✅ git hooks 已启用: $(git config core.hooksPath)"
