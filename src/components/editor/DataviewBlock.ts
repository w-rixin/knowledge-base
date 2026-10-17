/**
 * Dataview 块（v1.12 最简版）：在笔记里嵌入一个"实时数据视图"。
 *
 * 设计：
 * - **叶子节点**（atom=true）：没有可编辑子内容，整块靠 NodeView 渲染
 * - **配置存属性**：`data-dataview` 属性存 JSON 序列化的 DataviewConfig
 *   - 例：`<div data-dataview='{"kind":"recent-notes","limit":10}'>`
 * - **Markdown 兼容**：依赖 tiptap-markdown 的 `html: true` 透传 div；外部 md 工具
 *   会看到一个空 div（无样式），导回应用时 parseHTML 重新识别
 * - **导出快照**：导出 HTML/Markdown 时块会被序列化为原始 div，**当前查询结果不固化**
 *   （v2 再做"导出时快照"）
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { DataviewConfig } from "@/types";
import { DataviewNodeView } from "./DataviewNodeView";

export interface DataviewBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    dataviewBlock: {
      /** 插入 dataview 块；传入完整配置 */
      insertDataview: (config: DataviewConfig) => ReturnType;
    };
  }
}

/** 默认配置：插入时若用户没指定就用这个 */
const DEFAULT_CONFIG: DataviewConfig = {
  kind: "recent-notes",
  limit: 10,
};

function parseConfigFromEl(el: HTMLElement): DataviewConfig {
  const raw = el.getAttribute("data-dataview");
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(raw) as DataviewConfig;
    if (!parsed.kind) return { ...DEFAULT_CONFIG };
    return parsed;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export const DataviewBlock = Node.create<DataviewBlockOptions>({
  name: "dataviewBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: { class: "tiptap-dataview" },
    };
  },

  addAttributes() {
    return {
      config: {
        default: { ...DEFAULT_CONFIG } as DataviewConfig,
        parseHTML: (el) => parseConfigFromEl(el as HTMLElement),
        renderHTML: (attrs) => ({
          "data-dataview": JSON.stringify(attrs.config ?? DEFAULT_CONFIG),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-dataview]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-dataview": JSON.stringify(node.attrs.config ?? DEFAULT_CONFIG),
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DataviewNodeView);
  },

  addCommands() {
    return {
      insertDataview:
        (config: DataviewConfig) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { config },
          }),
    };
  },
});
