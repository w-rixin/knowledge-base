#!/usr/bin/env bash
# =============================================================================
# 麒麟 aarch64 一键出包脚本
# =============================================================================
#
# 用途：把「编译麒麟 aarch64 安装包」压缩成一条命令，其余全部交给 GitHub Actions。
#
# 你不需要有 Linux 机器、不需要装 Rust/Node、不需要交叉编译链 ——
# ARM 原生 runner（ubuntu-24.04-arm）在云端完成全部工作。
#
# 用法：
#   bash scripts/build-kylin.sh                 # 用当前版本号（读 package.json）
#   bash scripts/build-kylin.sh 1.66.0          # 指定版本号
#   bash scripts/build-kylin.sh 1.66.0 --dry-run # 只检查环境，不真的推
#
# 前置条件：
#   1. 代码已推到 GitHub（私有仓库也行，ARM runner 消耗 Actions 额度）
#   2. 仓库配好 Secret：TAURI_SIGNING_PRIVATE_KEY（自动更新签名，离线场景可不配）
#
# 产出：GitHub Release 草稿里的 KnowledgeBase_<版本>_arm64.deb
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; DIM=$'\033[2m'; NC=$'\033[0m'

ok()   { echo "${GREEN}✔${NC} $*"; }
warn() { echo "${YELLOW}!${NC} $*"; }
err()  { echo "${RED}✘${NC} $*" >&2; }
info() { echo "${CYAN}·${NC} $*"; }
dim()  { echo "${DIM}  $1${NC}"; }

DRY_RUN=0
VERSION=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) VERSION="$arg" ;;
  esac
done

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  麒麟 aarch64 一键出包${DRY_RUN:+
  (dry-run 检查模式)}"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── 1. 版本号 ──────────────────────────────────────────────────────────────
if [ -z "$VERSION" ]; then
  VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
  [ -z "$VERSION" ] && { err "读不到版本号，请显式指定：bash scripts/build-kylin.sh 1.66.0"; exit 1; }
  info "版本号：${VERSION}（取自 package.json）"
else
  info "版本号：${VERSION}（命令行指定）"
fi

TAG="v${VERSION}-kylin"

# ── 2. 环境检查 ────────────────────────────────────────────────────────────
info "检查构建环境…"

command -v git >/dev/null 2>&1 || { err "未安装 git"; exit 1; }
ok "git 可用"

command -v node >/dev/null 2>&1 || { err "未安装 Node.js"; exit 1; }
ok "Node $(node -v | sed 's/v//') 可用"

if [ ! -d .git ]; then
  err "当前目录不是 git 仓库，无法触发 CI"
  echo ""
  echo "  请先初始化并推送："
  echo "    git init && git add -A && git commit -m \"feat: 麒麟 aarch64 支持\""
  echo "    git remote add origin <你的 GitHub 仓库地址>"
  echo "    git push -u origin main"
  echo ""
  exit 1
fi
ok "git 仓库正常"

BRANCH="$(git branch --show-current)"
[ -z "$BRANCH" ] && BRANCH="main"
ok "当前分支：${BRANCH}"

REMOTE="$(git remote get-url origin 2>/dev/null || true)"
if [ -z "$REMOTE" ]; then
  err "未配置 origin 远程仓库"
  dim "git remote add origin <你的 GitHub 仓库地址>"
  exit 1
fi
ok "远程仓库：${REMOTE}"

# ── 3. CI 配置检查 ─────────────────────────────────────────────────────────
info "检查 CI 配置…"

WORKFLOW=".github/workflows/release.yml"
[ -f "$WORKFLOW" ] || { err "缺少 ${WORKFLOW}，麒麟 ARM 矩阵未就绪"; exit 1; }

if grep -q "ubuntu-24.04-arm" "$WORKFLOW"; then
  ok "麒麟 ARM 矩阵已配置（ubuntu-24.04-arm）"
else
  err "release.yml 中找不到 ubuntu-24.04-arm"
  dim "需要为麒麟添加 ARM runner 矩阵，否则 CI 不会产出 aarch64 包"
  exit 1
fi

if grep -q "RELEASE_KYLIN_ARM" "$WORKFLOW"; then
  info "RELEASE_KYLIN_ARM 开关已就绪（设 skip 可跳过 ARM 构建）"
fi

if [ -f src-tauri/tauri.linux.conf.json ]; then
  ok "麒麟打包配置存在（targets=deb）"
else
  warn "缺少 src-tauri/tauri.linux.conf.json，Linux 将沿用默认 targets"
fi

# ── 4. 工作区检查 ──────────────────────────────────────────────────────────
info "检查工作区状态…"

DIRTY="$(git status --porcelain 2>/dev/null | grep -v '^\s*$' || true)"
if [ -n "$DIRTY" ]; then
  CHANGED="$(echo "$DIRTY" | wc -l | tr -d ' ')"
  if [ "$CHANGED" -gt 0 ]; then
    warn "有 ${CHANGED} 个文件未提交："
    echo "$DIRTY" | head -8 | sed 's/^/      /'
    if [ "$DRY_RUN" -eq 1 ]; then
      dim "（dry-run 模式，仅提示）"
    else
      err "请先提交这些改动再出包：git add -A && git commit -m \"...\""
      exit 1
    fi
  fi
else
  ok "工作区干净"
fi

if git rev-parse "v${VERSION}" >/dev/null 2>&1; then
  warn "标签 ${TAG} 已存在，可能需要手动删除或改用新版本号"
  dim "git tag -d ${TAG} && git push origin :refs/tags/${TAG}"
fi

# ── 5. 触发 ────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  即将执行"
echo "════════════════════════════════════════════════════════════"
dim "  git tag ${TAG}"
dim "  git push origin ${TAG}"
dim ""
dim "  → CI 在 ubuntu-24.04-arm 原生 ARM runner 上编译"
dim "  → 约 10-20 分钟后在 GitHub Release 草稿中得到："
dim "    KnowledgeBase_${VERSION}_arm64.deb"
echo ""

if [ "$DRY_RUN" -eq 1 ]; then
  ok "dry-run 检查通过，未执行任何推送"
  exit 0
fi

read -r -p "确认推标签并触发构建？[y/N] " REPLY
case "$REPLY" in
  [yY]|[yY][eE][sS]) ;;
  *) echo "已取消"; exit 0 ;;
esac

git tag "$TAG" "$(git rev-parse HEAD)"
git push origin "$TAG"

echo ""
ok "标签已推送：${TAG}"
echo ""
info "查看构建进度："
dim "  ${REMOTE/\.git/}/actions"
echo ""
info "构建完成后取包（在你的 Windows 上执行）："
dim "  gh release download ${TAG} --pattern \"*_arm64.deb\""
dim ""
info "然后把 deb 拷到麒麟机安装 —— 见 docs/kylin-aarch64-offline-deploy.md"
echo ""