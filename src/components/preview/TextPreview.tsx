import { useEffect, useState } from "react";
import { Spin, Alert, Tag, theme as antdTheme } from "antd";
import { attachmentApi, type TextPreviewData } from "@/lib/api";

interface Props {
  rel: string;
  fileName: string;
}

/**
 * 纯文本附件预览（md/txt/json/csv/yaml/代码 等）。
 *
 * 简单做法：等宽字体 + 保留换行 + 横向滚动。
 * 不做语法高亮——预览场景为主，需要语法高亮请用编辑器内代码块；
 * 项目已经有 lowlight，未来要加可以接进来。
 */
export function TextPreview({ rel, fileName }: Props) {
  const { token } = antdTheme.useToken();
  const [data, setData] = useState<TextPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    attachmentApi
      .previewText(rel)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rel]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: "100%", minHeight: 240 }}
      >
        <Spin tip="正在读取文件..." />
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="文本预览失败"
        description={error}
      />
    );
  }

  if (!data) return null;

  return (
    <div>
      <div
        style={{
          fontSize: 12,
          color: token.colorTextSecondary,
          marginBottom: 6,
        }}
      >
        {fileName} · 共 {data.totalLines.toLocaleString()} 行
        {data.truncated && (
          <Tag color="orange" style={{ marginLeft: 8, fontSize: 10 }}>
            已截断显示
          </Tag>
        )}
      </div>
      <pre
        style={{
          margin: 0,
          padding: "12px 14px",
          fontSize: 13,
          lineHeight: 1.55,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          background: token.colorFillQuaternary,
          color: token.colorText,
          borderRadius: 6,
          border: `1px solid ${token.colorBorderSecondary}`,
          maxHeight: 540,
          overflow: "auto",
          whiteSpace: "pre",
          wordBreak: "normal",
        }}
      >
        {data.content}
      </pre>
    </div>
  );
}
