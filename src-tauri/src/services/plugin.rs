//! 插件层（#8 方案 A）：把"外部 MCP server"包装成可分享 / 一键安装 / 脚手架创建的"插件"。
//!
//! 设计取舍：**插件 = 一个 stdio MCP server（任意语言）**。
//! - 复用现有 `McpClientManager`（进程隔离 + 缓存）+ `create_mcp_server`，安全面几乎零新增。
//! - "自己 coding" 满足：用户用任意语言写 MCP server 即是插件。
//! - 进程隔离 = 插件崩溃 / 恶意代码影响不到主进程与用户数据（只能调它被授予的工具）。
//!
//! 本模块只做两件现有 server CRUD 不覆盖的事：
//!   1. 从 `kb-plugin.json` 清单一键安装（解析 + `${PLUGIN_DIR}` 路径还原 → McpServerInput）
//!   2. 生成插件脚手架（一个可直接 `npm install && 编辑` 的 Node stdio MCP server 模板）

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::McpServerInput;

/// 插件清单 `kb-plugin.json` 的结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    #[serde(default = "default_manifest_version")]
    pub manifest_version: u32,
    /// 插件名（= 创建出的 MCP server 别名，需唯一）
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub homepage: String,
    /// 插件如何作为 MCP server 启动
    pub mcp: PluginMcp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMcp {
    /// 可执行命令（如 "node" / "python" / 绝对路径）
    pub command: String,
    /// 命令行参数；可用 `${PLUGIN_DIR}` 占位插件目录绝对路径
    #[serde(default)]
    pub args: Vec<String>,
    /// 环境变量；值里也可用 `${PLUGIN_DIR}`
    #[serde(default)]
    pub env: HashMap<String, String>,
}

fn default_manifest_version() -> u32 {
    1
}

pub struct PluginService;

impl PluginService {
    /// 解析清单 + 把 `${PLUGIN_DIR}` 替换为插件目录绝对路径，产出可建 server 的 `McpServerInput`。
    ///
    /// `base_dir` = 清单文件所在目录（前端导入 kb-plugin.json 时传它的父目录）。
    pub fn manifest_to_input(
        manifest_json: &str,
        base_dir: Option<&str>,
    ) -> Result<McpServerInput, AppError> {
        let m: PluginManifest = serde_json::from_str(manifest_json)
            .map_err(|e| AppError::Custom(format!("插件清单 JSON 解析失败: {e}")))?;
        if m.name.trim().is_empty() {
            return Err(AppError::Custom("插件清单缺少 name".into()));
        }
        if m.mcp.command.trim().is_empty() {
            return Err(AppError::Custom("插件清单缺少 mcp.command".into()));
        }

        // ${PLUGIN_DIR} → base_dir（没传 base_dir 就原样保留，留给用户用绝对路径）
        let subst = |s: &str| -> String {
            match base_dir {
                Some(d) => s.replace("${PLUGIN_DIR}", d),
                None => s.to_string(),
            }
        };

        Ok(McpServerInput {
            name: m.name.trim().to_string(),
            transport: "stdio".into(),
            command: subst(&m.mcp.command),
            args: m.mcp.args.iter().map(|a| subst(a)).collect(),
            env: m
                .mcp
                .env
                .iter()
                .map(|(k, v)| (k.clone(), subst(v)))
                .collect(),
            enabled: true,
        })
    }

    /// 生成插件脚手架：在 `parent_dir` 下建 `<安全名>/`，写入可直接运行的 Node stdio MCP server 模板。
    /// 返回创建的插件目录绝对路径。重名目录加 `_1`/`_2` 避免覆盖。
    pub fn scaffold(parent_dir: &str, name: &str) -> Result<String, AppError> {
        let parent = Path::new(parent_dir);
        std::fs::create_dir_all(parent)?;

        let safe = sanitize_name(name);
        let dir = unique_dir(parent, &safe);
        std::fs::create_dir_all(&dir)?;

        std::fs::write(dir.join("kb-plugin.json"), manifest_template(name))?;
        std::fs::write(dir.join("server.mjs"), SERVER_TEMPLATE)?;
        std::fs::write(dir.join("package.json"), package_template(&safe))?;
        std::fs::write(dir.join("README.md"), readme_template(name))?;

        Ok(dir.to_string_lossy().to_string())
    }
}

/// 目录名安全化：非法文件名字符替换为 `-`，空则给默认名。
fn sanitize_name(name: &str) -> String {
    let s: String = name
        .trim()
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | ' ' => '-',
            _ => c,
        })
        .collect();
    if s.is_empty() {
        "kb-plugin".into()
    } else {
        s
    }
}

/// 在 parent 下找一个尚未存在的目录名（base，否则 base-1 / base-2 …）。
fn unique_dir(parent: &Path, base: &str) -> std::path::PathBuf {
    if !parent.join(base).exists() {
        return parent.join(base);
    }
    for n in 1..10_000 {
        let cand = format!("{base}-{n}");
        if !parent.join(&cand).exists() {
            return parent.join(cand);
        }
    }
    parent.join(base)
}

fn manifest_template(name: &str) -> String {
    // 用 serde_json 构造，避免手拼字符串在 name 含 " / \ / 换行时生成非法 JSON。
    // args 用 ${PLUGIN_DIR} 占位，安装时由主应用还原为插件目录绝对路径。
    let manifest = PluginManifest {
        manifest_version: 1,
        name: name.trim().to_string(),
        description: "我的知识库插件（脚手架生成，请改成你的实现）".to_string(),
        version: "1.0.0".to_string(),
        author: String::new(),
        homepage: String::new(),
        mcp: PluginMcp {
            command: "node".to_string(),
            args: vec!["${PLUGIN_DIR}/server.mjs".to_string()],
            env: HashMap::new(),
        },
    };
    // 固定结构体序列化不会失败；万一失败给个最小合法兜底，绝不写出非法/空清单
    serde_json::to_string_pretty(&manifest)
        .map(|s| format!("{s}\n"))
        .unwrap_or_else(|_| "{\n  \"manifestVersion\": 1\n}\n".to_string())
}

fn package_template(safe: &str) -> String {
    format!(
        r#"{{
  "name": "{safe}",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Knowledge Base plugin (MCP stdio server)",
  "dependencies": {{
    "@modelcontextprotocol/sdk": "^1.0.0"
  }}
}}
"#
    )
}

fn readme_template(name: &str) -> String {
    format!(
        r#"# {name} · 知识库插件

这是一个**知识库插件**，本质是一个 stdio **MCP server**（用任意语言写都行，这里给的是 Node 模板）。
进程隔离运行，安全；你可以给它定义工具，供知识库的 AI 对话 / 外部 agent 调用。

## 开发步骤

1. 安装依赖：
   ```bash
   npm install
   ```
2. 编辑 `server.mjs`，在 `tools` 里加你自己的工具（参考里面的 `hello` 示例）。
3. 本地自测（可选）：
   ```bash
   node server.mjs   # 它会等待 stdin 的 JSON-RPC，一般交给 MCP 客户端驱动
   ```
4. 在知识库里安装：**设置 → MCP → 插件 → 安装插件（导入 kb-plugin.json）**，选本目录的 `kb-plugin.json`。
   安装后即出现在「外部 MCP server」列表，点「列出工具」可验证。

## 文件说明

- `kb-plugin.json` —— 插件清单。`args` 里的 `${{PLUGIN_DIR}}` 安装时会被还原成本插件目录绝对路径。
- `server.mjs` —— 插件主体（MCP server）。
- `package.json` —— Node 依赖。

## 想读写知识库内容？

插件读写笔记有两条路：
- 让插件**调用 `kb-mcp` CLI**（`kb-mcp --db-path <app.db> search "关键词"` 等）拿 JSON；
- 或在插件里直接打开 app.db（只读）查询（注意并发与 schema 兼容）。

> 建议优先用 `kb-mcp` CLI，schema 变动时不易出错。
"#
    )
}

/// 脚手架生成的 Node stdio MCP server 模板（可直接运行；用户在此基础上加工具）。
const SERVER_TEMPLATE: &str = r#"// 知识库插件 · MCP stdio server（脚手架模板）
// 依赖：@modelcontextprotocol/sdk（见 package.json）。改完 server 后到知识库里导入 kb-plugin.json 安装。
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "kb-plugin", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ① 在这里声明你的工具（name / description / inputSchema）
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "hello",
      description: "示例工具：回显一句问候。把它换成你自己的逻辑。",
      inputSchema: {
        type: "object",
        properties: { who: { type: "string", description: "要问候的对象" } },
      },
    },
  ],
}));

// ② 在这里实现工具调用
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "hello") {
    const who = req.params.arguments?.who ?? "world";
    return { content: [{ type: "text", text: `Hello, ${who}! 来自你的知识库插件。` }] };
  }
  throw new Error(`未知工具: ${req.params.name}`);
});

// stdout 是 JSON-RPC 通道，日志一律走 stderr，切勿 console.log 到 stdout
await server.connect(new StdioServerTransport());
console.error("[kb-plugin] ready");
"#;
