# 麒麟 aarch64 离线部署手册

面向 **完全无外网** 的银河麒麟桌面版 V10（aarch64，飞腾 / 鲲鹏）。

> 本文是 `kylin-aarch64-build.md` 的**部署篇**。构建方案见那篇，本文只讲离线机怎么装。

---

## 核心认知：离线不影响构建

**构建不需要在麒麟机上做。** 上游 CI 已加 `ubuntu-24.04-arm` 原生 ARM runner 矩阵，
云端产出 `_arm64.deb`，你下载后用 U 盘摆渡到麒麟机即可。

这带来三个好处：

| 好处 | 说明 |
|---|---|
| 不装 Rust 工具链 | 麒麟机无需 rustup / node / pnpm，省几十 GB 磁盘 |
| 避开 glibc 冲突 | 云端 Ubuntu 24.04（glibc 2.39）产出的包向下兼容麒麟 |
| 避开 webkit 编译坑 | 构建期的 webkit2gtk-4.1-dev  headache 全在云端解决 |

离线机只做三件事：**准备依赖 → 装包 → 验证**。

---

## 一、准备阶段（必须在联网机上完成）

### 1.1 触发云端构建

推 tag 即可（Windows 联网机操作）：

```bash
git tag v1.65.0-kylin
git push origin v1.65.0-kylin
```

`ubuntu-24.04-arm` 矩阵会自动跑，产物进 GitHub Release（草稿）。

> 私有仓库的 ARM runner 消耗 Actions 额度。ARM runner 排队通常比 x64 久，
> 若只在需要时构建，可设仓库变量 `RELEASE_KYLIN_ARM=skip` 关掉。

### 1.2 下载产物

从 GitHub Release 下载（草稿需先在 GitHub 点 publish，或用 `gh release download`）：

- `KnowledgeBase_1.65.0_amd64.deb` ← 注意核对架构后缀
- 视需要：`*.AppImage`、`libpdfium.so`、`RapidOCR-json`

> **架构核对**：麒麟机是 aarch64，deb 文件名后缀应为 `_arm64.deb` 或 `_aarch64.deb`。
> 若是 `_amd64.deb`，说明拿到的是 x86_64 产物，装不上。

### 1.3 收集离线依赖（最关键一步）

**这是离线部署的核心难点**：我们的 deb 依赖 `libwebkit2gtk-4.1-0` 等 6 个包，
离线机没法自动下载，必须提前打包带走。

#### 方式 A：找一台同版本联网麒麟机（推荐、最可靠）

必须与离线机 **`lsb_release -a` 完全一致**（同 SP 版本、同架构）。在联网机上：

```bash
# 确认环境一致
lsb_release -a
uname -m                      # 必须都是 aarch64

# 下载主包及其完整依赖树
sudo apt-get clean
mkdir -p ~/kb-offline-repo
cd ~/kb-offline-repo
sudo apt-get install --download-only \
  libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 \
  librsvg2-2 fonts-noto-cjk libc6 \
  ./KnowledgeBase_1.65.0_arm64.deb

# 连带缓存目录一起拷走（更稳）
cp /var/cache/apt/archives/*.deb ~/kb-offline-repo/ 2>/dev/null
```

#### 方式 B：apt-offline 精准签名（无同版本麒麟机时）

在**离线机**上生成签名 → 联网机下载 → 拷回离线机：

```bash
# 【离线机】装 apt-offline（需先有安装包，或从 U 盘拷入）
sudo apt-get install --download-only -o Dir::Cache::archives=/tmp \
  libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 \
  librsvg2-2 fonts-noto-cjk libc6
sudo apt-offline set /tmp/kb.sig --update --upgrade --install-packages \
  libwebkit2gtk-4.1-0,libgtk-3-0,libayatana-appindicator3-1,librsvg2-2,fonts-noto-cjk,libc6

# 【联网机】按签名下载
sudo apt-get install apt-offline
sudo apt-offline get /tmp/kb.sig --bundle /tmp/kb-bundle.zip

# 【拷回离线机】
sudo apt-offline install /tmp/kb-bundle.zip
sudo apt-get install -f
```

> **注意**：方式 B 要求联网机也是麒麟同版本且架构一致，否则包版本对不上。
> 若无法满足，用方式 C。

#### 方式 C：从 ISO 或麒麟官方镜像站取包

麒麟官方镜像（需与离线机同 SP 版本）：

- `https://mirrors.aliyun.com/kylin/V10-SP1/aarch64/`
- `http://archive.kylinos.cn/kylin/kylinsourcev10/`

按 1.2 节列出的包名逐个下载，连同依赖一起带走。

---

## 二、传输到离线机

用 U 盘 / 光盘 / 内网摆渡，把以下内容拷到离线机同一目录（如 `~/kb-offline/`）：

```
kb-offline/
├── KnowledgeBase_1.65.0_arm64.deb     ← 主包
├── libwebkit2gtk-4.1-0_*.aarch64.deb  ← 依赖（方式 A/B 产物）
├── libgtk-3-0_*.aarch64.deb
├── libayatana-appindicator3-1_*.deb
├── librsvg2-2_*.aarch64.deb
├── fonts-noto-cjk_*.deb
└── libc6_*.aarch64.deb
```

---

## 三、离线机安装

### 3.1 配置本地离线源（推荐，避免 dpkg 依赖地狱）

```bash
cd ~/kb-offline
sudo apt-get install dpkg-dev        # 若本机已有则跳过
dpkg-scanpackages . /dev/null | gzip > Packages.gz
sudo mkdir -p /var/local/kb-repo
sudo cp *.deb Packages.gz /var/local/kb-repo/
echo 'deb [trusted=yes] file:///var/local/kb-repo ./' | \
  sudo tee /etc/apt/sources.list.d/kb-offline.list
sudo apt-get update
```

用本地源安装的好处：依赖关系进 apt 数据库，后续卸载升级都正常。

### 3.2 安装

```bash
sudo apt-get install -f              # 先把离线依赖装齐
sudo apt install ./KnowledgeBase_1.65.0_arm64.deb
```

若不做本地源，退化为：

```bash
sudo dpkg -i *.deb
sudo apt-get install -f              # 修复依赖（依赖已离线备齐，不会联网）
```

### 3.3 处理 kysec 安全模块

麒麟默认启用 kysec，会拦截非商店来源安装：

- 若双击 deb 被拒 → 「设置 → 安全 → 应用安装」放开非商店来源
- 调试期可临时 `sudo kysecctl --disable`，**生产环境不要关闭**
- 若启动被拦（kysec 日志 `/var/log/kysec*`），需 IT 放行应用签名

---

## 四、验证清单（全程无需网络）

```bash
# 依赖
pkg-config --modversion webkit2gtk-4.1
fc-list :lang=zh | head                # 中文字体非空，否则界面豆腐块

# 安装状态
dpkg -l | grep -i knowledgebase       # 应显示 ii

# 启动
KnowledgeBase
```

功能项：

| 项 | 判定标准 | 离线可测 |
|---|---|---|
| 应用启动 | 窗口正常打开，无闪退 | ✅ |
| 中文字体 | 界面无方块 | ✅ |
| 系统托盘 | 右下角出现图标 | ✅ |
| 全文搜索 / 双向链接 / 图谱 | 正常（bundled SQLite） | ✅ |
| PDF 导入（文本层） | 正常（pdf-extract 主路径） | ✅ |
| PDF 导入（扫描件） | 需 `libpdfium.so`，否则提示先 OCR | ✅ |
| OCR 识别 | 需 Linux 版 `RapidOCR-json`，否则显示「引擎未安装」 | ✅ |
| Word 导出 / Excel 解析 | 正常（纯 Rust 实现） | ✅ |
| MCP sidecar（AI 问答） | 需联网访问模型服务 | ❌ |
| **自动更新** | **不可用，见下节** | ❌ |

排查入口：`~/.local/share/com.agilefr.kb/logs/` 与 `<数据目录>/crash/crash-YYYYMMDD.log`

---

## 五、⚠️ 离线环境的两个已知限制

### 5.1 自动更新不可用

**Tauri 的 updater 在 Linux 上只支持 AppImage，不支持 deb**（官方限制：
updater 产物在 Linux 上从 AppImage 生成 `.AppImage.tar.gz` + `.sig`）。

因此麒麟机装 deb 后，**应用内「检查更新」不会有新版本提示**。这是预期行为，不是配置错误。

应对：
- 升级走**人工摆渡**：新版本构建后重新走第三节流程 `apt install ./新版本.deb`（apt 会自动升级同包）
- 若确实需要自动更新，得改用 AppImage 方案，但 **AppImage 在麒麟上有 kysec/FUSE 拦截风险**，
  且麒麟多为 deb 生态，**建议接受人工升级**

### 5.2 AI 功能需单独开通网络策略

MCP sidecar、知识图谱 AI 问答、网页剪藏都需要访问模型服务与外网。
若麒麟机确实全封闭，这些功能不可用，其余本地功能（笔记 / 搜索 / 图谱 / 导出）**完全不受影响**。

本项目核心是**本地知识库**，网络只用于可选的 AI 增值功能，因此离线可用性良好。

---

## 六、后续版本升级流程

```
联网 Windows 机：git tag v1.66.0-kylin && git push
        ↓
GitHub Actions 自动构建 arm64 deb
        ↓
下载产物 + 更新离线依赖包
        ↓
U 盘摆渡到麒麟机
        ↓
sudo apt install ./KnowledgeBase_1.66.0_arm64.deb    # apt 自动升级同包
```

依赖包只在**首次**需要完整收集；后续升级若未引入新依赖，只需带主包。