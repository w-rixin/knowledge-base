// =============================================================================
// Tauri 1.x 兼容层（更新 API）
// =============================================================================
//
// 为什么需要这个文件：
//   v2 的 '@tauri-apps/api/updater' 导出 `Update` **类型**，且 checkUpdate()
//   返回一个带 download()/install() 方法的 Update **实例**。
//   v1 完全没有 Update 对象，只有三个全局函数：
//     - checkUpdate(): Promise<UpdateResult>   // { shouldUpdate, manifest? }
//     - installUpdate(): Promise<void>         // 下载 + 安装一步到位
//     - onUpdaterEvent(handler): Promise<UnlistenFn>
//
//   这里把 v1 的 UpdateManifest 以 `Update` 名字导出，让
//   UpdateBadge / UpdateModal / useUpdateChecker 三个文件不用改类型引用。
//
// ⚠️ 能力差异（不可弥合，属 v1 架构限制）：
//   1. v2 能把「下载」与「安装」分离 —— 后台静默下好，用户点重启秒装。
//      v1 的 installUpdate() 是「下载 + 安装」一条龙，**无法预下载**。
//      因此 useUpdateChecker 里发现新版本后直接进入 ready（含义变为
//      「可安装」，而非「已下载完」），startDownload() 退化为幂等空操作。
//   2. v2 的 download(onEvent) 回调带 Started/Progress/Finished 字节级进度。
//      v1 的 onUpdaterEvent 只有 'PENDING' | 'ERROR' | 'DONE' | 'UPTODATE'
//      四个粗粒度状态，**没有字节进度**，故 progress/downloadedSize/totalSize
//      在 v1 下恒为 0（UI 保留字段以免改组件）。
//
// 关联：src-tauri/tauri.conf.json 的 tauri.updater.active 必须为 true。
// =============================================================================

import type { UpdateManifest, UpdateResult, UpdateStatus, UpdateStatusResult } from "@tauri-apps/api/updater";
import { checkUpdate as v1CheckUpdate, installUpdate as v1InstallUpdate, onUpdaterEvent as v1OnUpdaterEvent } from "@tauri-apps/api/updater";

/** v2 的 `Update` 类型 —— v1 实为 UpdateManifest（version / date / body） */
export type Update = UpdateManifest;

export type { UpdateResult, UpdateStatus, UpdateStatusResult };

export const checkUpdate = v1CheckUpdate;
export const installUpdate = v1InstallUpdate;
export const onUpdaterEvent = v1OnUpdaterEvent;
