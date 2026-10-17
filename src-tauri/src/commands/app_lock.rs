//! 应用启动锁 —— IPC 入口
//!
//! 业务逻辑全在 services::app_lock。这里只做参数转发与错误转字符串。
//! 与 hidden_pin / vault 完全独立：这是"打开软件就要输密码"的全局软锁门禁。

use tauri::State;

use crate::models::AppLockStatus;
use crate::services::app_lock;
use crate::state::AppState;

/// 查询应用锁状态：是否开启 + 闲置自动锁定分钟数
#[tauri::command]
pub fn app_lock_status(state: State<'_, AppState>) -> Result<AppLockStatus, String> {
    app_lock::status(&state.db).map_err(|e| e.to_string())
}

/// 设置/修改进入密码（已设过时必须传 old_password）
#[tauri::command]
pub fn app_lock_set_password(
    state: State<'_, AppState>,
    old_password: Option<String>,
    new_password: String,
    hint: Option<String>,
) -> Result<(), String> {
    app_lock::set_password(&state.db, old_password, new_password, hint).map_err(|e| e.to_string())
}

/// 校验进入密码（错误次数限制由后端管）
#[tauri::command]
pub fn app_lock_verify(state: State<'_, AppState>, password: String) -> Result<(), String> {
    app_lock::verify(&state.db, password).map_err(|e| e.to_string())
}

/// 关闭应用锁（需当前密码校验通过）
#[tauri::command]
pub fn app_lock_disable(state: State<'_, AppState>, current_password: String) -> Result<(), String> {
    app_lock::disable(&state.db, current_password).map_err(|e| e.to_string())
}

/// 获取密码提示（无则 None）
#[tauri::command]
pub fn app_lock_get_hint(state: State<'_, AppState>) -> Result<Option<String>, String> {
    app_lock::get_hint(&state.db).map_err(|e| e.to_string())
}

/// 设置闲置自动锁定分钟数（0 = 关闭；后端 clamp 到 [0, 240]）
#[tauri::command]
pub fn app_lock_set_auto_minutes(state: State<'_, AppState>, minutes: i64) -> Result<(), String> {
    app_lock::set_auto_minutes(&state.db, minutes).map_err(|e| e.to_string())
}
