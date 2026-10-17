import { useEffect, useRef, useState } from "react";
import { Input, Button, Alert, Typography, theme as antdTheme } from "antd";
import type { InputRef } from "antd";
import { Lock } from "lucide-react";
import { appLockApi } from "@/lib/api";
import { useAppStore } from "@/store";
import { WindowControls } from "@/components/layout/WindowControls";

const { Text, Title } = Typography;

// macOS 用系统 overlay 红黄绿按钮（见 AppLayout 同款判断），不自绘 WindowControls，
// 仅留出左侧拖拽区即可。非 Mac 自绘最小化/最大化/关闭，避免无边框窗口锁屏时无法操作。
const IS_MAC =
  typeof navigator !== "undefined" && /Mac OS X|Macintosh/.test(navigator.userAgent);

/**
 * 应用启动锁 —— 全屏锁屏页（软锁 / 全局进入密码）。
 *
 * 由 AppLockGate 在 appLocked 时整页替换主内容渲染，因此笔记内容根本不进 DOM，
 * 真正"挡顺手翻"。校验逻辑全在后端：错误次数限制、锁定冷却提示都来自 invoke 抛出的字符串。
 *
 * 窗口是无边框（decorations:false），所以这里必须自带：
 * - 顶部 data-tauri-drag-region 拖拽条（锁屏时也能挪动窗口）
 * - WindowControls（忘记密码时仍能最小化 / 关闭窗口，不至于卡死）
 */
export function AppLockScreen() {
  const { token } = antdTheme.useToken();
  const unlockApp = useAppStore((s) => s.unlockApp);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    appLockApi
      .getHint()
      .then((h) => setHint(h && h.trim() ? h : null))
      .catch(() => setHint(null));
    return () => clearTimeout(t);
  }, []);

  async function handleSubmit() {
    if (!password.trim()) {
      setErrorMsg("请输入进入密码");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await appLockApi.verify(password);
      setPassword("");
      unlockApp();
    } catch (e) {
      setErrorMsg(String(e));
      setPassword("");
      setTimeout(() => inputRef.current?.focus(), 50);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        display: "flex",
        flexDirection: "column",
        background: token.colorBgLayout,
      }}
    >
      {/* 顶部可拖拽条 + 窗口控制（无边框窗口锁屏时仍可移动/关闭） */}
      <div
        data-tauri-drag-region
        style={{
          height: 48,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingLeft: IS_MAC ? 80 : 12,
        }}
      >
        {!IS_MAC && <WindowControls />}
      </div>

      {/* 居中解锁卡片 */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 360,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `${token.colorPrimary}1a`,
              color: token.colorPrimary,
            }}
          >
            <Lock size={30} strokeWidth={1.8} />
          </div>
          <Title level={4} style={{ margin: 0 }}>
            已锁定
          </Title>
          <Text type="secondary" style={{ fontSize: 13, textAlign: "center" }}>
            输入进入密码以解锁知识库
          </Text>

          <Input.Password
            ref={inputRef}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onPressEnter={handleSubmit}
            placeholder="请输入进入密码"
            autoComplete="off"
            maxLength={64}
            size="large"
            disabled={submitting}
          />

          <Button
            type="primary"
            block
            size="large"
            loading={submitting}
            onClick={handleSubmit}
          >
            解锁
          </Button>

          {/* 密码提示：默认收起，点"忘记密码？"才展开，避免旁人瞥见 */}
          {hint && !showHint && (
            <a
              onClick={(e) => {
                e.preventDefault();
                setShowHint(true);
              }}
              style={{ fontSize: 12, alignSelf: "center" }}
            >
              忘记密码？查看提示
            </a>
          )}
          {hint && showHint && (
            <Alert
              type="info"
              showIcon
              style={{ width: "100%" }}
              message={<span style={{ fontSize: 13 }}>提示：{hint}</span>}
            />
          )}
          {errorMsg && (
            <Alert type="error" showIcon style={{ width: "100%" }} message={errorMsg} />
          )}
        </div>
      </div>
    </div>
  );
}
