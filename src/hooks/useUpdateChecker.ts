import { useEffect, useState, useRef, useCallback } from "react";
import type { Update } from "@/lib/tauriUpdater";
import { installUpdate, onUpdaterEvent } from "@/lib/tauriUpdater";
import { relaunch } from "@tauri-apps/api/process";
import { updaterApi } from "@/lib/api";
import { flushSettingsToDisk } from "@/store";

/**
 * 更新生命周期状态机。
 *
 * idle        无可用更新（或检查失败静默忽略）
 * checking    正在检查（仅手动检查时短暂经过）
 * available   发现新版本，尚未下载完成（自动后台下载会立即把它推向 downloading）
 * downloading 后台静默下载中（只下载、不安装）
 * ready       已下载完，字节在本地待命，点重启即可秒装
 * installing  正在安装并重启
 * error       下载/安装失败，可在 Modal 里重试或走镜像手动下载
 */
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

interface Options {
  /** 应用启动多久后第一次检查（毫秒）。默认 5000。 */
  initialDelay?: number;
  /** 后续轮询间隔（毫秒）。默认 30 分钟。 */
  interval?: number;
  /**
   * 是否启用自动检查 + 后台下载。默认 true。
   * 多窗口场景下只让主窗口启用，避免每个子窗口都重复后台下载同一个更新包。
   */
  enabled?: boolean;
}

/**
 * 应用级自动检查 + 后台预下载更新。
 *
 * 设计目标：用户「点重启就秒装」，不用干等下载。
 * - 启动 initialDelay 后静默 check；之后每 interval 再 check 一次。
 * - 一旦发现新版本，**立即在后台静默 `download()`（只下不装）**，把更新包字节下到本地。
 * - 下载完进入 ready，UI（徽章/Modal）提示「重启以更新」。
 * - 用户点重启时走 `install()`（复用已下载好的字节，不二次下载）+ `relaunch()`。
 *
 * ⚠️ Tauri 1.x 降级说明（与上面 v2 描述有出入，务必先看这段）：
 *   v1 **没有** Update 对象，也没有可分离的「下载」步骤 ——
 *   installUpdate() 是「下载 + 安装」一条龙。因此：
 *     - 做不到「后台静默预下载、用户点重启秒装」；
 *     - 发现新版本后直接进入 ready（含义变为「可以安装了」，不是「已下载完」）；
 *     - startDownload() 退化为幂等空操作，仅推进状态；
 *     - 字节级进度拿不到（v1 只有 PENDING/ERROR/DONE/UPTODATE 四个粗状态），
 *       progress / downloadedSize / totalSize 在 v1 下恒为 0。
 *   UI 文案相应从「已下载完成，点击重启秒装」改为「点击安装并重启」。
 */
export function useUpdateChecker(options: Options = {}) {
  const { initialDelay = 5000, interval = 30 * 60 * 1000, enabled = true } = options;

  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhaseState] = useState<UpdatePhase>("idle");
  const [progress, setProgress] = useState(0);
  const [downloadedSize, setDownloadedSize] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Update 实例保活：download() 的字节绑在它身上，install() 要用同一个。
  const updateRef = useRef<Update | null>(null);
  // phase 镜像到 ref，避免轮询闭包读到过期的 phase。
  const phaseRef = useRef<UpdatePhase>("idle");

  const setPhase = useCallback((p: UpdatePhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  /**
   * 后台下载更新包（v2 语义：只下载、不安装）。
   *
   * ⚠️ Tauri 1.x 下这是**降级实现**：v1 的 installUpdate() 把下载和安装合成一步，
   *    不存在「先下好、待会儿再装」的中间态，所以这里拿不到字节进度，
   *    也不真正发起任何网络请求 —— 只是把状态推进到 ready，其余保持幂等。
   *
   *    保留这个函数是为了让 runCheck / UpdateModal 的调用面不用改动。
   */
  const startDownload = useCallback(async () => {
    if (!updateRef.current) return;
    // 正在装 / 已就绪，不重复触发。
    if (phaseRef.current === "installing") return;

    setProgress(0);
    setDownloadedSize(0);
    setTotalSize(0);
    setError(null);
    setPhase("ready");
  }, [setPhase]);

  /**
   * 安装更新并重启。
   *
   * v1 与 v2 的差别：v2 是 u.install() 复用已下载字节；v1 是全局 installUpdate()，
   * 它会在这一刻**现下载再安装** —— 所以这一步不再是「秒装」，可能要等一会儿。
   */
  const installAndRelaunch = useCallback(async () => {
    if (!updateRef.current) return;
    if (phaseRef.current !== "ready" && phaseRef.current !== "error") return;
    setPhase("installing");
    setError(null);
    let unlisten: (() => void) | undefined;
    try {
      // 安装器为了替换可执行文件必须先杀掉本进程 —— 此时还没落盘的设置改动
      // 就永久丢了（用户观感就是"更新之后设置被重置"）。先同步刷一次。
      // 刷盘失败不该挡住更新：settings 是次要数据，装不上新版本才是大事。
      await flushSettingsToDisk().catch(() => {});
      try {
        // v1 只有 PENDING / ERROR / DONE / UPTODATE 四个粗粒度状态，没有字节进度，
        // 这里用它把 UI 的进度条推到 100%，并捕获安装期错误。
        unlisten = await onUpdaterEvent(({ status, error }) => {
          if (status === "PENDING") setProgress(0);
          else if (status === "DONE") setProgress(100);
          else if (status === "ERROR") setError(error ?? "更新失败");
        });
      } catch {
        // 订阅失败不阻断安装：进度条只是锦上添花。
      }
      await installUpdate();
      unlisten?.();
      await relaunch();
    } catch (e) {
      // 安装失败回退到 ready，允许用户重试或走镜像手动下载。
      unlisten?.();
      setError(String(e));
      setPhase("ready");
    }
  }, [setPhase]);

  /** 内部统一的检查逻辑。manual=true 时无视轮询节流并自动弹 Modal。 */
  const runCheck = useCallback(
    async (manual: boolean): Promise<{ hasUpdate: boolean; error?: string }> => {
      // 已经在处理某个版本（下载中/已就绪/安装中）：手动点就直接把 Modal 打开看进度，
      // 自动轮询则直接跳过，别打断正在进行的下载。
      if (
        updateRef.current &&
        (phaseRef.current === "available" ||
          phaseRef.current === "downloading" ||
          phaseRef.current === "ready" ||
          phaseRef.current === "installing" ||
          phaseRef.current === "error")
      ) {
        if (manual) setModalOpen(true);
        return { hasUpdate: true };
      }

      try {
        if (manual) setPhase("checking");
        const result = await updaterApi.checkUpdate();
        if (result) {
          updateRef.current = result;
          setUpdate(result);
          setPhase("available");
          if (manual) setModalOpen(true);
          // 发现即后台下载，用户无需等待。
          void startDownload();
          return { hasUpdate: true };
        }
        setPhase("idle");
        return { hasUpdate: false };
      } catch (e) {
        // 自动检查静默失败（没网/端点不通不影响应用运行）；手动检查把错误回传给调用方。
        if (manual) setPhase("idle");
        return { hasUpdate: false, error: String(e) };
      }
    },
    [setPhase, startDownload]
  );

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => void runCheck(false), initialDelay);
    const id = setInterval(() => void runCheck(false), interval);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [enabled, runCheck, initialDelay, interval]);

  const openModal = useCallback(() => {
    if (updateRef.current) setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    // 仅隐藏弹窗：下载/就绪状态保留，徽章继续提示，用户随时可再点开重启。
    setModalOpen(false);
  }, []);

  /**
   * 用户手动触发检查（托盘菜单「检查更新…」）。
   * 有更新时弹出 Modal；已是最新或失败时由调用方给出反馈。
   */
  const checkManually = useCallback(
    () => runCheck(true),
    [runCheck]
  );

  return {
    update,
    phase,
    progress,
    downloadedSize,
    totalSize,
    error,
    modalOpen,
    openModal,
    closeModal,
    checkManually,
    startDownload,
    installAndRelaunch,
  };
}
