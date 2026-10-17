#!/usr/bin/env node
/**
 * Codex Stop Hook - 单 turn 结束时触发 (knowledge_base)
 *
 * 功能：
 *   1. 清理 Windows `> nul` 误用产生的 nul 文件（兜底，pre-tool-use 拦截后理论不再产生）
 *   2. 播放完成音效（复用 .claude/audio/completed.wav，若存在）
 *
 * Codex stdin schema：
 *   { session_id, turn_id, stop_hook_active, last_assistant_message, cwd, ... }
 *
 * Codex 输出：
 *   - 必须返回 JSON
 *   - {} → 正常结束
 *   - {decision:"block", reason} → 自动续 turn（不要乱用，会陷入死循环）
 *   - {continue:false} → 强制停止后续处理
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let raw = '';
let input = {};
try {
  raw = fs.readFileSync(0, 'utf8');
  if (raw) input = JSON.parse(raw);
} catch {
  // 输入异常时也要正常退出，不能阻塞 Codex
}

const cwd = input.cwd || process.cwd();

// 防御：stop_hook_active 表示已是 hook 触发的 re-entry，直接退出，避免连锁触发
if (input.stop_hook_active) {
  process.stdout.write('{}');
  process.exit(0);
}

// === 1. 清理 nul 文件（Windows `> nul` 误用兜底） ===
const findAndDeleteNul = (dir, depth = 0) => {
  if (depth > 5) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    try {
      if (entry.isFile() && entry.name === 'nul') {
        fs.unlinkSync(fullPath);
        process.stderr.write(`🧹 已清理: ${fullPath}\n`);
      } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'target') {
        // Tauri 项目跳过 src-tauri/target（编译缓存巨大）
        findAndDeleteNul(fullPath, depth + 1);
      }
    } catch {
      // 单文件异常不影响整体
    }
  }
};
findAndDeleteNul(cwd);

// === 2. 播放完成音效 ===
const audioFile = path.join(cwd, '.claude', 'audio', 'completed.wav');
try {
  if (fs.existsSync(audioFile)) {
    const platform = process.platform;
    if (platform === 'darwin') {
      execSync(`afplay "${audioFile}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
    } else if (platform === 'win32') {
      // PlaySync() 是同步播放，必须等待返回，否则 hook 退出后子进程会被终止
      execSync(
        `powershell -NoProfile -c "(New-Object Media.SoundPlayer '${audioFile.replace(/'/g, "''")}').PlaySync()"`,
        { stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
      );
    } else {
      try {
        execSync(`aplay "${audioFile}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        try { execSync(`paplay "${audioFile}"`, { stdio: ['pipe', 'pipe', 'pipe'] }); } catch {}
      }
    }
  }
} catch {
  // 音效失败静默忽略
}

// Codex 要求 Stop hook 返回 JSON
process.stdout.write('{}');
process.exit(0);
