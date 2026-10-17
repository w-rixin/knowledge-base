# 麒麟系统（aarch64）移植构建方案

面向 **银河麒麟桌面版 V10（Debian 基，.deb）**、**aarch64 架构**（飞腾 D2000 / 鲲鹏 920 等）。

本项目的 Rust 代码层**已为跨平台而写**，无需改动业务逻辑。本文覆盖真正需要动手的部分：
目标机环境、二进制资源重建、打包发布。

> **本文面向「有联网构建机」的场景。**
> 若目标麒麟机**完全无外网**（内网/涉密环境），请直接看
> **[`kylin-aarch64-offline-deploy.md`](./kylin-aarch64-offline-deploy.md)**——
> 构建改由云端 ARM runner 完成，离线机只做安装，本文第四、五章的本地构建步骤不适用。

---

## 一、结论速览

| 层级 | 改造量 | 说明 |
|---|---|---|
| Rust 代码 | **≈ 0** | 平台分支已完备，见 `src-tauri/Cargo.toml` 桌面依赖分组 |
| 打包配置 | **小** | 已新增 `src-tauri/tauri.linux.conf.json` + CI 加 ARM 矩阵 |
| 二进制资源 | **大** | pdfium / OCR 引擎均为 Windows 原件，需重建 |
| 目标机环境 | **中** | webkit2gtk-4.1 与 glibc 是主要约束 |

代码层无需改动的依据：

- `Cargo.toml:119` 桌面依赖已用 `cfg(any(windows, macos, linux))` 分组
- `Cargo.toml:49` reqwest 用 `rustls-tls` —— **不依赖 OpenSSL**，规避麒麟最大的坑
- `Cargo.toml:43` rusqlite `bundled` —— 静态编译，不吃系统 SQLite
- `lib.rs:930` 已写好 `#[cfg(target_os = "linux")] libpdfium.so` 路径
- `ocr.rs:58` 已写好 `#[cfg(unix)]` 自动补可执行位
- `converter.rs:160` 非 Windows 分支走 `soffice`（LibreOffice）
- `capabilities/default.json` 的 `platforms` 已含 `linux`

### 构建方式选择

| 场景 | 推荐方式 | 详见 |
|---|---|---|
| 麒麟机**能联网** | 本地或云端构建均可 | 本文第四章 |
| 麒麟机**完全离线** | 云端 `ubuntu-24.04-arm` runner | `kylin-aarch64-offline-deploy.md` |

GitHub 已提供 **arm64 原生 hosted runner**（`ubuntu-24.04-arm`，Cobalt 100 处理器），
公开仓库免费、私有仓库 2026 年 1 月起也支持（消耗额度）。
因此**无需自备麒麟构建机**，也无需求交叉编译链。

---

## 二、目标机环境准备

### 2.1 webkit2gtk-4.1（Tauri 2 的硬依赖，最高优先级）

Tauri 2 要求 `libwebkit2gtk-4.1`。**麒麟 V10 SP1/SP2 官方源只有 4.0**，需要额外处理。

先在目标机确认：

```bash
dpkg -l | grep webkit2gtk
# 或
pkg-config --modversion webkit2gtk-4.1
```

若报缺失，按以下顺序处理：

1. **优先升级到 V10 SP3** —— SP3 基线 glibc 与 webkit2gtk 较新，是最省事的路。
2. 从麒麟开发者社区获取 `webkit2gtk-4.1` 的 aarch64 deb 包，离线安装：

```bash
sudo dpkg -i libwebkit2gtk-4.1-0_*.aarch64.deb
sudo apt-get install -f     # 修复依赖残留
```

验证：

```bash
pkg-config --modversion webkit2gtk-4.1   # 应输出 2.4x.x
```

> 注意：webkit2gtk-4.1 对 glibc 有最低要求。若安装时提示 `GLIBC_2.3x not found`，
> 说明该机的 glibc 版本低于 2.1x 系列的构建基线，只能走「升级 SP」或「自建包」路线。

### 2.2 构建期依赖（在麒麟构建机上安装）

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  pkg-config build-essential curl wget file
```

### 2.3 运行时依赖（写进了 .deb 的 depends）

`tauri.linux.conf.json` 已声明：`libc6`、`libwebkit2gtk-4.1-0`、`libgtk-3-0`、
`libayatana-appindicator3-1`（托盘图标）、`librsvg2-2`、`fonts-noto-cjk`（中文字体）。

若麒麟源中 `libayatana-appindicator3-1` 缺失（老版本用 `libappindicator3-1`），
改用后者，否则 `apt install ./xxx.deb` 会因依赖无法解析而失败。

### 2.4 中文字体（麒麟常见「豆腐块」问题）

麒麟默认字体集不含完整中文字形，界面会出现方块。检查：

```bash
fc-list :lang=zh | head
```

若无输出，安装：

```bash
sudo apt install -y fonts-noto-cjk
fc-cache -fv
```

### 2.5 kysec 安全模块（麒麟特有）

麒麟默认启用 kysec，会拦截非商店来源的应用安装与部分可执行文件执行。

- 装 .deb 时若被系统拦截，需在「设置 → 安全 → 应用安装」放开非商店来源；
- 调试期可用 `sudo kysecctl --disable` 临时关闭，**生产环境不要关闭**。

---

## 三、二进制资源重建

`resources/` 下有三份资源，其中两份是 Windows 原件。**缺失时均优雅降级，不影响启动**。

### 3.1 降级行为对照（重要）

| 资源 | 缺失后果 | 是否阻塞 |
|---|---|---|
| `libpdfium.so` | PDF 导入退回 `pdf-extract` 主路径，失去扫描件兜底 | 否 |
| `RapidOCR-json`（Linux） | OCR 功能关闭，设置页显示「引擎未安装」 | 否 |
| ONNX 模型（`.onnx`） | 跨平台共用，已随仓库提交 | — |

所以**可以先出无 OCR 的可用版本**，再按需补 OCR。这是降低风险的关键策略。

### 3.2 PDFium（`libpdfium.so`）

PDFium 是 Chromium 的 PDF 引擎，C++ 实现，无官方预编译 Linux 包，需从源码交叉编译。

路线选择：

- **路线 A（在麒麟机原生编译，推荐）**：PDFium 有大量依赖（`ninja`、`gn`），交叉编译环境配置复杂，
  在麒麟 aarch64 机器上原生编译最省事。
- **路线 B（复用 x86_64 成果）**：从 Puppeteer / Chromium 的 Linux 包里取出 `libpdfium.so`，
  但需确认是 aarch64 架构，否则无法运行。

放置位置：`src-tauri/resources/pdfium/libpdfium.so`

主程序按 `lib.rs:931` 解析该路径，加载失败只 `log::warn`（`lib.rs:939`），不阻断启动。

### 3.3 OCR 引擎（`RapidOCR-json`，Linux aarch64）

RapidOCR-json 是自含 ONNXRuntime 的单可执行文件，三平台 stdin/stdout JSON 协议一致
（见 `resources/ocr/README.md`），所以主程序无需改动，只是换二进制。

获取方式：

1. 到 [RapidOCR-json Releases](https://github.com/RapidAI/RapidOCR-json) 下载 Linux 版。
   注意**官方多提供 x64**，aarch64 未必有现成包。
2. 若无 aarch64 包：源码构建（`pip install rapidocr-onnxruntime` + PyInstaller），
   目标平台为麒麟 aarch64 Python 环境。
3. 放置：`src-tauri/resources/ocr/RapidOCR-json`（**无扩展名**）

放置后无需改代码，`ocr.rs` 启动时会自动 `chmod +x`（`ocr.rs:58`），
并由 `tauri.conf.json` 的 `resources/ocr/RapidOCR-json*` glob 自动打进安装包。

`models/` 下的 ONNX 模型与字典是**平台无关**的，三平台共用同一份，已随仓库提交。

### 3.4 MCP sidecar（`kb-mcp`）

Tauri 的 `externalBin` 要求文件名带 target triple。构建脚本已支持 `--target`：

```bash
# 在麒麟 aarch64 机器上（host triple 即为 aarch64-unknown-linux-gnu）
pnpm build:mcp
# 产物自动复制为 src-tauri/binaries/kb-mcp-aarch64-unknown-linux-gnu

# 或显式指定 target
pnpm build:mcp -- --target aarch64-unknown-linux-gnu
```

若 `src-tauri/binaries/` 为空，`tauri build` 会因缺 sidecar 报错，必须先跑这一步。

---

## 四、构建

### 4.1 构建机选择：优先麒麟 aarch64 原生构建

**强烈不建议从 Windows 或 x86_64 Linux 交叉编译到 aarch64**：
glibc 版本与 webkit2gtk-4.1 的链接问题会反复阻塞，且这类问题在打包阶段才暴露，排查成本高。

推荐在目标麒麟机器（或麒麟官方 Docker 镜像）上原生构建，glibc 与 webkit 天然匹配。

### 4.2 构建步骤

```bash
# 1. 依赖
sudo apt update && sudo apt install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf pkg-config build-essential

# 2. 工具链
rustup target add aarch64-unknown-linux-gnu   # 仅交叉编译时需要
pnpm install

# 3. sidecar（必须先做，否则打包缺 externalBin）
pnpm build:mcp

# 4. 打包
pnpm tauri build
```

产物位置：`src-tauri/target/release/bundle/deb/`

### 4.3 云端构建（推荐，无需自备麒麟机）

GitHub 提供 **arm64 原生 runner**：`ubuntu-24.04-arm`（Cobalt 100 / Armv9-A）。
本项目 `.github/workflows/release.yml` 已加入该矩阵：

```yaml
LINUX_ARM='{"platform":"ubuntu-24.04-arm","args":"--bundles deb"}'
```

特点：

- **原生 aarch64，非 QEMU 模拟** → 无交叉编译的 glibc / pkg-config  headache
- 无需 `--target`，host triple 即 `aarch64-unknown-linux-gnu`，sidecar 与主程序自动对齐
- 公开仓库免费；私有仓库消耗 Actions 额度（ARM runner 排队通常更久）

触发方式与其它平台一致，推 tag 即可：

```bash
git tag v1.65.0-kylin
git push origin v1.65.0-kylin
```

产物进 GitHub Release（草稿）。

控制开关（仓库 Settings → Secrets and variables → Actions → Variables）：

| 变量 | 值 | 效果 |
|---|---|---|
| `RELEASE_KYLIN_ARM` | 未设 / 其它 | 含麒麟 aarch64 构建（默认） |
| `RELEASE_KYLIN_ARM` | `skip` | 不构建，省 ARM runner 额度 |

`release.yml` 中「Install Linux system dependencies」步骤的条件已从
`matrix.platform == 'ubuntu-22.04'` 放宽为 `startsWith(matrix.platform, 'ubuntu-')`，
使 ARM runner 也能装到 webkit2gtk-4.1-dev 等依赖。

### 4.4 安装

```bash
sudo apt install ./KnowledgeBase_1.65.0_arm64.deb
# 或
sudo dpkg -i KnowledgeBase_1.65.0_arm64.deb && sudo apt-get install -f
```

> aarch64 的 deb 文件名后缀是 `_arm64.deb` 或 `_aarch64.deb`（由 tauri-bundler 依目标三元组生成），
> 实际以后缀为准。拿到 `_amd64.deb` 说明是 x86_64 产物，装不上。

> 离线机安装请见 `kylin-aarch64-offline-deploy.md`（含依赖离线仓搭建）。

---

## 五、跨平台打包配置说明

本项目采用 **Tauri 平台专属配置文件** 方案，而非在 `tauri.conf.json` 的 `targets` 数组里堆多平台。

原因：`tauri-bundler` 对 `deb`/`rpm`/`dmg` 有 cfg 门控（跨平台时不产出），
但 **`nsis` 被刻意不 cfg 门控**（为了支持在 Linux/mac 上用 `cargo-xwin` 交叉打 Windows 包）。
若把 `["nsis", "deb"]` 写在同一数组里，在麒麟上执行 `tauri build` 会尝试交叉构建 Windows 安装包。

新增文件 `src-tauri/tauri.linux.conf.json`：

```json
{
  "bundle": {
    "targets": ["deb"],
    "linux": {
      "deb": {
        "section": "utility",
        "depends": ["libc6", "libwebkit2gtk-4.1-0", "libgtk-3-0",
                    "libayatana-appindicator3-1", "librsvg2-2", "fonts-noto-cjk"]
      }
    }
  }
}
```

合并语义为 RFC 7386 JSON Merge Patch：对象递归合并，数组整体替换。
因此该文件只需写要覆盖的键，`bundle.active`、`bundle.icon` 等仍继承 `tauri.conf.json`。

`depends` 是**追加**而非替换 tauri-bundler 自动计算的依赖，最终结果为上述列表的并集。

---

## 六、自动更新（updater）—— deb 方案的限制

**Tauri 的 updater 在 Linux 上只支持 AppImage，不支持 deb。**

官方行为：`bundle.createUpdaterArtifacts` 在 Linux 上从 **AppImage** 生成
`.AppImage.tar.gz` + `.AppImage.sig`（`v1Compatible` 模式下）。deb 不生成 updater 产物，
因此**麒麟机装 deb 后，应用内「检查更新」不会有新版本提示**。这是框架限制，非配置错误。

### 应对方案

**方案 1（推荐）：人工升级**

走标准 deb 升级链路，apt 会自动替换同包：

```bash
sudo apt install ./KnowledgeBase_1.66.0_arm64.deb   # 版本高于已装则自动升级
```

对内网/离线环境（本项目目标场景），人工摆渡本就不可避免，此方案无额外成本。

**方案 2：改用 AppImage 以启用自动更新**

需 `--bundles appimage`，产物自带更新能力。**但有两个坑**：

- **麒麟 kysec 会拦 AppImage 的 FUSE 挂载**，报
  `error while loading shared libraries: ... cannot open shared object file`，
  需 `kysecctl --disable` 或改设 `APPIMAGE_EXTRACT_AND_RUN=1`（绕过 FUSE 解压执行）
- 麒麟生态以 deb 为主，AppImage 分发体验差、桌面图标/文件关联需额外配置

**结论：麒麟场景建议用 deb + 人工升级。** 本项目核心功能全本地，
网络只用于可选的 AI 功能，自动更新的收益有限，不值得为它引入 AppImage 的 kysec 风险。

若将来确需自动更新，参考 Tauri 官方 updater 文档确认届时框架是否已支持 deb。

> 注意：`tauri.conf.json` 的 `plugins.updater` 配置与 `pubkey` **三平台共用，无需改动**。
> Windows / macOS 的自动更新不受此限制，正常工作。

---

## 七、验收清单

在目标麒麟 aarch64 机器上逐项确认：

```bash
# 依赖与版本
pkg-config --modversion webkit2gtk-4.1    # 应 ≥ 2.40
ldd --version | head -1
fc-list :lang=zh | head                    # 中文字体非空

# 安装与启动
sudo apt install ./KnowledgeBase_*.deb
KnowledgeBase                                # 应正常起窗口
```

功能项：

| 项 | 判定标准 |
|---|---|
| 应用启动 | 无闪退，日志无 panic |
| 窗口/最小化/最大化/拖拽 | 正常（`decorations: false` 的无边框窗口在 Linux 上行为一致） |
| 系统托盘 | 右下角出现图标（依赖 appindicator） |
| SQLite 全文搜索 / 双向链接 / 图谱 | 正常（bundled，无系统库依赖） |
| PDF 导入（有文本层） | 正常（走 pdf-extract 主路径） |
| PDF 导入（扫描件） | 装了 `libpdfium.so` 才正常，否则提示先 OCR |
| OCR 识别 | 装了 Linux 引擎才正常 |
| 文件导出 Word | 正常（docx-rs 纯 Rust） |
| Excel/ODS 解析 | 正常（calamine 纯 Rust） |
| 文档转换（LibreOffice） | 需目标机装 `libreoffice` |
| MCP sidecar（AI 问答） | 正常（`binaries/kb-mcp-aarch64-unknown-linux-gnu`） |
| 自动更新 | **deb 方案不可用**，见第六章 |

排查入口：`~/.local/share/com.agilefr.kb/logs/`（tauri-plugin-log）
与 `<数据目录>/crash/crash-YYYYMMDD.log`（崩溃报告）。

---

## 八、遗留风险

1. **webkit2gtk-4.1 无官方麒麟源** —— 依赖从麒麟开发者社区获取，属外部依赖，需先与 IT 部门确认可获得性。
2. **OCR 引擎 aarch64 包未必现成** —— 官方 Release 多为 x64，可能需自行 PyInstaller 打包。
3. **PDFium 需源码编译** —— C++ 项目，`gn`/`ninja` 工具链配置有一定成本。
4. **kysec 拦截** —— 若目标机的 kysec 策略严格，.deb 内的 sidecar 启动可能被拦，需 IT 放行。
5. **`fonts-noto-cjk` 包名** —— 部分麒麟版本包名不同，安装失败时按 `apt-cache search noto` 实查。