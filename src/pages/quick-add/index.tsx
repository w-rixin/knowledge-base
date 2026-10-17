/**
 * 「快速记一笔」独立悬浮窗页面（滴答清单式）。
 *
 * 由 Rust 侧 `popout_window::open_quick_add` 创建的 `quick-add` 无边框置顶小窗加载，
 * 全局快捷键（默认 Ctrl+Alt+Space）或托盘菜单唤起，应用在后台也能弹出，不打断主窗工作。
 *
 * 交互（沿用 QuickNoteCaptureModal 的约定，但宿主是独立窗口而非 antd Modal）：
 *   - 自动聚焦输入框，敲字 → Enter 追加到今日日记（Shift+Enter 换行）
 *   - 保存成功 → 清空 + 隐藏窗口（hide 不销毁，下次秒开）
 *   - Esc / 失焦 → 隐藏窗口（记完即走）
 *   - 顶部细条 data-tauri-drag-region 可拖动窗口
 *
 * Why 隐藏不关闭：窗口复用，避免每次重建 WebView 的几百 ms 白屏。
 */
import { useState, useRef, useEffect } from "react";
import { Input, Button, App as AntdApp, theme as antdTheme } from "antd";
import type { InputRef } from "antd";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sparkles, X } from "lucide-react";
import { dailyApi } from "@/lib/api";

export default function QuickAddPage() {
  const { token } = antdTheme.useToken();
  const { message } = AntdApp.useApp();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<InputRef>(null);
  // 挂载后短暂忽略失焦隐藏，避免窗口刚弹出、焦点还没稳定时被误隐藏
  const readyRef = useRef(false);

  const hideWindow = () => {
    void getCurrentWindow().hide();
  };

  // 监听窗口聚焦：被唤起（focused=true）时清空并聚焦输入框；失焦则自动隐藏。
  useEffect(() => {
    const win = getCurrentWindow();
    const focusInput = () => window.setTimeout(() => inputRef.current?.focus(), 30);

    // 首次创建时窗口是隐藏的（Rust 侧 visible:false，规避新 WebView 白屏）。
    // 等 React 首帧真正绘制完（双 rAF）再 show + 抢焦点，避免用户看到空白窗。
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        void win.show();
        void win.setFocus();
        focusInput();
      });
    });

    const t = window.setTimeout(() => {
      readyRef.current = true;
    }, 400);

    let unlisten: (() => void) | undefined;
    void win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        setText("");
        focusInput();
      } else if (readyRef.current) {
        // 点到别处 → 收起（与滴答清单一致）
        void win.hide();
      }
    }).then((un) => {
      unlisten = un;
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(t);
      unlisten?.();
    };
  }, []);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) {
      message.warning("内容不能为空");
      return;
    }
    setSaving(true);
    try {
      await dailyApi.appendQuickCapture(trimmed);
      setText("");
      hideWindow();
    } catch (e) {
      message.error(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="flex flex-col h-screen w-screen"
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* 可拖拽标题条（无边框窗口靠它移动） */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-3 shrink-0"
        style={{ height: 36, borderBottom: `1px solid ${token.colorBorderSecondary}` }}
      >
        <span
          className="flex items-center gap-1.5"
          style={{ fontSize: 13, fontWeight: 600, color: token.colorText, pointerEvents: "none" }}
        >
          <Sparkles size={14} style={{ color: token.colorPrimary }} />
          快速记一笔
        </span>
        <Button
          type="text"
          size="small"
          icon={<X size={14} />}
          onClick={hideWindow}
          style={{ width: 24, height: 24, padding: 0 }}
        />
      </div>

      {/* 输入区 */}
      <div className="flex-1 flex flex-col px-3 py-2.5 min-h-0">
        <Input.TextArea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="想到什么就写什么，回车记入今天的日记…"
          autoSize={{ minRows: 3, maxRows: 6 }}
          variant="borderless"
          style={{
            flex: 1,
            resize: "none",
            fontSize: 14,
            padding: "10px 12px",
            background: token.colorFillQuaternary,
            borderRadius: 8,
            lineHeight: 1.6,
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void handleSubmit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              hideWindow();
            }
          }}
        />
        <div className="flex items-center justify-between mt-2 shrink-0">
          <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>
            Enter 保存 · Shift+Enter 换行 · Esc 关闭
          </span>
          <Button type="primary" size="small" loading={saving} onClick={handleSubmit}>
            记入今日
          </Button>
        </div>
      </div>
    </div>
  );
}
