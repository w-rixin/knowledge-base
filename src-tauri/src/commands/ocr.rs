//! OCR Commands（#9 方案 A · 本地 RapidOCR）
//!
//! - `ocr_available`：本地引擎是否随安装包分发
//! - `ocr_image`：识别单张图片文件的文字
//! - `ocr_pdf`：识别扫描件 PDF（每页渲染成图 → OCR → 拼接）
//!
//! 仅桌面端：移动端不能 spawn 子进程 / 无 PDFium。

#![cfg(desktop)]

use std::path::Path;

/// 本地 OCR 引擎是否可用（bundle 里有 RapidOCR-json）。
#[tauri::command]
pub fn ocr_available() -> bool {
    crate::services::ocr::is_available()
}

/// 识别单张图片文件的文字，返回按行拼接的全文。
#[tauri::command]
pub async fn ocr_image(path: String) -> Result<String, String> {
    // OCR 是阻塞式（子进程管道 + 推理），放到阻塞线程池，避免占住 async 运行时
    tauri::async_runtime::spawn_blocking(move || {
        crate::services::ocr::recognize_image(Path::new(&path))
    })
    .await
    .map_err(|e| format!("OCR 任务调度失败: {e}"))?
}

/// 识别扫描件 PDF：每页渲染成 PNG → 逐页 OCR → 用分页符拼接。
/// `max_pages` 缺省 30 页，防超大 PDF 卡死。
#[tauri::command]
pub async fn ocr_pdf(
    app: tauri::AppHandle,
    path: String,
    max_pages: Option<usize>,
) -> Result<String, String> {
    use tauri::Manager;
    let cap = max_pages.unwrap_or(30).clamp(1, 200);
    // OCR 临时图放应用缓存目录下独立子目录，识别完清掉
    let tmp_root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("取缓存目录失败: {e}"))?
        .join("ocr-tmp");

    tauri::async_runtime::spawn_blocking(move || {
        let src = Path::new(&path);
        let pngs = crate::services::pdf::render_pdf_to_pngs(src, &tmp_root, cap)?;
        if pngs.is_empty() {
            return Err("PDF 没有可渲染的页面".to_string());
        }
        let mut parts: Vec<String> = Vec::new();
        for (i, png) in pngs.iter().enumerate() {
            match crate::services::ocr::recognize_image(png) {
                Ok(text) if !text.trim().is_empty() => {
                    parts.push(format!("<!-- 第 {} 页 -->\n{}", i + 1, text));
                }
                Ok(_) => {} // 空页跳过
                Err(e) => {
                    log::warn!("[ocr] 第 {} 页识别失败: {}", i + 1, e);
                }
            }
            let _ = std::fs::remove_file(png);
        }
        // 清理临时目录（best-effort）
        let _ = std::fs::remove_dir_all(&tmp_root);
        Ok(parts.join("\n\n"))
    })
    .await
    .map_err(|e| format!("OCR 任务调度失败: {e}"))?
}
