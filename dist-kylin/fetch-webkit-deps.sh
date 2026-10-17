#!/usr/bin/env bash
# =============================================================================
# 从 Ubuntu 22.04 源下载 webkit2gtk-4.1 及依赖（仅下载，不安装）
# =============================================================================
#
# 用途：麒麟源里没有 webkit2gtk-4.1 时，从 Ubuntu 官方源取 aarch64 包，
#       拷到 U 盘摆渡到麒麟机安装。
#
# 关键点：
#   - 本脚本在**联网机**上跑，可以是 x86_64（因为只下载不运行，架构由 apt 决定）
#   - 用 `apt-get download` 而非 `install`，不会污染本机系统
#   - 独立下载目录，不改动本机 apt 源配置
#   - 最后用 dpkg-deb 逐个检查架构，确保是 arm64
#
# 用法：
#   bash fetch-webkit-deps.sh              # 下载到 ./kb-deps
#   bash fetch-webkit-deps.sh /media/usb/kb-deps   # 指定输出目录
#
# 前提：联网机是 Debian/Ubuntu 系且能访问 ports.ubuntu.com
# =============================================================================

set -euo pipefail

OUT_DIR="${1:-./kb-deps}"
MIRROR="http://ports.ubuntu.com/ubuntu-ports"
SUITE="jammy"
COMPONENTS="main universe"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; NC=$'\033[0m'
ok()   { echo "${GREEN}✔${NC} $*"; }
warn() { echo "${YELLOW}!${NC} $*"; }
err()  { echo "${RED}✘${NC} $*" >&2; }
info() { echo "${CYAN}·${NC} $*"; }

echo ""
echo "============================================================"
echo " 从 Ubuntu 22.04 下载 webkit2gtk-4.1 依赖（arm64）"
echo "============================================================"
echo ""

# ── 1. 环境检查 ────────────────────────────────────────────────────────────
info "检查环境…"
if ! command -v apt-get >/dev/null 2>&1; then
  err "本机需要 apt-get（Debian/Ubuntu 系）"
  err "若只有 Windows，可用 WSL Ubuntu，或换一台 Linux 机器执行"
  exit 1
fi
ok "apt-get 可用"

if [ ! -d /etc/apt ]; then
  err "未检测到 apt 目录，可能不是 Debian/Ubuntu 系"
  exit 1
fi

# 是否有 dpkg-deb（检查架构用）
HAS_DPKG=0
command -v dpkg-deb >/dev/null 2>&1 && HAS_DPKG=1

# ── 2. 准备独立的下载环境（不改本机源）────────────────────────────────────
info "准备独立下载环境…"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 关键：用 -o Dir::Etc 指向临时目录，**完全不碰本机 /etc/apt/sources.list**
mkdir -p "$WORK/lists/partial" "$WORK/cache/archives/partial"

ARCH="arm64"

info "下载源：${MIRROR} (${SUITE})"
info "目标架构：${ARCH}"
echo ""

# ── 3. 要下载的包 ──────────────────────────────────────────────────────────
# libwebkit2gtk-4.1-0 本身 + 其直接依赖链上麒麟可能缺的
PACKAGES=(
  "libwebkit2gtk-4.1-0"
  "libwebkit2gtk-4.1-common"
  "libjavascriptcoregtk-4.1-0"
  "libsoup-3.0-0"
  "libflite1"
  "libavif15"
  "libavif16"
  "libharfbuzz-icu0"
  "libenchant-2-2"
  "libsecret-1-0"
  "libmanette-0.2-0"
  "libhyphen0"
  "libwebpdemux2"
)

# ── 4. 用独立 sources.list 下载 ────────────────────────────────────────────
SOURCES_FILE="$WORK/sources.list"
cat > "$SOURCES_FILE" <<EOF
deb [arch=${ARCH}] ${MIRROR} ${SUITE} ${COMPONENTS}
EOF

info "执行下载（不安装）…"
DOWNLOAD_OK=0
if apt-get \
    -o Dir::Etc::sourcelist="$SOURCES_FILE" \
    -o Dir::Etc::sourceparts="-" \
    -o Dir::State::lists="$WORK/lists" \
    -o Dir::Cache::archives="$WORK/cache/archives" \
    -o APT::Get::List-Cleanup="0" \
    -o Acquire::Languages="none" \
    update 2>&1 | tail -3; then
  ok "索引更新完成"
  DOWNLOAD_OK=1
else
  warn "索引更新失败，检查网络"
fi

if [ "$DOWNLOAD_OK" -eq 1 ]; then
  echo ""
  info "逐个下载 deb…"
  for p in "${PACKAGES[@]}"; do
    if apt-get \
        -o Dir::Etc::sourcelist="$SOURCES_FILE" \
        -o Dir::Etc::sourceparts="-" \
        -o Dir::State::lists="$WORK/lists" \
        -o Dir::Cache::archives="$WORK/cache/archives" \
        download "$p" -o Dir::Cache::archives="$OUT_DIR" 2>/dev/null; then
      ok "$p"
    else
      warn "$p 下载失败（源里可能没有，将跳过）"
    fi
    cd "$OUT_DIR" && cd "$OUT_DIR" 2>/dev/null || true
  done
fi

# apt-get download 会把文件下到当前目录，故再统一收集一次
cd "$OUT_DIR"
find "$WORK/cache/archives" -name "*.deb" -exec cp {} "$OUT_DIR"/ \; 2>/dev/null || true

# ── 5. 架构校验（关键：绝不能混进 amd64 包）────────────────────────────────
echo ""
info "校验包架构…"
if [ "$HAS_DPKG" -eq 1 ]; then
  GOOD=0; BAD=0
  for f in "$OUT_DIR"/*.deb; do
    [ -f "$f" ] || continue
    A="$(dpkg-deb -f "$f" Architecture 2>/dev/null || echo "?")"
    case "$A" in
      arm64) GOOD=$((GOOD+1)) ;;
      *) warn "架构不符($A): $(basename "$f")"
         rm -f "$f"    # 直接删掉，防止装错架构
         BAD=$((BAD+1)) ;;
    esac
  done
  ok "arm64 包：${GOOD} 个"
  [ "$BAD" -gt 0 ] && warn "已剔除 ${BAD} 个非 arm64 包"
fi

# ── 6. 生成安装说明 ────────────────────────────────────────────────────────
COUNT=$(ls -1 "$OUT_DIR"/*.deb 2>/dev/null | wc -l | tr -d ' ')

cat > "$OUT_DIR/README-麒麟安装.txt" <<EOF
webkit2gtk-4.1 依赖包（从 Ubuntu 22.04 ${SUITE} 取得，架构 arm64）
生成时间: $(date '+%Y-%m-%d %H:%M:%S')
包数量: ${COUNT}

════════════════════════════════════════════════════

【在麒麟机上安装】

  1) 把整个目录拷到麒麟机，例如 ~/kb-deps
  2) 执行：

       cd ~/kb-deps
       sudo dpkg -i *.deb

     若提示依赖顺序问题（正常），继续：

       sudo apt-get install -f

  3) 装应用：

       sudo apt install ./KnowledgeBase_1.65.0_arm64.deb

════════════════════════════════════════════════════

【注意事项】

  · 本目录是 Ubuntu 22.04 的包，麒麟 V10 基于 Ubuntu 20.04，
    glibc 通常向下兼容；若某个包报 glibc 版本不足，单独跳过该包，
    让 apt-get install -f 用麒麟自己的版本补上。

  · 若报 libicu70 与麒麟已有版本冲突（如 libicu67），
    跳过 libicu70 那两个包，让系统用自己的 ICU。

  · 若 apt 提示找不到依赖，请把完整报错发出来再对症处理。

════════════════════════════════════════════════════
EOF
ok "已生成安装说明"

# ── 7. 汇总 ────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
TOTAL_SIZE="$(du -sh "$OUT_DIR" 2>/dev/null | cut -f1)"
if [ "$COUNT" -gt 0 ]; then
  ok "下载完成：${COUNT} 个包，共 ${TOTAL_SIZE}"
  echo ""
  echo "输出目录：${OUT_DIR}"
  ls -lh "$OUT_DIR"/*.deb 2>/dev/null | awk '{printf "  %-52s %s\n", $9, $5}'
  echo ""
  info "下一步："
  echo "  1) 把整个 ${OUT_DIR} 目录拷到 U 盘"
  echo "  2) 在麒麟机按 README-麒麟安装.txt 操作"
else
  err "未下载到任何包"
  echo ""
  echo "可能原因："
  echo "  · 本机无法访问 ${MIRROR}"
  echo "  · 架构选择有误"
  echo ""
  echo "备选：换用清华/阿里 Ubuntu 镜像后重试，例如"
  echo "  sed -i 's|${MIRROR}|https://mirrors.tuna.tsinghua.edu.cn/ubuntu-ports|g' /tmp/x"
fi
echo "============================================================"
echo ""