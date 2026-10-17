#!/usr/bin/env node
// scripts/build-mcp.mjs
// 编译 kb-mcp sidecar，并按 Tauri externalBin 命名规范复制到 src-tauri/binaries/
//
// 用法：
//   pnpm build:mcp                                 — release，host triple
//   pnpm build:mcp --debug                         — debug 编译
//   pnpm build:mcp --target x86_64-apple-darwin    — cross-compile 到指定 target
//                                                    （CI 多 target 矩阵用，本地很少用）
//
// Tauri 要求 externalBin 文件名带 target triple 后缀，例：
//   binaries/kb-mcp-x86_64-pc-windows-msvc.exe
//   binaries/kb-mcp-aarch64-apple-darwin
//   binaries/kb-mcp-x86_64-unknown-linux-gnu

import { execSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_TAURI = join(ROOT, "src-tauri");
const BINARIES_DIR = join(SRC_TAURI, "binaries");

// ─── 解析参数 ───────────────────────────────
const argv = process.argv.slice(2);
const profile = argv.includes("--debug") ? "debug" : "release";
const profileFlag = profile === "release" ? "--release" : "";

// --target X 或 --target=X
function parseTarget() {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target" && argv[i + 1]) return argv[i + 1];
    if (a.startsWith("--target=")) return a.slice("--target=".length);
  }
  return null;
}
const explicitTarget = parseTarget();

// ─── 取 host triple ────────────────────────
function getHostTriple() {
  const r = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("rustc 未安装或不在 PATH 中");
  const m = r.stdout.match(/^host:\s*(\S+)$/m);
  if (!m) throw new Error("无法从 rustc -vV 解析 host triple");
  return m[1];
}

const targetTriple = explicitTarget || getHostTriple();
const isWin = targetTriple.includes("windows");
const exeSuffix = isWin ? ".exe" : "";

// 显式 --target 时 cargo 产物路径多一层 target/<triple>/<profile>/
const cargoProductDir = explicitTarget
  ? join(SRC_TAURI, "target", explicitTarget, profile)
  : join(SRC_TAURI, "target", profile);

// ─── 编译 ───────────────────────────────────
function buildMcp() {
  const targetFlag = explicitTarget ? `--target ${explicitTarget}` : "";
  const cmd = `cargo build ${profileFlag} ${targetFlag} -p kb-mcp`.replace(/\s+/g, " ");
  console.log(`[build-mcp] ${cmd}`);
  execSync(cmd, { cwd: SRC_TAURI, stdio: "inherit" });
}

// ─── 复制到 binaries/ ──────────────────────
function copyToBinaries() {
  const src = join(cargoProductDir, `kb-mcp${exeSuffix}`);
  if (!existsSync(src)) throw new Error(`找不到产物: ${src}`);
  if (!existsSync(BINARIES_DIR)) mkdirSync(BINARIES_DIR, { recursive: true });
  const dst = join(BINARIES_DIR, `kb-mcp-${targetTriple}${exeSuffix}`);
  copyFileSync(src, dst);
  console.log(`[build-mcp] copied → ${dst}`);
}

console.log(`[build-mcp] target = ${targetTriple}, profile = ${profile}${explicitTarget ? " (cross)" : " (host)"}`);
buildMcp();
copyToBinaries();
console.log("[build-mcp] done");
