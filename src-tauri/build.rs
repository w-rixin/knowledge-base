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

    tauri_build::build()
}
