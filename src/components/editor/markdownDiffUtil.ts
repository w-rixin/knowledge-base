/**
 * 对比/合并视图里取笔记 markdown 的工具。
 *
 * tiptap-markdown 把连续空段落序列化成 HTML 兜底（`<p><br></p>` / `<p></p>`）——纯 markdown 没法
 * 表达"多个连续空行"。这在 diff 视图里又丑又容易被误以为是坏的，所以统一 tidy 掉再展示。
 */
import type { Editor } from "@tiptap/react";

/**
 * 把 tiptap-markdown 序列化里"空段落的 HTML 兜底"（`<p></p>` / `<p><br></p>`）替换成**空行本身**——
 * 让空行就显示成空行，而不是一行 `<p><br></p>` 文本。
 *
 * 注意：**不**压缩连续空行、**不** trim 首尾——用户需要在 diff 里看到这些空行。
 */
export function tidyNoteMarkdown(md: string): string {
  return md
    .replace(/\r\n/g, "\n")
    .replace(/<p>\s*(?:<br\s*\/?>\s*)?<\/p>/gi, "") // <p><br></p> → 这一行变空行（外围的 \n\n 还在）
    .replace(/[ \t]+\n/g, "\n"); // 顺手去掉行尾空白
}

/** 取当前编辑器内容的 markdown（已 tidy）；无 markdown storage 时退回纯文本 */
export function getNoteMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
  const raw = storage.markdown?.getMarkdown() ?? editor.getText({ blockSeparator: "\n\n" });
  return tidyNoteMarkdown(raw);
}

/** 取当前编辑器内容的纯文本（不含 markdown 标记，块之间空一行）—— 用于"和非 markdown 的剪贴板内容对比" */
export function getNotePlainText(editor: Editor): string {
  return editor.getText({ blockSeparator: "\n\n" }).replace(/\r\n/g, "\n");
}

/**
 * 粗略判断一段文本"看起来像不像 Markdown 源码"。
 * 命中任一典型标记即认为是 markdown：ATX 标题 / 无序列表 / 有序列表 / 引用 / 围栏代码块 /
 * 行内强调（**x** / __x__）/ 链接 [..](..) / 图片 ![..](..) / 分隔线 / 表格分隔行。
 * 仅用于"剪贴板对比"时决定笔记侧给 markdown 源码还是纯文本，判错也只是 diff 噪声多一点。
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text || !text.trim()) return false;
  return [
    /^#{1,6}\s+\S/m, // # 标题
    /^\s*[-*+]\s+\S/m, // - 列表
    /^\s*\d+\.\s+\S/m, // 1. 列表
    /^\s*>\s+\S/m, // > 引用
    /^\s*```/m, // ``` 代码块
    /\*\*[^\s*][^*]*\*\*/, // **加粗**
    /__[^\s_][^_]*__/, // __加粗__
    /!?\[[^\]]+\]\([^)]+\)/, // [链接](..) / ![图片](..)
    /^\s*([-*_])(?:\s*\1){2,}\s*$/m, // --- / *** / ___ 分隔线
    /^\s*\|.*\|\s*$/m, // | 表格 |
  ].some((re) => re.test(text));
}
