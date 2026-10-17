import { useEffect } from "react";
import { useAppStore } from "@/store";
import { AppLockScreen } from "./AppLockScreen";

/**
 * 触发"用户仍在使用"的活动事件。任一事件发生即重置闲置计时器。
 * passive 监听，不影响滚动/触摸性能。
 */
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "wheel",
  "touchstart",
  "click",
] as const;

/**
 * 应用启动锁门禁。仅在主窗口挂载（见 App.tsx）。
 *
 * - appLocked=true → 整页渲染锁屏，主内容（AppRouter）根本不进 DOM，真正挡住偷看。
 * - appLocked=false → 正常渲染应用，并按"闲置自动锁定"设置启动计时器：
 *   人离开座位 N 分钟无操作 → 自动回到锁屏（公用电脑场景的关键防护）。
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const appLocked = useAppStore((s) => s.appLocked);
  const appLockEnabled = useAppStore((s) => s.appLockEnabled);
  const autoMinutes = useAppStore((s) => s.appLockAutoMinutes);

  useEffect(() => {
    // 仅在"已配置进入密码 + 开启了自动锁定 + 当前已解锁"时运行计时器
    if (!appLockEnabled || appLocked || autoMinutes <= 0) return;

    const timeoutMs = autoMinutes * 60 * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastReset = 0;

    const fire = () => {
      // 触发时再走 store action（内部会校验 appLockEnabled），避免闭包里读到陈旧态
      useAppStore.getState().lockAppNow();
    };
    const reset = () => {
      const now = Date.now();
      // 节流：mousemove 等高频事件最多每秒重置一次计时器，避免性能抖动
      if (now - lastReset < 1000) return;
      lastReset = now;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, timeoutMs);
    };

    timer = setTimeout(fire, timeoutMs);
    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, reset, { passive: true }),
    );
    return () => {
      if (timer) clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, reset));
    };
  }, [appLockEnabled, appLocked, autoMinutes]);

  if (appLocked) return <AppLockScreen />;
  return <>{children}</>;
}
