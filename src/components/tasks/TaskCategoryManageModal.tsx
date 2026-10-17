import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Input,
  Button,
  List,
  Popconfirm,
  ColorPicker,
  App as AntdApp,
  theme as antdTheme,
} from "antd";
import { Plus, Trash2, Edit3, Check, X, GripVertical } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { taskCategoryApi } from "@/lib/api";
import type { TaskCategory } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 分类列表变化（增/删/改/排序）后回调，让父组件刷新 */
  onChanged?: () => void;
}

const PRESET_COLORS = [
  "#1677ff",
  "#52c41a",
  "#faad14",
  "#ff4d4f",
  "#722ed1",
  "#13c2c2",
  "#eb2f96",
  "#fa8c16",
  "#8c8c8c",
];

/** 提取后端错误的可读文案：剥掉 AppError::InvalidInput 自动加的"参数无效:"前缀 */
function extractMsg(e: unknown): string {
  const raw = String(e ?? "未知错误");
  return raw.replace(/^参数无效:\s*/, "");
}

/** 从颜色对象中拿 hex 字符串。AntD ColorPicker 回调可能给 Color 对象，也可能给字符串 */
function toHex(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toHexString" in value) {
    const fn = (value as { toHexString: () => string }).toHexString;
    if (typeof fn === "function") return fn.call(value);
  }
  return "#1677ff";
}

/**
 * 单条分类的可拖拽列表项。
 *
 * 设计要点：
 *   1. 拖动手柄独占：把 useSortable 的 listeners 只绑到左侧 GripVertical 图标，
 *      不绑到整行 —— 否则点编辑/删除按钮、点输入框（编辑态）都会触发拖拽。
 *   2. PointerSensor 在父级设了 5px 距离阈值，小幅 click 不会误激活拖拽。
 *   3. transform/transition 来自 dnd-kit，按 vertical 策略平移其他兄弟节点。
 */
interface SortableCategoryItemProps {
  category: TaskCategory;
  isEditing: boolean;
  editName: string;
  editColor: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditNameChange: (v: string) => void;
  onEditColorChange: (v: string) => void;
  onDelete: () => void;
  tokenColorText: string;
  tokenColorTextTertiary: string;
}

function SortableCategoryItem({
  category: c,
  isEditing,
  editName,
  editColor,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditNameChange,
  onEditColorChange,
  onDelete,
  tokenColorText,
  tokenColorTextTertiary,
}: SortableCategoryItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: c.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging
      ? { position: "relative" as const, zIndex: 999, opacity: 0.7 }
      : {}),
  };

  return (
    <div ref={setNodeRef} style={style}>
      <List.Item
        style={{ padding: "8px 4px" }}
        actions={
          isEditing
            ? [
                <Button
                  key="save"
                  type="text"
                  size="small"
                  icon={<Check size={14} />}
                  onClick={onSaveEdit}
                  title="保存"
                />,
                <Button
                  key="cancel"
                  type="text"
                  size="small"
                  icon={<X size={14} />}
                  onClick={onCancelEdit}
                  title="取消"
                />,
              ]
            : [
                <Button
                  key="edit"
                  type="text"
                  size="small"
                  icon={<Edit3 size={14} />}
                  onClick={onStartEdit}
                  title="编辑"
                />,
                <Popconfirm
                  key="del"
                  title="删除这个分类？"
                  description="原任务的分类会被清空（落到「未分类」），不会丢失"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={onDelete}
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<Trash2 size={14} />}
                    danger
                    title="删除"
                  />
                </Popconfirm>,
              ]
        }
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* 拖动手柄：仅这里挂 dnd-kit 的 listeners，避免和按钮/输入框冲突。
              编辑态隐藏手柄，提示用户先保存/取消才能继续重排。 */}
          {!isEditing && (
            <span
              {...attributes}
              {...listeners}
              style={{
                display: "inline-flex",
                alignItems: "center",
                cursor: "grab",
                color: tokenColorTextTertiary,
                touchAction: "none",
              }}
              title="拖动以重排"
            >
              <GripVertical size={14} />
            </span>
          )}
          {isEditing ? (
            <>
              <ColorPicker
                value={editColor}
                onChange={(v) => onEditColorChange(toHex(v))}
                presets={[{ label: "推荐", colors: PRESET_COLORS }]}
                size="small"
              />
              <Input
                size="small"
                value={editName}
                onChange={(e) => onEditNameChange(e.target.value)}
                onPressEnter={onSaveEdit}
                maxLength={30}
                autoFocus
                style={{ flex: 1 }}
              />
            </>
          ) : (
            <>
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: c.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 13, color: tokenColorText }}>{c.name}</span>
            </>
          )}
        </div>
      </List.Item>
    </div>
  );
}

export function TaskCategoryManageModal({ open, onClose, onChanged }: Props) {
  const { message } = AntdApp.useApp();
  const { token } = antdTheme.useToken();

  const [categories, setCategories] = useState<TaskCategory[]>([]);
  const [loading, setLoading] = useState(false);

  // 新建态
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#1677ff");

  // 编辑态：单条编辑
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#1677ff");

  async function load() {
    setLoading(true);
    try {
      const list = await taskCategoryApi.list();
      setCategories(list);
    } catch (e) {
      message.error(`加载分类失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      load();
      setNewName("");
      setNewColor("#1677ff");
      setEditingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** 名称是否和现有分类重复（前端预检，避免无谓的后端往返） */
  const newNameDup = useMemo(() => {
    const t = newName.trim();
    if (!t) return false;
    return categories.some((c) => c.name === t);
  }, [newName, categories]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      message.warning("请输入分类名称");
      return;
    }
    if (newNameDup) {
      message.warning(`分类名称「${name}」已存在`);
      return;
    }
    try {
      await taskCategoryApi.create({
        name,
        color: newColor,
        sort_order: categories.length,
      });
      setNewName("");
      setNewColor("#1677ff");
      await load();
      onChanged?.();
      message.success("已创建");
    } catch (e) {
      // 后端已用 AppError::InvalidInput("分类名称「xxx」已存在") 给出可读文案；
      // 直接展示，不加"创建失败:"前缀，避免双重啰嗦
      message.error(extractMsg(e));
    }
  }

  function startEdit(c: TaskCategory) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditColor(c.color);
  }
  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: number) {
    const name = editName.trim();
    if (!name) {
      message.warning("名称不能为空");
      return;
    }
    try {
      await taskCategoryApi.update(id, { name, color: editColor });
      setEditingId(null);
      await load();
      onChanged?.();
      message.success("已保存");
    } catch (e) {
      message.error(extractMsg(e));
    }
  }

  async function handleDelete(id: number) {
    try {
      await taskCategoryApi.delete(id);
      await load();
      onChanged?.();
      message.success("已删除（原任务回落到「未分类」）");
    } catch (e) {
      message.error(`删除失败: ${e}`);
    }
  }

  // PointerSensor 设 5px 激活距离：避免在拖动手柄上的微点击误触发拖拽
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  /** 拖完后把当前数组顺序 broadcast 到 sort_order：
   *  1. 乐观更新本地 state，UI 立刻反映新顺序
   *  2. 并行调多个 update_task_category 写后端 sort_order（分类条数极少，并行成本可忽略）
   *  3. 任一失败 → 提示 + reload 兜底回滚
   *  不新增 batch reorder API，复用现有 update Command，零后端改动 */
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = categories.findIndex((c) => c.id === active.id);
    const newIdx = categories.findIndex((c) => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const reordered = arrayMove(categories, oldIdx, newIdx);
    setCategories(reordered); // 乐观更新

    try {
      await Promise.all(
        reordered.map((c, idx) =>
          c.sort_order === idx
            ? Promise.resolve(true)
            : taskCategoryApi.update(c.id, { sort_order: idx }),
        ),
      );
      onChanged?.();
    } catch (e) {
      message.error(`排序保存失败：${e}`);
      await load(); // 回滚到服务端真实顺序
    }
  }

  return (
    <Modal
      title="管理待办分类"
      open={open}
      onCancel={onClose}
      footer={
        <Button onClick={onClose}>关闭</Button>
      }
      width={480}
      destroyOnHidden
    >
      <div className="flex flex-col gap-3">
        {/* 新建行 */}
        <div
          style={{
            padding: 8,
            borderRadius: 6,
            background: token.colorFillQuaternary,
          }}
        >
          <div className="flex items-center gap-2">
            <ColorPicker
              value={newColor}
              onChange={(v) => setNewColor(toHex(v))}
              presets={[{ label: "推荐", colors: PRESET_COLORS }]}
              size="small"
            />
            <Input
              placeholder="新分类名称（如：工作 / 学习 / 生活）"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onPressEnter={handleCreate}
              maxLength={30}
              status={newNameDup ? "error" : undefined}
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              size="middle"
              icon={<Plus size={14} />}
              onClick={handleCreate}
              disabled={!newName.trim() || newNameDup}
            >
              新建
            </Button>
          </div>
          {newNameDup && (
            <div
              className="text-[11px] mt-1"
              style={{ color: token.colorError, paddingLeft: 36 }}
            >
              已存在同名分类
            </div>
          )}
        </div>

        {/* 列表（可拖拽重排） */}
        <DndContext sensors={dndSensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={categories.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <List
              loading={loading}
              dataSource={categories}
              locale={{ emptyText: "还没有分类，使用上方输入框创建第一个" }}
              renderItem={(c) => (
                <SortableCategoryItem
                  key={c.id}
                  category={c}
                  isEditing={editingId === c.id}
                  editName={editName}
                  editColor={editColor}
                  onStartEdit={() => startEdit(c)}
                  onCancelEdit={cancelEdit}
                  onSaveEdit={() => saveEdit(c.id)}
                  onEditNameChange={setEditName}
                  onEditColorChange={setEditColor}
                  onDelete={() => handleDelete(c.id)}
                  tokenColorText={token.colorText}
                  tokenColorTextTertiary={token.colorTextTertiary}
                />
              )}
            />
          </SortableContext>
        </DndContext>
      </div>
    </Modal>
  );
}
