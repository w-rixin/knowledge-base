#!/usr/bin/env bash
# 一键生成诊断报告并保存 —— 跑完把生成的文件发我即可
#
# 用法：在麒麟机上执行
#   bash kylin-report.sh
#
# 会在当前目录生成 kylin-report.txt，直接把这个 txt 发过来就行。

OUT="kylin-report.txt"

{
echo "============================================================"
echo " 麒麟环境诊断报告"
echo " 生成时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo " 主机名:   $(hostname)"
echo "============================================================"
echo ""

echo "===== 1. 系统信息 ====="
if [ -f /etc/os-release ]; then
  grep -E "^(NAME|VERSION|VERSION_ID|VERSION_CODENAME|PRETTY_NAME|ID)=" /etc/os-release 2>/dev/null
fi
echo "内核: $(uname -r)"
echo "架构: $(uname -m)"
if [ -f /etc/kylin-build ]; then echo "麒麟构建号: $(cat /etc/kylin-build)"; fi
if [ -f /etc/.kyinfo ]; then echo "kyinfo:"; cat /etc/.kyinfo 2>/dev/null; fi
if [ -f /etc/kylin-release ]; then echo "kylin-release:"; cat /etc/kylin-release 2>/dev/null; fi
echo "glibc: $(ldd --version 2>/dev/null | head -1)"
echo ""

echo "===== 2. 架构确认 ====="
if command -v dpkg >/dev/null 2>&1; then
  echo "包管理器: dpkg (Debian 系)"
  echo "架构名:$(dpkg --print-architecture 2>/dev/null)"
elif command -v rpm >/dev/null 2>&1; then
  echo "包管理器: rpm (RHEL 系)"
  echo "架构名: $(rpm -eval '%{_arch}' 2>/dev/null)"
fi
echo ""

echo "===== 3. 已安装的 webkit 相关包 ====="
dpkg -l 2>/dev/null | grep -i webkit || echo "(dpkg 未列出任何 webkit 包)"
echo ""

echo "===== 4. 【最关键】webkit 运行时库 ====="
echo "--- ldconfig 缓存中查找 ---"
ldconfig -p 2>/dev/null | grep -i webkit || echo "(未在ldconfig 缓存中找到任何 webkit 库)"
echo ""
echo "--- 在文件系统查找 .so 文件 ---"
for d in /usr/lib /usr/lib64 /usr/lib/aarch64-linux-gnu /usr/lib/arm-linux-gnueabihf /lib /lib64 /usr/local/lib; do
  if [ -d "$d" ]; then
    find "$d" -maxdepth 2 -name "libwebkit2gtk*" 2>/dev/null | head -20
  fi
done | sort -u
echo ""

echo "===== 5. apt 能否装到 webkit2gtk-4.1（不实际安装，仅查询）====="
if command -v apt-cache >/dev/null 2>&1; then
  echo "--- apt-cache policy libwebkit2gtk-4.1-0 ---"
  apt-cache policy libwebkit2gtk-4.1-0 2>&1
  echo ""
  echo "--- 搜索源里所有 webkit2gtk 包 ---"
  apt-cache search webkit2gtk 2>&1 | head -20
  echo ""
  echo "--- apt-cache search webkitgtk 4.x ---"
  apt-cache search --names-only 'webkit2gtk-4' 2>&1 | head -10
else
  echo "(无 apt-cache)"
fi
echo ""

echo "===== 6. apt 软件源 ====="
grep -rhE "^deb " /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null | head -20
echo ""

echo "===== 7. 其余运行时依赖检查 ====="
for so in libgtk-3.so.0 libayatana-appindicator3.so.1 libayatana-appindicator3.so.0 \
          librsvg-2.so.2 libwebkit2gtk-4.1.so.0 libwebkit2gtk-4.0.so.37 libX11.so.6; do
  if ldconfig -p 2>/dev/null | grep -q "$so"; then
    echo "[有] $so"
  else
    echo "[无] $so"
  fi
done
echo ""

echo "===== 8. 中文字体 ====="
CJK=$(fc-list :lang=zh 2>/dev/null | wc -l)
echo "中文字体条数: $CJK"
if [ "$CJK" -gt 0 ]; then
  fc-list :lang=zh 2>/dev/null | head -5
else
  echo "(无中文字体，界面中文会显示为方块)"
fi
echo ""

echo "===== 9. 磁盘空间（安装需约 100MB 依赖 + 80MB 应用）====="
df -h /usr /home 2>/dev/null | head -5
echo ""

echo "===== 10. kysec 安全模块状态 ====="
if [ -f /etc/kysec.conf ] || command -v kysecctl >/dev/null 2>&1; then
  echo "kysec: 已启用（可能拦截第三方应用安装）"
  command -v kysecctl >/dev/null 2>&1 && kysecctl --status 2>&1 | head -5
else
  echo "kysec: 未检测到"
fi
echo ""

echo "============================================================"
echo " 报告结束"
echo "============================================================"
} > "$OUT" 2>&1

echo ""
echo "报告已生成: $OUT"
echo ""
echo "请把这个文件发给我："
echo "  1. 内容全选复制粘贴，或"
echo "  2. 直接把 $OUT 文件拖到聊天窗口"
echo ""