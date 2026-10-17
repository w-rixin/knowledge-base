/**
 * 快速记一笔 Modal（全局快捷键 Ctrl+Shift+N 触发）。
 *
 * 流程：
 *   open → autofocus 输入框 → 用户敲字 → Enter / 点保存
 *   → invoke append_quick_capture → 追加到今天的日记
 *   → toast 「已记入今天的日记」+ 关闭 Modal
 *   → 可选：点 toast 里的「查看」跳转到日记编辑器
 *
 * 设计原则：
 *   - 极简 UI：标题 + textarea + 一个保存按钮，不打扰心流
 *   - Enter 直接发送（Shift+Enter 换行，模仿 ChatGPT/IM 输入框）
 *   - 关 Modal 立即清空输入（不保留草稿，免得用户混淆）
 *
 * 跟豆包/划词翻译这类系统级浮窗的区别：
 *   - 它们是 OS 窗口，盖在 WebView 之上
 *   - 这个 Modal 是 antd 自己的弹层，在应用内层级最高
 */
import { useState, useRef, useEffect } from "react";
import { Modal, Input, Button, Space, Typography, App as AntdApp } from "antd";
import type { InputRef } from "antd";
import { Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { dailyApi } from "@/lib/api";

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function QuickNoteCaptureModal({ open, onClose }: Props) {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<InputRef>(null);

  // Modal 每次打开：清空内容 + 聚焦输入框
  useEffect(() => {
    if (open) {
      setText("");
      // 等 antd Modal 内部 mount 完成再 focus
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) {
      message.warning("内容不能为空");
      return;
    }
    setSaving(true);
    try {
      const dailyId = await dailyApi.appendQuickCapture(trimmed);
      message.success({
        content: (
          <span>
            已记入今天的日记{" "}
            <a
              onClick={(e) => {
                e.preventDefault();
                navigate(`/notes/${dailyId}`);
                message.destroy();
              }}
              style={{ marginLeft: 8 }}
            >
              查看
            </a>
          </span>
        ),
        duration: 3,
      });
      onClose();
    } catch (e) {
      message.error(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={
        <Space size={6}>
          <Sparkles size={16} />
          <span>快速记一笔</span>
        </Space>
      }
      width={520}
      // 关闭时彻底销毁，避免下次打开时残留旧 state
      destroyOnHidden
    >
      <Input.TextArea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="想到什么就写什么，回车保存到今天的日记…"
        autoSize={{ minRows: 4, maxRows: 12 }}
        // Enter 保存 / Shift+Enter 换行（输入框常见约定）
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void handleSubmit();
          }
          if (e.key === "Escape") {
            onClose();
          }
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 12,
        }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          Enter 保存 · Shift+Enter 换行 · Esc 关闭
        </Text>
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSubmit}>
            保存
          </Button>
        </Space>
      </div>
    </Modal>
  );
}
