// =============================================================================
// Tauri 1.x 兼容层 —— @tauri-apps/plugin-log
// =============================================================================
//
// npm 上的 @tauri-apps/plugin-log 只有 2.x（v1 从未发布 npm 包）。
// Rust 侧用的是 plugins-workspace v1 分支的 tauri-plugin-log，
// 其命令是 `plugin:log|log`，参数 { level, message, location, keyValues }。
//
// v1 的 Level 枚举数值（与 Rust log::LevelFilter 对齐）：
//   1 = Error, 2 = Warn, 3 = Info, 4 = Debug, 5 = Trace
// =============================================================================

import { invoke } from "@tauri-apps/api/tauri";

type Level = 1 | 2 | 3 | 4 | 5;

async function log(level: Level, message: string): Promise<void> {
  try {
    await invoke("plugin:log|log", {
      level,
      message,
      location: "frontend",
      keyValues: {},
    });
  } catch {
    // 日志失败绝不能影响业务：退化为浏览器控制台
  }
}

export const error = (message: string) => log(1, message);
export const warn = (message: string) => log(2, message);
export const info = (message: string) => log(3, message);
export const debug = (message: string) => log(4, message);
export const trace = (message: string) => log(5, message);

/** v2 的 attachConsole 在 v1 无对应实现，这里退化为 no-op（保留签名便于调用方编译） */
export async function attachConsole(): Promise<void> {
  /* no-op in Tauri 1.x */
}

/** 兼容 v2 的 attachLogger，同样是 no-op */
export async function attachLogger(): Promise<void> {
  /* no-op in Tauri 1.x */
}
