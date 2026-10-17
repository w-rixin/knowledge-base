import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { theme as antdTheme } from "antd";
import type { SlashCommandItem } from "./slashCommandItems";

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface Props {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export const SlashCommandList = forwardRef<SlashCommandListRef, Props>(
  function SlashCommandListInner({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const { token } = antdTheme.useToken();
    const containerRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    // 选中项滚动到可视区
    useEffect(() => {
      const el = itemRefs.current[selectedIndex];
      if (el) el.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false;
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = items[selectedIndex];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    // 按 group 分组渲染（保持原数组顺序，按出现顺序的分组）
    const grouped = useMemo(() => {
      const order: string[] = [];
      const map = new Map<string, SlashCommandItem[]>();
      for (const item of items) {
        if (!map.has(item.group)) {
          map.set(item.group, []);
          order.push(item.group);
        }
        map.get(item.group)!.push(item);
      }
      return order.map((g) => ({ group: g, list: map.get(g)! }));
    }, [items]);

    if (items.length === 0) {
      return (
        <div
          style={{
            background: token.colorBgElevated,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadius,
            boxShadow: token.boxShadowSecondary,
            padding: "8px 12px",
            fontSize: 13,
            color: token.colorTextTertiary,
          }}
        >
          无匹配命令
        </div>
      );
    }

    // 渲染时维护 flat index 与 group 渲染的对应
    let flatIndex = -1;
    itemRefs.current = [];

    return (
      <div
        ref={containerRef}
        style={{
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadius,
          boxShadow: token.boxShadowSecondary,
          padding: 4,
          minWidth: 280,
          maxWidth: 360,
          maxHeight: 320,
          overflowY: "auto",
        }}
      >
        {grouped.map(({ group, list }) => (
          <div key={group}>
            <div
              style={{
                padding: "6px 10px 4px",
                fontSize: 11,
                fontWeight: 600,
                color: token.colorTextTertiary,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {group}
            </div>
            {list.map((item) => {
              flatIndex += 1;
              const myIndex = flatIndex;
              const isActive = myIndex === selectedIndex;
              const Icon = item.icon;
              return (
                <div
                  key={item.key}
                  ref={(el) => {
                    itemRefs.current[myIndex] = el;
                  }}
                  onMouseEnter={() => setSelectedIndex(myIndex)}
                  onMouseDown={(e) => {
                    // 阻止编辑器失焦（失焦会让 suggestion 关闭）
                    e.preventDefault();
                    command(item);
                  }}
                  style={{
                    padding: "6px 10px",
                    fontSize: 13,
                    borderRadius: 4,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: isActive
                      ? token.controlItemBgActive
                      : "transparent",
                    color: token.colorText,
                  }}
                >
                  <Icon size={16} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.title}
                    </div>
                    {item.subtitle && (
                      <div
                        style={{
                          fontSize: 11,
                          color: token.colorTextTertiary,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                  {item.shortcut && (
                    <div
                      style={{
                        fontSize: 11,
                        color: token.colorTextTertiary,
                        flexShrink: 0,
                      }}
                    >
                      {item.shortcut}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  },
);
