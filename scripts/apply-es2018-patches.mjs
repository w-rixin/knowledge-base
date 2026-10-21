#!/usr/bin/env node
/**
 * apply-es2018-patches.mjs
 * ------------------------------------------------------------------
 * 银河麒麟 V10 GFB 兼容补丁（aarch64 deb 专用，Windows/macOS 开发机同样执行，无害）
 *
 * 背景：目标机器的 webkit2gtk 2.28（focal 底）所用 JSC 不支持 ES2018 的
 * lookbehind 断言（(?<= / (?<!，WebKitGTK 2.40+ 才支持）。vite 的
 * target 降级只处理语法、不改写正则字面量，因此下列依赖中的 lookbehind
 * 会原样进入产物，在编辑器初始化 / Markdown 渲染 / mermaid 图表解析时
 * 直接抛 "invalid group specifier name" 导致白屏。
 *
 * 本脚本在 postinstall 阶段对 node_modules 中的 4 个依赖共 7 个文件做
 * 确定性字符串替换，语义等价改写（见各规则注释）。任何一条规则失配
 * （包版本变更导致原文消失）都会以非零码退出，阻止带病构建。
 *
 * 为什么不使用 patch-package：8.0.1 的 detectPackageManager 不识别
 * pnpm-lock.yaml，且 apply 模式按 node_modules/<pkg> 定位包，无法命中
 * pnpm 孤立布局（.pnpm/<pkg>@<ver>/node_modules/<pkg>）中的传递依赖。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 解析包在 node_modules 中的真实目录：
 * 1. 顶层 node_modules/<pkg>（直接依赖，pnpm 建 junction）
 * 2. pnpm 孤立布局 node_modules/.pnpm/<dir>/node_modules/<pkg>
 *    注意：pnpm 的 .pnpm 目录名对长名字会截断（如
 *    "@tiptap+extension-mathemati_fc48ca..."， mathematics 被截成
 *    mathemati_ + hash），不能简单按 <pkg>@<version> 前缀匹配，
 *    需遍历 + 读 package.json 验证 name/version 兜底。
 */
function resolvePkgDir(pkg, version) {
  const top = join(root, 'node_modules', pkg)
  if (existsSync(join(top, 'package.json'))) return top
  const dotPnpm = join(root, 'node_modules', '.pnpm')
  if (!existsSync(dotPnpm)) return null
  const escaped = pkg.replace('/', '+')
  const entries = readdirSync(dotPnpm)
  // 2a. 常规（未截断）目录名：<escaped>@<version>[_peerhash]
  const exactPrefix = `${escaped}@${version}`
  for (const d of entries.filter((x) => x.startsWith(exactPrefix)).sort()) {
    const p = join(dotPnpm, d, 'node_modules', pkg)
    if (existsSync(join(p, 'package.json'))) return p
  }
  // 2b. 截断目录名兜底：粗筛前缀后读 package.json 验证
  const coarse = escaped.slice(0, 20)
  for (const d of entries) {
    if (!d.startsWith(coarse)) continue
    const pj = join(dotPnpm, d, 'node_modules', pkg, 'package.json')
    if (!existsSync(pj)) continue
    try {
      const meta = JSON.parse(readFileSync(pj, 'utf8'))
      if (meta.name === pkg && meta.version === version) {
        return join(dotPnpm, d, 'node_modules', pkg)
      }
    } catch {
      /* 跳过无法解析的目录 */
    }
  }
  return null
}

/**
 * 规则表。subs 中每条为 [原始串, 替换串, 说明]。
 * 原始串均取自各包 npm 官方 tarball（pristine 源逐字节比对确认）。
 */
const RULES = [
  {
    pkg: '@tiptap/extension-mathematics',
    version: '3.22.4',
    file: 'dist/index.js',
    subs: [
      [
        'find: /(?<!\\$)(\\$\\$([^$\\n]+?)\\$\\$)(?!\\$)/,',
        'find: /(^|[^$])(\\$\\$([^$\\n]+?)\\$\\$)(?!\\$)/,',
        'inputRule：去掉 lookbehind，改为消费前导字符并在 handler 中补偿 start',
      ],
      [
        // 锚定 inlineMath handler 的上下文（const latex = match[2] 在前），
        // 避免误伤 blockMath 规则（/^\$\$\$([^$]+)\$\$\$$/，无捕获前缀，
        // 其 const start = range.from 必须保持原样）
        'const latex = match[2];\n          const { tr } = state;\n          const start = range.from;',
        'const latex = match[3];\n          const { tr } = state;\n          const start = range.from + match[1].length;',
        'inlineMath：组号后移一位 + start 跳过新消费的前导字符',
      ],
    ],
  },
  {
    pkg: '@tiptap/extension-mathematics',
    version: '3.22.4',
    file: 'dist/index.cjs',
    subs: [
      [
        'find: /(?<!\\$)(\\$\\$([^$\\n]+?)\\$\\$)(?!\\$)/,',
        'find: /(^|[^$])(\\$\\$([^$\\n]+?)\\$\\$)(?!\\$)/,',
        '同上（CJS 产物）',
      ],
      [
        'const latex = match[2];\n          const { tr } = state;\n          const start = range.from;',
        'const latex = match[3];\n          const { tr } = state;\n          const start = range.from + match[1].length;',
        '同上（CJS 产物，锚定上下文避免误伤 blockMath）',
      ],
    ],
  },
  {
    pkg: 'mdast-util-gfm-autolink-literal',
    version: '2.0.1',
    file: 'lib/index.js',
    subs: [
      [
        '/(?<=^|\\s|\\p{P}|\\p{S})([-.\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)/gu',
        '/([-.\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)/gu',
        'email autolink：lookbehind 边界判定改由 findEmail 的 previous() 手工完成（原函数已实现等效逻辑）',
      ],
    ],
  },
  {
    pkg: 'marked',
    version: '16.4.2',
    file: 'lib/marked.esm.js',
    subs: [
      [
        '(?<a>`+)[^`]+\\k<a>(?!`)',
        '(`+)[^`]+\\1(?!`)',
        'link 正则：命名组+反向引用 → 编号组+反向引用',
      ],
      [
        '(?<b>`+)[^`]+\\k<b>(?!`)',
        '(`+)[^`]+\\1(?!`)',
        'code 正则：同上',
      ],
    ],
  },
  {
    pkg: 'marked',
    version: '16.4.2',
    file: 'lib/marked.umd.js',
    subs: [
      [
        '(?<a>`+)[^`]+\\k<a>(?!`)',
        '(`+)[^`]+\\1(?!`)',
        'link 正则：同上（UMD 产物）',
      ],
      [
        '(?<b>`+)[^`]+\\k<b>(?!`)',
        '(`+)[^`]+\\1(?!`)',
        'code 正则：同上（UMD 产物）',
      ],
    ],
  },
  {
    pkg: 'mermaid',
    version: '11.14.0',
    file: 'dist/chunks/mermaid.esm/ganttDiagram-TCXCBYQ4.mjs',
    subs: [
      [
        '/^after\\s+(?<ids>[\\d\\w- ]+)/',
        '/^after\\s+([\\d\\w- ]+)/',
        'gantt after 语句：命名组 → 编号组',
      ],
      [
        'afterStatement.groups.ids.split(" ")',
        'afterStatement[1].split(" ")',
        'gantt after 语句：取值方式随组改写',
      ],
      [
        '/^until\\s+(?<ids>[\\d\\w- ]+)/',
        '/^until\\s+([\\d\\w- ]+)/',
        'gantt until 语句：命名组 → 编号组',
      ],
      [
        'untilStatement.groups.ids.split(" ")',
        'untilStatement[1].split(" ")',
        'gantt until 语句：取值方式随组改写',
      ],
    ],
  },
  {
    pkg: 'mermaid',
    version: '11.14.0',
    file: 'dist/chunks/mermaid.esm.min/ganttDiagram-MUNLMDZQ.mjs',
    subs: [
      [
        '/^after\\s+(?<ids>[\\d\\w- ]+)/',
        '/^after\\s+([\\d\\w- ]+)/',
        'gantt after 语句（压缩产物）',
      ],
      [
        '/^until\\s+(?<ids>[\\d\\w- ]+)/',
        '/^until\\s+([\\d\\w- ]+)/',
        'gantt until 语句（压缩产物）',
      ],
      [
        'u.groups.ids.split(" ")',
        'u[1].split(" ")',
        'gantt after/until 取值（压缩产物，共 2 处）',
      ],
    ],
  },
]

let totalApplied = 0
let totalSkipped = 0
const failures = []

for (const rule of RULES) {
  const pkgDir = resolvePkgDir(rule.pkg, rule.version)
  if (!pkgDir) {
    failures.push(
      `[${rule.pkg}@${rule.version}] 在 node_modules 中找不到包目录（版本可能已变更，需重新生成补丁规则）`,
    )
    continue
  }
  const filePath = join(pkgDir, rule.file)
  if (!existsSync(filePath)) {
    failures.push(
      `[${rule.pkg}@${rule.version}] 目标文件不存在: ${rule.file}（版本可能已变更，需重新生成补丁规则）`,
    )
    continue
  }
  let content = readFileSync(filePath, 'utf8')
  let fileChanged = false

  for (const [from, to, note] of rule.subs) {
    const count = content.split(from).length - 1
    if (count > 0) {
      content = content.split(from).join(to)
      totalApplied += count
      fileChanged = true
      console.log(`  ✔ ${rule.pkg} ${rule.file}: ${count} 处替换 — ${note}`)
    } else if (content.includes(to)) {
      totalSkipped += 1
      console.log(`  - ${rule.pkg} ${rule.file}: 已应用（幂等跳过）— ${note}`)
    } else {
      failures.push(
        `[${rule.pkg}@${rule.version}] ${rule.file} 中未找到预期字符串且无已补丁痕迹: ${JSON.stringify(from.slice(0, 60))}…`,
      )
    }
  }

  if (fileChanged) {
    writeFileSync(filePath, content, 'utf8')
  }
}

// 防误伤护栏：@tiptap/extension-mathematics 有两个 inputRule——
//   inlineMath  /(^|[^$])(\$\$([^$\n]+?)\$\$)(?!\$)/  需要 start 补偿
//   blockMath   /^\$\$\$([^$]+)\$\$\$$/               无捕获前缀，start 必须保持 range.from
// start 补偿在每个产物中只能出现 1 次；出现多次说明 blockMath 被污染。
{
  const pkgDir = resolvePkgDir('@tiptap/extension-mathematics', '3.22.4')
  if (pkgDir) {
    for (const f of ['dist/index.js', 'dist/index.cjs']) {
      const p = join(pkgDir, f)
      if (!existsSync(p)) continue
      const c = readFileSync(p, 'utf8')
      const n = c.split('range.from + match[1].length').length - 1
      if (n !== 1) {
        failures.push(
          `[防误伤护栏] @tiptap/extension-mathematics ${f} 中 start 补偿出现 ${n} 次（应为 1 次，blockMath 规则疑似被污染）`,
        )
      }
    }
  }
}

console.log('')
console.log(
  `ES2018 正则补丁: ${totalApplied} 处替换, ${totalSkipped} 处幂等跳过, ${failures.length} 处失败`,
)

if (failures.length > 0) {
  console.error('')
  console.error('补丁应用失败：')
  for (const f of failures) console.error(`  ✘ ${f}`)
  console.error('')
  console.error(
    '请检查上述依赖的版本是否发生变化；若为预期升级，需对照新版本重新生成补丁规则。',
  )
  process.exit(1)
}
