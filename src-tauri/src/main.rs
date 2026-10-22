// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 麒麟 V10 点击迟钝修复（实测生效后固化）：
    // WebKitGTK 的 GPU 合成模式在无硬件加速的环境（飞腾 CPU + llvmpipe 软件渲染）下，
    // 每次交互都要多走一趟软件光栅化合成往返。禁用合成、退回纯 CPU 绘制后跟手度显著改善。
    // 仅在 Linux 生效；用户已在环境里显式设置该变量时不覆盖，保留终端手动覆盖的口子。
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    knowledge_base_lib::run()
}
