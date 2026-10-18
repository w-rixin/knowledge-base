// =============================================================================
// Tauri 1.x 兼容层 —— @tauri-apps/plugin-store
// =============================================================================
//
// 为什么需要：
//   npm 上的 @tauri-apps/plugin-store **只有 2.x 版本**（和 Rust 侧 crates.io
//   完全一样，Tauri v1 时代从未发布过 1.x npm 包）。
//   而 Rust 侧我们用的是 plugins-workspace `v1` 分支的 tauri-plugin-store，
//   它的命令名与参数格式和 v2 一致，只是**没有官方 npm 客户端**。
//
// 做法：按 v1 分支 guest-js/index.ts 的原样实现一遍（命令名、参数完全对齐），
//   并额外提供静态方法 `Store.load(path)` —— v2 才有静态 load，v1 是 new Store(path)。
//   这样调用方代码（src/store/index.ts 等）一行都不用改。
//
// 关联：tauri.conf.json 无需额外 allowlist（插件命令不经 allowlist 校验），
//   Rust 侧已在 lib.rs 注册 tauri_plugin_store::Builder。
// =============================================================================

import { invoke } from "@tauri-apps/api/tauri";

/** 与 v1 分支 guest-js 的 ChangePayload 对齐（此处仅用于类型完整性） */
export interface ChangePayload<T> {
  path: string;
  key: string;
  value: T | null;
}

export class Store {
  path: string;

  constructor(path: string) {
    this.path = path;
  }

  /**
   * v2 风格的静态加载器。
   * v1 的 Store 不需要「加载」——构造即可，所有读写都带 path 参数下发给后端。
   * 保留此方法是为了不改造调用方（`const store = await Store.load(FILE)`）。
   */
  static async load(path: string): Promise<Store> {
    return new Store(path);
  }

  async set(key: string, value: unknown): Promise<void> {
    return await invoke("plugin:store|set", { path: this.path, key, value });
  }

  async get<T>(key: string): Promise<T | null> {
    return await invoke<T | null>("plugin:store|get", { path: this.path, key });
  }

  async has(key: string): Promise<boolean> {
    return await invoke<boolean>("plugin:store|has", { path: this.path, key });
  }

  async delete(key: string): Promise<boolean> {
    return await invoke<boolean>("plugin:store|delete", { path: this.path, key });
  }

  async clear(): Promise<void> {
    return await invoke("plugin:store|clear", { path: this.path });
  }

  async reset(): Promise<void> {
    return await invoke("plugin:store|reset", { path: this.path });
  }

  async keys(): Promise<string[]> {
    return await invoke<string[]>("plugin:store|keys", { path: this.path });
  }

  async values<T>(): Promise<T[]> {
    return await invoke<T[]>("plugin:store|values", { path: this.path });
  }

  async entries<T>(): Promise<Array<[string, T]>> {
    return await invoke<Array<[string, T]>>("plugin:store|entries", { path: this.path });
  }

  async length(): Promise<number> {
    return await invoke<number>("plugin:store|length", { path: this.path });
  }

  /** 把内存中的改动落盘。v1 的 set 只改内存，必须显式 save。 */
  async save(): Promise<void> {
    return await invoke("plugin:store|save", { path: this.path });
  }
}

export default Store;
