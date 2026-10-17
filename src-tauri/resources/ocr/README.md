# 本地 OCR 引擎（RapidOCR-json sidecar）

本目录放 [RapidOCR-json](https://github.com/RapidAI/RapidOCR-json)（又名 PaddleOCR-json）
的**跨平台**命令行引擎。它是自含 ONNXRuntime 的单可执行文件（无 DLL 依赖），
三平台的 stdin/stdout JSON 协议**完全一致**——所以主程序（`src-tauri/src/services/ocr.rs`）
一套代码即可驱动三平台，各平台只需放对应的二进制文件。

## 目录布局

```
resources/ocr/
├── RapidOCR-json.exe          # Windows 引擎（已提交）
├── RapidOCR-json              # macOS / Linux 引擎（无扩展名，需自行放入，见下）
├── models/
│   ├── ch_PP-OCRv4_det_infer.onnx        # 检测（已提交）
│   ├── ch_ppocr_mobile_v2.0_cls_infer.onnx  # 方向分类（已提交）
│   ├── rec_ch_PP-OCRv4_infer.onnx        # 识别，含中英数字（已提交）
│   └── dict_chinese.txt                  # 字典（已提交）
└── README.md
```

`models/` 里的 ONNX 模型与字典是**平台无关**的，三平台共用同一份（已提交）。
需要按平台补的只有引擎可执行文件本身。

## 当前状态

- **Windows**：`RapidOCR-json.exe` 已随仓库提交，开箱可用。
- **macOS**：**不需要本目录任何二进制**——已改用系统原生 **Apple Vision**（零二进制、in-process）。
  代码见 `src-tauri/mac/ocr_vision.m`（ObjC，build.rs 用 cc 编译并链接 Vision 框架）+
  `src-tauri/src/services/mac_ocr.rs`（Rust FFI）。图片 OCR 直接走 Vision，无需放 RapidOCR mac 二进制。
  （扫描件 PDF 的 OCR 仍需 `resources/pdfium/libpdfium.dylib` 来把 PDF 渲染成图——那是 pdfium 的
  跨平台缺口，与 OCR 引擎无关。）
- **Linux**：**尚未提交二进制**（与 `resources/pdfium/` 同样，本仓库当前 Windows 为主）。
  运行时 OCR 会**优雅禁用**（设置页显示「引擎未安装」），不影响其它功能。放入 Linux 版
  `RapidOCR-json`（见下）后重新 build 即可用。

## 给 Linux 补引擎（macOS 已用 Vision，无需此步）

1. 到 RapidOCR-json / PaddleOCR-json 的 GitHub Releases 下载 Linux 引擎压缩包
   （`*_linux_x64.zip` 之类），解压后取其中的 `RapidOCR-json` 可执行文件。
2. 把该可执行文件放到本目录并**命名为 `RapidOCR-json`（无扩展名）**。
   （主程序按平台解析：Windows 找 `.exe`，Linux 找无扩展名的 `RapidOCR-json`。）
3. Linux 上可执行位若丢失，主程序启动时会自动 `chmod +x`（见 `services/ocr.rs`），
   一般无需手动处理。
4. 在 Linux 上重新 `pnpm tauri build`，引擎会被 `tauri.conf.json` 的 `resources/ocr/RapidOCR-json*`
   glob 打进安装包。

> macOS 也可以改回 RapidOCR sidecar（放入 mac 版 `RapidOCR-json` 无扩展名二进制即可）——
> `services/ocr.rs` 里 `recognize_image` 会在 Vision 不可用时自动回退 sidecar。但默认走 Vision，
> 零二进制、系统原生、中英识别质量好，无需这么做。

## 协议（三平台一致，供维护参考）

- 启动：`RapidOCR-json[.exe] --models=models --det=... --cls=... --rec=... --keys=dict_chinese.txt --ensureLogger=0`（cwd = 本目录）。
- 就绪：stdout 打印版本行后输出 `OCR init completed.`。
- 请求：往 stdin 逐行写 `{"image_path":"<相对/绝对路径>"}`。
- 响应：stdout 逐行返回 `{"code":100,"data":[{"text":"...","score":0.9,"box":[[x,y]...]}]}`；
  `code=101` 表示无文字，其它为错误。
- **坑**：关闭 stdin（EOF）会让引擎死循环刷 `code=299` → 进程常驻、绝不关 stdin，退出时直接 kill。

> macOS 若想零二进制、走系统原生 OCR，可另实现 Apple Vision（`VNRecognizeTextRequest`）后端，
> 在 `services/ocr.rs` 里按 `#[cfg(target_os = "macos")]` 分支替换 sidecar 路径——姊妹项目 AgileShot
> 的 macOS 就是这么做的（`localocrengine_mac.mm`）。本项目暂用统一的 RapidOCR sidecar 方案。
