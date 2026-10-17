#!/usr/bin/env bash
# =============================================================================
# 麒麟 webkit2gtk 诊断脚本（只读，不改系统）
# =============================================================================
#
# 用途：一次查清「Tauri 应用能否在这台麒麟机上启动」。
#       仅执行查询类命令，不安装任何东西、不修改系统配置。
#
# 用法：
#   bash check-kylin-webkit.sh
#
# 关键概念（很多人搞混）：
#   pkg-config / *.pc 文件  → **开发包**（编译时才需要，含头文件）
#   libwebkit2gtk-*.so      → **运行时库**（程序启动时才需要）
#
#   所以「pkg-config 查不到」**不等于**「应用跑不起来」。
#   本脚本会分别检查两者，给出准确结论。
# =============================================================================

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; NC=$'\033[0m'
ok()   { echo "${GREEN}[有]${NC} $*"; }
bad()  { echo "${RED}[无]${NC} $*"; }
warn() { echo "${YELLOW}[?]${NC} $*"; }

echo ""
echo "============================================================"
echo " 麒麟 webkit2gtk 诊断报告"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# ── 1. 系统信息 ────────────────────────────────────────────────────────────
echo "${CYAN}【1】系统信息${NC}"
echo "----------------------------------------"
[ -f /etc/os-release ] && . /etc/os-release && echo "  发行版: ${PRETTY_NAME:-未知}"
echo "  版本号: ${VERSION_ID:-?}  (代号 ${VERSION_CODENAME:-?})"
echo "  内核:   $(uname -r)"
echo "  架构:   $(uname -m)"
[ -f /etc/kylin-build ] && echo "  麒麟构建号: $(cat /etc/kylin-build)"
[ -f /etc/.kyinfo ] && echo "  kyinfo: $(cat /etc/.kyinfo)"
echo "  glibc:  $(ldd --version 2>/dev/null | head -1)"
echo ""

# ── 2. 包管理器 ────────────────────────────────────────────────────────────
PKG=""
if command -v dpkg >/dev/null 2>&1; then
  PKG="dpkg"
  ARCH_NAME="$(dpkg --print-architecture 2>/dev/null)"
elif command -v rpm >/dev/null 2>&1; then
  PKG="rpm"
  ARCH_NAME="$(rpm -eval '%{_arch}' 2>/dev/null)"
fi
echo "${CYAN}【2】架构与包管理器${NC}"
echo "----------------------------------------"
echo "  包管理器: ${PKG:-未识别}"
echo "  架构名:   ${ARCH_NAME:-未知}"
echo ""

# ── 3. 已安装的 webkit 包 ──────────────────────────────────────────────────
echo "${CYAN}【3】已安装的 webkit2gtk 相关包${NC}"
echo "----------------------------------------"
if [ "$PKG" = "dpkg" ]; then
  dpkg -l 2>/dev/null | grep -i webkit | awk '{printf "  %-52s %s\n", $2, $3}'
  if ! dpkg -l 2>/dev/null | grep -qi webkit; then
    echo "  （未安装任何 webkit 包）"
  fi
else
  rpm -qa 2>/dev/null | grep -i webkit | sed 's/^/  /'
fi
echo ""

# ── 4. 【关键】运行时库是否存在 ────────────────────────────────────────────
echo "${CYAN}【4】运行时库（这才是应用启动的关键）${NC}"
echo "----------------------------------------"
LIB_FOUND=""
for lib in libwebkit2gtk-4.1.so.0 libwebkit2gtk-4.1.so.1 libwebkit2gtk-4.0.so.37 libwebkit2gtk-4.0.so.38; do
  PATH_FOUND="$(ldconfig -p 2>/dev/null | grep "$lib" | head -1)"
  if [ -n "$PATH_FOUND" ]; then
    ok "$lib"
    LIB_FOUND="$lib"
    echo "      $(echo "$PATH_FOUND" | awk '{print $NF}')"
  fi
done
if [ -z "$LIB_FOUND" ]; then
  bad "未找到任何 libwebkit2gtk 运行时库"
fi
echo ""

# ── 5. Tauri 的 WebKitGTK 具体版本要求 ─────────────────────────────────────
echo "${CYAN}【5】Tauri 2 的版本要求${NC}"
echo "----------------------------------------"
echo "  Tauri 2 (wry/webkit2gtk) 需要: ${CYAN}webkit2gtk-4.1${NC}"
echo "  较老的 Tauri 1.x 需要:          webkit2gtk-4.0"
if [ -n "$(echo "$LIB_FOUND" | grep '4\.1')" ]; then
  ok "运行时库满足 4.1 要求 —— 本项目可以启动"
elif [ -n "$(echo "$LIB_FOUND" | grep '4\.0')" ]; then
  warn "只有 4.0 运行时库 —— Tauri 2 应用**无法启动**"
  echo "      （Tauri 2 已放弃 4.0 支持，这是硬性要求）"
else
  bad "没有任何 webkit2gtk 运行时库 —— 应用必然无法启动"
fi
echo ""

# ── 6. 其余运行时依赖 ──────────────────────────────────────────────────────
echo "${CYAN}【6】其余运行时依赖${NC}"
echo "----------------------------------------"
check_so() {
  if ldconfig -p 2>/dev/null | grep -q "$1"; then ok "$1"; else bad "$1"; fi
}
check_so "libgtk-3.so.0"
check_so "libayatana-appindicator3.so.1"
check_so "libayatana-appindicator3.so.0"
check_so "librsvg-2.so.2"
check_so "libwebkit2gtk-4.1.so.0"
echo ""

# ── 7. 中文字体 ────────────────────────────────────────────────────────────
echo "${CYAN}【7】中文字体${NC}"
echo "----------------------------------------"
CJK_COUNT="$(fc-list :lang=zh 2>/dev/null | wc -l)"
if [ "$CJK_COUNT" -gt 0 ]; then
  ok "已装中文字体（$CJK_COUNT 条）"
  fc-list :lang=zh 2>/dev/null | head -3 | sed 's/^/      /'
else
  warn "无中文字体 —— 界面中文会显示成方块"
  echo "      安装：sudo apt install fonts-noto-cjk"
fi
echo ""

# ── 8. 结论 ────────────────────────────────────────────────────────────────
echo "============================================================"
echo " 诊断结论"
echo "============================================================"
if [ -n "$(echo "$LIB_FOUND" | grep '4\.1')" ]; then
  echo "${GREEN}✅ 本机具备运行条件${NC}"
  echo "可以直接安装：sudo apt install ./KnowledgeBase_1.65.0_arm64.deb"
elif [ -n "$(echo "$LIB_FOUND" | grep '4\.0')" ]; then
  echo "${RED}❌ 缺 webkit2gtk-4.1 运行时库${NC}"
  echo ""
  echo "原因：Tauri 2 硬依赖 webkit2gtk-4.1，麒麟系统里只有 4.0。"
  echo ""
  echo "可选路径："
  echo "  1) 升级系统到 V10 SP3（最推荐，基线更新，自带 4.1 概率高）"
  echo "  2) 从麒麟开发者社区获取 webkit2gtk-4.1 的 ${ARCH_NAME:-aarch64} 包"
  echo "     参考：https://mirrors.aliyun.com/kylin/"
  echo "  3) 若单位有内网 apt 源，请管理员加入 4.1 的包"
  echo ""
  echo "下一步请把本报告发给 IT 部门，确认能否取得 webkit2gtk-4.1。"
else
  echo "${RED}❌ 未安装任何 webkit2gtk${NC}"
  echo "系统连基础 WebView 都没有，需先安装。"
fi
echo "============================================================"
echo ""