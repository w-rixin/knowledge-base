//! T-S051 同步冲突解决
//!
//! V1 pull 在以下两种情况会把远端版本落地为冲突文件，本地保持原样：
//! 1. 双方 `updated_at` 完全相同但内容 hash 不同（manifest diff 的 `conflicts` 集合）
//! 2. 本地有未推送改动 + 远端也改了（pull.rs 的分歧检测兜底）
//!
//! 冲突文件路径：`<app_data>/sync_conflicts/backend_<id>/<stable_id>_<ts>.md`
//! （`<stable_id>` 是笔记 UUID；`<ts>` 是远端 `updated_at` 把 `:` 和空格换成 `-`）
//!
//! 本模块提供：
//! - `list_conflicts`：扫描所有 backend 的冲突文件，配上本地笔记内容，给 UI 做两栏 diff
//! - `resolve_conflict`：按"用本地 / 用远端 / 合并结果"写回笔记（bump updated_at 让本地下次 push 胜出）+ 删冲突文件

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::database::Database;
use crate::error::AppError;
use crate::models::NoteInput;

/// 冲突文件夹相对 app_data_dir 的根目录名（与 commands/sync_v1.rs::sync_v1_pull 里保持一致）
const CONFLICTS_ROOT: &str = "sync_conflicts";

/// 一条待解决的同步冲突
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictItem {
    /// 所属同步源 id
    pub backend_id: i64,
    /// 同步源名字（"我的坚果云"等），便于 UI 分组展示
    pub backend_name: String,
    /// 笔记 stable_uuid（从冲突文件名解析）
    pub stable_id: String,
    /// 本地笔记 id（本地已无此笔记 → None）
    pub note_id: Option<i64>,
    /// 笔记标题（优先本地标题；本地无 → 用远端 .md 的 H1；再无 → stable_id）
    pub title: String,
    /// 冲突文件绝对路径（resolve 时回传，用于定位 + 删除）
    pub conflict_file_path: String,
    /// 冲突文件名（仅用于展示）
    pub conflict_file_name: String,
    /// 冲突文件创建时间（≈ 远端那个冲突版本被拉下来的时间），ISO 字符串，best-effort
    pub detected_at: Option<String>,
    /// 本地笔记当前正文（加密笔记 / 本地已无 → 占位文案）
    pub local_content: String,
    /// 远端冲突版本正文（已去掉 `# 标题` 前缀；加密笔记 → 空串）
    pub remote_content: String,
    /// 是否加密笔记 —— 加密笔记不支持在此处合并，UI 只给"忽略"
    pub encrypted: bool,
    /// 本地是否已不存在此笔记（删了又收到冲突）—— 只能"用远端（重建）"或"忽略"
    pub note_missing_locally: bool,
}

/// 用户选择的解决方式
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictResolution {
    /// 保留本地版本（重写一遍本地内容以 bump updated_at，让下次 push 本地胜出）+ 删冲突文件
    KeepLocal,
    /// 采用远端版本（远端正文写回本地笔记）+ 删冲突文件
    UseRemote,
    /// 采用前端传回的手动合并结果 + 删冲突文件
    Merged,
}

/// 扫描所有同步源的冲突文件
pub fn list_conflicts(db: &Database, app_data_dir: &Path) -> Result<Vec<ConflictItem>, AppError> {
    let mut out = Vec::new();
    let backends = db.list_sync_backends()?;
    for be in &backends {
        let dir = app_data_dir
            .join(CONFLICTS_ROOT)
            .join(format!("backend_{}", be.id));
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue, // 该 backend 没有冲突目录 → 跳过
        };
        for ent in entries.flatten() {
            let path = ent.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let file_name = match path.file_name().and_then(|s| s.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            // 文件名：<stable_id>_<ts>.md  → 取第一个 '_' 之前作为 stable_id
            // （笔记 UUID 是 hex+dash，不含 '_'；ts 是 yyyy-mm-dd-HH-MM-SS，也不含 '_'）
            let stem = file_name.strip_suffix(".md").unwrap_or(&file_name);
            let stable_id = match stem.split_once('_') {
                Some((sid, _ts)) => sid.to_string(),
                None => stem.to_string(),
            };

            let remote_body = std::fs::read_to_string(&path).unwrap_or_default();

            // 本地笔记？
            let note_id = db.get_note_id_by_stable_uuid(&stable_id)?;
            let (title, local_content, encrypted, note_missing_locally) = match note_id {
                Some(id) => match db.get_note(id)? {
                    Some(n) if n.is_encrypted => (n.title, String::new(), true, false),
                    Some(n) => (n.title, n.content, false, false),
                    None => {
                        // id 查到了但笔记读不出（被软删）→ 当作本地无
                        let (t, _) = parse_remote_md(&remote_body, &stable_id);
                        (t, String::new(), false, true)
                    }
                },
                None => {
                    let (t, _) = parse_remote_md(&remote_body, &stable_id);
                    (t, String::new(), false, true)
                }
            };

            let remote_content = if encrypted {
                String::new()
            } else {
                let (_t, c) = parse_remote_md(&remote_body, &title);
                c
            };

            let detected_at = std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .map(|t| {
                    let dt: chrono::DateTime<chrono::Local> = t.into();
                    dt.format("%Y-%m-%d %H:%M:%S").to_string()
                });

            out.push(ConflictItem {
                backend_id: be.id,
                backend_name: be.name.clone(),
                stable_id,
                note_id,
                title,
                conflict_file_path: path.to_string_lossy().into_owned(),
                conflict_file_name: file_name,
                detected_at,
                local_content,
                remote_content,
                encrypted,
                note_missing_locally,
            });
        }
    }
    Ok(out)
}

/// 解决一条冲突
///
/// `conflict_file_path` 必须落在 `<app_data>/sync_conflicts/` 下（防止被当成任意文件删除接口）。
pub fn resolve_conflict(
    db: &Database,
    app_data_dir: &Path,
    conflict_file_path: &str,
    resolution: ConflictResolution,
    merged_content: Option<&str>,
) -> Result<(), AppError> {
    let path = PathBuf::from(conflict_file_path);

    // ── 安全校验：路径规范化后必须在 app_data/sync_conflicts/ 内
    let conflicts_root = app_data_dir.join(CONFLICTS_ROOT);
    let canon_root = conflicts_root
        .canonicalize()
        .unwrap_or_else(|_| conflicts_root.clone());
    let canon_path = path
        .canonicalize()
        .map_err(|e| AppError::Custom(format!("冲突文件不存在或无法访问: {}", e)))?;
    if !canon_path.starts_with(&canon_root) {
        return Err(AppError::Custom(
            "非法的冲突文件路径（不在 sync_conflicts 目录内）".into(),
        ));
    }

    let remote_body = std::fs::read_to_string(&canon_path)
        .map_err(|e| AppError::Custom(format!("读取冲突文件失败: {}", e)))?;

    // 从文件名解析 stable_id
    let file_name = canon_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    let stem = file_name.strip_suffix(".md").unwrap_or(file_name);
    let stable_id = match stem.split_once('_') {
        Some((sid, _)) => sid.to_string(),
        None => stem.to_string(),
    };

    let note_id = db.get_note_id_by_stable_uuid(&stable_id)?;
    let encrypted = match note_id {
        Some(id) => db.get_note_is_encrypted(id).unwrap_or(false),
        None => false,
    };

    if encrypted {
        // 加密笔记不在此处合并：任何 resolution 都只是"忽略"——清掉这条笔记的冲突标记文件
        if let Some(backend_dir) = canon_path.parent() {
            remove_conflict_files_for(backend_dir, &stable_id);
        }
        return Ok(());
    }

    match resolution {
        ConflictResolution::KeepLocal => {
            // 重写一遍本地内容 → updated_at 冒泡到现在 → 下次 push 本地胜出
            if let Some(id) = note_id {
                if let Some(n) = db.get_note(id)? {
                    db.update_note(
                        id,
                        &NoteInput {
                            title: n.title,
                            content: n.content,
                            folder_id: n.folder_id,
                        },
                    )?;
                }
            }
            // 本地已无此笔记 → 没什么可保留的，直接删冲突文件即可
        }
        ConflictResolution::UseRemote => {
            let (title, content) = parse_remote_md(&remote_body, &stable_id);
            match note_id {
                Some(id) => {
                    let folder_id = db.get_note(id)?.and_then(|n| n.folder_id);
                    db.update_note(
                        id,
                        &NoteInput {
                            title,
                            content,
                            folder_id,
                        },
                    )?;
                }
                None => {
                    // 本地已删 → 用远端 UUID 重建（保持多端 ID 稳定）。
                    // 冲突 .md 不携带 is_daily 信息 → 暂建为普通笔记；若它实为日记，下次
                    // get_or_create_daily 会按标题兜底认领，不会重复新建。
                    db.create_note_with_uuid(
                        &NoteInput {
                            title,
                            content,
                            folder_id: None,
                        },
                        &stable_id,
                        false,
                        None,
                        false,
                    )?;
                }
            }
        }
        ConflictResolution::Merged => {
            let merged =
                merged_content.ok_or_else(|| AppError::Custom("缺少合并结果内容".into()))?;
            match note_id {
                Some(id) => {
                    let n = db
                        .get_note(id)?
                        .ok_or_else(|| AppError::NotFound(format!("笔记 {} 不存在", id)))?;
                    db.update_note(
                        id,
                        &NoteInput {
                            title: n.title,
                            content: merged.to_string(),
                            folder_id: n.folder_id,
                        },
                    )?;
                }
                None => {
                    // 本地已删，但用户手动合并了 → 用远端标题 + 合并正文重建
                    // （同上：暂建为普通笔记，日记由 get_or_create_daily 兜底认领）
                    let (title, _) = parse_remote_md(&remote_body, &stable_id);
                    db.create_note_with_uuid(
                        &NoteInput {
                            title,
                            content: merged.to_string(),
                            folder_id: None,
                        },
                        &stable_id,
                        false,
                        None,
                        false,
                    )?;
                }
            }
        }
    }

    // 删掉这条笔记的所有冲突文件（当前格式只有 <uuid>.md 一个，但早期版本会堆多个 <uuid>_<ts>.md）
    if let Some(backend_dir) = canon_path.parent() {
        remove_conflict_files_for(backend_dir, &stable_id);
    }
    Ok(())
}

// ─── 冲突文件读写工具 ──────────────────────────────────────────
// 早期版本把分歧冲突写成 `<uuid>_<远端 updated_at>.md`，每次 pull 检测到分歧就生成一个新文件名
// （ts 不同 → 不覆盖）→ 同一条笔记的冲突文件越积越多。现在改用固定名 `<uuid>.md`（覆盖写），
// 并在写入 / 解决冲突时把该笔记历史堆积的旧文件一并清掉。

/// 某 `.md` 文件（stem，不含扩展名）是否属于笔记 `safe_id`：
/// 匹配 `<safe_id>`（当前固定名）或 `<safe_id>_<...>`（早期带远端时间戳的）。
fn is_conflict_file_of(file_stem: &str, safe_id: &str) -> bool {
    file_stem == safe_id
        || file_stem
            .strip_prefix(safe_id)
            .map_or(false, |rest| rest.starts_with('_'))
}

/// 删掉某 backend 冲突目录下属于 `stable_id` 的所有冲突文件（含历史堆积的带时间戳的旧文件）。
/// 删不掉的（权限等）忽略 —— 下次 list_conflicts 仍会列出，用户可再试。
fn remove_conflict_files_for(backend_conflicts_dir: &Path, stable_id: &str) {
    let safe_id = stable_id.replace('/', "_");
    let rd = match std::fs::read_dir(backend_conflicts_dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if p.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
            if is_conflict_file_of(stem, &safe_id) {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
}

/// 写一条笔记的冲突文件到 `<backend_conflicts_dir>/<stable_id>.md`（固定名，覆盖写）；
/// 写前先清掉该笔记历史堆积的旧冲突文件。
/// `backend_conflicts_dir` = `<app_data>/sync_conflicts/backend_<id>/`。
pub fn write_conflict_file(
    backend_conflicts_dir: &Path,
    stable_id: &str,
    body: &str,
) -> std::io::Result<()> {
    std::fs::create_dir_all(backend_conflicts_dir)?;
    remove_conflict_files_for(backend_conflicts_dir, stable_id);
    let safe_id = stable_id.replace('/', "_");
    std::fs::write(backend_conflicts_dir.join(format!("{}.md", safe_id)), body)
}

/// 解析冲突 `.md` 文件 → `(title, content)`。转发到 [`super::note_md::parse_note_md`]
/// （新格式 YAML front-matter + 兼容旧 `# 标题` 格式）。
fn parse_remote_md(body: &str, fallback_title: &str) -> (String, String) {
    super::note_md::parse_note_md(body, fallback_title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_remote_md_extracts_h1() {
        let (t, c) = parse_remote_md("# 标题A\n\n正文1\n正文2", "fb");
        assert_eq!(t, "标题A");
        assert_eq!(c, "正文1\n正文2");
    }

    #[test]
    fn parse_remote_md_fallback_when_no_h1() {
        let (t, c) = parse_remote_md("没有标题的正文", "兜底标题");
        assert_eq!(t, "兜底标题");
        assert_eq!(c, "没有标题的正文");
    }

    #[test]
    fn stable_id_parsed_from_filename() {
        // <uuid>_<ts>.md
        let fname = "11111111-2222-3333-4444-555555555555_2026-05-11-14-30-00.md";
        let stem = fname.strip_suffix(".md").unwrap();
        let sid = stem.split_once('_').unwrap().0;
        assert_eq!(sid, "11111111-2222-3333-4444-555555555555");
    }

    // ───────── 修 Bug：冲突文件堆积（固定名 + 清理旧文件）─────────

    #[test]
    fn is_conflict_file_of_matches_fixed_and_legacy_names() {
        assert!(is_conflict_file_of("uuid-abc", "uuid-abc")); // 当前固定名 <uuid>.md
        assert!(is_conflict_file_of("uuid-abc_2026-05-12-10-30-00", "uuid-abc")); // 早期 <uuid>_<ts>.md
        assert!(!is_conflict_file_of("uuid-abcde", "uuid-abc"), "前缀但非 '_' 边界，不算");
        assert!(!is_conflict_file_of("other-uuid", "uuid-abc"));
    }

    #[test]
    fn write_conflict_file_fixed_name_and_cleans_legacy_stack() {
        let dir = std::env::temp_dir().join("kb_sync_v1_conflict_write_test");
        let _ = std::fs::remove_dir_all(&dir);
        let sid = "11111111-1111-1111-1111-111111111111";

        // 模拟早期堆积的带时间戳冲突文件 + 另一条笔记的冲突文件（不该被动到）
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{}_2026-05-10-08-00-00.md", sid)), "old1").unwrap();
        std::fs::write(dir.join(format!("{}_2026-05-11-09-00-00.md", sid)), "old2").unwrap();
        std::fs::write(dir.join("22222222-2222-2222-2222-222222222222.md"), "other").unwrap();

        write_conflict_file(&dir, sid, "newest").unwrap();

        let names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        assert!(names.contains(&format!("{}.md", sid)), "应有固定名 <uuid>.md; got = {:?}", names);
        assert!(
            !names.iter().any(|n| n.starts_with(&format!("{}_", sid))),
            "早期带时间戳的旧文件应被清掉; got = {:?}",
            names
        );
        assert!(
            names.contains(&"22222222-2222-2222-2222-222222222222.md".to_string()),
            "别的笔记的冲突文件不受影响"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join(format!("{}.md", sid))).unwrap(),
            "newest"
        );

        // 再写一次 → 覆盖，不堆积
        write_conflict_file(&dir, sid, "newest2").unwrap();
        let mine = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(sid))
            .count();
        assert_eq!(mine, 1, "同一笔记最多一个冲突文件");
        assert_eq!(
            std::fs::read_to_string(dir.join(format!("{}.md", sid))).unwrap(),
            "newest2"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn remove_conflict_files_for_clears_all_variants_of_one_note() {
        let dir = std::env::temp_dir().join("kb_sync_v1_conflict_rm_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let sid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        std::fs::write(dir.join(format!("{}.md", sid)), "x").unwrap();
        std::fs::write(dir.join(format!("{}_2026-01-01-00-00-00.md", sid)), "y").unwrap();
        std::fs::write(dir.join(format!("{}_2026-02-02-00-00-00.md", sid)), "z").unwrap();
        std::fs::write(dir.join("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.md"), "keep").unwrap();

        remove_conflict_files_for(&dir, sid);

        let remaining: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        assert_eq!(remaining, vec!["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.md".to_string()]);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
