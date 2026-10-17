#!/usr/bin/env bash
# =============================================================================
# 麒麟 aarch64 全自动建仓 + 推送 + 出包
# =============================================================================
#
# 用途：一条命令走完「建 GitHub 仓库 → 推代码 → 触发 ARM 构建 → 取 deb」。
#       只需事先完成一次 `gh auth login`（浏览器授权），之后全自动。
#
# 用法：
#   bash scripts/auto-release-kylin.sh              # 交互式（推荐，会逐步确认）
#   bash scripts/auto-release-kylin.sh --yes        # 全自动，不再逐步确认
#   bash scripts/auto-release-kylin.sh --repo my-kb # 指定仓库名
#   bash scripts/auto-release-kylin.sh --private    # 建私有仓库（消耗 Actions 额度）
#
# 前置：已执行过 `gh auth login` 并完成浏览器授权
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; DIM=$'\033[2m'; NC=$'\033[0m'
ok()   { echo "${GREEN}✔${NC} $*"; }
warn() { echo "${YELLOW}!${NC} $*"; }
err()  { echo "${RED}✘${NC} $*" >&2; }
info() { echo "${CYAN}·${NC} $*"; }
dim()  { echo "${DIM}  $1${NC}"; }
step() { echo ""; echo "${CYAN}━━ $* ━━${NC}"; }

ASSUME_YES=0
REPO_NAME="knowledge-base"
VISIBILITY="public"

for arg in "$@"; do
  case "$arg" in
    --yes|-y)   ASSUME_YES=1 ;;
    --repo)     REPO_NAME="$2"; shift ;;
    --private)  VISIBILITY="private" ;;
    --help|-h)  sed -n '2,18p' "$0"; exit 0 ;;
  esac
done

confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  read -r -p "$1 [y/N] " R
  case "$R" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  麒麟 aarch64 全自动出包"
echo "════════════════════════════════════════════════════════════"

# ── 1. 前置检查 ────────────────────────────────────────────────────────────
step "1/5 前置检查"

command -v git >/dev/null 2>&1 || { err "未安装 git"; exit 1; }
ok "git"

command -v node >/dev/null 2>&1 || { err "未安装 Node.js"; exit 1; }
ok "Node $(node -v | sed 's/v//')"

command -v gh >/dev/null 2>&1 || {
  err "未安装 gh CLI"
  dim "安装：winget install --id GitHub.cli --exact"
  dim "安装后重开终端，再执行：gh auth login"
  exit 1
}
ok "gh $(gh --version | head -1 | awk '{print $3}')"

GH_USER="$(gh api user --jq .login 2>/dev/null || true)"
if [ -z "$GH_USER" ]; then
  warn "尚未登录 GitHub"
  echo ""
  dim "请执行：gh auth login"
  dim "选 GitHub.com → HTTPS → 浏览器授权（复制一次性验证码）"
  echo ""
  read -r -p "现在执行 gh auth login？[y/N] " R
  case "$R" in [yY]*) gh auth login ;; *) err "需要登录后才能继续"; exit 1 ;; esac
  GH_USER="$(gh api user --jq .login 2>/dev/null || true)"
  [ -z "$GH_USER" ] && { err "登录失败"; exit 1; }
fi
ok "GitHub 账号：${GH_USER}"

# ── 2. 确保 remote ─────────────────────────────────────────────────────────
step "2/5 配置远程仓库"

REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
TARGET_URL="https://github.com/${GH_USER}/${REPO_NAME}.git"

if [ -z "$REMOTE_URL" ]; then
  info "添加远程：${TARGET_URL}"
  git remote add origin "$TARGET_URL"
  ok "origin 已配置"
elif echo "$REMOTE_URL" | grep -q "${GH_USER}"; then
  ok "origin 已就绪：${REMOTE_URL}"
else
  warn "origin 指向其他账号：${REMOTE_URL}"
  confirm "改指向 ${TARGET_URL}？" || exit 1
  git remote set-url origin "$TARGET_URL"
  ok "origin 已更新"
fi

# ── 3. 确保提交 ────────────────────────────────────────────────────────────
step "3/5 准备提交"

VERSION="$(node -p "require('./package.json').version")"
BRANCH="$(git branch --show-current)"
[ -z "$BRANCH" ] && BRANCH="master"

DIRTY="$(git status --porcelain | grep -v '^\s*$' || true)"
if [ -n "$DIRTY" ]; then
  CNT=$(echo "$DIRTY" | wc -l | tr -d ' ')
  warn "有 ${CNT} 个文件未提交"
  echo "$DIRTY" | head -5 | sed 's/^/      /'
  confirm "自动提交这些改动？" || exit 1
  git add -A
  git commit -m "chore: 同步本地改动"
  ok "已提交"
else
  ok "工作区干净（${BRANCH} 分支）"
fi

# ── 4. 建仓 + 推送 ──────────────────────────────────────────────────────────
step "4/5 创建仓库并推送"

if gh repo view "${GH_USER}/${REPO_NAME}" --json name >/dev/null 2>&1; then
  warn "仓库已存在：${GH_USER}/${REPO_NAME}"
else
  info "创建${VISIBILITY}仓库 ${REPO_NAME}…"
  if [ "$VISIBILITY" = "private" ]; then
    gh repo create "${GH_USER}/${REPO_NAME}" --private --description "本地知识库桌面应用（Tauri 2）" >/dev/null
  else
    gh repo create "${GH_USER}/${REPO_NAME}" --public  --description "本地知识库桌面应用（Tauri 2）" >/dev/null
  fi
  ok "仓库已创建：https://github.com/${GH_USER}/${REPO_NAME}"
fi

info "推送代码（${BRANCH} → origin）…"
git push -u origin "$BRANCH" 2>&1 | tail -5
ok "推送完成"

# ── 5. 触发 ARM 构建 ───────────────────────────────────────────────────────
step "5/5 触发麒麟 aarch64 构建"

TAG="v${VERSION}-kylin"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  warn "标签 ${TAG} 已存在"
  confirm "删除并重建该标签？" || exit 1
  git tag -d "$TAG" >/dev/null
  git push origin ":refs/tags/${TAG}" 2>/dev/null || true
  ok "旧标签已清除"
fi

confirm "推标签 ${TAG} 并触发 ARM 构建？" || exit 1
git tag "$TAG" "$(git rev-parse HEAD)"
git push origin "$TAG" 2>&1 | tail -3
ok "标签已推送：${TAG}"

echo ""
info "构建进度（约 10-20 分钟）："
dim "  gh run watch"
dim "  或打开：https://github.com/${GH_USER}/${REPO_NAME}/actions"
echo ""

if ! confirm "现在开始等待构建完成？" || exit 0; then :; fi

echo "等待 ARM 构建（Ctrl+C 可随时退出，不影响已触发的构建）…"
echo ""

if gh run watch --exit-status --timeout 40m 2>&1 | tail -15; then
  ok "构建完成"
else
  warn "构建未在预期内完成或被中断，请到 Actions 页查看"
  dim "  https://github.com/${GH_USER}/${REPO_NAME}/actions"
  exit 1
fi

# ── 下载产物 ───────────────────────────────────────────────────────────────
echo ""
step "下载安装包"

mkdir -p ./dist-kylin
if gh release download "$TAG" --pattern "*_arm64.deb" --dir ./dist-kylin 2>/dev/null || \
   gh release download "$TAG" --pattern "*.deb" --dir ./dist-kylin 2>/dev/null; then
  DEB_FILE="$(ls -1 ./dist-kylin/*.deb 2>/dev/null | head -1)"
  if [ -n "$DEB_FILE" ]; then
    ok "已下载：${DEB_FILE}"
    SIZE=$(du -h "$DEB_FILE" | cut -f1)
    info "大小：${SIZE}"
    case "$(basename "$DEB_FILE")" in
      *_amd64.deb)
        warn "⚠ 这是 x86_64 产物，装不到麒麟 aarch64 机！"
        ;;
      *_arm64.deb|*_aarch64.deb)
        ok "架构正确（arm64）"
        ;;
    esac
    echo ""
    info "下一步："
    dim "  1) 把这个 deb 拷到联网的同版本麒麟机"
    dim "  2) 运行：bash scripts/collect-offline-deps.sh --deb $DEB_FILE"
    dim "  3) 把生成的 kb-offline-repo 目录用 U 盘摆渡到离线麒麟机"
    echo ""
    dim "  详见 docs/kylin-aarch64-offline-deploy.md"
  fi
else
  warn "未找到 deb 产物"
  dim "Release 是草稿状态，需先发布："
  dim "  gh release edit ${TAG} --draft=false"
  dim "  然后重跑本脚本的下载步骤"
fi