/**
 * AI 回复 / 通用 Markdown 渲染共用组件。
 *
 * 包了 react-markdown 并默认启用 GFM 插件，让 AI 回复里常见的
 * 表格 / 删除线 / 任务列表 / 自动链接都能正确渲染。
 *
 * 为什么不直接到处 `import Markdown from "react-markdown"`：
 * - react-markdown 默认只支持 CommonMark，**不含表格**
 * - 漏配 remarkPlugins 时，AI 回的 `| a | b |\n|---|---|` 表格语法
 *   会变成"原文堆字符"显示，严重影响阅读体验
 * - 集中到这里，未来要换 markdown 渲染器（如改成带语法高亮的）只改一处
 */
import { type ReactNode } from "react";
import Markdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = Omit<Options, "remarkPlugins" | "children"> & {
  children: string;
  /** 调用方可追加额外插件；默认只启用 GFM */
  extraRemarkPlugins?: Options["remarkPlugins"];
};

export function MarkdownContent({
  children,
  extraRemarkPlugins,
  ...rest
}: Props): ReactNode {
  const plugins = extraRemarkPlugins
    ? [remarkGfm, ...extraRemarkPlugins]
    : [remarkGfm];
  return (
    <Markdown remarkPlugins={plugins} {...rest}>
      {children}
    </Markdown>
  );
}
