import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Empty, App as AntdApp } from "antd";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { MindMapView } from "@/components/notes/MindMapView";
import { noteApi } from "@/lib/api";

/**
 * 思维导图独立弹出窗口页面（由 popout_window.rs::open_mindmap 加载）
 *
 * - URL 形如 `index.html#/mindmap-popout/:noteId`，window label = `popout-mindmap-{id}`
 * - 进入时拉一次笔记内容；之后通过 Tauri 全局事件 `note:updated` 跨窗口同步
 * - 标题同步：拉到笔记后 setTitle(笔记标题) → OS 标题栏跟着变
 * - 复用 MindMapView 组件（variant=standalone：占满整个窗口、不显示关闭/弹窗按钮）
 */
export default function MindMapPopoutPage() {
  const { noteId: idParam } = useParams<{ noteId: string }>();
  const noteId = Number(idParam);
  const { message } = AntdApp.useApp();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 初次加载笔记 + 监听跨窗口更新事件
  useEffect(() => {
    if (!Number.isFinite(noteId) || noteId <= 0) {
      setError("无效的笔记 ID");
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadNote = async () => {
      try {
        const note = await noteApi.get(noteId);
        if (cancelled) return;
        setTitle(note.title);
        setContent(note.content);
        setLoading(false);
        // OS 标题栏写上笔记标题，方便用户在任务栏/Alt+Tab 里识别
        try {
          await getCurrentWebviewWindow().setTitle(
            `思维导图 · ${note.title || "未命名"}`,
          );
        } catch {
          // setTitle 失败不影响主流程
        }
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      }
    };

    void loadNote();

    // 监听其他窗口保存事件 → 同步刷新（popout 自己不会触发保存，不用过滤 sourceLabel）
    const unlistenPromise = listen<{ id: number }>("note:updated", (e) => {
      if (cancelled) return;
      if (e.payload.id !== noteId) return;
      void loadNote();
    });

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [noteId, message]);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
        }}
      >
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
        }}
      >
        <Empty description={error} />
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <MindMapView
        open
        onClose={() => {
          /* standalone 模式不会触发，但保留 props 契约 */
        }}
        markdown={content}
        title={title}
        variant="standalone"
      />
    </div>
  );
}
