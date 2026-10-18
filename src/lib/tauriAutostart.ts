// =============================================================================
// Tauri 1.x 兼容层 —— @tauri-apps/plugin-autostart
// =============================================================================
//
// npm 上的 @tauri-apps/plugin-autostart 只有 2.x。
// Rust 侧用 plugins-workspace v1 分支，命令为：
//   plugin:autostart|is_enabled / enable / disable
// 参数为空（v1 分支的 guest-js 就是这么调的）。
// =============================================================================

import { invoke } from "@tauri-apps/api/tauri";

export async function isEnabled(): Promise<boolean> {
  return await invoke<boolean>("plugin:autostart|is_enabled");
}

export async function enable(): Promise<void> {
  await invoke("plugin:autostart|enable");
}

export async function disable(): Promise<void> {
  await invoke("plugin:autostart|disable");
}
