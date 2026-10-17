/**
 * Dataview 块的配置编辑 Modal。
 *
 * - 选 kind（5 个固定模板）
 * - 根据 kind 显示对应参数控件（tag / folder / project）
 * - 通用：limit + 可选自定义标题
 */
import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Form,
  Select,
  Input,
  InputNumber,
  Cascader,
  message,
} from "antd";
import { folderApi, projectApi, tagApi } from "@/lib/api";
import type {
  DataviewConfig,
  DataviewKind,
  Folder,
  Project,
  Tag,
} from "@/types";

interface Props {
  open: boolean;
  initial: DataviewConfig;
  onClose: () => void;
  onSave: (next: DataviewConfig) => void;
}

const KIND_OPTIONS: { value: DataviewKind; label: string; hint: string }[] = [
  {
    value: "recent-notes",
    label: "最近修改的笔记",
    hint: "按 updated_at 倒序展示",
  },
  {
    value: "notes-by-tag",
    label: "按标签筛选笔记",
    hint: "选择一个标签，列出挂着该标签的笔记",
  },
  {
    value: "notes-by-folder",
    label: "文件夹下的笔记",
    hint: "选择一个文件夹，递归列出子孙文件夹的所有笔记",
  },
  {
    value: "pending-tasks",
    label: "未完成任务",
    hint: "全部未完成的主任务，按紧急度+截止日排序",
  },
  {
    value: "tasks-by-project",
    label: "项目下的任务",
    hint: "选择一个项目，列出该项目的所有任务（含已完成）",
  },
];

/** Folder 扁平列表 → Cascader 树（按 parent_id） */
function buildFolderTree(folders: Folder[]) {
  const map = new Map<number | null, Folder[]>();
  for (const f of folders) {
    const key = (f.parent_id ?? null) as number | null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  function build(parentId: number | null): {
    value: number;
    label: string;
    children?: ReturnType<typeof build>;
  }[] {
    return (map.get(parentId) ?? []).map((f) => {
      const kids = build(f.id);
      return {
        value: f.id,
        label: f.name,
        ...(kids.length > 0 ? { children: kids } : {}),
      };
    });
  }
  return build(null);
}

/** 在 Cascader 树里找 folderId 对应的祖先链（用于回填） */
function findFolderPath(
  tree: ReturnType<typeof buildFolderTree>,
  target: number,
): number[] | null {
  for (const node of tree) {
    if (node.value === target) return [node.value];
    if (node.children) {
      const sub = findFolderPath(node.children, target);
      if (sub) return [node.value, ...sub];
    }
  }
  return null;
}

export function DataviewBlockModal({ open, initial, onClose, onSave }: Props) {
  const [form] = Form.useForm<DataviewConfig>();
  const [kind, setKind] = useState<DataviewKind>(initial.kind);
  const [tags, setTags] = useState<Tag[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  // 打开 Modal 时加载依赖列表 + 回填表单
  useEffect(() => {
    if (!open) return;
    setKind(initial.kind);
    form.setFieldsValue({
      ...initial,
      limit: initial.limit ?? 10,
    });
    tagApi.list().then(setTags).catch(() => setTags([]));
    folderApi.list().then(setFolders).catch(() => setFolders([]));
    projectApi
      .list(false)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [open, initial, form]);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const initialFolderPath = useMemo(() => {
    if (initial.folderId == null) return undefined;
    return findFolderPath(folderTree, initial.folderId) ?? undefined;
  }, [folderTree, initial.folderId]);

  async function handleOk() {
    let values: DataviewConfig;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    // 校验：参数化模板必须有参数
    if (kind === "notes-by-tag" && !values.tag?.trim()) {
      message.warning("请选择一个标签");
      return;
    }
    if (kind === "notes-by-folder" && values.folderId == null) {
      message.warning("请选择一个文件夹");
      return;
    }
    if (kind === "tasks-by-project" && values.projectId == null) {
      message.warning("请选择一个项目");
      return;
    }
    onSave({
      kind,
      tag: kind === "notes-by-tag" ? values.tag?.trim() : undefined,
      folderId: kind === "notes-by-folder" ? values.folderId : undefined,
      projectId: kind === "tasks-by-project" ? values.projectId : undefined,
      limit: values.limit ?? 10,
      title: values.title?.trim() || undefined,
    });
  }

  return (
    <Modal
      title="编辑数据视图"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="保存"
      destroyOnHidden
      width={520}
    >
      <Form form={form} layout="vertical" initialValues={{ limit: 10 }}>
        <Form.Item label="视图类型" required>
          <Select
            value={kind}
            onChange={(v) => setKind(v)}
            options={KIND_OPTIONS.map((o) => ({
              value: o.value,
              label: (
                <div>
                  <div>{o.label}</div>
                  <div style={{ fontSize: 11, color: "#999" }}>{o.hint}</div>
                </div>
              ),
            }))}
            optionLabelProp="label"
          />
        </Form.Item>

        {kind === "notes-by-tag" && (
          <Form.Item name="tag" label="标签">
            <Select
              showSearch
              allowClear
              placeholder="选择标签"
              options={tags.map((t) => ({
                value: t.name,
                label: t.name,
              }))}
              filterOption={(input, option) =>
                String(option?.label ?? "")
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            />
          </Form.Item>
        )}

        {kind === "notes-by-folder" && (
          <Form.Item
            name="folderId"
            label="文件夹"
            getValueFromEvent={(value: number[] | undefined) =>
              value && value.length > 0 ? value[value.length - 1] : undefined
            }
            initialValue={initialFolderPath?.[initialFolderPath.length - 1]}
          >
            <Cascader
              options={folderTree}
              placeholder="选择文件夹（含子孙）"
              changeOnSelect
              defaultValue={initialFolderPath}
            />
          </Form.Item>
        )}

        {kind === "tasks-by-project" && (
          <Form.Item name="projectId" label="项目">
            <Select
              showSearch
              allowClear
              placeholder="选择项目"
              options={projects.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
              filterOption={(input, option) =>
                String(option?.label ?? "")
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            />
          </Form.Item>
        )}

        <Form.Item
          name="limit"
          label="最多展示"
          rules={[
            { required: true, message: "请输入数量" },
            { type: "number", min: 1, max: 200 },
          ]}
        >
          <InputNumber min={1} max={200} style={{ width: "100%" }} />
        </Form.Item>

        <Form.Item name="title" label="自定义标题（可选）">
          <Input placeholder="留空使用默认标题" maxLength={64} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
