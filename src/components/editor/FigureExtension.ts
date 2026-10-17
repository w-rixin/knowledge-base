import ImageResize from "tiptap-extension-resize-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageResizeNodeView } from "./ImageResizeNodeView";

/**
 * 图片节点扩展：在 ImageResize 之上叠加 `caption`（图注）、`alt`（替代文本）、
 * `align`（左/中/右对齐），并用自绘的 React NodeView 替换第三方包原生 NodeView。
 *
 * 设计原则：
 *   1. **自绘 NodeView**（见 ImageResizeNodeView.tsx 注释）——第三方包的原生 NodeView
 *      靠 DOM click + document 全局监听显示手柄，且不实现 destroy 等生命周期，在「复用
 *      编辑器 + setContent 切笔记」架构下监听泄漏 + 选中失效。这里 override addNodeView
 *      改用 ReactNodeViewRenderer，选中态由 ProseMirror NodeSelection 驱动。
 *      仍借用 ImageResize 的 name(`imageResize`) / parseHTML(img) / 基础 attrs。
 *   2. **存储兼容**：无 caption / 无尺寸 / 无对齐的图片走标准 markdown `![alt](url)`；
 *      一旦带 caption、自定义尺寸或对齐，就退成 raw HTML 兜底（`<img ...>` 或
 *      `<figure>...</figure>`），否则这些信息会在下次打开笔记时丢失。CommonMark 允许
 *      raw HTML，导出 .md 也兼容。
 *   3. **解析回填**：粘贴含 `<figure>` 的 HTML 或加载历史 figure 笔记时，把
 *      caption / alt / align 还原到 attrs。
 *
 * 与"表格自定义列宽 → HTML 兜底"采用同一思路（见 TiptapEditor.tsx 的
 * TableWithMarkdown）。
 */

type ImgAlign = "left" | "center" | "right";

/** 对齐 → 兜底 raw HTML 用的 inline style（让导出的 .md 在外部渲染器也能对齐） */
function alignToStyle(align: ImgAlign): string {
  if (align === "center") return "display:block;margin-left:auto;margin-right:auto;";
  if (align === "right") return "display:block;margin-left:auto;";
  return "";
}

export const FigureImage = ImageResize.extend({
  addAttributes() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parent = (this as any).parent?.() ?? {};
    return {
      ...parent,
      // ImageResize 的基础 attrs 里 alt 通常已有；这里显式声明确保 parseHTML/renderHTML
      // 都能拿到，并提供安全 fallback
      alt: {
        default: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parseHTML: (el: any) => el.getAttribute("alt") || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        renderHTML: (attrs: any) => (attrs.alt ? { alt: attrs.alt } : {}),
      },
      // 显式声明 width/height，确保拖拽缩放后 updateAttributes({width}) 能落进 schema，
      // 进而被下方 markdown serialize 读到并兜底成 raw HTML（否则尺寸打开就丢）。
      width: {
        default: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parseHTML: (el: any) => el.getAttribute("width") || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        renderHTML: (attrs: any) => (attrs.width ? { width: attrs.width } : {}),
      },
      height: {
        default: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parseHTML: (el: any) => el.getAttribute("height") || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        renderHTML: (attrs: any) => (attrs.height ? { height: attrs.height } : {}),
      },
      // 对齐：left(默认)/center/right。用 data-align 持久化（自己解析稳定），
      // 同时输出 inline style 让导出 .md 在外部 markdown 渲染器也能对齐。
      align: {
        default: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parseHTML: (el: any) => el.getAttribute("data-align") || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        renderHTML: (attrs: any) => {
          const align = attrs.align as ImgAlign | null;
          if (!align || align === "left") return {};
          return { "data-align": align, style: alignToStyle(align) };
        },
      },
    };
  },

  parseHTML() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentRules = ((this as any).parent?.() ?? []) as any[];
    return [
      // 优先匹配 figure，把 figcaption 文本提到 caption attr，避免落到 img 规则
      // 后丢掉 caption 信息
      {
        tag: "figure",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getAttrs: (node: any) => {
          const el = node as HTMLElement;
          const img = el.querySelector("img");
          if (!img) return false; // 不是 figure(img) 就不匹配
          const figcap = el.querySelector("figcaption");
          // 对齐优先读 figure 的 data-align（serialize 把 figure 对齐放在这里），
          // 兜底读内部 img 的 data-align
          const align =
            el.getAttribute("data-align") ||
            img.getAttribute("data-align") ||
            null;
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt") || null,
            width: img.getAttribute("width") || null,
            height: img.getAttribute("height") || null,
            align,
            caption: figcap?.textContent?.trim() || null,
          };
        },
      },
      ...parentRules,
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // 有 caption → 包成 figure；没有 → 走原 img 渲染
    const caption = HTMLAttributes.caption;
    if (caption) {
      const { caption: _drop, ...imgAttrs } = HTMLAttributes;
      void _drop;
      return [
        "figure",
        { class: "tiptap-figure" },
        ["img", imgAttrs],
        ["figcaption", {}, caption],
      ];
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parent = (this as any).parent?.bind(this) as
      | ((arg: { HTMLAttributes: Record<string, unknown> }) => unknown)
      | undefined;
    if (parent) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return parent({ HTMLAttributes }) as any;
    }
    return ["img", HTMLAttributes];
  },

  // 用自绘 React NodeView 替换第三方包原生 NodeView（修选中失效 + 监听泄漏，见文件头注释）
  addNodeView() {
    return ReactNodeViewRenderer(ImageResizeNodeView);
  },

  // tiptap-markdown 的 storage 注入：override 默认的 image markdown 序列化
  addStorage() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentStorage = ((this as any).parent?.() ?? {}) as Record<
      string,
      unknown
    >;
    return {
      ...parentStorage,
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const { src, alt, caption, width, height, align } = node.attrs;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const editor = (this as any).editor;
          const htmlAllowed = editor?.storage?.markdown?.options?.html;

          // 普通 markdown ![alt](url) 无法表达 width/height/对齐，所以只要存在 caption、
          // 自定义尺寸（拖拽调整过）或非左对齐，都退成 raw HTML 兜底；否则尺寸 / 图注 /
          // 对齐会在下次打开笔记时丢失。
          const hasSize =
            (width !== undefined && width !== null && width !== "") ||
            (height !== undefined && height !== null && height !== "");
          const hasAlign = align === "center" || align === "right";
          const needHtml = (caption || hasSize || hasAlign) && htmlAllowed;

          if (needHtml) {
            const esc = (v: unknown) =>
              String(v ?? "")
                .replace(/&/g, "&amp;")
                .replace(/"/g, "&quot;");
            const safeAlt = esc(alt);
            const safeSrc = String(src ?? "").replace(/&/g, "&amp;");
            const sizeAttr =
              (width != null && width !== ""
                ? ` width="${esc(width)}"`
                : "") +
              (height != null && height !== ""
                ? ` height="${esc(height)}"`
                : "");
            const alignAttr = hasAlign ? ` data-align="${align}"` : "";
            const alignStyle = hasAlign
              ? ` style="${alignToStyle(align as ImgAlign)}"`
              : "";

            if (caption) {
              const safeCap = String(caption)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;");
              // 对齐放在 figure 上（与 parseHTML 的 figure 规则一致）
              state.write(
                `<figure${alignAttr}${alignStyle}>\n<img src="${safeSrc}" alt="${safeAlt}"${sizeAttr}>\n<figcaption>${safeCap}</figcaption>\n</figure>`,
              );
            } else {
              state.write(
                `<img src="${safeSrc}" alt="${safeAlt}"${sizeAttr}${alignAttr}${alignStyle}>`,
              );
            }
            state.closeBlock(node);
            return;
          }

          // 普通 markdown 图片（与 tiptap-markdown 默认实现一致）
          const altText = (alt ?? "").replace(/[\[\]]/g, "");
          const url = (src ?? "").replace(/[()]/g, (c: string) =>
            c === "(" ? "%28" : "%29",
          );
          state.write(`![${altText}](${url})`);
          // ⚠ 本扩展配置为 inline:false（块级图片），块级节点序列化后必须 closeBlock，
          // 否则后续块会与图片粘在同一行，产生 `![]()<p>...` 畸形结构（图片后的回车/
          // 空段落紧贴）。下次加载时 markdown-it 把紧贴的 <p> 当「行内 HTML」解析进图片
          // 所在段落，形成非法嵌套 <p>，每次往返多裂出一个空段落 → 图片后空行无限递增、
          // 且「打开即 dirty」。仅块级图片需要 closeBlock；万一将来配 inline:true 则跳过。
          if (!node.type.isInline) {
            state.closeBlock(node);
          }
        },
        parse: {
          // markdown 解析由 markdown-it 处理：标准 ![alt](url) 自动还原；
          // figure HTML 块走 raw HTML 通路 → 走上面的 parseHTML figure 规则
        },
      },
    };
  },
});
