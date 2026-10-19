// =============================================================================
// Tauri 1.x 兼容层（窗口 API）
// =============================================================================
//
// 为什么需要这个文件：
//   项目原用 Tauri 2.x，前端按 v2 的命名导入窗口 API。Tauri 1.x 的
//   '@tauri-apps/api/window' 导出的是**另一套名字**，且 v2 新增的
//   '@tauri-apps/api/webviewWindow' 与 '@tauri-apps/api/dpi' 两个模块在 v1 里
//   **根本不存在**（v1 把 WebviewWindow / PhysicalSize / currentMonitor 等全部
//   平铺在 window 模块下）。
//
//   直接改 13 个调用点可行，但会把 v1 的名字散进业务代码，将来回切 v2
//   又要再改一遍。这里做一层薄 shim，业务代码只依赖本文件。
//
// v2 → v1 映射表（已核对 node_modules/@tauri-apps/api@1.6.0/window.d.ts）：
//
//   getCurrentWindow()          → getCurrent()              [13 处]
//   getCurrentWebviewWindow()   → getCurrent()              [ 1 处]
//   type Window                 → WebviewWindow             [ 2 处]
//   WebviewWindow (webviewWindow 模块) → WebviewWindow (window 模块)  [ 2 处]
//   PhysicalSize (dpi 模块)     → PhysicalSize (window 模块) [ 1 处]
//
// 两个**不需要改**的项（曾误判，实测后更正，保留记录避免后人重复排查）：
//   - WebviewWindow.getByLabel()：v1 有，但签名是**同步**返回
//     `WebviewWindow | null`（v2 是 Promise）。调用点写了 await，
//     await 一个非 Promise 值在 JS/TS 里完全合法且解包结果一致，故无需改动。
//   - setSize()：v1 签名 `setSize(LogicalSize | PhysicalSize)`，
//     与 v2 一致，push-popup 传 PhysicalSize 的用法原样可用。
// =============================================================================

import {
  getCurrent,
  getAll,
  appWindow,
  WebviewWindow,
  WebviewWindowHandle,
  WindowManager,
  CloseRequestedEvent,
  currentMonitor,
  primaryMonitor,
  availableMonitors,
  LogicalSize,
  PhysicalSize,
  LogicalPosition,
  PhysicalPosition,
  UserAttentionType,
} from "@tauri-apps/api/window";

/** v2: getCurrentWindow() —— v1: getCurrent() */
export const getCurrentWindow = getCurrent;

/** v2: getCurrentWebviewWindow() —— v1: getCurrent() */
export const getCurrentWebviewWindow = getCurrent;

export {
  getAll,
  appWindow,
  WebviewWindow,
  WebviewWindowHandle,
  WindowManager,
  CloseRequestedEvent,
  currentMonitor,
  primaryMonitor,
  availableMonitors,
  LogicalSize,
  PhysicalSize,
  LogicalPosition,
  PhysicalPosition,
  UserAttentionType,
};

export type {
  Theme,
  TitleBarStyle,
  Monitor,
  ScaleFactorChanged,
  FileDropEvent,
  WindowOptions,
  WindowLabel,
  CursorIcon,
} from "@tauri-apps/api/window";

/** v2 的 `Window` 类型 —— v1 对应 `WebviewWindow` */
export type Window = WebviewWindow;
