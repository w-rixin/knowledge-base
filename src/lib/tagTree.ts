import type { Tag } from "@/types";

/** antd `<TreeSelect>` 用的节点形状（fieldNames 默认 value/title/children） */
export type TagTreeSelectNode = {
  value: number;
  title: string;
  children?: TagTreeSelectNode[];
};

/**
 * 把扁平 Tag[] 组装成 antd `<TreeSelect>` 用的 treeData。
 *
 * - 孤儿（parent_id 指向不存在的 id）当作顶层
 * - value=数字 id（不是 string key），方便直接对接前端 `noteTags.map(t=>t.id)`
 * - 不做 filter，调用方自己用 `treeNodeFilterProp="title"` + `showSearch` 处理搜索
 *
 * 用于：
 * - 新建标签弹窗（左侧 TagsPanel）的"父标签"下拉
 * - 笔记编辑器顶栏的"添加标签"多选
 */
export function buildTagTreeSelectData(tags: Tag[]): TagTreeSelectNode[] {
  const byId = new Map<number, Tag>();
  tags.forEach((t) => byId.set(t.id, t));

  const childrenMap = new Map<number | null, Tag[]>();
  for (const t of tags) {
    const parent =
      t.parent_id != null && byId.has(t.parent_id) ? t.parent_id : null;
    if (!childrenMap.has(parent)) childrenMap.set(parent, []);
    childrenMap.get(parent)!.push(t);
  }

  function build(tag: Tag): TagTreeSelectNode {
    const kids = (childrenMap.get(tag.id) ?? []).map(build);
    return {
      value: tag.id,
      title: tag.name,
      children: kids.length > 0 ? kids : undefined,
    };
  }
  return (childrenMap.get(null) ?? []).map(build);
}
