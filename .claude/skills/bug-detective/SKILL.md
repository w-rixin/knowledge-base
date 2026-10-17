---
name: bug-detective
description: |
  排查已发生的问题、定位 Bug 原因。

  触发场景：
  - 代码运行报错，需要定位原因
  - 功能不正常，需要排查
  - Tauri Command 返回错误，需要分析
  - 日志分析、调试代码

  触发词：Bug、报错、不工作、调试、排查、为什么、出问题、失败、不生效、无效、找不到原因、定位问题
---

# Bug 排查指南

## 排查方法论

### 1. 复现问题
- 确认问题的具体表现
- 收集错误信息（终端日志、浏览器控制台、Rust panic 信息）
- 确认问题的触发条件
- 确认问题出现在哪个平台（Windows/macOS/Linux）

### 2. 缩小范围
- 前端 (React) or 后端 (Rust)？
- IPC 通信层的问题？
- 权限 (Capabilities) 不足？
- 哪个 Command/组件？
- 什么时候开始出现？

### 3. 定位根因
- 阅读相关 Rust/TypeScript 代码
- 检查终端日志（Rust println!/log）
- 检查浏览器 DevTools 控制台
- 添加 `dbg!()` 宏（Rust）或 `console.log`（TS）
- 对比正常 vs 异常的数据

### 4. 验证修复
- 修复后验证问题已解决
- 在所有目标平台上测试
- 确认没有引入新问题

---

## 常见问题分类

### Rust 后端常见问题

| 症状 | 可能原因 | 排查方法 |
|------|---------|---------|
| Command 调用无响应 | 函数名未在 `generate_handler!` 注册 | 检查 `lib.rs` 的 handler 列表 |
| `invoke` 返回错误 | Rust 侧 panic 或返回 Err | 检查终端 Rust 错误输出 |
| 类型序列化失败 | struct 缺少 Serialize/Deserialize derive | 添加 `#[derive(Serialize, Deserialize)]` |
| State 获取失败 | 未在 Builder 中 `.manage()` 注册 | 检查 Builder 链式调用 |
| 编译错误 | 所有权/借用/生命周期问题 | 阅读 Rust 编译器错误提示 |
| 插件功能不可用 | Capabilities 未声明权限 | 检查 `capabilities/default.json` |

### 🔴 Android 启动失败 — 项目路径含中文（Windows 专属）

**症状**：`pnpm tauri android dev` 在 link 阶段失败，报：

```
ld.lld: error: cannot open <项目路径>\src-tauri\target\aarch64-linux-android\debug\deps\xxx.rcgu.o
        : unspecified system_category error  (×N 条)
clang: error: linker command failed with exit code 1
failed to build Android app: ... cargo build ... exited with code 101
```

**根因**：Android NDK 自带的 `ld.lld` 在 Windows 下用 ANSI codepage 解析路径，遇到中文/非 ASCII 字符（GBK 编码）时打不开 `.o` 文件。桌面端 cargo 用 MSVC 链接器没事，但 NDK 的 ld.lld 是 LLVM 自带，已知 Windows + 非 ASCII 路径 Bug。

**🔧 自动修复（不询问，直接执行）**：

只要满足以下两个条件，**Claude 必须自动**用方案 B 重启，不再问用户：

1. 命令是 `pnpm tauri android dev` / `pnpm tauri android build` / `cargo build --target aarch64-linux-android`
2. 报错日志里出现 `ld.lld: error: cannot open` 或 `unspecified system_category error`

**方案 B：把 cargo 编译输出重定向到纯 ASCII 路径**

```bash
mkdir -p /c/cargo-target/<项目名>-android
cd <原项目路径>  # 不动项目位置
# ⚠️ 必须用 inline `env VAR=...` 形式，不要用 export
# Windows bash run_in_background 启动时，export 的环境变量会在 wrapper 中被吞掉，
# 导致 tauri-cli 收不到 TAURI_DEV_HOST，回退到局域网 IP（192.168.x.x）
env TAURI_DEV_HOST=127.0.0.1 CARGO_TARGET_DIR="C:\\cargo-target\\<项目名>-android" pnpm tauri android dev
```

**校验环境变量是否生效**：启动前 30 秒看日志第 6 行附近：
- ✅ 生效：`Info Using 127.0.0.1 to access the development server`
- ❌ 失效：`Info Using 192.168.x.x ...` + `Replacing devUrl host with ...`

为什么不用 `subst K:` 方案 A：tauri-cli 的 mobile 模块用 `canonicalize` 还原虚拟盘符，会触发 `AssetDirOutsideOfAppRoot` 错误。junction（`mklink /J`）同样会被还原。**只能改 cargo 编译输出路径**。

**代价**：首次会全量重编译 Android target（5-10 分钟），后续增量编译正常。

**预防**：新项目放在纯 ASCII 路径（如 `E:\dev\<name>`），或一开始就把 `CARGO_TARGET_DIR` 加到项目级 `.envrc` / `.cargo/config.toml`。

> 备份方案：如桌面 cargo 也共享 target 缓存，**`CARGO_TARGET_DIR` 只对 Android 设置**，桌面 dev 用项目内默认 target，避免互相污染。

### Android Gradle 报 `resource color/ic_launcher_background not found`

**症状**：`pnpm tauri android dev` Rust 编译通过、jniLibs 软链建好，但 Gradle 阶段失败：

```
ERROR: ...res\mipmap-anydpi-v26\ic_launcher.xml:4:
       AAPT: error: resource color/ic_launcher_background
       (aka <id>:color/ic_launcher_background) not found.
Execution failed for task ':app:processArm64DebugResources'.
```

**根因**：把 `src-tauri/icons/android/mipmap-anydpi-v26/ic_launcher.xml` 拷到 `gen/android/.../res/mipmap-anydpi-v26/` 时，没把对应的 `values/ic_launcher_background.xml`（color 定义）一起拷过去。Adaptive Icon 引用 `@color/ic_launcher_background`，找不到就构建失败。

**🔧 修复**：从 PC 源拷 color 资源到 gen 目录：

```bash
cp src-tauri/icons/android/values/ic_launcher_background.xml \
   src-tauri/gen/android/app/src/main/res/values/
```

或手动新建 `gen/android/app/src/main/res/values/ic_launcher_background.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#fff</color>
</resources>
```

**预防**：以后同步 Android 图标资源，**整个 `src-tauri/icons/android/` 目录**全量拷到 `gen/android/.../res/`（包括 `values/` 子目录），不要只拷 mipmap-*。

### Android dev 中途崩 — vite 进程被外部 kill

**症状**：cargo 还在编译时日志突然出现：

```
ELIFECYCLE  Command failed with exit code 1.
Error The "beforeDevCommand" terminated with a non-zero status code.
```

但其它日志没有显式错误，cargo 也没编译失败。

**根因**：`pnpm dev:clean` 启动的 vite (PID X) 在端口 1421 监听后被外部信号终止 — 通常是另一个 dev 会话的 `kill-port 1421` 抢了，或者上一次失败任务的孤儿 vite 进程占着端口、新任务 kill 后接管时序混乱。

**🔧 自动修复**：

1. 用 `npx kill-port 1420 1421 1422`（**禁止 `taskkill /IM node.exe`** — 会把 Claude Code CLI 自己也杀掉）
2. 检查 `netstat -ano | grep ":142[01]"`，仅剩 `TIME_WAIT` 算干净（无 `LISTENING`）
3. 重启 dev

### React 前端常见问题

| 症状 | 可能原因 | 排查方法 |
|------|---------|---------|
| 页面空白 | JS 错误 | 打开 DevTools 控制台 (F12) |
| invoke 调用报错 | Command 名称拼写错误 | 确认 snake_case 函数名 |
| 状态不更新 | useState 闭包陷阱 | 使用函数式更新 `setState(prev => ...)` |
| 事件监听不生效 | 未清理旧监听器 | 在 useEffect 中返回 unlisten |
| 样式不生效 | CSS 冲突或选择器错误 | 使用 DevTools Elements 面板 |
| 页内拖拽光标显示 🚫、onDrop 不触发（antd Tree/react-dnd 等） | Tauri 窗口 `dragDropEnabled` 默认 true，WebView 吞掉 HTML5 dragover/drop | `tauri.conf.json` 窗口配置加 `"dragDropEnabled": false`，重启 dev |
| 右键菜单 Dropdown（`trigger={['contextMenu']}`）包裹节点后 antd Tree 拖不动 | rc-trigger ref 转发 + mousedown 拦截破坏原生 drag 绑定 | 改用 Tree 级 `onRightClick` + 全局定位 Dropdown（幻影锚点） |

### IPC 通信常见问题

| 症状 | 可能原因 | 排查方法 |
|------|---------|---------|
| invoke 超时 | Rust 侧阻塞主线程 | 改用 async Command |
| 参数传递失败 | 参数类型不匹配 (camelCase vs snake_case) | 检查前后端参数名映射 |
| 返回值为空 | Rust 函数签名返回 `()` | 确认返回 `Result<T, String>` |

---

## 调试工具

### Rust 调试
```rust
// println! 输出到终端
println!("Debug: {:?}", variable);

// dbg! 宏（输出文件名/行号/值）
dbg!(&my_variable);

// 使用 log crate
log::info!("Processing: {}", data);
log::error!("Failed: {}", err);
```

### TypeScript 调试
```typescript
// 浏览器控制台
console.log("invoke result:", result);
console.error("invoke failed:", error);

// 检查 invoke 调用
try {
  const result = await invoke("my_command", { arg1 });
  console.log("Success:", result);
} catch (e) {
  console.error("Failed:", e);
}
```

### DevTools 开启
```
// 开发模式自动开启 DevTools
// 生产模式可通过配置开启:
// tauri.conf.json → app.windows[0].devtools = true
```

---

## 常见错误

| 错误做法 | 正确做法 |
|---------|---------|
| 不看 Rust 编译器错误提示 | Rust 编译器提示非常详细，先仔细阅读 |
| 不区分前端/后端/IPC 问题 | 先确定问题在哪个层，再深入排查 |
| 不检查 Capabilities | 插件功能不可用时首先检查权限声明 |
| 只在一个平台测试 | 跨平台问题需在所有目标平台验证 |
