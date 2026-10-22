// =============================================================================
// 自动性能模式 —— 软件渲染环境下剥离昂贵的 backdrop-filter 毛玻璃
// =============================================================================
//
// 背景：默认主题 light-glass 给每个 .ant-card / 侧栏 / 顶栏都上了 backdrop-filter
// 高斯模糊（light-glass 为 20px），侧边导航浮层 SidePanel 更是内联 blur(10px)。
// 有 GPU 时这些近乎免费；但在无硬件加速、走 llvmpipe / SwiftShader 软件光栅化的
// 环境（如飞腾 + 无 GPU 的麒麟机）下，每一处模糊都是逐帧全区域着色器开销——
// 滚动卡片列表 / 拖动浮层时的主要卡顿源。WEBKIT_DISABLE_COMPOSITING_MODE 只解决
// 合成往返，模糊本身仍在大口吃 CPU/GPU，所以这里单独治。
//
// 做法：启动时探测 WebGL 的真实渲染器字符串，命中 llvmpipe / software /
// swiftshader / basic render / softpipe 时给 <html> 打 data-perf="on"，
// 由 global.css 末尾的覆盖规则统一把这些 backdrop-filter 置为 none。
// 有 GPU 的机器 data-perf="off"，玻璃观感原样保留、零影响。
//
// 探测同步、只读、无副作用；结果写进 tauri 日志（终端可见），便于确认是否触发。
// 必须在首屏渲染前同步调用（main.tsx 入口处），避免先渲染一遍模糊再被摘掉的闪烁。
// =============================================================================

import { info } from "@/lib/tauriLog";

const PERF_ATTR = "data-perf";

/** 渲染器 / 厂商字符串是否指向软件光栅化 */
function isSoftwareRenderer(s: string): boolean {
  return /llvmpipe|software|swiftshader|basic render|softpipe/i.test(s);
}

/** 探测是否处于软件渲染环境，并带回可用于日志的明细 */
function detectSoftwareRendering(): { software: boolean; detail: string } {
  try {
    const canvas = document.createElement("canvas");
    const gl: WebGLRenderingContext | null =
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) {
      // 连 WebGL 上下文都建不起来——基本可断定是软件渲染 / 受限环境，直接进性能模式
      return { software: true, detail: "no-webgl-context" };
    }
    const dbg = gl.getExtension(
      "WEBGL_debug_renderer_info",
    ) as WEBGL_debug_renderer_info | null;
    if (dbg) {
      const vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? "");
      const renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? "");
      return {
        software: isSoftwareRenderer(vendor) || isSoftwareRenderer(renderer),
        detail: `${vendor} / ${renderer}`,
      };
    }
    // 拿不到 debug 扩展时退回读受限的 RENDERER（多数驱动仍会泄露渲染器名）
    const renderer = String(gl.getParameter(gl.RENDERER) ?? "");
    return { software: isSoftwareRenderer(renderer), detail: renderer || "unknown" };
  } catch (e) {
    // 探测本身出错时不武断改观感，保持关闭；细节进日志
    return {
      software: false,
      detail: `probe-error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** 入口早期调用：探测软件渲染并据此设置 <html data-perf>。同步、须在首屏渲染前执行。 */
export function initPerfMode(): void {
  if (typeof document === "undefined") return;
  // 已被显式设置过（如调试时手动加过）则不覆盖
  if (document.documentElement.hasAttribute(PERF_ATTR)) return;

  const { software, detail } = detectSoftwareRendering();
  if (software) {
    document.documentElement.setAttribute(PERF_ATTR, "on");
    void info(
      `[perf] 检测到软件渲染（${detail}）→ 启用性能模式 data-perf=on，已剥离 backdrop-filter 毛玻璃`,
    );
  } else {
    document.documentElement.setAttribute(PERF_ATTR, "off");
    void info(`[perf] 硬件加速可用（${detail}）→ 性能模式关闭，保留毛玻璃观感`);
  }
}
