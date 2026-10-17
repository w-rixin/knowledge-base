#!/usr/bin/env bash
# =============================================================================
# 麒麟 aarch64 离线依赖收集脚本
# =============================================================================
#
# 用途：在「联网的同版本麒麟机」上运行，一次性把离线机安装所需的全部依赖
#       打包成一个可拷贝的离线仓（主包 + 全部依赖 + 本地源索引）。
#
# 为什么需要它：麒麟机不能联网，apt 无法自动下载 libwebkit2gtk-4.1 等依赖。
#             必须在联网机上把依赖树完整下载好，一起带过去。
#
# 用法：
#   bash scripts/collect-offline-deps.sh                    # 交互式（推荐）
#   bash scripts/collect-offline-deps.sh --deb ./xxx.deb   # 指定主包
#   bash scripts/collect-offline-deps.sh --out /media/usb/kb-offline
#
# 关键前提：联网机与离线机的 `lsb_release -a` 输出必须完全一致
#          （同 SP 版本、同 aarch64 架构），否则包版本对不上。
#
# 产物：一个目录，拷到 U 盘后在离线机上直接用（见 kylin-aarch64-offline-deploy.md）
# =============================================================================

set -euo pipefail

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; NC=$'\033[0m'
ok()   { echo "${GREEN}✔${NC} $*"; }
warn() { echo "${YELLOW}!${NC} $*"; }
err()  { echo "${RED}✘${NC} $*" >&2; }
info() { echo "${CYAN}·${NC} $*"; }

DEB_PATH=""
OUT_DIR="$PWD/kb-offline-repo"

while [ $# -gt 0 ]; do
  case "$1" in
    --deb) DEB_PATH="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) err "未知参数：$1"; exit 1 ;;
  esac
done

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  麒麟 aarch64 离线依赖收集"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── 1. 环境自检 ────────────────────────────────────────────────────────────
info "检查本机环境…"

command -v apt-get >/dev/null 2>&1 || { err "非 Debian/Ubuntu 系（无 apt-get）"; exit 1; }
ok "包管理器：apt"

ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
info "架构：${ARCH}"
if [ "$ARCH" != "aarch64" ]; then
  warn "本机不是 aarch64！"
  warn "产出的包只能用于 ${ARCH}，与麒麟 aarch64 机不匹配。"
  warn "若你是故意在 x86 机上收集，请确认清楚再继续。"
  read -r -p "仍要继续？[y/N] " R; case "$R" in [yY]*) ;; *) exit 1 ;; esac
else
  ok "架构匹配 aarch64"
fi

if [ -f /etc/os-release ]; then
  . /etc/os-release
  info "本机系统：${PRETTY_NAME:-未知}"
  ok "请确认与麒麟离线机的 lsb_release -a 一致"
fi

# ── 2. 定位主包 ────────────────────────────────────────────────────────────
info "定位主包…"
if [ -z "$DEB_PATH" ]; then
  FOUND=$(ls -1 ./*.deb 2>/dev/null | head -1 || true)
  if [ -z "$FOUND" ]; then
    FOUND=$(find "$HOME" -maxdepth 3 -name "KnowledgeBase*_arm64.deb" 2>/dev/null | head -1 || true)
  fi
  if [ -z "$FOUND" ]; then
    err "未找到主包。请用 --deb 指定，例如："
    echo "    bash scripts/collect-offline-deps.sh --deb ~/Downloads/KnowledgeBase_1.65.0_arm64.deb"
    exit 1
  fi
  DEB_PATH="$FOUND"
fi

[ -f "$DEB_PATH" ] || { err "主包不存在：${DEB_PATH}"; exit 1; }
DEB_PATH="$(realpath "$DEB_PATH")"
ok "主包：$(basename "$DEB_PATH")"

PKG_NAME=$(dpkg-deb -f "$DEB_PATH" Package 2>/dev/null || echo "unknown")
VER=$(dpkg-deb -f "$DEB_PATH" Version 2>/dev/null || echo "unknown")
info "包名版本：${PKG_NAME} ${VER}"

# ── 3. webkit2gtk-4.1 可用性（头号风险）────────────────────────────────────
info "检查 webkit2gtk-4.1 可用性…"
if dpkg -l 2>/dev/null | grep -q "libwebkit2gtk-4.1-0"; then
  ok "已安装 libwebkit2gtk-4.1-0"
else
  if apt-cache show libwebkit2gtk-4.1-0 >/dev/null 2>&1; then
    ok "源中有 libwebkit2gtk-4.1-0 可下载"
  else
    warn "源中【没有】libwebkit2gtk-4.1-0 —— 这是麒麟移植的头号障碍"
    info "需先从麒麟开发者社区获取 4.1 的 aarch64 deb 包，再放入本目录"
    dim "镜像参考：https://mirrors.aliyun.com/kylin/"
  fi
fi

# ── 4. 收集依赖 ────────────────────────────────────────────────────────────
# 与 src-tauri/tauri.linux.conf.json 的 depends 保持一致
DEPS=(
  libwebkit2gtk-4.1-0
  libgtk-3-0
  libayatana-appindicator3-1
  librsvg2-2
  fonts-noto-cjk
  libc6
)

mkdir -p "$OUT_DIR"
OUT_DIR="$(realpath "$OUT_DIR")"
info "输出目录：${OUT_DIR}"

echo ""
info "下载主包与依赖（约 100-200MB，视网络）…"
cp "$DEB_PATH" "$OUT_DIR/"

# apt-get --download-only 会连同依赖树一起下载到 archives 缓存
MISSING=()
for p in "${DEPS[@]}"; do
  if apt-cache show "$p" >/dev/null 2>&1; then
    ok "解析：${p}"
  else
    warn "源中未找到：${p}"
    MISSING+=("$p")
  fi
done

echo ""
info "执行下载（--download-only 不安装，仅下载）…"
DOWNLOAD_OK=0
if sudo apt-get update -qq 2>/dev/null; then ok "apt 索引已更新"; fi

if sudo apt-get install --download-only -y --reinstall \
     "${DEPS[@]}" "$DEB_PATH" 2>&1 | tail -20; then
  DOWNLOAD_OK=1
  ok "依赖下载完成"
else
  warn "apt 下载过程有告警（继续尝试从缓存取包）"
fi

# 无论成功与否，都把缓存里的包捞出来（往往已下载大半）
if [ -d /var/cache/apt/archives ]; then
  COPIED=$(sudo cp /var/cache/apt/archives/*.deb "$OUT_DIR/" 2>/dev/null | wc -l || echo 0)
  CNT=$(ls -1 "$OUT_DIR"/*.deb 2>/dev/null | wc -l)
  ok "当前目录共 ${CNT} 个 deb 包"
fi

# ── 5. 生成本地源索引 ──────────────────────────────────────────────────────
info "生成本地源索引…"
if command -v dpkg-scanpackages >/dev/null 2>&1; then
  ( cd "$OUT_DIR" && dpkg-scanpackages . /dev/null 2>/dev/null | gzip > Packages.gz )
  [ -f "$OUT_DIR/Packages.gz" ] && ok "已生成 Packages.gz（离线机可直接用 apt 安装）"
else
  warn "缺 dpkg-scanpackages（apt-get install dpkg-dev），未生成索引"
  dim "离线机上仍可用 dpkg -i *.deb + apt-get install -f 安装"
fi

# ── 6. 写一份说明 ──────────────────────────────────────────────────────────
cat > "$OUT_DIR/README-离线安装.txt" <<EOF
麒麟 aarch64 离线安装包
生成时间：$(date '+%Y-%m-%d %H:%M:%S')
生成机器：$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-未知}") / ${ARCH}
主包：$(basename "$DEB_PATH")

════════════════════════════════════════════════════════

【离线机安装步骤】

  1) 把整个目录拷到离线机，例如 ~/kb-offline
  2) 配置本地离线源（若已有 Packages.gz）：
       cd ~/kb-offline
       sudo mkdir -p /var/local/kb-repo
       sudo cp *.deb Packages.gz /var/local/kb-repo/
       echo 'deb [trusted=yes] file:///var/local/kb-repo ./' | \\
         sudo tee /etc/apt/sources.list.d/kb-offline.list
       sudo apt-get update

  3) 安装：
       sudo apt-get install -f
       sudo apt install ./$(basename "$DEB_PATH")

     若不做本地源，退化为：
       sudo dpkg -i *.deb
       sudo apt-get install -f

════════════════════════════════════════════════════════

【注意事项】

  · 本目录依赖必须与离线机同版本（$(. /etc/os-release 2>/dev/null && echo "${VERSION_ID:-?}"))
  · 若麒麟拦非商店安装：设置 → 安全 → 应用安装 放开非商店来源
  · 界面中文显示为方块 → 确认 fonts-noto-cjk 已装：fc-list :lang=zh
  · 自动更新不可用（Linux 下 Tauri updater 仅支持 AppImage），
    升级请重新获取新版本 deb 后 apt install，会自动替换同包

EOF
ok "已写入安装说明 README-离线安装.txt"

# ── 7. 汇总 ────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
TOTAL=$(du -sh "$OUT_DIR" 2>/dev/null | cut -f1)
CNT=$(ls -1 "$OUT_DIR"/*.deb 2>/dev/null | wc -l)
ok "完成：${CNT} 个 deb 包，共 ${TOTAL}"
echo ""
info "下一步："
dim "  1) 把整个目录 ${OUT_DIR}"
dim "     拷到 U 盘 / 内网摆渡到麒麟机"
dim "  2) 在麒麟机上按 README-离线安装.txt 操作"
echo ""

if [ ${#MISSING[@]} -gt 0 ]; then
  warn "以下包在源中未找到，需手动补齐："
  for m in "${MISSING[@]}"; do echo "      - ${m}"; done
  dim "麒麟镜像参考：https://mirrors.aliyun.com/kylin/"
  echo ""
fi