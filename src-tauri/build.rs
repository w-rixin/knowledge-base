fn main() {
    // #9 macOS 零二进制 OCR：仅当**目标平台**是 macOS 时，编译 Apple Vision 的 ObjC 桥
    // 并链接系统框架（in-process，不 bundle 任何二进制）。用 CARGO_CFG_TARGET_OS 判目标平台
    // （而非 build.rs 宿主平台），交叉编译也正确。非 macOS 目标完全跳过，不影响 Win/Linux。
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" {
        cc::Build::new()
            .file("mac/ocr_vision.m")
            .flag("-fobjc-arc") // ARC 管理 NS 对象；CF/CG 句柄仍手动 release
            .compile("kb_mac_vision");
        // 链接 Apple 系统框架
        println!("cargo:rustc-link-lib=framework=Vision");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=CoreGraphics");
        println!("cargo:rustc-link-lib=framework=ImageIO");
        println!("cargo:rerun-if-changed=mac/ocr_vision.m");
    }

    // 把 cargo 给 build script 的 TARGET 转发成编译期常量 KB_TARGET_TRIPLE，
    // 供 src/commands/mcp.rs 拼 kb-mcp sidecar 的文件名（binaries/kb-mcp-<triple>）。
    //
    // 为什么必须绕 build.rs 这一圈（历史教训，勿改回 env!("TAURI_ENV_TARGET_TRIPLE")）：
    //   - Cargo 文档只保证 build script 能读到 TARGET，**不保证** crate 源码里
    //     env!("TARGET") 可用；
    //   - tauri CLI 注入给 cargo 子进程的是 TAURI_TARGET_TRIPLE（另一个名字），
    //     而直接 `cargo build` / `cargo check` 时谁都不注入；
    //   - 原代码写的是 env!("TAURI_ENV_TARGET_TRIPLE") —— 一个没有任何工具链
    //     组件会设置的名字，导致每条流水线都得手动补环境变量：check 工作流补了、
    //     release.yml 没补 → 发布管线直接编译失败。
    // cargo:rustc-env 是文档保证的机制，cargo check / cargo build / tauri build
    // 全路径统一生效，无需任何环境变量注入。
    let target = std::env::var("TARGET")
        .expect("build.rs 只在 cargo 下运行，TARGET 必然由 cargo 注入");
    println!("cargo:rustc-env=KB_TARGET_TRIPLE={target}");

    tauri_build::build()
}
