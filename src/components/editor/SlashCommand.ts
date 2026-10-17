import { Extension, ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import {
  SlashCommandList,
  type SlashCommandListRef,
} from "./SlashCommandList";
import {
  buildSlashCommandItems,
  filterSlashItems,
  type SlashCommandBuildOptions,
  type SlashCommandItem,
} from "./slashCommandItems";

export type SlashCommandOptions = SlashCommandBuildOptions;

/**
 * 斜杠命令菜单：在编辑器中输入 `/` 触发块插入候选浮层。
 *
 * 触发规则：
 * - 仅在行首或空格后输入 `/` 才触发，避免和路径文本（`a/b/c`）冲突
 * - 在 codeBlock / 行内 code / link 节点内禁用
 * - 输入空格立即退出，避免误触
 *
 * Why 这样设计：
 * - 复刻 WikiLinkSuggestion 同款架构（Suggestion + tippy + ReactRenderer），
 *   保持编辑器扩展风格一致
 * - 命令清单是静态数据，items 同步过滤即可，不查 API
 */
export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      // 默认空实现：未配置时媒体项执行会提示"请先保存笔记"
      getNoteId: () => undefined,
      ensureNoteId: () => undefined,
      requestEmbedUrl: undefined,
    };
  },

  addProseMirrorPlugins() {
    const items = buildSlashCommandItems({
      getNoteId: this.options.getNoteId,
      ensureNoteId: this.options.ensureNoteId,
      requestEmbedUrl: this.options.requestEmbedUrl,
    });

    return [
      Suggestion<SlashCommandItem>({
        // 给独立的 PluginKey，避免与 WikiLinkSuggestion 默认 key 冲突
        // ("Adding different instances of a keyed plugin (suggestion$)")。
        pluginKey: new PluginKey("slashCommandSuggestion"),
        editor: this.editor,
        char: "/",
        // 行首 / 空格后才允许触发
        startOfLine: false,
        allowedPrefixes: [" "],
        // 输入空格立即关闭浮层
        allowSpaces: false,
        // 在代码块、行内代码、链接内禁用
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            const node = $from.node(depth);
            if (node.type.name === "codeBlock") return false;
          }
          const marks = $from.marks();
          if (
            marks.some(
              (m) => m.type.name === "code" || m.type.name === "link",
            )
          ) {
            return false;
          }
          return true;
        },
        items: ({ query }: { query: string }) => {
          return filterSlashItems(items, query);
        },
        command: ({ editor, range, props }) => {
          const item = props as SlashCommandItem;
          // 由各 item 自己决定是否需要 deleteRange + 实际命令
          item.command({ editor, range });
        },
        render: () => {
          let component: ReactRenderer<SlashCommandListRef> | null = null;
          let popup: TippyInstance[] | null = null;

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashCommandList, {
                props,
                editor: props.editor,
              });
              if (!props.clientRect) return;
              popup = tippy("body", {
                getReferenceClientRect: () =>
                  props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                theme: "slash-command",
                arrow: false,
                offset: [0, 4],
              });
            },
            onUpdate: (props) => {
              component?.updateProps(props);
              if (!props.clientRect) return;
              popup?.[0].setProps({
                getReferenceClientRect: () =>
                  props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
              });
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                popup?.[0].hide();
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              popup?.[0].destroy();
              component?.destroy();
              popup = null;
              component = null;
            },
          };
        },
      }),
    ];
  },
});
