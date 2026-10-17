//! macOS 零二进制 OCR — Apple Vision 的 Rust FFI 封装（#9 macOS）。
//!
//! 底层 ObjC 实现在 `mac/ocr_vision.m`（build.rs 用 cc 编译并链接 Vision 框架）。
//! 系统原生、in-process，**不 bundle 任何二进制**（区别于 Win/Linux 的 RapidOCR sidecar）。
//!
//! 仅 macOS 编译（`#![cfg(target_os = "macos")]`）。

#![cfg(target_os = "macos")]

use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::path::Path;

extern "C" {
    fn kb_mac_vision_available() -> i32;
    /// 返回 malloc 的 UTF-8 C 串（调用方 free）；NULL=失败；""=无文字。
    fn kb_mac_vision_recognize(image_path: *const c_char) -> *mut c_char;
    fn kb_mac_vision_free(p: *mut c_char);
}

/// Apple Vision 是否可用（macOS 10.15+）。
pub fn available() -> bool {
    // SAFETY: 纯查询，无入参，ObjC 侧只读系统能力
    unsafe { kb_mac_vision_available() == 1 }
}

/// 用 Apple Vision 识别图片文件，返回按行拼接的全文。
pub fn recognize(image_path: &Path) -> Result<String, String> {
    let path = image_path
        .to_str()
        .ok_or_else(|| "图片路径含非 UTF-8 字符".to_string())?;
    let c_path = CString::new(path).map_err(|e| format!("路径转 C 串失败: {e}"))?;

    // SAFETY: c_path 在调用期间存活；返回指针非空时是 ObjC strdup 的 malloc 串，
    // 用完立刻经 kb_mac_vision_free 释放，不跨越本函数。
    unsafe {
        let ptr = kb_mac_vision_recognize(c_path.as_ptr());
        if ptr.is_null() {
            return Err("Apple Vision OCR 失败".to_string());
        }
        let text = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        kb_mac_vision_free(ptr);
        Ok(text)
    }
}
