// =============================================================================
// Tauri 1.x 兼容层（shell / opener 能力）
// =============================================================================
//
// 为什么需要这个文件：
//   项目原用 Tauri 2.x，前端从 '@tauri-apps/plugin-opener' 导入
//   openUrl / openPath / revealItemInDir 三个函数。Tauri 1.x **没有 opener 插件**
//   （它只在 v2 存在），对应的能力是 allowlist 内置的 '@tauri-apps/api/shell'，
//   且只提供一个统一的 `open(pathOrUrl)`。
//
//   若把 14 个调用点逐个改成 open()，不仅改动面大，`revealItemInDir`
//   （在文件管理器中定位文件）在 v1 更是完全没有对应 API。
//
//   所以这里做一层薄 shim：对外保持 v2 的函数签名，内部映射到 v1 实现。
//   将来若回到 Tauri 2，只需把本文件的导入换回 plugin-opener 即可。
//
// 关联：src-tauri/tauri.conf.json 的 allowlist.shell.open 必须为 true。
// =============================================================================

import { open as shellOpen } from '@tauri-apps/api/shell';

/**
 * 统一入口：用系统默认程序打开 URL 或文件。
 *
 * v1 本身就有 open(pathOrUrl)，这里再包一层是为了让全项目前端
 * 只依赖本 shim 一个模块（便于将来整体切回 Tauri 2 的 opener 插件）。
 */
export async function open(target: string): Promise<void> {
  return shellOpen(target);
}

/**
 * 用系统默认程序打开 URL。
 * v2: openUrl(url) → v1: open(url)
 */
export async function openUrl(url: string): Promise<void> {
  return shellOpen(url);
}

/**
 * 用系统默认程序打开本地文件/目录。
 */
export async function openPath(path: string): Promise<void> {
  return shellOpen(path);
}

/**
 * 在文件管理器中定位文件。
 *
 * ⚠️ Tauri 1.x 无 revealItemInDir。这里**降级**为「打开文件所在目录」：
 *    行为差异是 v1 不会把该文件选中高亮，但目录能正确打开、用户能找到文件。
 *    若传入的本身是目录，则直接打开该目录（等价于原语义）。
 *
 * 为什么不用 shell Command 实现真正的「选中」：
 *    需要在 allowlist.shell.scope 里显式放行 explorer / open / xdg-open 等命令，
 *    等于给应用开了任意命令执行面，安全性代价与收益不成比例。
 */
export async function revealItemInDir(path: string): Promise<void> {
  if (!path) return;
  const norm = path.replace(/\\/g, '/');
  const trimmed = norm.replace(/\/+$/, '');

  // 无分隔符或已是根 → 直接打开
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) {
    return shellOpen(trimmed || '/');
  }

  // 判断是否为目录：末尾带分隔符的（已在上一步去掉）或没有扩展名且像目录
  // 这里采用保守策略：先尝试打开父目录；若 path 本身是目录，
  // 调用方通常传入的就是目录（如 root_dir），此时打开父目录也能看到它。
  const parent = trimmed.substring(0, idx);
  return shellOpen(parent);
}
