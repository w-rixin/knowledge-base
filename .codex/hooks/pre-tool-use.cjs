#!/usr/bin/env node
/**
 * Codex PreToolUse Hook - 工具执行前拦截 (knowledge_base 项目)
 *
 * 功能：阻止已知踩坑命令（Windows `> nul`、`rm -rf /` 等），并对敏感
 * 文件写入做提醒。匹配 Bash + apply_patch/Edit/Write 工具。
 *
 * Codex stdin schema：
 *   { session_id, turn_id, tool_name, tool_use_id, tool_input, cwd, ... }
 *   - Bash: tool_input.command
 *   - apply_patch: tool_input.input（unified diff 字符串，路径在 +++ 行）
 *
 * Codex 输出：
 *   - {hookSpecificOutput:{...permissionDecision:"deny", permissionDecisionReason}} → 阻止
 *   - {} 或不输出 → 放行
 *   - 加 systemMessage 字段可仅提示不阻止
 */

const fs = require('fs');

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

const toolName = input.tool_name || '';
const toolInput = input.tool_input || {};

const block = (reason) => {
  // Codex 官方推荐输出格式：hookSpecificOutput 嵌套结构（不可与旧格式 decision/reason 混用，
  // 否则 Codex 会判定为 "invalid pre-tool-use JSON output" 并放行命令）
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
};

const warn = (msg) => {
  process.stdout.write(JSON.stringify({ systemMessage: msg }));
  process.exit(0);
};

// ===== Bash 命令拦截 =====
if (toolName === 'Bash' || /^shell$/i.test(toolName)) {
  const command = toolInput.command || (Array.isArray(toolInput.argv) ? toolInput.argv.join(' ') : '');

  // Windows `> nul` 误用：会创建名为 nul 的文件
  if (/[12]?\s*>\s*nul\b/i.test(command)) {
    block(
      '🚫 命令被阻止：检测到 `> nul`\n\n' +
      '问题：Windows 的 bash 不识别 nul 设备，会创建名为 nul 的实体文件\n\n' +
      '解决方案：移除重定向，或改用 `> /dev/null 2>&1`（跨平台）\n\n' +
      `原命令: \`${command}\``
    );
  }

  const dangerous = [
    { p: /rm\s+-rf\s+\/(?!\w)/, why: '删除根目录' },
    { p: /rm\s+-rf\s+\*/, why: '删除所有文件' },
    // 拦截 rm -rf 后跟 Windows 绝对路径（如 D:/xxx 或 D:\xxx），带或不带引号、带或不带尾部 *
    { p: /rm\s+-rf\s+["']?[A-Za-z]:[\/\\][^"'\s]*["']?\s*\*?/i, why: '删除 Windows 绝对路径下的文件' },
    // 拦截 rm -rf 后跟 Unix 系统关键目录（放过项目内相对路径）
    { p: /rm\s+-rf\s+["']?\/(home|usr|etc|var|opt|root|tmp|bin|sbin|lib)\b/i, why: '删除系统关键目录' },
    { p: /drop\s+database/i, why: '删除数据库' },
    { p: /truncate\s+table/i, why: '清空表数据' },
    { p: /git\s+push\s+--force\s+(origin\s+)?(main|master)/i, why: '强制推送到主分支' },
    { p: /git\s+reset\s+--hard\s+HEAD~\d+/, why: '硬重置多个提交' },
    { p: />\s*\/dev\/sd[a-z]/, why: '直接写入磁盘设备' },
    { p: /mkfs\./, why: '格式化文件系统' },
    { p: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, why: 'Fork 炸弹' },
    // 全局指令禁令：禁止 taskkill /IM node.exe（会杀掉 Codex 自身）
    { p: /taskkill\s+(\/F\s+)?\/IM\s+node\.exe/i, why: 'taskkill /IM node.exe 会终止 Codex 自身进程，请用 npx kill-port 或精确 PID' },
    // PowerShell 等价：Stop-Process -Name node（也会杀 Codex 自身）
    { p: /Stop-Process\b[^|;\n]*-Name\s+["']?node\*?["']?(\b|\s)/i, why: 'Stop-Process -Name node 会终止 Codex 自身进程，请用 npx kill-port 或精确 PID' },
    // PowerShell 等价：Get-Process node | Stop-Process（管道形式）
    { p: /Get-Process\b[^|;\n]*\bnode\b[^|;\n]*\|\s*Stop-Process/i, why: '管道杀 node 进程会终止 Codex 自身，请用 npx kill-port 或精确 PID' },
    // PowerShell EncodedCommand：base64 包装命令绕过静态审计
    { p: /\b(powershell|pwsh)(\.exe)?\s+[-\/]+(enc|encodedcommand|e\b)/i, why: 'PowerShell -EncodedCommand 包装命令绕过审计，禁止使用（请用明文命令）' },
    // PowerShell 格式化磁盘（mkfs 的 Windows 等价）
    { p: /\bFormat-Volume\b/i, why: 'PowerShell 格式化磁盘卷（mkfs 等价）' },
    { p: /\bClear-Disk\b[^|;\n]*-RemoveData/i, why: 'PowerShell 清空磁盘数据' },
    // PowerShell 删除分区/卷
    { p: /\b(Remove-Partition|Remove-Volume)\b[^|;\n]*-(Confirm|Force)/i, why: 'PowerShell 删除磁盘分区/卷' },
    // PowerShell 关机/重启（强制）
    { p: /\b(Stop-Computer|Restart-Computer)\b[^|;\n]*-Force/i, why: 'PowerShell 强制关机/重启' },
    // cmd 关机
    { p: /\bshutdown\b[^|;\n]*\/[rspf]\b/i, why: 'shutdown 关机/重启命令' },
    // 远程下载执行（curl|bash 的 PowerShell 等价）：irm/iwr | iex
    { p: /\b(Invoke-RestMethod|Invoke-WebRequest|irm|iwr)\b[^|;\n]*\|\s*(iex|Invoke-Expression)\b/i, why: '远程下载并执行（IRM | IEX），无法审计远端脚本内容' },
    // Tauri 项目：禁止 cargo clean release（会清掉编译缓存导致重编译耗时）
    // 注：cargo clean 不算高危，但建议提示。这里仅警告不阻止
  ];

  for (const { p, why } of dangerous) {
    if (p.test(command)) {
      block(`⚠️ 危险操作被阻止\n\n命令: \`${command}\`\n原因: ${why}\n\n如确需执行，请手动在终端运行`);
    }
  }

  // PowerShell / cmd 删除组合检测
  // 触发条件：命令中同时出现 (Windows 绝对路径) + (递归/强制删除动词)
  const hasWinAbsPath = /[A-Za-z]:[\\/][^"'\s|;<>]+/.test(command);
  if (hasWinAbsPath) {
    const psDeletePatterns = [
      // PowerShell cmdlet：Remove-Item（任意参数都拦，避免 -LiteralPath/无 -Recurse 绕过）
      { p: /Remove-Item\b/i, why: 'PowerShell Remove-Item 删除 Windows 绝对路径' },
      // PowerShell 别名（与 Bash 重名）：rm / ri / erase / del + 任意参数
      { p: /\b(rm|ri|erase|del)\b\s+[^|;\n]*[A-Za-z]:[\\/]/i, why: 'PowerShell 别名删除 Windows 绝对路径' },
      // cmd：rd /s、rmdir /s（递归删除目录树）
      { p: /\b(rd|rmdir)\b[^|;\n]*\/[sS]\b/i, why: 'cmd 递归删除 Windows 绝对路径' },
      // cmd：del /s 或 del /f（递归/强制删除文件）
      { p: /\bdel\b[^|;\n]*\/[sSfF]\b/i, why: 'cmd 强制/递归删除 Windows 绝对路径' },
      // .NET 反射 API：[System.IO.File]::Delete / [IO.File]::Delete
      { p: /\[\s*(System\.)?IO\.File\s*\]\s*::\s*Delete/i, why: '.NET File API 删除 Windows 绝对路径' },
      // .NET 反射 API：[System.IO.Directory]::Delete
      { p: /\[\s*(System\.)?IO\.Directory\s*\]\s*::\s*Delete/i, why: '.NET Directory API 删除 Windows 绝对路径' },
      // .NET FileInfo / DirectoryInfo 实例方法 .Delete()
      { p: /\bNew-Object\s+(System\.)?IO\.(FileInfo|DirectoryInfo)\b/i, why: '.NET FileInfo/DirectoryInfo 删除 Windows 绝对路径' },
      // FileSystem.DeleteFile / DeleteDirectory（VisualBasic 接口）
      { p: /Microsoft\.VisualBasic\.FileIO\.FileSystem.*Delete(File|Directory)/i, why: 'VisualBasic FileSystem 删除 Windows 绝对路径' },
      // 间接执行：iex / Invoke-Expression（可能拼接出删除命令）
      { p: /\b(Invoke-Expression|iex)\b/i, why: '间接执行（Invoke-Expression）+ Windows 绝对路径，无法静态审计' },
      // robocopy /mir 到空目录（变相删除目标）
      { p: /\brobocopy\b[^|;\n]*\/(mir|purge)\b/i, why: 'robocopy MIR/PURGE 镜像删除 Windows 绝对路径' },
      // Clear-Content：清空文件内容（虽然不删文件本身，但破坏性同等）
      { p: /\bClear-Content\b/i, why: 'PowerShell Clear-Content 清空 Windows 绝对路径文件' }
    ];
    for (const { p, why } of psDeletePatterns) {
      if (p.test(command)) {
        block(`⚠️ 危险操作被阻止\n\n命令: \`${command}\`\n原因: ${why}\n\n如确需执行，请手动在终端运行`);
      }
    }
  }

  const warnings = [
    { p: /git\s+push\s+--force/, msg: 'Force push 可能覆盖他人代码' },
    { p: /npm\s+publish/, msg: '即将发布到 npm' },
    { p: /docker\s+system\s+prune/, msg: '将清理所有未使用的 Docker 资源' },
    // Tauri 项目特定提示
    { p: /cargo\s+clean/, msg: 'cargo clean 会清空 src-tauri/target 编译缓存，下次构建需完整重编译（耗时数分钟）' },
    { p: /pnpm\s+(remove|uninstall)/, msg: '即将移除 npm 依赖，确认不影响 vite/tauri 构建' }
  ];
  for (const { p, msg } of warnings) {
    if (p.test(command)) warn(`⚠️ 注意：${msg}`);
  }
}

// ===== apply_patch / Edit / Write 文件写入拦截 =====
if (/^(apply_patch|Edit|Write)$/i.test(toolName)) {
  // 不同形态的输入：apply_patch 用 input 字符串；Edit/Write 用 file_path
  const filePath = toolInput.file_path || '';
  const patchText = toolInput.input || toolInput.patch || '';

  const sensitive = [
    '.env',
    '.env.production',
    '.env.local',
    'tauri.conf.json',
    'credentials.json',
    'secrets.json',
    '.gitee_token',
    'gitcode_token'
  ];

  const hits = [];
  for (const f of sensitive) {
    if (filePath.endsWith(f) || (typeof patchText === 'string' && patchText.includes(f))) {
      hits.push(f);
    }
  }
  if (hits.length) {
    // tauri.conf.json 是项目核心配置（窗口/打包/CSP），改之前提醒用户慎重
    if (hits.includes('tauri.conf.json')) {
      warn(`⚠️ 即将修改 Tauri 核心配置文件 tauri.conf.json\n请确认改动不破坏 productName / identifier / bundle / security 等字段`);
    } else {
      warn(`⚠️ 敏感文件写入：${hits.join(', ')}\n请确保不要把密钥/Token 提交到 Git`);
    }
  }
}

// 默认放行（输出空对象，符合 Codex 期望的 JSON 形态）
process.stdout.write('{}');
process.exit(0);
