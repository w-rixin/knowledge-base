// =============================================================================
// 系统托盘（Tauri 1.x 版本）
// =============================================================================
//
// 🔴 为什么这个文件与 v2 版本差异巨大：
//   v2 用 TrayIconBuilder，支持：
//     - 富菜单（MenuItem / CheckMenuItem / PredefinedMenuItem，可动态改）
//     - on_tray_icon_event 精确区分 左键按下/抬起、右键、双击
//     - 事件回调带 &AppHandle 参数
//   v1 只有 SystemTray + SystemTrayMenu，限制明显：
//     1) 菜单项只能用 CustomMenuItem::new(id, label)，
//        CheckMenuItem 用 .checked(bool) 表达；
//     2) **SystemTrayEvent 只带 tray_id: String，不带任何 handle**，
//        事件里拿 AppHandle 只能靠闭包捕获；
//     3) **Linux 上 LeftClick / RightClick 事件完全不支持**（v1 官方注明
//        "Linux: Unsupported"），所以"点图标切换窗口显隐"在麒麟上不存在，
//        只能走菜单项。
//
// 因此本实现相对 v2 的功能取舍：
//   ✔ 保留：新建笔记 / 快速记一笔 / 打开日记 / 搜索 / 立即同步 /
//           检查更新 / 显示窗口 / 退出 / 强制退出
//   ✘ 移除：「窗口置顶」与「开机自启」两个勾选项 —— v1 在事件里拿不到
//            menu item handle，做不了可靠的状态回写（需 app.tray_handle()
//            再 get_item，且 Linux 点击行为不一致），留作后续按需补回
//   ✘ 移除：dev 环境橙色角标 —— v1 无 tauri::image::Image，只有 Icon::Rgba，
//            且 default_window_icon() 在 v1 不可用，改为直接用图标文件
// =============================================================================

use tauri::{
    CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu,
    SystemTrayMenuItem,
};

use crate::services::sync_scheduler;

/// 初始化系统托盘。
///
/// 用 if let Err 兜底调用（见 lib.rs）：托盘是辅助功能，失败不应让应用启动崩。
pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("new-note", "新建笔记"))
        .add_item(CustomMenuItem::new("quick-add", "快速记一笔"))
        .add_item(CustomMenuItem::new("open-daily", "打开今日日记"))
        .add_item(CustomMenuItem::new("open-search", "搜索"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("sync-now", "立即同步"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("check-update", "检查更新…"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("show", "显示窗口"))
        .add_item(CustomMenuItem::new("quit", "退出"))
        // 逃生门：不经前端的强制退出。
        // 托盘菜单是系统原生控件，不依赖 WebView；WebView 白屏/崩溃时这是唯一可用的退出入口。
        .add_item(CustomMenuItem::new("force-quit", "强制退出（不保存）"));

    // 托盘图标：v1 用 Icon::File 指向打包进 resources 的图标。
    // 选 32x32（Linux 托盘常用尺寸），失败则由 with_icon 的 TryInto 报错，不 panic。
    let icon_path = app
        .path_resolver()
        .resolve_resource("icons/32x32.png")
        .or_else(|| app.path_resolver().app_config_dir().map(|d| d.join("icons/32x32.png")));

    // 事件闭包里没有 AppHandle 参数，必须提前捕获一份
    let app_handle = app.handle().clone();

    let mut tray = SystemTray::new()
        .with_tooltip(if cfg!(debug_assertions) {
            "知识库 [DEV]"
        } else {
            "知识库"
        })
        .with_menu(menu)
        .on_event(move |event| {
            // v1 的事件只带 tray_id，所有动作都通过捕获的 app_handle 完成
            if let SystemTrayEvent::MenuItemClick { id, .. } = event {
                match id.as_ref() {
                    "new-note" => {
                        bring_main_to_front(&app_handle);
                        let _ = app_handle.emit_all("tray:new-note", ());
                    }
                    "quick-add" => {
                        // 快速记一笔悬浮窗：不前置主窗，应用在后台也能记
                        let _ = crate::services::popout_window::open_quick_add(&app_handle);
                    }
                    "open-daily" => {
                        bring_main_to_front(&app_handle);
                        let _ = app_handle.emit_all("tray:open-daily", ());
                    }
                    "open-search" => {
                        bring_main_to_front(&app_handle);
                        let _ = app_handle.emit_all("tray:open-search", ());
                    }
                    "sync-now" => {
                        let h = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            sync_scheduler::push_once(&h, "tray").await;
                        });
                    }
                    "check-update" => {
                        bring_main_to_front(&app_handle);
                        let _ = app_handle.emit_all("tray:check-update", ());
                    }
                    "show" => {
                        bring_main_to_front(&app_handle);
                    }
                    "quit" => {
                        // 走前端确认流程：让 React 检查未保存草稿，弹 Modal 三选一
                        bring_main_to_front(&app_handle);
                        let _ = app_handle.emit_all("tray:request-exit", ());
                    }
                    "force-quit" => {
                        // 不 emit、不等前端、不做 IPC —— WebView 已死时才用这一项
                        log::warn!("[tray] 用户选择强制退出（跳过草稿检查与退出同步）");
                        app_handle.exit(0);
                    }
                    _ => {}
                }
            }
        });

    // 托盘图标：v1 的 Icon::File 受 icon-png/icon-ico feature 控制，而 build.rs 要求
    // Cargo feature 与 allowlist 严格对应（不允许随意加 feature），故这里改用
    // Icon::Rgba —— 该变体**不受 feature gate 限制**，只需自己把 PNG 解成 RGBA。
    // 项目本身已依赖 image crate（见 Cargo.toml target.desktop 段），直接复用。
    if let Some(p) = icon_path {
        if p.exists() {
            match std::fs::read(&p) {
                Ok(bytes) => match image::load_from_memory(&bytes) {
                    Ok(img) => {
                        let rgba = img.to_rgba8();
                        let (w, h) = (rgba.width(), rgba.height());
                        tray = tray.with_icon(tauri::Icon::Rgba {
                            rgba: rgba.into_raw(),
                            width: w,
                            height: h,
                        });
                    }
                    Err(e) => log::warn!("[tray] 图标解码失败: {}", e),
                },
                Err(e) => log::warn!("[tray] 图标读取失败: {}", e),
            }
        } else {
            log::warn!("[tray] 图标文件不存在，使用无图标托盘: {}", p.display());
        }
    }

    tray.build(app)?;
    Ok(())
}

/// 把主窗口从最小化/隐藏中恢复并聚焦
fn bring_main_to_front(app: &tauri::AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
